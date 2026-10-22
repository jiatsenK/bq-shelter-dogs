import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { dispatchWalk } from '../src/walk-accept.js';
import { setup, request, post, current } from './walk-fixture.mjs';

async function machine(env, action, body) {
  const response = await worker.fetch(new Request(`https://worker.example/api/walk-writeback/${action}`, {
    method:'POST', headers:{ 'Content-Type':'application/json','X-Sheet-Write-Key':env.SHEET_WRITE_KEY }, body:JSON.stringify(body)
  }),env);
  const out = await response.json();
  if (!response.ok) throw Object.assign(new Error(out.error),{ status:response.status });
  return out;
}

function sheetAdapter(env, sheet, calls) {
  return async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.action === 'walkScan') return Response.json({ ok:true,rows:[{ dog:{ id:'9001',name:'測試狗' },current:sheet.value }] });
    calls.push(body);
    const target = await machine(env,'target',{ dog:body.dog,dispatchId:body.dispatchId,current:sheet.value });
    sheet.value = target.current;
    const receipt = { dogKey:body.dog.id,version:target.version,dispatchId:target.dispatchId,current:sheet.value };
    const result = await machine(env,'receipt',receipt);
    return Response.json({ ok:true,...receipt,...result });
  };
}

async function tick(env, at) {
  const tasks = [];
  await worker.scheduled({ scheduledTime: at }, env, { waitUntil: p => tasks.push(p) });
  await Promise.all(tasks);
}

test('#457 今天人工改名單後復原，仍回到今天以前，不復活人工拿掉的名字', async t => {
  const now = Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'],now });
  const env = { ...await setup(),WALK_RETRY_ENABLED:'true' }, real = globalThis.fetch;
  worker.testing.resetState();
  const sheet = { value:{ date:'2026-10-01',walker:'' } }, calls = [];
  globalThis.fetch = sheetAdapter(env,sheet,calls);
  try {
    await post(env,request('manual-before-undo'));
    await tick(env,now);
    sheet.value = { date:'2026-10-22',walker:'乙' };
    await tick(env,now+60000);
    assert.equal((await current(env)).walks[0].walker,'乙');
    const undo = await post(env,request('manual-after-undo','丙',{ action:'undo',dogs:[{ id:'9001',name:'測試狗',expectedVersion:2 }] }));
    assert.equal(undo.status,200);
    assert.deepEqual(undo.body.results[0].current,{ date:'2026-10-01',walker:'' });
    await tick(env,now+120000);
    assert.deepEqual(sheet.value,{ date:'2026-10-01',walker:'' });
    assert.equal((await current(env)).walks[0].walked,false);
    assert.equal((await current(env)).walks[0].syncStatus,'synced');
  } finally { globalThis.fetch=real;env.DB.close(); }
});

test('排程按 1、2、4、8、15 分鐘持久退避，重啟不重設', async t => {
  const start = Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const env = { ...await setup(), WALK_RETRY_ENABLED: 'true' };
  worker.testing.resetState();
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url,init) => {
    if (JSON.parse(init.body).action==='walkScan') return Response.json({ ok:true,rows:[] });
    calls++; throw new Error('lost');
  };
  try {
    await post(env, request('retry-00001'));
    let now = start;
    for (const minutes of [1,2,4,8,15,15]) {
      await tick(env, now);
      assert.equal((await current(env)).walks[0].syncStatus, 'retry');
      const before = calls;
      await tick(env, now + minutes * 60000 - 1);
      assert.equal(calls, before, '到期前不再呼叫 Google');
      worker.testing.resetState();
      now += minutes * 60000;
      t.mock.timers.setTime(now);
    }
  } finally { globalThis.fetch = real; env.DB.close(); }
});

test('通知遺失時排程直接讀表補漏，人工改早日期以新版本接受；無差異不寫心跳', async t => {
  const now=Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'],now });
  const env={ ...await setup(),WALK_RETRY_ENABLED:'true' },real=globalThis.fetch;
  worker.testing.resetState();
  const sheet={ value:{ date:'2026-10-01',walker:'' } },calls=[];
  globalThis.fetch=sheetAdapter(env,sheet,calls);
  try {
    await post(env,request('missed-0001'));
    await tick(env,now);
    assert.equal((await current(env)).walks[0].syncStatus,'synced');
    sheet.value={ date:'2026-09-30',walker:'乙' };
    await tick(env,now+60000);
    const latest=(await current(env)).walks[0];
    assert.equal(latest.walkedDate,'2026-09-30');
    assert.equal(latest.walker,'乙');
    assert.equal(latest.syncStatus,'synced');
    const before=(await env.DB.prepare('SELECT total_changes() n').first()).n;
    await tick(env,now+120000);
    assert.equal((await env.DB.prepare('SELECT total_changes() n').first()).n,before);
    assert.equal(calls.length,1,'人工修正不產生反向寫入');
  } finally { globalThis.fetch=real;env.DB.close(); }
});

