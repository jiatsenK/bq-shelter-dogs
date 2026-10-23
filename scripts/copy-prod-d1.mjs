// 預覽測試庫整份換成正式庫資料（.github/workflows/seed-preview-db.yml，#520）：試算表同步退役後（#501）沒有別的灌法。
// 正式庫只跑 `d1 export`（只讀）；清空與匯入都明確帶 wrangler.preview-db.jsonc，只碰測試庫
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ident = name => `"${String(name).replace(/"/g, '""')}"`;
const isSystem = name => /^(sqlite_|_cf_)/.test(name);

// 匯出檔自帶建表與觸發器，匯入前測試庫要清空；索引隨表一起刪。刪表時 SQLite 會檢查參照它的子表，
// 子表的父表已不在就報錯，所以依建表 SQL 的 REFERENCES 排序：參照別人的表先刪
export function dropAllSql(objects) {
  const keep = type => objects.filter(o => o.type === type && !isSystem(o.name));
  const tables = new Map(keep('table').map(o => [o.name, [...String(o.sql ?? '').matchAll(/REFERENCES\s+"?(\w+)/gi)].map(m => m[1])]));
  const order = [], seen = new Set();
  const visit = name => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const [child, parents] of tables) if (child !== name && parents.includes(name)) visit(child);
    order.push(name);
  };
  for (const name of tables.keys()) visit(name);
  const drop = (type, names) => names.map(name => `DROP ${type} IF EXISTS ${ident(name)};`);
  return ['PRAGMA defer_foreign_keys=ON;', ...drop('TRIGGER', keep('trigger').map(o => o.name)), ...drop('VIEW', keep('view').map(o => o.name)), ...drop('TABLE', order)].join('\n');
}

// 匯出檔一列一句 INSERT；Worker 存資料包每段到 1MB（參數綁定沒事），寫成 SQL 文字會超過 D1 單句上限（SQLITE_TOOBIG）。
// 過長的句子把最長的字串分段接到暫存表 _copy_long 的一列，原處換成子查詢讀回，直到句子在上限內
const bytes = text => Buffer.byteLength(text);
const quote = text => `'${text.replace(/'/g, "''")}'`;

function pieces(text, limit) {
  const out = [];
  let piece = '';
  for (const ch of text) {
    if (piece && bytes(quote(piece + ch)) > limit) { out.push(piece); piece = ''; }
    piece += ch;
  }
  return [...out, piece];
}

export function splitLongInserts(sql, limit = 90_000) {
  let used = false;
  const lines = sql.split('\n').flatMap(line => {
    if (!line.startsWith('INSERT INTO') || bytes(line) <= limit) return [line];
    used = true;
    const out = [];
    for (let id = 1; bytes(line) > limit; id++) {
      const lit = [...line.matchAll(/'(?:[^']|'')*'/g)].sort((a, b) => b[0].length - a[0].length)[0];
      const head = 'UPDATE _copy_long SET t=t||', tail = ` WHERE id=${id};`;
      out.push(`INSERT INTO _copy_long VALUES(${id},'');`,
        ...pieces(lit[0].slice(1, -1).replace(/''/g, "'"), limit - bytes(head + tail)).map(p => head + quote(p) + tail));
      line = `${line.slice(0, lit.index)}(SELECT t FROM _copy_long WHERE id=${id})${line.slice(lit.index + lit[0].length)}`;
    }
    return [...out, line, 'DELETE FROM _copy_long;'];
  });
  if (!used) return sql;
  return [lines[0], 'CREATE TABLE IF NOT EXISTS _copy_long (id INTEGER PRIMARY KEY, t TEXT NOT NULL);', ...lines.slice(1), 'DROP TABLE IF EXISTS _copy_long;'].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const testDb = ['bq-shelter-dogs-test', '--remote', '--config', 'wrangler.preview-db.jsonc'];
  const wrangler = args => execFileSync('npx', ['--yes', 'wrangler@4', 'd1', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
  const dump = join(mkdtempSync(join(tmpdir(), 'prod-d1-')), 'prod.sql');
  wrangler(['export', 'bq-shelter-dogs', '--remote', '--output', dump]);
  writeFileSync(dump, splitLongInserts(readFileSync(dump, 'utf8')));
  const objects = JSON.parse(wrangler(['execute', ...testDb, '--json', '--command', "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','view','trigger')"]))[0].results;
  wrangler(['execute', ...testDb, '--command', dropAllSql(objects)]);
  wrangler(['execute', ...testDb, '--yes', '--file', dump]);
  console.log(`測試庫清掉 ${objects.filter(o => !isSystem(o.name)).length} 個物件，已匯入正式庫匯出`);
}
