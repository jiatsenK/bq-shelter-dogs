// #460：一輪 Cron 的 CPU 跟 D1 往返次數成正比（每次往返都要在 Worker 打包請求、解讀回傳）。
// 派送一隻狗時，同一次請求內每份資料只讀一次；跨請求（Apps Script 回呼）仍各自重新核對（ADR 0017）。
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { dispatchWalk } from '../src/walk-accept.js';
import { setup, post, request } from './walk-fixture.mjs';

// 只數最外層的往返：batch 算一次，batch 裡的敘述不另外算。
function counted(DB0) {
  const trips = { cron: 0, target: 0, receipt: 0 };
  let phase = 'cron';
  const wrap = st => ({ _st: st, bind: (...a) => wrap(st.bind(...a)),
    run: () => (trips[phase]++, st.run()), all: () => (trips[phase]++, st.all()), first: c => (trips[phase]++, st.first(c)) });
  const DB = { prepare: sql => wrap(DB0.prepare(sql)), batch: sts => (trips[phase]++, DB0.batch(sts.map(s => s._st || s))) };
  return { DB, trips, as: async (p, fn) => { const was = phase; phase = p; try { return await fn(); } finally { phase = was; } } };
}

test('派送一隻狗：Cron 端 ≤ 3 次 D1 往返，拿目標 ≤ 2 次，回報寫完 ≤ 2 次', async () => {
  const base = await setup();
  const c = counted(base.DB);
  const env = { ...base, DB: c.DB, SYNC_DAILY_BUDGET: '1000000' };
  const sheet = { date: '2026-10-01', walker: '' };
  const real = globalThis.fetch;
  const call = async (action, body) => (await worker.fetch(new Request(`https://x.invalid/api/walk-writeback/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sheet-Write-Key': env.SHEET_WRITE_KEY }, body: JSON.stringify(body) }), env)).json();
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.action, 'walkWake');
    const target = await c.as('target', () => call('target', { dog: body.dog, dispatchId: body.dispatchId, current: sheet }));
    Object.assign(sheet, target.current);
    const receipt = { dogKey: body.dog.id, version: target.version, dispatchId: target.dispatchId, current: { ...sheet } };
    const result = await c.as('receipt', () => call('receipt', receipt));
    return Response.json({ ok: true, ...receipt, ...result });
  };
  try {
    assert.equal((await post({ ...base, SYNC_DAILY_BUDGET: '1000000' }, request('trips-00001'))).status, 200);
    await dispatchWalk(c.DB, { id: '9001', name: '測試狗' }, env, Date.now());
  } finally { globalThis.fetch = real; }
  assert.equal(await base.DB.prepare("SELECT status FROM v3_walk_outbox WHERE dog_key='9001' ORDER BY version DESC").first('status'), 'synced');
  assert.equal(await base.DB.prepare("SELECT COUNT(*) n FROM v3_walk_delivery").first('n'), 0);
  console.log('D1 往返', c.trips);
  assert.ok(c.trips.cron <= 3, `Cron 端 ${c.trips.cron} 次`);
  assert.ok(c.trips.target <= 2, `拿目標 ${c.trips.target} 次`);
  assert.ok(c.trips.receipt <= 2, `回報寫完 ${c.trips.receipt} 次`);
});
