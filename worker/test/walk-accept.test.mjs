import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { setup, request, post, current, day } from './walk-fixture.mjs';
test.beforeEach(() => worker.testing.resetState());
test('D1 接受後立即讀到日期、名單與同步中，不必等 Google', async () => {
  const env = await setup();
  const tasks = [];
  const real = globalThis.fetch;
  // 背景派送可能在測試結束後才呼叫 fetch：先放行的話，晚到的呼叫也立刻失敗，不會卡住。
  let release, released = false;
  globalThis.fetch = () => new Promise((_, reject) => { release = () => reject(new Error('Google unavailable')); if (released) release(); });
  try {
    const out = await post(env, request('request-0001'), { waitUntil: p => tasks.push(p) });
    assert.equal(out.status, 200);
    assert.equal(out.body.results[0].status, 'written');
    assert.equal(out.body.results[0].accepted, true);
    const data = await current(env);
    assert.equal(data.walks[0].walker, '甲');
    assert.equal(data.walks[0].walkedDate, day());
    assert.ok(['pending','dispatching'].includes(data.walks[0].syncStatus));
    assert.equal(tasks.length, 1);
  } finally { released = true; release?.(); await Promise.all(tasks); globalThis.fetch = real; env.DB.close(); }
});

test('同狗並行保留兩人；同識別重送零寫入；內容不同拒絕', async () => {
  const env = await setup();
  const [a,b] = await Promise.all([post(env, request('parallel-0001')), post(env, request('parallel-0002', '乙'))]);
  assert.deepEqual([a.status,b.status], [200,200]);
  assert.deepEqual((await current(env)).walks[0].walker.split('、').sort(), ['乙','甲']);
  const before = (await current(env)).version;
  const again = await post(env, request('parallel-0001'));
  assert.deepEqual(again.body.results, a.body.results);
  assert.equal((await current(env)).version, before);
  assert.equal((await post(env, request('parallel-0001','丙'))).status, 409);
  env.DB.close();
});

test('接受交易任一步失敗皆回復；預算不足不留半份狀態', async () => {
  for (const table of ['v3_walk_state','v3_walk_requests','v3_walk_outbox','v3_walk_pack','v3_walk_write_budget']) {
    const env = await setup();
    const event = table === 'v3_walk_pack' ? 'UPDATE' : 'INSERT';
    await env.DB.prepare(`CREATE TRIGGER fail_accept BEFORE ${event} ON ${table} BEGIN SELECT RAISE(ABORT,'injected'); END`).run();
    assert.equal((await post(env, request('rollback-0001'))).status, 503, table);
    assert.deepEqual((await current(env)).walks, [], table);
    for (const t of ['v3_walk_state','v3_walk_requests','v3_walk_outbox','v3_walk_write_budget']) assert.equal((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()).n, 0, t);
    env.DB.close();
  }
  const env = await setup();
  assert.equal((await post({ ...env, SYNC_MAX_ROWS: 1 }, request('budget-0001'))).status, 503);
  assert.deepEqual((await current(env)).walks, []);
  env.DB.close();
});

test('空白拆名沿用既有規則與固定身分；午夜保留最新狀態且拒絕重放昨天操作', async () => {
  const env = await setup();
  const req = request('spaces-0001','甲 乙');
  assert.equal((await post(env, req)).status, 200);
  assert.equal((await current(env)).walks[0].walker, '甲、乙');
  const real = Date.now;
  try {
    Date.now = () => real() + 86400000;
    const data = await current(env);
    assert.equal(data.walks[0].walked, false);
    assert.equal(data.walks[0].walkedDate, req.operationDate);
    assert.equal((await post(env, req)).status, 400);
  } finally { Date.now = real; env.DB.close(); }
});

test('已接管資料不被舊同步回灌；冷讀一列取得一致版本與完整內容', async () => {
  const env = await setup();
  await post(env,request('projection-0001'));
  await env.DB.prepare("UPDATE v3_sheet_main SET walked_date='2000-01-01' WHERE number='9001'").run();
  worker.testing.resetState();
  const before = env.DB.stats.rowsRead;
  const data = await current(env);
  assert.equal(env.DB.stats.rowsRead-before,1);
  assert.equal(data.walks[0].walkedDate,day());
  assert.equal(data.walks[0].walker,'甲');
  assert.equal((await post(env,{ action:'walk', walker:'乙', dogs:[{ id:'9001',name:'測試狗' }] })).status,410);
  env.DB.close();
});

test('#408 無關資料增加十倍，既有單狗接受與冷讀的讀寫列數不變', async () => {
  const env = await setup();
  await post(env,request('scale-initial'));
  const seed = async (start,count) => env.DB.batch(Array.from({ length:count },(_,i) => env.DB.prepare("INSERT INTO v3_walk_outbox(dog_key,version,operation_date,target_date,target_walker,status,next_attempt_at) VALUES('9001',?,'2020-01-01','2020-01-01','舊','superseded','x')").bind(start+i)));
  await seed(100,20);
  const measure = async id => {
    const read = env.DB.stats.rowsRead, before = (await env.DB.prepare('SELECT total_changes() AS n').first()).n;
    assert.equal((await post(env,request(id))).status,200);
    const changed = (await env.DB.prepare('SELECT total_changes() AS n').first()).n-before;
    return { read:env.DB.stats.rowsRead-read, changed };
  };
  const small = await measure('scale-small');
  await seed(1000,180);
  assert.deepEqual(await measure('scale-large'),small);
  const before = env.DB.stats.rowsRead;
  await current(env);
  assert.equal(env.DB.stats.rowsRead-before,1);
  const plan = await env.DB.prepare("EXPLAIN QUERY PLAN UPDATE v3_walk_outbox SET status='superseded' WHERE dog_key='9001' AND status NOT IN ('synced','superseded')").all();
  assert.ok(plan.results.some(r => r.detail.includes('v3_walk_outbox_active')));
  env.DB.close();
});
