import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { todayWalks } from '../src/today-walks/index.js';
import { appsScript } from './apps-script.mjs';
import { setup, request, post, current, tick, addDog } from './walk-fixture.mjs';

// #684：失敗 10 次停；停住＝下次時間設成永遠不到期，排程就不再撿
const RETRY_LIMIT = 10, STOPPED_AT = '9999-12-31T00:00:00.000Z';
const dog = { id:'9001',name:'測試狗' };
const walks = (env, gas, at) => todayWalks(env, { sheet:gas.sheet, ...(at === undefined ? {} : { now:() => at }) });
// Worker 叫小程式寫回的次數（不算保險掃描）
const wakes = gas => gas.calls.filter(c => c.action !== 'walkScan');
const lost = () => Promise.reject(new Error('lost'));
// 寫回送不到小程式（連不上）；保險掃描照常讀表
const wakeLost = gas => { gas.network = (body, deliver) => body.action === 'walkScan' ? deliver() : lost(); };
const job = env => env.DB.prepare('SELECT o.status,o.next_attempt_at,o.error,r.failures FROM v3_walk_outbox o JOIN v3_walk_state s ON s.dog_key=o.dog_key AND s.version=o.version LEFT JOIN v3_walk_retry r ON r.dog_key=o.dog_key').first();
const budgetRow = env => env.DB.prepare('SELECT reserved,retry FROM v3_walk_write_budget').first();

test('#457 今天人工改名單後復原，仍回到今天以前，不復活人工拿掉的名字', async t => {
  const now = Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'],now });
  const env = { ...await setup(),WALK_RETRY_ENABLED:'true' }, gas = appsScript(env);
  worker.testing.resetState();
  try {
    await post(env,request('manual-before-undo'));
    await tick(gas,env,now);
    gas.set('9001',{ date:'2026/10/22',walker:'乙' });
    await tick(gas,env,now+60000);
    assert.equal((await current(env)).walks[0].walker,'乙');
    const undo = await post(env,request('manual-after-undo','丙',{ action:'undo',dogs:[{ ...dog,expectedVersion:2 }] }));
    assert.equal(undo.status,200);
    assert.deepEqual(undo.body.results[0].current,{ date:'2026-10-01',walker:'' });
    await tick(gas,env,now+120000);
    assert.deepEqual(gas.cell('9001'),{ date:'2026-10-01',walker:'' });
    assert.equal((await current(env)).walks[0].walked,false);
    assert.equal((await current(env)).walks[0].syncStatus,'synced');
  } finally { env.DB.close(); }
});

test('排程按 1、2、4、8、15 分鐘持久退避，重啟不重設', async t => {
  const start = Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const env = { ...await setup(), WALK_RETRY_ENABLED: 'true' }, gas = appsScript(env);
  worker.testing.resetState();
  wakeLost(gas);
  try {
    await post(env, request('retry-00001'));
    let now = start;
    for (const minutes of [1,2,4,8,15,15]) {
      await tick(gas, env, now);
      assert.equal((await current(env)).walks[0].syncStatus, 'retry');
      const before = wakes(gas).length;
      await tick(gas, env, now + minutes * 60000 - 1);
      assert.equal(wakes(gas).length, before, '到期前不再呼叫 Google');
      worker.testing.resetState();
      now += minutes * 60000;
      t.mock.timers.setTime(now);
    }
  } finally { env.DB.close(); }
});

