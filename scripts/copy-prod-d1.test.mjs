import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { createCompactDatabase } from './compact-schema.mjs';
import { dropAllSql, splitLongInserts } from './copy-prod-d1.mjs';

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
  await createCompactDatabase(db);
  const list = async () => (await db.prepare("SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','view','trigger') AND name NOT LIKE 'sqlite_%'").all()).results;
  // wrangler 的 --command 整串在同一個交易，延後的外鍵檢查才有效；這裡用 batch 模擬
  await db.batch(dropAllSql(await list()).split('\n').map(sql => db.prepare(sql)));
  assert.deepEqual(await list(), []);
});

// 匯出檔一列一句 INSERT；Worker 存資料包每段到 1MB（參數綁定沒事），寫成 SQL 文字會超過 D1 單句上限（SQLITE_TOOBIG）
test('splitLongInserts：過長的 INSERT 把長字串分段接到暫存表再讀回，匯入結果跟原本一模一樣', async () => {
  const long = `它's "長" ${'x'.repeat(50)}'';中文`.repeat(20);
  const dump = [
    'PRAGMA defer_foreign_keys=TRUE;',
    'CREATE TABLE t (k TEXT PRIMARY KEY, a TEXT, b TEXT);',
    `INSERT INTO "t" ("k","a","b") VALUES('short','x','y');`,
    `INSERT INTO "t" ("k","a","b") VALUES('long','${long.replace(/'/g, "''")}','${long.slice(0, 300).replace(/'/g, "''")}');`,
  ].join('\n');
  const out = splitLongInserts(dump, 400);
  const lines = out.split('\n');
  assert.ok(lines.every(l => Buffer.byteLength(l) <= 400), '每句都在上限內');
  assert.equal(lines.at(-1), 'DROP TABLE IF EXISTS _copy_long;');
  const db = fakeD1();
  await db.batch(lines.slice(1).map(sql => db.prepare(sql)));
  const rows = (await db.prepare('SELECT k, a, b FROM t ORDER BY k').all()).results;
  assert.deepEqual(rows.map(r => [r.k, r.a, r.b]), [['long', long, long.slice(0, 300)], ['short', 'x', 'y']]);
  assert.equal(splitLongInserts(dump.split('\n').slice(0, 3).join('\n'), 400), dump.split('\n').slice(0, 3).join('\n'), '都不長就原樣');
});
