// 稽核第 5 項：排程每次跑完或出錯都記在 v3_sync_state，管理網站資料檢查讀出來看排程有沒有在跑。
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { recordRun } from '../src/cron-status.js';
import { readCronStatus } from '../src/admin/checks.js';
import { setup, post, request } from './walk-fixture.mjs';

const row = async (env, job) => JSON.parse((await env.DB.prepare('SELECT value FROM v3_sync_state WHERE key=?').bind(`cron_${job}`).first('value')) || 'null');
async function run(env, cron, at) {
  const tasks = [];
  await worker.scheduled({ scheduledTime:at, cron }, env, { waitUntil:p => tasks.push(p) });
  await Promise.allSettled(tasks);
}
const T = Date.parse('2026-10-26T05:53:00.000Z');

test('跑完記 okAt；出錯記 failAt 與訊息、保留上次 okAt；功能沒開不記；舊值讀不懂就重記', async () => {
  const env = await setup();
  try {
    await recordRun(env, 'scan', T, async () => {});
    assert.deepEqual(await row(env, 'scan'), { okAt:'2026-10-26T05:53:00.000Z' });
    await recordRun(env, 'scan', T + 1000, async () => { throw new Error('主清單直接讀回失敗'); });
    assert.deepEqual(await row(env, 'scan'), { okAt:'2026-10-26T05:53:00.000Z', failAt:'2026-10-26T05:53:01.000Z', error:'主清單直接讀回失敗' });
    await recordRun(env, 'retry', T, async () => false);
    assert.equal(await row(env, 'retry'), null, '功能沒開：沒跑就不記');
    await env.DB.prepare("INSERT INTO v3_sync_state(key,value) VALUES('cron_trash','壞掉')").run();
    await recordRun(env, 'trash', T, async () => ({}));
    assert.deepEqual(await row(env, 'trash'), { okAt:'2026-10-26T05:53:00.000Z' });
    const down = { DB:{ prepare() { throw new Error('D1 down'); } } };
    let ran = false;
    await recordRun(down, 'retry', T, async () => { ran = true; });
    assert.ok(ran, '記不進去不影響工作本身，也不往外丟');
  } finally { env.DB.close(); }
});

test('排程：保險掃描讀試算表失敗、寫回重試讀 D1 失敗都記成失敗，不當成跑完', async () => {
  const env = { ...await setup(), WALK_RETRY_ENABLED:'true' }, real = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ ok:true });
  try {
    await post(env, request('cron-0001', '甲'));
    globalThis.fetch = async () => { throw new Error('network'); };
    await run(env, '53 1,5,15 * * *', T);
    const scan = await row(env, 'scan');
    assert.equal(scan.okAt, undefined);
    assert.equal(scan.failAt, '2026-10-26T05:53:00.000Z');
    assert.match(scan.error, /主清單直接讀回失敗/);
    const prepare = env.DB.prepare.bind(env.DB);
    env.DB.prepare = sql => (/v3_walk_delivery/.test(sql) ? { bind() { return { all:async () => { throw new Error('D1 busy'); } }; } } : prepare(sql));
    await run(env, '5-59/10 * * * *', T);
    env.DB.prepare = prepare;
    assert.deepEqual(await row(env, 'retry'), { failAt:'2026-10-26T05:53:00.000Z', error:'D1 busy' });
  } finally { globalThis.fetch = real; env.DB.close(); }
});

test('預覽版、功能沒開：排程不跑也不記', async () => {
  const env = { ...await setup(), WALK_RETRY_ENABLED:'true', PREVIEW:'1' };
  try {
    await run(env, '5-59/10 * * * *', T);
    await run(env, '53 1,5,15 * * *', T);
    assert.equal(await row(env, 'retry'), null);
    assert.equal(await row(env, 'scan'), null);
  } finally { env.DB.close(); }
});

test('管理網站讀排程：從未記錄、讀不懂、過期、最近失敗分開標示，只讀不寫', async () => {
  const env = await setup();
  try {
    const ok = '2026-10-26T05:45:00.000Z';
    await env.DB.prepare("INSERT INTO v3_sync_state(key,value) VALUES('cron_retry',?),('cron_scan',?),('cron_trash','[1]')")
      .bind(JSON.stringify({ okAt:ok }), JSON.stringify({ okAt:'2026-10-25T15:53:00.000Z', failAt:'2026-10-26T01:53:00.000Z', error:'主清單直接讀回失敗' })).run();
    const writes = [];
    const measured = { prepare(sql) { if (!/^\s*SELECT/i.test(sql)) writes.push(sql); return env.DB.prepare(sql); } };
    const [retry, scan, trash] = await readCronStatus(measured, Date.parse(ok) + 10 * 60000);
    assert.equal(writes.length, 0);
    assert.deepEqual(retry, { job:'retry', state:'ok', okAt:ok, failAt:null, error:'', stale:false });
    assert.equal(scan.stale, true, '09:53 那次失敗，上次跑完已超過 13 小時（正常最多隔 10 小時）');
    assert.equal(scan.error, '主清單直接讀回失敗');
    assert.equal(trash.state, 'error');
    assert.equal((await readCronStatus(env.DB, Date.parse(ok) + 41 * 60000))[0].stale, true, '寫回重試超過 40 分鐘沒跑完算過期');
    await env.DB.prepare("DELETE FROM v3_sync_state WHERE key='cron_trash'").run();
    assert.equal((await readCronStatus(env.DB))[2].state, 'never');
  } finally { env.DB.close(); }
});
