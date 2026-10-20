import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// #248 加的欄位：已經建好的 v3_walks 用 ALTER 補上（CREATE TABLE IF NOT EXISTS 不會改舊表）
const ADDED = [['v3_walks', 'dog_number', "TEXT NOT NULL DEFAULT ''"], ['v3_walks', 'dog_name', "TEXT NOT NULL DEFAULT ''"],
  ['v3_dogs', 'fixed_care', 'INTEGER NOT NULL DEFAULT 0 CHECK(fixed_care IN (0,1))']];

// db/compact-schema.sql 拆成一句一句（不含結尾分號）；觸發器裡面也有分號，整段算一句
export async function compactSchemaStatements() {
  const sql = await readFile(new URL('../db/compact-schema.sql', import.meta.url), 'utf8');
  return sql.replace(/--[^\n]*/g, '').match(/CREATE TRIGGER[\s\S]*?END;|(?:(?!CREATE TRIGGER)[^;])+;/g).map(s => s.trim().replace(/;$/, '')).filter(Boolean);
}

// 不連線正式服務，也不套用舊模型的 migrations。
export async function migrateCompactDatabase(db) {
  const statements = await compactSchemaStatements();
  const result = await db.batch(statements.map(sql => db.prepare(sql)));
  const columns = {};
  for (const table of new Set(ADDED.map(([t]) => t))) columns[table] = (await db.prepare(`PRAGMA table_info(${table})`).all()).results.map(c => c.name);
  for (const sql of addedColumnsSql(columns)) await db.prepare(sql).run();
  return result;
}

// columns：{ 表名: [現有欄位名] }；回傳舊表缺的欄位要跑的 ALTER
export function addedColumnsSql(columns) {
  return ADDED.filter(([table, column]) => !(columns[table] || []).includes(column))
    .map(([table, column, type]) => `ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

// 預覽測試庫補欄位（.github/workflows/seed-preview-db.yml）：測試庫的表比 fixed_care 早建，CREATE TABLE IF NOT EXISTS 補不到。
// 只對測試庫，正式庫不從這裡改
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const d1 = args => JSON.parse(execFileSync('npx', ['--yes', 'wrangler@4', 'd1', 'execute', 'bq-shelter-dogs-test', '--remote', '--config', 'wrangler.preview-db.jsonc', '--json', '--command', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
  const columns = {};
  for (const table of new Set(ADDED.map(([t]) => t))) columns[table] = d1([`PRAGMA table_info(${table})`])[0].results.map(c => c.name);
  const sql = addedColumnsSql(columns);
  for (const s of sql) d1([s]);
  console.log(sql.length ? `測試庫補欄位：${sql.join('；')}` : '測試庫欄位齊全，不用補');
}
