// ADR 0016：撤銷溜了不靠手機的復原證據，Worker 從 D1 溜狗紀錄找上一次（previousWalk）。
// #558 起舊版 POST /walk 的復原退場，只剩 D1 接受流程（walk-accept.js）用它，這裡直接測函式
// 執行：node --test worker/test/undo-revert.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { previousWalk } from '../src/today.js';
import { fakeD1 } from './fakes.mjs';
import { migrateCompactDatabase } from '../../scripts/migrate-compact-db.mjs';

const TODAY = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

async function makeDb() {
  const DB = fakeD1();
  await migrateCompactDatabase(DB);
  await DB.batch([
    DB.prepare("INSERT INTO v3_dogs(dog_id,name) VALUES('d1','老大'),('d2','新來的'),('d3','無編號')"),
    DB.prepare("INSERT INTO v3_dog_numbers(number,dog_id) VALUES('2025061101','d1'),('2026100101','d2')"),
    DB.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,synced_at) VALUES(1,'d3','','無編號','2026-10-01T00:00:00Z')"),
    DB.prepare("INSERT INTO v3_volunteers(volunteer_id,name,last_seen) VALUES('v1','志工甲','2026-10-01'),('v2','小明','2026-10-01')"),
    DB.prepare("INSERT INTO v3_identity_names(code,name_key,name,volunteer_id) VALUES('c1','志工甲','志工甲','v1'),('c2','小明','小明','v2')"),
    DB.prepare("INSERT INTO v3_walks(dog_id,walk_date,position,walker_code,dog_number,dog_name) VALUES('d1','2026-01-02',0,'c2','2025061101','老大'),('d1','2026-03-04',0,'c1','2025061101','老大'),('d1','2026-03-04',1,'c2','2025061101','老大'),('d1',?,0,'c9','2025061101','老大'),('d3','2025-12-31',0,'c1','','無編號')").bind(TODAY),
  ]);
  return DB;
}

test('今天以前最後一次的日期與那天的名字；今天的紀錄不算', async () => {
  const db = await makeDb();
  assert.deepEqual(await previousWalk(db, { id: '2025061101', name: '老大' }, TODAY), { date: { date: '2026-03-04' }, walker: '志工甲、小明' });
});

test('從沒溜過留空白；沒編號的狗用名字找；找不到這隻狗回 null', async () => {
  const db = await makeDb();
  assert.deepEqual(await previousWalk(db, { id: '2026100101', name: '新來的' }, TODAY), { date: { text: '' }, walker: '' });
  assert.deepEqual(await previousWalk(db, { id: '', name: '無編號' }, TODAY), { date: { date: '2025-12-31' }, walker: '志工甲' });
  assert.equal(await previousWalk(db, { id: '1999', name: '誰' }, TODAY), null);
});