// #684：重試有上限。tick 會跑保險掃描與寫回重試，掃描失敗不影響寫回重試。
test('#684 試算表明確拒絕（金鑰、試算表 ID、權限、沒設定）失敗一次就停，排程不再撿，管理網站看得到', async t => {
  const start = Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'],now:start });
  const cases = [
    [{}, { key:'舊金鑰' }, '寫入試算表的金鑰不對，請 K 檢查設定'],
    [{}, { sheetError:'Illegal spreadsheet id' }, '試算表 ID 不對，請 K 檢查小程式設定'],
    [{}, { sheetError:'You do not have permission to access the requested document.' }, '小程式沒有試算表的編輯權限，請 K 檢查設定'],
    [{ SHEET_WRITE_KEY:'' }, {}, '志工網站還沒設定寫入試算表'],
  ];
  for (const [extra, script, reason] of cases) {
    const env = { ...await setup(),WALK_RETRY_ENABLED:'true',...extra }, gas = appsScript(env, { key:script.key });
    gas.sheetError = script.sheetError;
    worker.testing.resetState();
    t.mock.timers.setTime(start);
    try {
      await post(env, request('refused-0001'));
      await tick(gas, env, start);
      const sent = wakes(gas).length;
      const row = await job(env);
      assert.deepEqual([row.status, row.next_attempt_at, row.failures], ['retry', STOPPED_AT, 1], reason);
      assert.equal((await current(env)).walks[0].syncStatus, 'retry');
      for (const minutes of [1, 60, 24 * 60]) { worker.testing.resetState(); await tick(gas, env, start + minutes * 60000); }
      assert.equal(wakes(gas).length, sent, '停住後排程不再呼叫試算表');
      const [stopped] = await todayWalks(env).stopped();
      assert.deepEqual(stopped, { number:'9001',name:'測試狗',dogId:'dog',date:request('x').operationDate,failures:1,reason });
    } finally { env.DB.close(); }
  }
});

test('#684 其他錯誤第 10 次失敗後停；這隻狗再登記就換新版本、次數歸零重新寫回', async t => {
  const start = Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'],now:start });
  const env = { ...await setup(),WALK_RETRY_ENABLED:'true' }, gas = appsScript(env);
  worker.testing.resetState();
  wakeLost(gas);
  try {
    await post(env, request('limit-00001'));
    let now = start;
    for (let i = 1; i <= RETRY_LIMIT; i++) {
      await tick(gas, env, now);
      const row = await job(env);
      assert.equal(row.failures, i);
      if (i < RETRY_LIMIT) assert.notEqual(row.next_attempt_at, STOPPED_AT, `第 ${i} 次失敗還會再試`);
      worker.testing.resetState();
      now = Date.parse(row.next_attempt_at === STOPPED_AT ? new Date(now + 60000).toISOString() : row.next_attempt_at);
      t.mock.timers.setTime(now);
    }
    assert.equal(wakes(gas).length, RETRY_LIMIT);
    assert.equal((await job(env)).next_attempt_at, STOPPED_AT);
    await tick(gas, env, now + 86400000);
    assert.equal(wakes(gas).length, RETRY_LIMIT, '第 10 次失敗後不再試');
    const [stopped] = await todayWalks(env).stopped();
    assert.deepEqual([stopped.failures, stopped.reason], [RETRY_LIMIT, '連不上試算表，請稍後再試']);
    const version = (await current(env)).walks[0].version;
    assert.equal((await post(env, request('limit-00002','乙',{ dogs:[{ ...dog,expectedVersion:version }] }))).status, 200);
    worker.testing.resetState();
    await tick(gas, env, now + 86400000 + 60000);
    assert.equal(wakes(gas).length, RETRY_LIMIT + 1, '新版本照常派送');
    assert.deepEqual([(await job(env)).failures, (await job(env)).next_attempt_at === STOPPED_AT], [1, false]);
    assert.deepEqual(await todayWalks(env).stopped(), [], '舊版本已被取代，不再列出');
  } finally { env.DB.close(); }
});

test('#685 重試用量超過每日上限時延到隔天（UTC 午夜），第一次派送不算重試', async t => {
  const start = Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'],now:start });
  const env = { ...await setup(),WALK_RETRY_ENABLED:'true' }, gas = appsScript(env);
  worker.testing.resetState();
  wakeLost(gas);
  try {
    await post(env, request('cap-000001'));
    const before = (await budgetRow(env)).reserved;
    await tick(gas, env, start);
    assert.deepEqual([wakes(gas).length, (await budgetRow(env)).retry], [1, 0], '第一次派送只扣總預算');
    // 上限只夠一次重試：設成一次派送保留的量
    env.SYNC_RETRY_DAILY_BUDGET = String((await budgetRow(env)).reserved - before);
    let now = Date.parse((await job(env)).next_attempt_at);
    worker.testing.resetState(); await tick(gas, env, now);
    assert.equal(wakes(gas).length, 2);
    assert.ok((await budgetRow(env)).retry > 0, '再派送算重試');
    now = Date.parse((await job(env)).next_attempt_at);
    worker.testing.resetState(); await tick(gas, env, now);
    assert.equal(wakes(gas).length, 2, '上限用完不再呼叫試算表');
    const row = await job(env);
    assert.deepEqual([row.status, row.failures, row.next_attempt_at], ['retry', 2, '2026-10-23T00:00:00.000Z']);
    worker.testing.resetState(); await tick(gas, env, Date.parse('2026-10-22T23:55:00Z'));
    assert.equal(wakes(gas).length, 2, '當天都不再試');
    worker.testing.resetState(); await tick(gas, env, Date.parse('2026-10-23T00:05:00Z'));
    assert.equal(wakes(gas).length, 3, '隔天上限重置，照常重試');
    assert.equal((await job(env)).failures, 3);
  } finally { env.DB.close(); }
});

