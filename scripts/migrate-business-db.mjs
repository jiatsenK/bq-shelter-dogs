// #215：明確呼叫才建新表，部署與 Worker 不會呼叫此入口。
import { readFile, readdir } from 'node:fs/promises';

export async function migrateBusinessDatabase(db) {
  const directory = new URL('../db/migrations/', import.meta.url);
  const results = [];
  for (const file of (await readdir(directory)).filter(f => /^\d+.*\.sql$/.test(f)).sort()) {
    const sql = await readFile(new URL(file, directory), 'utf8');
    const statements = sql.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean);
    // 每個版本一個交易，與 Wrangler 套同份 SQL；不由部署呼叫。
    results.push(...await db.batch(statements.map(statement => db.prepare(statement))));
  }
  return results;
}