test('程序中斷遺留的派送由同接收端讀回；昨天未完成且今天有新版本只寫今天', async t => {
  const start = Date.parse('2026-10-21T15:59:00Z');
  t.mock.timers.enable({ apis:['Date'],now:start });
  const env = { ...await setup(),WALK_RETRY_ENABLED:'true' }, real = globalThis.fetch;
  worker.testing.resetState();
  const calls = [], sheet = { value:{ date:'2026-10-01',walker:'' } };
  try {
    await post(env,request('midnight-0001'));
    // 在派送持久提交後被終止的程序；重啟不會執行 finally。
    await env.DB.batch([
      env.DB.prepare("INSERT INTO v3_walk_delivery VALUES('9001','interrupted',?)").bind(new Date(start).toISOString()),
      env.DB.prepare("UPDATE v3_walk_outbox SET status='dispatching',dispatch_id='interrupted' WHERE dog_key='9001'"),
    ]);
    t.mock.timers.setTime(start+120000);
    await post(env,request('midnight-0002','乙'));
    globalThis.fetch = sheetAdapter(env,sheet,calls);
    await tick(env,start+120000);
    assert.deepEqual(sheet.value,{ date:'2026-10-22',walker:'乙' });
    const visible = (await current(env)).walks[0];
    assert.equal(visible.syncStatus,'synced');
    assert.equal(visible.walker,'乙');
    assert.equal((await env.DB.prepare('SELECT status FROM v3_walk_outbox WHERE version=1').first()).status,'superseded');
    const before = calls.length;
    await tick(env,start+180000);
    assert.equal(calls.length,before);
  } finally { globalThis.fetch=real;env.DB.close(); }
});

test('結果未知但直接讀回已是目前目標，重啟後確認且不重複改格', async t => {
  const now = Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'],now });
  const env = { ...await setup(),WALK_RETRY_ENABLED:'true' }, real = globalThis.fetch;
  worker.testing.resetState();
  try {
    await post(env,request('unknown-0001'));
    const first = await machine(env,'target',{ dog:{ id:'9001',name:'測試狗' },dispatchId:'crashed',current:{ date:'2026-10-01',walker:'' } });
    await env.DB.prepare('DELETE FROM v3_walk_delivery WHERE dog_key=?').bind('9001').run(); // 舊版遺留的無 delivery 派送。
    const sheet = { value:first.current }, calls=[];
    globalThis.fetch=sheetAdapter(env,sheet,calls);
    await tick(env,now);
    assert.equal((await current(env)).walks[0].syncStatus,'synced');
    assert.equal(calls.length,1);
  } finally { globalThis.fetch=real;env.DB.close(); }
});

test('每輪最多十隻，失敗退避不擋其他到期工作；完成歷史使用索引排除',async t => {
  const now=Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'],now });
  const env={ ...await setup(),WALK_RETRY_ENABLED:'true' },real=globalThis.fetch;
  worker.testing.resetState();
  const sent=[];
  globalThis.fetch=async (_url,init) => {
    const body=JSON.parse(init.body);
    if (body.action==='walkScan') return Response.json({ ok:true,rows:[] });
    sent.push(body.dog.id); throw new Error('lost');
  };
  try {
    for (let i=0;i<12;i++) {
      const id=String(9100+i),dogId=`dog-${i}`,name=`測試狗${i}`;
      await env.DB.batch([
        env.DB.prepare('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)').bind(dogId,name),
        env.DB.prepare('INSERT INTO v3_dog_numbers VALUES(?,?)').bind(id,dogId),
        env.DB.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,walked_date,synced_at) VALUES(?,?,?,?, '2026-10-01','x')").bind(i+2,dogId,id,name),
      ]);
      assert.equal((await post(env,request(`limit-000${i}`, '甲',{ dogs:[{ id,name }] }))).status,200);
    }
    await tick(env,now);
    assert.equal(sent.length,10);
    await tick(env,now+1);
    assert.equal(sent.length,12);
    assert.equal(new Set(sent).size,12);
    const plan=await env.DB.prepare("EXPLAIN QUERY PLAN SELECT dog_key FROM v3_walk_outbox WHERE status IN ('pending','retry','unconfirmed') AND next_attempt_at<=? ORDER BY next_attempt_at,dog_key LIMIT 10").bind(new Date(now).toISOString()).all();
    assert.ok(plan.results.some(row=>row.detail.includes('v3_walk_outbox_due')));
    const dispatchPlan=await env.DB.prepare("EXPLAIN QUERY PLAN SELECT version FROM v3_walk_outbox WHERE dog_key=? AND dispatch_id=? AND status='dispatching'").bind('9001','unknown').all();
    assert.ok(dispatchPlan.results.some(row=>row.detail.includes('v3_walk_outbox_dispatch')));
    const interruptedPlan=await env.DB.prepare("EXPLAIN QUERY PLAN SELECT dog_key FROM v3_walk_outbox WHERE status='dispatching' AND next_attempt_at<=? ORDER BY next_attempt_at,dog_key LIMIT 10").bind(new Date(now).toISOString()).all();
    assert.ok(interruptedPlan.results.some(row=>row.detail.includes('v3_walk_outbox_interrupted')));
  } finally { globalThis.fetch=real;env.DB.close(); }
});