test('#685 重試用光自己的上限時，新的登記照常接受、第一次派送照常送出', async t => {
  const start = Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'],now:start });
  const env = { ...await setup(),WALK_RETRY_ENABLED:'true',SYNC_RETRY_DAILY_BUDGET:'0' }, gas = appsScript(env);
  worker.testing.resetState();
  wakeLost(gas);
  const sent = () => wakes(gas).map(body => (body.items || [body]).map(item => item.dog.id));
  try {
    await post(env, request('cap-stuck-01'));
    await tick(gas, env, start);
    const now = Date.parse((await job(env)).next_attempt_at);
    // 卡住的狗到期了，同一輪另一隻狗剛登記、還沒送過
    const fresh = { id:'9200',name:'fresh狗0' };
    await addDog(env, gas, { ...fresh, dogId:'fresh-0', row:2 });
    assert.equal((await post(env, request('fresh-req-0000','甲',{ dogs:[fresh] }))).status, 200);
    worker.testing.resetState(); await tick(gas, env, now);
    assert.deepEqual(sent(), [['9001'], ['9200']], '只送新登記，卡住的重試延到隔天');
    assert.equal((await job(env)).next_attempt_at, '2026-10-23T00:00:00.000Z');
    assert.equal((await budgetRow(env)).retry, 0);
    assert.equal((await post(env, request('cap-fresh-02','乙',{ dogs:[{ ...fresh,expectedVersion:1 }] }))).status, 200, '新的登記不受重試上限影響');
  } finally { env.DB.close(); }
});

test('通知遺失時排程直接讀表補漏，人工改早日期以新版本接受；無差異只記排程跑完時間（稽核第 5 項）', async t => {
  const now=Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'],now });
  const env={ ...await setup(),WALK_RETRY_ENABLED:'true' },gas=appsScript(env);
  worker.testing.resetState();
  try {
    await post(env,request('missed-0001'));
    await tick(gas,env,now);
    assert.equal((await current(env)).walks[0].syncStatus,'synced');
    gas.set('9001',{ date:'2026/9/30',walker:'乙' });
    await tick(gas,env,now+60000);
    const latest=(await current(env)).walks[0];
    assert.equal(latest.walkedDate,'2026-09-30');
    assert.equal(latest.walker,'乙');
    assert.equal(latest.syncStatus,'synced');
    const before=(await env.DB.prepare('SELECT total_changes() n').first()).n;
    await tick(gas,env,now+120000);
    assert.equal((await env.DB.prepare('SELECT total_changes() n').first()).n,before+2,'只多寫 cron_scan、cron_retry 兩列');
    assert.equal(wakes(gas).length,1,'人工修正不產生反向寫入');
    assert.deepEqual(gas.cell('9001'),{ date:'2026-09-30',walker:'乙' });
  } finally { env.DB.close(); }
});

test('程序中斷遺留的派送由同接收端讀回；昨天未完成且今天有新版本只寫今天', async t => {
  const start = Date.parse('2026-10-21T15:59:00Z');
  t.mock.timers.enable({ apis:['Date'],now:start });
  const env = { ...await setup(),WALK_RETRY_ENABLED:'true' }, gas = appsScript(env);
  worker.testing.resetState();
  try {
    await post(env,request('midnight-0001'));
    // 在派送持久提交後被終止的程序；重啟不會執行 finally。
    await env.DB.batch([
      env.DB.prepare("INSERT INTO v3_walk_delivery VALUES('9001','interrupted',?)").bind(new Date(start).toISOString()),
      env.DB.prepare("UPDATE v3_walk_outbox SET status='dispatching',dispatch_id='interrupted' WHERE dog_key='9001'"),
    ]);
    t.mock.timers.setTime(start+120000);
    await post(env,request('midnight-0002','乙'));
    await tick(gas,env,start+120000);
    assert.deepEqual(gas.cell('9001'),{ date:'2026-10-22',walker:'乙' });
    const visible = (await current(env)).walks[0];
    assert.equal(visible.syncStatus,'synced');
    assert.equal(visible.walker,'乙');
    assert.equal((await env.DB.prepare('SELECT status FROM v3_walk_outbox WHERE version=1').first()).status,'superseded');
    const before = wakes(gas).length;
    await tick(gas,env,start+180000);
    assert.equal(wakes(gas).length,before);
  } finally { env.DB.close(); }
});

