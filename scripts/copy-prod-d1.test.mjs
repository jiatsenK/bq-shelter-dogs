import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateCompactDatabase } from './migrate-compact-db.mjs';
import { dropAllSql } from './copy-prod-d1.mjs';

// 預覽測試庫整份換成正式庫匯出前，先清空測試庫：觸發器、檢視、資料表全刪，系統表（sqlite_、_cf_）不動
test('dropAllSql：先刪觸發器與檢視再刪表，參照別人的表先刪，略過系統表，名稱引號不會壞掉 SQL', () => {
  const sql = dropAllSql([
    { type: 'table', name: 'v3_dogs', sql: 'CREATE TABLE v3_dogs (dog_id TEXT PRIMARY KEY)' },
    { type: 'table', name: 'v3_dog_numbers', sql: 'CREATE TABLE v3_dog_numbers (dog_id TEXT REFERENCES v3_dogs(dog_id))' },
    { type: 'trigger', name: 'walk_pack_INSERT' },
    { type: 'index', name: 'idx_x' },
    { type: 'view', name: 'v"x' },
    { type: 'table', name: 'sqlite_sequence' },
    { type: 'table', name: '_cf_KV' },
  ]);
  assert.equal(sql, [
    'PRAGMA defer_foreign_keys=ON;',
    'DROP TRIGGER IF EXISTS "walk_pack_INSERT";',
    'DROP VIEW IF EXISTS "v""x";',
    'DROP TABLE IF EXISTS "v3_dog_numbers";',
    'DROP TABLE IF EXISTS "v3_dogs";',
  ].join('\n'));
});

test('dropAllSql：套用到完整 schema 後測試庫沒有剩下任何資料表', async () => {
  const db = fakeD1();
  await migrateCompactDatabase(db);
  const list = async () => (await db.prepare("SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','view','trigger') AND name NOT LIKE 'sqlite_%'").all()).results;
  // wrangler 的 --command 整串在同一個交易，延後的外鍵檢查才有效；這裡用 batch 模擬
  await db.batch(dropAllSql(await list()).split('\n').map(sql => db.prepare(sql)));
  assert.deepEqual(await list(), []);
});