test('預算拒絕時不半寫、不派送，停用與預覽環境不執行新排程',async t => {
  const now=Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'],now });
  const env={ ...await setup(),WALK_RETRY_ENABLED:'true' },real=globalThis.fetch;
  worker.testing.resetState();
  let wake=0;
  globalThis.fetch=async (_url,init) => {
    if (JSON.parse(init.body).action==='walkScan') return Response.json({ ok:true,rows:[] });
    wake++;throw new Error('should not send');
  };
  try {
    await post(env,request('budget-0001'));
    const before=(await env.DB.prepare('SELECT reserved FROM v3_walk_write_budget').first()).reserved;
    await tick({ ...env,SYNC_MAX_ROWS:'1' },now);
    await tick({ ...env,SYNC_DAILY_BUDGET:'80' },now);
    assert.equal(wake,0);
    assert.equal((await current(env)).walks[0].syncStatus,'pending');
    assert.equal((await env.DB.prepare('SELECT reserved FROM v3_walk_write_budget').first()).reserved,before);
    assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM v3_walk_guard').first()).n,0);
    await tick({ ...env,WALK_RETRY_ENABLED:undefined },now);
    await tick({ ...env,PREVIEW:'true' },now);
    assert.equal(wake,0);
    assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM v3_walk_delivery').first()).n,0);
  } finally { globalThis.fetch=real;env.DB.close(); }
});

test('無法分類的舊派送結果停寫並保留新工作；午夜無新登記仍以昨天日期重試',async t => {
  const now=Date.parse('2026-10-21T15:59:00Z');
  t.mock.timers.enable({ apis:['Date'],now });
  const env={ ...await setup(),WALK_RETRY_ENABLED:'true' },real=globalThis.fetch;
  worker.testing.resetState();
  try {
    await post(env,request('ambiguous-0001'));
    const old=await machine(env,'target',{ dog:{ id:'9001',name:'測試狗' },dispatchId:'old',current:{ date:'2026-10-01',walker:'' } });
    t.mock.timers.setTime(now+120000);
    const sheet={ value:{ date:'2026-10-01',walker:'' } },calls=[];
    globalThis.fetch=sheetAdapter(env,sheet,calls);
    // 實際持久派送中斷；時間到了仍走同一接收端。
    await env.DB.prepare("UPDATE v3_walk_delivery SET started_at=? WHERE dog_key='9001'").bind(new Date(now).toISOString()).run();
    await tick(env,now+120000);
    assert.deepEqual(sheet.value,{ date:'2026-10-21',walker:'甲' });
    assert.equal((await current(env)).walks[0].walked,false);
    // 今天乙曾取得派送目標並寫入，但回執遺失；再接受丙後不能猜舊結果。
    await post(env,request('ambiguous-0002','乙'));
    const unknown=await machine(env,'target',{ dog:{ id:'9001',name:'測試狗' },dispatchId:'unknown',current:sheet.value });
    sheet.value=unknown.current;
    await post(env,request('ambiguous-0003','丙'));
    await tick(env,now+180000);
    assert.deepEqual(sheet.value,{ date:'2026-10-22',walker:'乙' });
    assert.equal((await current(env)).walks[0].walker,'乙、丙');
    assert.equal((await current(env)).walks[0].syncStatus,'retry');
  } finally { globalThis.fetch=real;env.DB.close(); }
});