test('結果未知但直接讀回已是目前目標，重啟後確認且不重複改格', async t => {
  const now = Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'],now });
  const env = { ...await setup(),WALK_RETRY_ENABLED:'true' }, gas = appsScript(env);
  worker.testing.resetState();
  try {
    await post(env,request('unknown-0001'));
    // 小程式寫了格子、送回執前被停掉，Worker 那次也沒收尾
    gas.stopAt('receipt');
    const ran = gas.cutOff();
    walks(env,gas).dispatch([dog]);
    await ran;
    assert.deepEqual(gas.cell('9001'),{ date:'2026-10-22',walker:'甲' });
    await env.DB.prepare('DELETE FROM v3_walk_delivery WHERE dog_key=?').bind('9001').run(); // 舊版遺留的無 delivery 派送。
    const sent = wakes(gas).length, written = gas.writes().length;
    await tick(gas,env,now);
    assert.equal((await current(env)).walks[0].syncStatus,'synced');
    assert.equal(wakes(gas).length,sent+1);
    assert.equal(gas.writes().length,written,'表上已是目標，不重複改格');
  } finally { env.DB.close(); }
});

test('每輪最多十隻，失敗退避不擋其他到期工作；完成歷史使用索引排除',async t => {
  const now=Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'],now });
  const env={ ...await setup(),WALK_RETRY_ENABLED:'true' },gas=appsScript(env);
  worker.testing.resetState();
  wakeLost(gas);
  // 合併派送一次送多隻（#460）
  const sent=()=>wakes(gas).flatMap(body=>(body.items || [body]).map(item=>item.dog.id));
  try {
    for (let i=0;i<12;i++) {
      const id=String(9100+i),name=`測試狗${i}`;
      await addDog(env,gas,{ id,dogId:`dog-${i}`,name,row:i+2 });
      assert.equal((await post(env,request(`limit-000${i}`, '甲',{ dogs:[{ id,name }] }))).status,200);
    }
    await tick(gas,env,now);
    assert.equal(sent().length,10);
    await tick(gas,env,now+1);
    assert.equal(sent().length,12);
    assert.equal(new Set(sent()).size,12);
    const plan=await env.DB.prepare("EXPLAIN QUERY PLAN SELECT dog_key FROM v3_walk_outbox WHERE status IN ('pending','retry','unconfirmed') AND next_attempt_at<=? ORDER BY next_attempt_at,dog_key LIMIT 10").bind(new Date(now).toISOString()).all();
    assert.ok(plan.results.some(row=>row.detail.includes('v3_walk_outbox_due')));
    const dispatchPlan=await env.DB.prepare("EXPLAIN QUERY PLAN SELECT version FROM v3_walk_outbox WHERE dog_key=? AND dispatch_id=? AND status='dispatching'").bind('9001','unknown').all();
    assert.ok(dispatchPlan.results.some(row=>row.detail.includes('v3_walk_outbox_dispatch')));
    const interruptedPlan=await env.DB.prepare("EXPLAIN QUERY PLAN SELECT dog_key FROM v3_walk_outbox WHERE status='dispatching' AND next_attempt_at<=? ORDER BY next_attempt_at,dog_key LIMIT 10").bind(new Date(now).toISOString()).all();
    assert.ok(interruptedPlan.results.some(row=>row.detail.includes('v3_walk_outbox_interrupted')));
  } finally { env.DB.close(); }
});

