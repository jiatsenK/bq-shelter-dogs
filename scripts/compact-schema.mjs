import { readFile } from 'node:fs/promises';

// SQL 拆成一句一句（不含結尾分號）；觸發器裡面也有分號，整段算一句。migrations/*.sql 也用這個（scripts/d1-migrations.mjs）
export function splitStatements(sql) {
  return (sql.replace(/--[^\n]*/g, '').match(/CREATE TRIGGER[\s\S]*?END;|(?:(?!CREATE TRIGGER)[^;])+;/g) || []).map(s => s.trim().replace(/;$/, '')).filter(Boolean);
}

export async function compactSchemaStatements() {
  return splitStatements(await readFile(new URL('../db/compact-schema.sql', import.meta.url), 'utf8'));
}

// 測試用：照 db/compact-schema.sql 建一個空庫（現在的完整樣子）。不連線正式服務
export async function createCompactDatabase(db) {
  const statements = await compactSchemaStatements();
  return db.batch(statements.map(sql => db.prepare(sql)));
}
