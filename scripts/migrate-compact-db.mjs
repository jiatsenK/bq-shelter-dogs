import { readFile } from 'node:fs/promises';

// #248 加的欄位：已經建好的 v3_walks 用 ALTER 補上（CREATE TABLE IF NOT EXISTS 不會改舊表）
const ADDED = [['v3_walks', 'dog_number', "TEXT NOT NULL DEFAULT ''"], ['v3_walks', 'dog_name', "TEXT NOT NULL DEFAULT ''"]];

// 不連線正式服務，也不套用舊模型的 migrations。
export async function migrateCompactDatabase(db) {
  const sql = await readFile(new URL('../db/compact-schema.sql', import.meta.url), 'utf8');
  const statements = sql.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean);
  const result = await db.batch(statements.map(sql => db.prepare(sql)));
  for (const [table, column, type] of ADDED) {
    const { results } = await db.prepare(`PRAGMA table_info(${table})`).all();
    if (!results.some(c => c.name === column)) await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
  }
  return result;
}