test('預算拒絕時不半寫、不派送，停用與預覽環境不執行新排程',async t => {
  const now=Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'],now });
  const env={ ...await setup(),WALK_RETRY_ENABLED:'true' },gas=appsScript(env);
  worker.testing.resetState();
  try {
    await post(env,request('budget-0001'));
    const before=(await env.DB.prepare('SELECT reserved FROM v3_walk_write_budget').first()).reserved;
    await tick(gas,{ ...env,SYNC_MAX_ROWS:'1' },now);
    await tick(gas,{ ...env,SYNC_DAILY_BUDGET:'80' },now);
    assert.equal(wakes(gas).length,0);
    assert.equal((await current(env)).walks[0].syncStatus,'pending');
    assert.equal((await env.DB.prepare('SELECT reserved FROM v3_walk_write_budget').first()).reserved,before);
    assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM v3_batch_guard').first()).n,0);
    await tick(gas,{ ...env,WALK_RETRY_ENABLED:undefined },now);
    await tick(gas,{ ...env,PREVIEW:'true' },now);
    assert.equal(wakes(gas).length,0);
    assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM v3_walk_delivery').first()).n,0);
  } finally { env.DB.close(); }
});

test('無法分類的舊派送結果停寫並保留新工作；午夜無新登記仍以昨天日期重試',async t => {
  const now=Date.parse('2026-10-21T15:59:00Z');
  t.mock.timers.enable({ apis:['Date'],now });
  const env={ ...await setup(),WALK_RETRY_ENABLED:'true' },gas=appsScript(env);
  worker.testing.resetState();
  try {
    await post(env,request('ambiguous-0001'));
    // 小程式拿到目標就被停掉，表上沒寫；Worker 那次也沒收尾
    gas.stopAfter('target');
    let ran=gas.cutOff();
    walks(env,gas).dispatch([dog]);
    await ran;
    t.mock.timers.setTime(now+120000);
    // 實際持久派送中斷；時間到了仍走同一接收端。
    await env.DB.prepare("UPDATE v3_walk_delivery SET started_at=? WHERE dog_key='9001'").bind(new Date(now).toISOString()).run();
    await tick(gas,env,now+120000);
    assert.deepEqual(gas.cell('9001'),{ date:'2026-10-21',walker:'甲' });
    assert.equal((await current(env)).walks[0].walked,false);
    // 今天乙的派送寫進格子，但回執遺失；再接受丙後不能猜舊結果。
    await post(env,request('ambiguous-0002','乙'));
    gas.stopAt('receipt');
    ran=gas.cutOff();
    walks(env,gas).dispatch([dog]);
    await ran;
    assert.deepEqual(gas.cell('9001'),{ date:'2026-10-22',walker:'乙' });
    await post(env,request('ambiguous-0003','丙'));
    await tick(gas,env,now+180000);
    assert.deepEqual(gas.cell('9001'),{ date:'2026-10-22',walker:'乙' });
    assert.equal((await current(env)).walks[0].walker,'乙、丙');
    assert.equal((await current(env)).walks[0].syncStatus,'retry');
  } finally { env.DB.close(); }
});

test('#408 完成歷史增加十倍，排程與 target／receipt API 的讀寫量不變',async t => {
  const now=Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'],now });
  const env={ ...await setup(),WALK_RETRY_ENABLED:'true' },gas=appsScript(env);
  worker.testing.resetState();
  try {
    await post(env,request('history-initial'));
    await tick(gas,env,now);
    const seed=async (start,count) => env.DB.batch(Array.from({ length:count },(_,i)=>env.DB.prepare("INSERT INTO v3_walk_outbox(dog_key,version,operation_date,target_date,target_walker,status,next_attempt_at) VALUES('9001',?,'2020-01-01','2020-01-01','舊','synced','x')").bind(start+i)));
    const measure=async id => {
      await post(env,request(id));
      const before=(await env.DB.prepare('SELECT total_changes() n').first()).n,read=env.DB.stats.rowsRead;
      await tick(gas,env,now);
      const changed=(await env.DB.prepare('SELECT total_changes() n').first()).n-before;
      return { changed,read:env.DB.stats.rowsRead-read };
    };
    await seed(100,20);
    const small=await measure('history-small');
    await seed(1000,180);
    assert.deepEqual(await measure('history-large'),small);
    assert.equal((await current(env)).walks[0].syncStatus,'synced');
  } finally { env.DB.close(); }
});

