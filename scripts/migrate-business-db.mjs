// #215：明確呼叫才建新表，部署與 Worker 不會呼叫此入口。
import { readFile } from 'node:fs/promises';

export async function migrateBusinessDatabase(db) {
  const sql = await readFile(new URL('../db/migrations/0001_business_model.sql', import.meta.url), 'utf8');
  const statements = sql.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean);
  // 與 Wrangler migrations 相同的 SQL。IF NOT EXISTS 讓替身與還原演練可重跑。
  return db.batch(statements.map(statement => db.prepare(statement)));
}
