// 今日溜狗紀錄（ADR 0007）：按溜了／復原寫試算表成功後記進 D1，GET /api/today 讀今天的清單
// 執行：node --test worker/test/today.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { fakeD1 } from './fakes.mjs';
import { migrateCompactDatabase } from '../../scripts/migrate-compact-db.mjs';

const SITE = 'https://bq-shelter-dogs.<子網域>.workers.dev';
const TODAY = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

async function makeEnv() {
  const DB = fakeD1();
  await migrateCompactDatabase(DB);
  return { DB, SHEET_WRITE_URL: 'https://script.example/exec' };
}
// 假小程式：照 apps-script/sheet-write.gs 的回法
function fakeScript(reply) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    return new Response(JSON.stringify({ ok: true, today: TODAY, results: reply(body) }));
  };
  return calls;
}
test.beforeEach(t => {
  worker.testing.resetState();
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
});

let ip = 0;
const post = body => new Request(`${SITE}/api/walk`, { method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json', 'CF-Connecting-IP': `9.9.9.${++ip}` }, body: JSON.stringify(body) });
const today = async env => (await worker.fetch(new Request(`${SITE}/api/today`, { headers: { Origin: SITE } }), env)).json();

const sheet = body => body.dogs.map(d => body.action === 'walk'
  ? { id: d.id, name: d.name, status: 'written', prev: { date: { date: '2026-10-01' }, walker: '志工乙' }, wrote: { walker: body.walker } }
  : { id: d.id, name: d.name, status: 'restored' });

test('按溜了：寫試算表成功後今天清單馬上有，記誰溜的；沒編號的狗用「名:犬名」', async () => {
  const env = await makeEnv();
  fakeScript(sheet);
  assert.equal((await worker.fetch(post({ action: 'walk', walker: 'K', dogs: [{ id: '9001', name: '甲' }, { id: '', name: '新來的' }] }), env)).status, 200);
  const out = await today(env);
  assert.equal(out.date, TODAY);
  assert.deepEqual(out.walks.map(w => [w.key, w.walked, w.walkedDate, w.walker]).sort(), [['9001', true, TODAY, 'K'], ['名:新來的', true, TODAY, 'K']]);
});

test('K 誤按已溜後按復原：今天清單改成沒溜（記回原本的日期和人），網站不會再算 K 今天溜過', async () => {
  const env = await makeEnv();
  fakeScript(sheet);
  await worker.fetch(post({ action: 'walk', walker: 'K', dogs: [{ id: '9001', name: '甲' }] }), env);
  assert.equal((await today(env)).walks[0].walked, true);
  const undo = { action: 'undo', dogs: [{ id: '9001', name: '甲', prev: { date: { date: '2026-10-01' }, walker: '志工乙' }, wrote: { walker: 'K' } }] };
  assert.equal((await worker.fetch(post(undo), env)).status, 200);
  const [w] = (await today(env)).walks;
  assert.deepEqual([w.key, w.walked, w.walkedDate, w.walker], ['9001', false, '2026-10-01', '志工乙']);
});

test('試算表沒寫進去、找不到狗：不記；D1 寫失敗：按的人照常成功', async () => {
  const env = await makeEnv();
  fakeScript(body => body.dogs.map(d => ({ id: d.id, name: d.name, status: 'notFound' })));
  await worker.fetch(post({ action: 'walk', walker: 'K', dogs: [{ id: '9001', name: '甲' }] }), env);
  assert.deepEqual((await today(env)).walks, []);
  fakeScript(sheet);
  const broken = { ...env, DB: { prepare: () => ({ bind() { return this; } }), batch: async () => { throw new Error('D1 壞了'); } } };
  const res = await worker.fetch(post({ action: 'walk', walker: 'K', dogs: [{ id: '9001', name: '甲' }] }), broken);
  assert.equal(res.status, 200);
});

test('今天以前的紀錄下次寫入時清掉；GET /api/today 只回今天；沒接 D1 回 503', async () => {
  const env = await makeEnv();
  await env.DB.prepare("INSERT INTO v3_today_walks VALUES('2020-01-01','old',1,'2020-01-01','舊','x')").run();
  fakeScript(sheet);
  await worker.fetch(post({ action: 'walk', walker: 'K', dogs: [{ id: '9001', name: '甲' }] }), env);
  assert.deepEqual((await env.DB.prepare('SELECT dog_key FROM v3_today_walks').all()).results, [{ dog_key: '9001' }]);
  const res = await worker.fetch(new Request(`${SITE}/api/today`, { headers: { Origin: SITE } }), {});
  assert.equal(res.status, 503);
});
