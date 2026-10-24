// 預覽測試庫整份換成正式庫資料（.github/workflows/seed-preview-db.yml，#520）：試算表同步退役後（#501）沒有別的灌法。
// 正式庫只跑 `d1 export`（只讀）；清空與匯入都明確帶 wrangler.preview-db.jsonc，只碰測試庫
// copyDatabase 也給套用 migration 前把正式庫複製到備用庫（scripts/d1-migrations.mjs，#553）
import { runWrangler } from './d1-database.mjs';
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

// from／to：{ name, config }。from 只跑 d1 export（只讀）；to 先清空再匯入，不能是正式庫。
// 匯出含 d1_migrations，複製後的庫記得自己套過哪些 migration（#553）
export function copyDatabase({ from, to, d1 = wranglerD1 }) {
  if (to.name === PROD_DB) throw new Error('複製的目的地不能是正式庫');
  const dump = join(mkdtempSync(join(tmpdir(), 'copy-d1-')), 'dump.sql');
  d1(['export', from.name, '--remote', '--config', from.config, '--output', dump]);
  writeFileSync(dump, splitLongInserts(readFileSync(dump, 'utf8')));
  const target = [to.name, '--remote', '--config', to.config];
  const objects = JSON.parse(d1(['execute', ...target, '--json', '--command', "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','view','trigger')"]))[0].results;
  d1(['execute', ...target, '--command', dropAllSql(objects)]);
  d1(['execute', ...target, '--yes', '--file', dump]);
  return objects.filter(o => !isSystem(o.name)).length;
}

const PROD_DB = 'bq-shelter-dogs';
const wranglerD1 = args => runWrangler(['d1', ...args], { stderr: 'inherit', maxBuffer: 64 * 1024 * 1024 });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const n = copyDatabase({ from: { name: PROD_DB, config: 'wrangler.jsonc' }, to: { name: 'bq-shelter-dogs-test', config: 'wrangler.preview-db.jsonc' } });
  console.log(`測試庫清掉 ${n} 個物件，已匯入正式庫匯出`);
}
