import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateCompactDatabase } from './migrate-compact-db.mjs';
import { fixedCareSql } from './copy-fixed-care.mjs';

// 預覽測試庫：「有人固定照顧」是網站寫進正式庫的，試算表沒有；照正式庫的編號名單套到測試庫（含取消）
test('fixedCareSql：名單上的編號設為固定照顧，其他取消；編號裡的引號不會壞掉 SQL', async () => {
  const db = fakeD1();
  await migrateCompactDatabase(db);
  for (const [id, n, care] of [['a', '101', 0], ['b', '102', 1], ['c', "10'3", 0]]) {
    await db.prepare('INSERT INTO v3_dogs(dog_id, name, fixed_care) VALUES(?,?,?)').bind(id, id, care).run();
    await db.prepare('INSERT INTO v3_dog_numbers(number, dog_id) VALUES(?,?)').bind(n, id).run();
  }
  await db.prepare(fixedCareSql(['101', "10'3"])).run();
  const rows = (await db.prepare('SELECT dog_id, fixed_care FROM v3_dogs ORDER BY dog_id').all()).results;
  assert.deepEqual(rows.map(r => [r.dog_id, r.fixed_care]), [['a', 1], ['b', 0], ['c', 1]]);
});
