import test from 'node:test';
import assert from 'node:assert/strict';
import { addedColumnsSql } from './migrate-compact-db.mjs';

// 預覽測試庫是 fixed_care 加入前建的表（CREATE TABLE IF NOT EXISTS 不改舊表），預覽讀狗時 no such column
test('addedColumnsSql：只補舊表缺的欄位，已經有的不重複加', () => {
  const sql = addedColumnsSql({ v3_walks: ['dog_id', 'dog_number', 'dog_name'], v3_dogs: ['dog_id', 'name'] });
  assert.deepEqual(sql, ['ALTER TABLE v3_dogs ADD COLUMN fixed_care INTEGER NOT NULL DEFAULT 0 CHECK(fixed_care IN (0,1))', 'ALTER TABLE v3_sheet_main ADD COLUMN walker TEXT']);
  assert.deepEqual(addedColumnsSql({ v3_walks: ['dog_number', 'dog_name'], v3_dogs: ['fixed_care'], v3_sheet_main: ['walker'] }), []);
});
