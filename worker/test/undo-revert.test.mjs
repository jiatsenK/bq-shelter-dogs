// ADR 0016：撤銷溜了不靠手機的復原證據，Worker 從 D1 溜狗紀錄找上一次。
// #558 起舊版 POST /walk 的復原退場，只剩 D1 接受流程；#748 起走今日溜狗紀錄 module 入口（網站登記再復原）測
// 執行：node --test worker/test/undo-revert.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { fakeD1 } from './fakes.mjs';
import { createCompactDatabase } from '../../scripts/compact-schema.mjs';
import { resolveIdentity } from '../src/identity.js';
import { post, day } from './walk-fixture.mjs';

// 主清單上三隻狗今天都已經溜過、表上沒寫溜狗人：網站接手時「上一次」從溜狗紀錄找今天以前最後一次
async function makeEnv() {
  const DB = fakeD1();
  await createCompactDatabase(DB);
  const today = day();
  await DB.batch([
    DB.prepare("INSERT INTO v3_dogs(dog_id,name) VALUES('d1','老大'),('d2','新來的'),('d3','無編號')"),
    DB.prepare("INSERT INTO v3_dog_numbers(number,dog_id) VALUES('2025061101','d1'),('2026100101','d2')"),
    DB.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,walked_date,walker) VALUES(1,'d1','2025061101','老大',?1,''),(2,'d2','2026100101','新來的',?1,''),(3,'d3','','無編號',?1,'')").bind(today),
    DB.prepare("INSERT INTO v3_volunteers(volunteer_id,name,last_seen) VALUES('v1','小美','2026-10-01'),('v2','小明','2026-10-01')"),
    DB.prepare("INSERT INTO v3_identity_names(code,name_key,name,volunteer_id) VALUES('c1','小美','小美','v1'),('c2','小明','小明','v2')"),
    DB.prepare("INSERT INTO v3_walks(dog_id,walk_date,position,walker_code,dog_number,dog_name) VALUES('d1','2026-01-02',0,'c2','2025061101','老大'),('d1','2026-03-04',0,'c1','2025061101','老大'),('d1','2026-03-04',1,'c2','2025061101','老大'),('d1',?,0,'c9','2025061101','老大'),('d3','2025-12-31',0,'c1','','無編號')").bind(today),
  ]);
  await resolveIdentity(DB, '甲', 'test');
  return { DB, WALKER_KEY: 'test' };
}
const walk = (id, dog, extra = {}) => ({ action: 'walk', requestId: id, operationDate: day(), walker: '甲', dogs: [dog], ...extra });
// 甲登記溜了再復原，回復原後的目前值
async function walkThenUndo(env, dog) {
  const walked = await post(env, walk(`walk-${dog.id || 'noid'}-0001`, dog));
  assert.equal(walked.status, 200);
  const undo = await post(env, walk(`undo-${dog.id || 'noid'}-0002`, { ...dog, expectedVersion: walked.body.results[0].version }, { action: 'undo' }));
  assert.equal(undo.status, 200);
  return undo.body.results[0].current;
}

test('今天以前最後一次的日期與那天的名字；今天的紀錄不算', async () => {
  const env = await makeEnv(); worker.testing.resetState();
  try {
    assert.deepEqual(await walkThenUndo(env, { id: '2025061101', name: '老大' }), { date: '2026-03-04', walker: '小美、小明' });
  } finally { env.DB.close(); }
});

test('從沒溜過留空白；沒編號的狗用名字找；找不到這隻狗不接受', async () => {
  const env = await makeEnv(); worker.testing.resetState();
  try {
    assert.deepEqual(await walkThenUndo(env, { id: '2026100101', name: '新來的' }), { date: '', walker: '' });
    assert.deepEqual(await walkThenUndo(env, { id: '', name: '無編號' }), { date: '2025-12-31', walker: '小美' });
    assert.equal((await post(env, walk('walk-missing-0001', { id: '1999', name: '誰' }))).status, 409);
  } finally { env.DB.close(); }
});
