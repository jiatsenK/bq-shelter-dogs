// #460：一輪 Cron 的 CPU 跟 D1 往返次數成正比（每次往返都要在 Worker 打包請求、解讀回傳）。
// 派送一隻狗時，同一次請求內每份資料只讀一次；跨請求（Apps Script 回呼）仍各自重新核對（ADR 0017）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { todayWalks } from '../src/today-walks/index.js';
import { appsScript } from './apps-script.mjs';
import { setup, post, request } from './walk-fixture.mjs';

// 只數最外層的往返：batch 算一次，batch 裡的敘述不另外算。phase 是現在算在哪一段（小程式要呼叫 Worker 時切過去）
function counted(DB0) {
  const trips = { cron: 0, target: 0, receipt: 0 };
  const c = { trips, phase: 'cron' };
  const wrap = st => ({ _st: st, bind: (...a) => wrap(st.bind(...a)),
    run: () => (trips[c.phase]++, st.run()), all: () => (trips[c.phase]++, st.all()), first: col => (trips[c.phase]++, st.first(col)) });
  c.DB = { prepare: sql => wrap(DB0.prepare(sql)), batch: sts => (trips[c.phase]++, DB0.batch(sts.map(s => s._st || s))) };
  return c;
}

test('派送一隻狗：Cron 端 ≤ 3 次 D1 往返，拿目標 ≤ 2 次，回報寫完 ≤ 2 次', async () => {
  const base = await setup();
  const c = counted(base.DB);
  const env = { ...base, DB: c.DB, SYNC_DAILY_BUDGET: '1000000' }, gas = appsScript(env);
  // 小程式呼叫 Worker 的 target、receipt 各算一段；小程式回應送回 Worker 後回到 Cron 端
  gas.beforeWorker = action => { c.phase = action; };
  gas.network = async (body, deliver) => {
    assert.equal(body.action, 'walkWake');
    const res = await deliver();
    c.phase = 'cron';
    return res;
  };
  assert.equal((await post({ ...base, SYNC_DAILY_BUDGET: '1000000' }, request('trips-00001'))).status, 200);
  await todayWalks(env, { sheet: gas.sheet }).dispatch([{ id: '9001', name: '測試狗' }]);
  assert.deepEqual(gas.posts.map(p => p.action), ['target', 'receipt']);
  assert.equal(await base.DB.prepare("SELECT status FROM v3_walk_outbox WHERE dog_key='9001' ORDER BY version DESC").first('status'), 'synced');
  assert.equal(await base.DB.prepare("SELECT COUNT(*) n FROM v3_walk_delivery").first('n'), 0);
  console.log('D1 往返', c.trips);
  assert.ok(c.trips.cron <= 3, `Cron 端 ${c.trips.cron} 次`);
  assert.ok(c.trips.target <= 2, `拿目標 ${c.trips.target} 次`);
  assert.ok(c.trips.receipt <= 2, `回報寫完 ${c.trips.receipt} 次`);
});