test('恢復派送 B 逾時但舊 A 才取得接收端鎖，A 再中斷仍能下一輪恢復',async t => {
  const now=Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'],now });
  const env={ ...await setup(),WALK_RETRY_ENABLED:'true' },gas=appsScript(env);
  worker.testing.resetState();
  // 送出去的寫回都先卡在網路上
  const held=[];
  gas.network=(body,deliver)=>body.action==='walkScan' ? deliver() : new Promise((_,reject)=>held.push({ deliver,reject }));
  const until=async n=>{ while (held.length<n) await new Promise(resolve=>setImmediate(resolve)); };
  let a;
  try {
    await post(env,request('race-recovery-1'));
    a=walks(env,gas).dispatch([dog]);
    await until(1);
    t.mock.timers.setTime(now+60000);
    const b=tick(gas,env,now+60000);
    await until(2);
    // A 晚到小程式、拿到目標後又被停掉
    gas.stopAfter('target');
    await held[0].deliver().catch(()=>{});
    held[1].reject(new Error('B lost'));await b;
    t.mock.timers.setTime(now+120000);
    gas.network=(_body,deliver)=>deliver();
    await tick(gas,env,now+120000);
    assert.equal((await current(env)).walks[0].syncStatus,'synced');
    assert.equal(gas.cell('9001').walker,'甲');
  } finally { held[0]?.reject(new Error('A lost')); await a; env.DB.close(); }
});

test('UTC 午夜前的預留不能繞過隔日預算，晚到回執保留待確認',async t => {
  const now=Date.parse('2026-10-21T23:59:00Z');
  t.mock.timers.enable({ apis:['Date'],now });
  const env={ ...await setup(),WALK_RETRY_ENABLED:'true' },gas=appsScript(env);
  worker.testing.resetState();
  try {
    await post(env,request('utc-budget-0001'));
    // 小程式寫完格子要送回執時已過 UTC 午夜，隔天的預算只剩 1 列
    gas.beforeWorker=action=>{ if (action==='receipt') { t.mock.timers.setTime(now+120000); env.SYNC_DAILY_BUDGET='1'; } };
    const ran=gas.cutOff();
    walks(env,gas).dispatch([dog]);
    await ran;
    assert.deepEqual(gas.posts.map(p=>[p.action,p.status]),[['target',200],['receipt',503]]);
    assert.equal((await current(env)).walks[0].syncStatus,'dispatching');
  } finally { env.SYNC_DAILY_BUDGET='20000';env.DB.close(); }
});

test('#460 合併派送：一輪只呼叫 Apps Script 一次，成功的標成已同步，失敗的那隻各自退避', async t => {
  const now=Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'],now });
  const env={ ...await setup(),WALK_RETRY_ENABLED:'true' },gas=appsScript(env);
  worker.testing.resetState();
  try {
    for (let i=0;i<3;i++) {
      const id=String(9100+i),name=`合併狗${i}`;
      // 9102 不在表上：小程式找不到唯一的狗，只有那隻失敗
      await addDog(env,i===2 ? null : gas,{ id,dogId:`batch-${i}`,name,row:i+2 });
      assert.equal((await post(env,request(`batch-000${i}`,'甲',{ dogs:[{ id,name }] }))).status,200);
    }
    await tick(gas,env,now);
    const batches=wakes(gas);
    assert.deepEqual(batches.map(body=>body.action),['walkWakeBatch']);
    assert.deepEqual(batches[0].items.map(item=>item.dog.id).sort(),['9100','9101','9102']);
    const rows=(await env.DB.prepare("SELECT o.dog_key,o.status FROM v3_walk_outbox o JOIN v3_walk_state s ON s.dog_key=o.dog_key AND s.version=o.version ORDER BY o.dog_key").all()).results;
    assert.deepEqual(rows.map(r=>[r.dog_key,r.status]),[['9100','synced'],['9101','synced'],['9102','retry']]);
    assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM v3_walk_delivery').first()).n,0);
    const failed=await env.DB.prepare("SELECT error,next_attempt_at FROM v3_walk_outbox WHERE dog_key='9102' AND status='retry'").first();
    assert.match(failed.error,/唯一/);
    assert.ok(failed.next_attempt_at>new Date(now).toISOString());
  } finally { env.DB.close(); }
});

// 主清單多 count 隻狗（編號 9200 起），各登記一次；onSheet 為 false 的不放到表上
async function addDogs(env,gas,count,prefix,onSheet=true) {
  for (let i=0;i<count;i++) {
    const id=String(9200+i),name=`${prefix}狗${i}`;
    await addDog(env,onSheet ? gas : null,{ id,dogId:`${prefix}-${i}`,name,row:i+2 });
    assert.equal((await post(env,request(`${prefix}-req-${String(i).padStart(4,'0')}`,'甲',{ dogs:[{ id,name }] }))).status,200);
  }
}