test('#408 完成歷史增加十倍，排程與 target／receipt API 的讀寫量不變',async t => {
  const now=Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'],now });
  const env={ ...await setup(),WALK_RETRY_ENABLED:'true' },real=globalThis.fetch;
  worker.testing.resetState();
  const sheet={ value:{ date:'2026-10-01',walker:'' } },calls=[];
  globalThis.fetch=sheetAdapter(env,sheet,calls);
  try {
    await post(env,request('history-initial'));
    await tick(env,now);
    const seed=async (start,count) => env.DB.batch(Array.from({ length:count },(_,i)=>env.DB.prepare("INSERT INTO v3_walk_outbox(dog_key,version,operation_date,target_date,target_walker,status,next_attempt_at) VALUES('9001',?,'2020-01-01','2020-01-01','舊','synced','x')").bind(start+i)));
    const measure=async id => {
      await post(env,request(id));
      const before=(await env.DB.prepare('SELECT total_changes() n').first()).n,read=env.DB.stats.rowsRead;
      await tick(env,now);
      const changed=(await env.DB.prepare('SELECT total_changes() n').first()).n-before;
      return { changed,read:env.DB.stats.rowsRead-read };
    };
    await seed(100,20);
    const small=await measure('history-small');
    await seed(1000,180);
    assert.deepEqual(await measure('history-large'),small);
    assert.equal((await current(env)).walks[0].syncStatus,'synced');
  } finally { globalThis.fetch=real;env.DB.close(); }
});

test('恢復派送 B 逾時但舊 A 才取得接收端鎖，A 再中斷仍能下一輪恢復',async t => {
  const now=Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'],now });
  const env={ ...await setup(),WALK_RETRY_ENABLED:'true' },real=globalThis.fetch;
  worker.testing.resetState();
  let first,stopA,stopB;
  globalThis.fetch=async (_url,init) => {
    const body=JSON.parse(init.body);
    if (body.action==='walkScan') return Response.json({ ok:true,rows:[] });
    if (!first) { first=body;return new Promise((_,reject)=>{ stopA=()=>reject(new Error('A lost')); }); }
    return new Promise((_,reject)=>{ stopB=()=>reject(new Error('B lost')); });
  };
  let a;
  try {
    await post(env,request('race-recovery-1'));
    a=dispatchWalk(env.DB,{ id:'9001',name:'測試狗' },env);
    while (!stopA) await new Promise(resolve=>setImmediate(resolve));
    t.mock.timers.setTime(now+60000);
    const b=tick(env,now+60000);
    while (!stopB) await new Promise(resolve=>setImmediate(resolve));
    await machine(env,'target',{ dog:first.dog,dispatchId:first.dispatchId,current:{ date:'2026-10-01',walker:'' } });
    stopB();await b;
    t.mock.timers.setTime(now+120000);
    const sheet={ value:{ date:'2026-10-01',walker:'' } },calls=[];
    globalThis.fetch=sheetAdapter(env,sheet,calls);
    await tick(env,now+120000);
    assert.equal((await current(env)).walks[0].syncStatus,'synced');
    assert.equal(sheet.value.walker,'甲');
  } finally { stopA?.();if(a)await a;globalThis.fetch=real;env.DB.close(); }
});

test('UTC 午夜前的預留不能繞過隔日預算，晚到回執保留待確認',async t => {
  const now=Date.parse('2026-10-21T23:59:00Z');
  t.mock.timers.enable({ apis:['Date'],now });
  const env={ ...await setup(),WALK_RETRY_ENABLED:'true' },real=globalThis.fetch;
  worker.testing.resetState();
  let wake,stop,a;
  globalThis.fetch=async (_url,init) => {
    wake=JSON.parse(init.body);
    return new Promise((_,reject)=>{ stop=()=>reject(new Error('lost')); });
  };
  try {
    await post(env,request('utc-budget-0001'));
    a=dispatchWalk(env.DB,{ id:'9001',name:'測試狗' },env);
    while(!stop)await new Promise(resolve=>setImmediate(resolve));
    const target=await machine(env,'target',{ dog:wake.dog,dispatchId:wake.dispatchId,current:{ date:'2026-10-01',walker:'' } });
    t.mock.timers.setTime(now+120000);
    env.SYNC_DAILY_BUDGET='1';
    await assert.rejects(machine(env,'receipt',{ dogKey:'9001',...target }),{ status:503 });
    assert.equal((await current(env)).walks[0].syncStatus,'dispatching');
  } finally { env.SYNC_DAILY_BUDGET='20000';stop?.();if(a)await a;globalThis.fetch=real;env.DB.close(); }
});
