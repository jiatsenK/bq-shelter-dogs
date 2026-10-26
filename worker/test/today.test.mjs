// 舊今日溜狗退場（#558 第一步）：D1 今日溜狗開關打開後（ADR 0018，#533），網站只讀 /today?source=d1、按溜了都帶 requestId。
// 還沒重新整理的舊網頁送來的舊版溜了／修改／復原、不帶 source=d1 的 /today，一律回 410 請它更新網頁，不再寫 v3_today_walks、不寫試算表。
// 執行：node --test worker/test/today.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { fakeD1 } from './fakes.mjs';
import { createCompactDatabase } from '../../scripts/compact-schema.mjs';

const SITE = 'https://bq-shelter-dogs.<子網域>.workers.dev';

async function makeEnv() {
  const DB = fakeD1();
  await createCompactDatabase(DB);
  return { DB, SHEET_WRITE_URL: 'https://script.example/exec' };
}
let calls = [];
test.beforeEach(t => {
  worker.testing.resetState();
  const real = globalThis.fetch;
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, results: [] }));
  };
  t.after(() => { globalThis.fetch = real; });
});

let ip = 0;
const post = async (env, body) => {
  const res = await worker.fetch(new Request(`${SITE}/api/walk`, { method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json', 'CF-Connecting-IP': `9.9.9.${++ip}` }, body: JSON.stringify(body) }), env);
  return { status: res.status, body: await res.json() };
};
const get = async (env, path) => {
  const res = await worker.fetch(new Request(`${SITE}/api${path}`, { headers: { Origin: SITE } }), env);
  return { status: res.status, body: await res.json() };
};
const oldTable = async env => ({
  rows: (await env.DB.prepare('SELECT * FROM v3_today_walks').all()).results,
  version: await env.DB.prepare('SELECT today FROM v3_data_versions WHERE id=1').first('today'),
});

test('舊網頁按溜了、修改、復原（沒帶 requestId）：回 410 請重新整理；不寫 v3_today_walks、不寫試算表', async () => {
  const env = await makeEnv();
  const before = await oldTable(env);
  const dog = { id: '9001', name: '甲' };
  for (const body of [
    { action: 'walk', walker: 'K', dogs: [dog, { id: '', name: '新來的' }] },
    { action: 'edit', walker: 'K、乙', dogs: [{ ...dog, expected: 'K' }] },
    { action: 'undo', walker: 'K', dogs: [{ ...dog, prev: { date: { date: '2026-10-01' }, walker: '乙' }, wrote: { walker: 'K' } }] },
    { action: 'undo', walker: 'K', dogs: [{ ...dog, wrote: { walker: 'K' } }] },
  ]) {
    const r = await post(env, body);
    assert.equal(r.status, 410, body.action);
    assert.equal(r.body.ok, false);
    assert.match(r.body.error, /重新整理/);
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(await oldTable(env), before);
});

test('沒接試算表也一樣回 410（不是 503 off，舊網頁才不會默默改成只記在手機）', async () => {
  const env = await makeEnv();
  const r = await post({ DB: env.DB }, { action: 'walk', walker: 'K', dogs: [{ id: '9001', name: '甲' }] });
  assert.equal(r.status, 410);
  assert.equal(r.body.code, undefined);
});

test('備註、異動紀錄沒有 requestId 照常走試算表，不受影響', async () => {
  const env = await makeEnv();
  assert.equal((await post(env, { action: 'note', walker: 'K', text: '很乖', dogs: [{ id: '9001', name: '甲' }] })).status, 200);
  assert.equal((await post(env, { action: 'log', walker: 'K', text: '移籠' })).status, 200);
  assert.deepEqual(calls.map(c => c.action), ['note', 'log']);
});

test('GET /today 不帶 source=d1：回 410 請重新整理，不讀 v3_today_walks；帶 source=d1 照常', async () => {
  const env = await makeEnv();
  const before = env.DB.stats.rowsRead;
  const old = await get(env, '/today');
  assert.equal(old.status, 410);
  assert.match(old.body.error, /重新整理/);
  assert.equal(env.DB.stats.rowsRead, before);
  const d1 = await get(env, '/today?source=d1');
  assert.equal(d1.status, 200);
  assert.equal(d1.body.source, 'd1');
  assert.ok(Array.isArray(d1.body.walks));
});

test('舊表刪掉（#558 第二步）後，舊入口與 D1 讀取照常', async () => {
  const env = await makeEnv();
  await env.DB.prepare('DROP TABLE v3_today_walks').run();
  await env.DB.prepare('DROP TABLE v3_data_versions').run();
  assert.equal((await get(env, '/today')).status, 410);
  assert.equal((await get(env, '/today?source=d1')).status, 200);
  assert.equal((await post(env, { action: 'walk', walker: 'K', dogs: [{ id: '9001', name: '甲' }] })).status, 410);
});