test('#498 十隻到期工作依單次預算拆批合併派送，不退回逐隻', async t => {
  const now=Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'],now });
  const env={ ...await setup(),WALK_RETRY_ENABLED:'true' },gas=appsScript(env);
  worker.testing.resetState();
  try {
    await addDogs(env,gas,10,'chunk');
    await walks(env,gas,now).dispatchDue();
    const batches=gas.calls.map(body=>{ assert.equal(body.action,'walkWakeBatch'); return body.items.length; });
    assert.ok(batches.length>=2 && batches.every(n=>n>1),`批次 ${batches}`);
    assert.equal(batches.reduce((a,b)=>a+b,0),10);
    const rows=(await env.DB.prepare("SELECT o.status FROM v3_walk_outbox o JOIN v3_walk_state s ON s.dog_key=o.dog_key AND s.version=o.version").all()).results;
    assert.ok(rows.length===10 && rows.every(r=>r.status==='synced'));
  } finally { env.DB.close(); }
});

test('#498 寫回重試不掃表；沒有待處理工作就不呼叫 Apps Script', async t => {
  const now=Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'],now });
  const env={ ...await setup(),WALK_RETRY_ENABLED:'true' },gas=appsScript(env);
  worker.testing.resetState();
  gas.network=lost;
  try {
    await post(env,request('noscan-0001'));
    await walks(env,gas,now).dispatchDue();
    assert.deepEqual(gas.calls.map(body=>body.action),['walkWake']);
    await walks(env,gas,now).dispatchDue();
    assert.equal(gas.calls.length,1);
  } finally { env.DB.close(); }
});

test('#498 預算拒絕不退回逐隻派送，工作留待下一輪', async t => {
  const now=Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'],now });
  const env={ ...await setup(),WALK_RETRY_ENABLED:'true' },gas=appsScript(env);
  worker.testing.resetState();
  try {
    await addDogs(env,gas,3,'budget');
    // 每日剩餘只夠一隻：合併批次被拒時不能改逐隻偷跑。
    const reserved=(await env.DB.prepare('SELECT reserved FROM v3_walk_write_budget').first()).reserved;
    await assert.rejects(walks({ ...env,SYNC_DAILY_BUDGET:String(reserved+100) },gas,now).dispatchDue(),/budget/,'排程記成失敗，管理網站看得到');
    assert.equal(gas.calls.length,0);
    assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM v3_walk_outbox WHERE status='pending'").first()).n,3);
  } finally { env.DB.close(); }
});

test('#498 遠端失敗分得出：沒設定、連不上（結果不明）、試算表明確拒絕；預算拒絕另記', async t => {
  const now=Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'],now });
  const env={ ...await setup(),WALK_RETRY_ENABLED:'true' },gas=appsScript(env);
  worker.testing.resetState();
  const error=async id=>(await env.DB.prepare("SELECT o.error FROM v3_walk_outbox o JOIN v3_walk_state s ON s.dog_key=o.dog_key AND s.version=o.version WHERE o.dog_key=?").bind(id).first()).error;
  const warns=[],warn=console.warn;
  console.warn=(...a)=>warns.push(a.join(' '));
  try {
    // 兩隻都不在表上：送到了小程式也找不到唯一的狗
    await addDogs(env,gas,2,'remote',false);
    gas.network=()=>Promise.reject(new Error('down'));
    await walks(env,gas,now).dispatch([{ id:'9200',name:'remote狗0' }]);
    assert.match(await error('9200'),/^writeback-unconfirmed/);
    gas.network=(_body,deliver)=>deliver();
    await walks(env,gas,now+10*60000).dispatch([{ id:'9200',name:'remote狗0' },{ id:'9201',name:'remote狗1' }]);
    assert.match(await error('9200'),/^writeback-rejected/);
    assert.match(await error('9201'),/^writeback-rejected/);
    const reserved=(await env.DB.prepare('SELECT reserved FROM v3_walk_write_budget').first()).reserved;
    await assert.rejects(walks({ ...env,SYNC_DAILY_BUDGET:String(reserved+1) },gas,now+60*60000).dispatchDue(),/budget/);
  } finally { console.warn=warn;env.DB.close(); }
});
