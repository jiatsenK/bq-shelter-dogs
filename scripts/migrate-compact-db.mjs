import { readFile } from 'node:fs/promises';

// 不連線正式服務，也不套用舊模型的 migrations。
export async function migrateCompactDatabase(db) {
  const sql = await readFile(new URL('../db/compact-schema.sql', import.meta.url), 'utf8');
  const statements = sql.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean);
  return db.batch(statements.map(sql => db.prepare(sql)));
}
