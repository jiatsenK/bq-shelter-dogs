// ADR 0016：撤銷溜了不靠手機的復原證據，Worker 從 D1 溜狗紀錄找上一次，任何選好身分的人都能撤銷今天只剩一個名字的登記
// 執行：node --test worker/test/undo-revert.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { fakeD1 } from './fakes.mjs';
import { migrateCompactDatabase } from '../../scripts/migrate-compact-db.mjs';

const SITE = 'https://bq-shelter-dogs.jiatsen-k.workers.dev';
const TODAY = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

async function makeEnv() {
  const DB = fakeD1();
  await migrateCompactDatabase(DB);
  await DB.batch([
    DB.prepare("INSERT INTO v3_dogs(dog_id,name) VALUES('d1','老大'),('d2','新來的'),('d3','無編號')"),
    DB.prepare("INSERT INTO v3_dog_numbers(number,dog_id) VALUES('2025061101','d1'),('2026100101','d2')"),
    DB.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,synced_at) VALUES(1,'d3','','無編號','2026-10-01T00:00:00Z')"),
    DB.prepare("INSERT INTO v3_volunteers(volunteer_id,name,last_seen) VALUES('v1','維芬','2026-10-01'),('v2','小明','2026-10-01')"),
    DB.prepare("INSERT INTO v3_identity_names(code,name_key,name,volunteer_id) VALUES('c1','維芬','維芬','v1'),('c2','小明','小明','v2')"),
    DB.prepare("INSERT INTO v3_walks(dog_id,walk_date,position,walker_code,dog_number,dog_name) VALUES('d1','2026-01-02',0,'c2','2025061101','老大'),('d1','2026-03-04',0,'c1','2025061101','老大'),('d1','2026-03-04',1,'c2','2025061101','老大'),('d1',?,0,'c9','2025061101','老大'),('d3','2025-12-31',0,'c1','','無編號')").bind(TODAY),
  ]);
  return { DB, SHEET_WRITE_URL: 'https://script.example/exec' };
}
function fakeScript() {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    return new Response(JSON.stringify({ ok: true, today: TODAY, results: body.dogs.map(d => ({ id: d.id, name: d.name, status: 'restored' })) }));
  };
  return calls;
}
test.beforeEach(t => {
  worker.testing.resetState();
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
});
let ip = 0;
const post = async (env, body) => {
  const res = await worker.fetch(new Request(`${SITE}/api/walk`, { method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json', 'CF-Connecting-IP': `8.8.8.${++ip}` }, body: JSON.stringify(body) }), env);
  return { status: res.status, body: await res.json() };
};

test('沒有 prev 的撤銷：Worker 找今天以前最後一次的日期與名字，帶給小程式並回給網站', async () => {
  const env = await makeEnv(), calls = fakeScript();
  const r = await post(env, { action: 'undo', walker: '佳岑', dogs: [{ id: '2025061101', name: '老大', wrote: { walker: '佳岑' } }] });
  assert.equal(r.status, 200);
  const prev = { date: { date: '2026-03-04' }, walker: '維芬、小明' };
  assert.deepEqual(calls[0].dogs, [{ id: '2025061101', name: '老大', prev, wrote: { walker: '佳岑' } }]);
  assert.equal(calls[0].walker, undefined);
  assert.deepEqual(r.body.results[0].prev, prev);
});

test('從沒溜過留空白；沒編號的狗用名字找', async () => {
  const env = await makeEnv(), calls = fakeScript();
  await post(env, { action: 'undo', walker: '佳岑', dogs: [{ id: '2026100101', name: '新來的', wrote: { walker: '佳岑' } }, { id: '', name: '無編號', wrote: { walker: '佳岑' } }] });
  assert.deepEqual(calls[0].dogs.map(d => d.prev), [{ date: { text: '' }, walker: '' }, { date: { date: '2025-12-31' }, walker: '維芬' }]);
});

test('撤銷記進編輯紀錄：誰、哪隻狗、改前→改後', async () => {
  const env = await makeEnv();
  fakeScript();
  await post(env, { action: 'undo', walker: '小明', dogs: [{ id: '2025061101', name: '老大', wrote: { walker: '佳岑' } }] });
  const rows = (await env.DB.prepare('SELECT editor_name,kind,dog_number,before_json,after_json FROM v3_edit_log').all()).results;
  assert.deepEqual(rows, [{ editor_name: '小明', kind: 'walkundo', dog_number: '2025061101',
    before_json: JSON.stringify({ date: TODAY, walker: '佳岑' }), after_json: JSON.stringify({ date: '2026-03-04', walker: '維芬、小明' }) }]);
});

test('擋掉：沒選身分、名單不只一個人、找不到這隻狗', async () => {
  const env = await makeEnv(), calls = fakeScript();
  assert.equal((await post(env, { action: 'undo', dogs: [{ id: '2025061101', name: '老大', wrote: { walker: '佳岑' } }] })).status, 400);
  assert.equal((await post(env, { action: 'undo', walker: '佳岑', dogs: [{ id: '2025061101', name: '老大', wrote: { walker: '佳岑、維芬' } }] })).status, 400);
  const lost = await post(env, { action: 'undo', walker: '佳岑', dogs: [{ id: '1999', name: '誰', wrote: { walker: '佳岑' } }] });
  assert.equal(lost.status, 200);
  assert.deepEqual(lost.body.results, [{ id: '1999', name: '誰', status: 'notFound' }]);
  assert.equal(calls.length, 0);
});
