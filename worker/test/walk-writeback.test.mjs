import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import worker from '../src/index.js';
import { todayWalks } from '../src/today-walks/index.js';
import { walkFingerprint } from '../src/today-walks/scan.js';
import { setup, request, post, current } from './walk-fixture.mjs';

const source = readFileSync(new URL('../../apps-script/sheet-write.gs', import.meta.url), 'utf8');
function scriptAdapter(callback, { mutate = () => {}, forbidFullRead = false } = {}) {
  let values = [['編號','犬名','遛狗日期','誰遛的'],['9001','測試狗','2026/10/1','']];
  const writes = [];
  let locked = false, reads = 0;
  const stored = { SHEET_ID: 'test', WRITE_KEY: 'test-secret', WALK_WORKER_URL: 'https://worker.example' };
  const props = { getProperty: key => stored[key] ?? null, setProperty: (key, value) => { stored[key] = value; } };
  const sheet = {
    getLastRow: () => values.length,
    getLastColumn: () => values[0].length,
    getDataRange: () => ({ getValues: () => { assert.equal(forbidFullRead,false,'通知不得下載完整主清單內容'); assert.equal(locked, true); mutate(values, ++reads); return values.map(r => [...r]); } }),
    getRange: (r,c,height=1,width=1) => ({
      getValues: () => { assert.equal(locked,true); return values.slice(r-1,r-1+height).map(row=>row.slice(c-1,c-1+width)); },
      setValue: value => { assert.equal(locked, true); values[r-1][c-1] = value; writes.push([r,c,value]); }
    }),
  };
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => props },
    LockService: { getScriptLock: () => ({ waitLock: () => { locked = true; }, releaseLock: () => { locked = false; } }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }), flush: () => {} },
    // 只模擬指紋用到的部分；Google 回的是有正負號的位元組
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (algorithm, text) => [...createHash(algorithm).update(text, 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)) },
    UrlFetchApp: { fetch: (url, options) => { assert.equal(locked, true); return callback(url, JSON.parse(options.payload), options.headers); } },
  });
  vm.runInContext(source, context);
  return { run: body => context.handleRequest(body), writes, values: () => values, replace: rows => { values = rows; }, mark: () => stored.SHEET_EDIT_MARK };
}

test('保險掃描在相同鎖內只回四個必要欄位，不寫格子且必須驗證',() => {
  const script=scriptAdapter(()=>{ throw new Error('掃描不回呼 Worker'); });
  const scan=script.run({ action:'walkScan',key:'test-secret' });
  assert.deepEqual(JSON.parse(JSON.stringify(scan.rows)),[{ dog:{ id:'9001',name:'測試狗' },current:{ date:'2026-10-01',walker:'' } }]);
  assert.deepEqual(script.writes,[]);
  assert.equal(script.run({ action:'walkScan',key:'wrong' }).ok,false);
});
test('接收端同鎖重定位、忽略舊 payload 目標、整格替換並讀回派送版本', () => {
  const calls = [];
  const script = scriptAdapter((url, body) => {
    calls.push([url,body]);
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(url.endsWith('/target')
      ? { ok: true, version: 2, dispatchId: body.dispatchId, current: { date: '2026-10-21', walker: '甲、乙' } }
      : { ok: true, confirmed: true }) };
  }, { mutate: (values, n) => { if (n === 2) values.splice(1,0,['9999','別隻狗','','']); } });
  const out = script.run({ action: 'walkWake', key: 'test-secret', dog: { id: '9001', name: '已改名也用編號' }, dispatchId: 'dispatch-1', current: { date: '2020-01-01', walker: '錯誤舊目標' } });
  assert.equal(out.version, 2);
  assert.deepEqual(script.writes, [[3,3,'2026/10/21'],[3,4,'甲、乙']]);
  assert.equal(calls[1][1].current.walker, '甲、乙');
  // 寫回改了格子就換表上變動記號，讀表較早的編輯通知不會再送寫回前的舊值
  assert.ok(script.mark());
});

test('寫前可見人工修改、同名無編號歧義、狗已移走都停止寫入', () => {
  const observations = [];
  const reply = (url, body) => {
    if (url.endsWith('/observe')) observations.push(...body.observations);
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true, results:[{ ok:true }], version: 1, dispatchId: body.dispatchId, current: { date: '2026-10-21', walker: '甲' } }) };
  };
  const script = scriptAdapter(reply, { mutate: (values,n) => { if (n === 2) values[1][3] = '人工修改'; } });
  const wake = { action: 'walkWake', key: 'test-secret', dog: { id: '9001', name: '測試狗' }, dispatchId: 'dispatch-1' };
  assert.throws(() => script.run(wake), /人工修改/);
  assert.deepEqual(script.writes, []);
  assert.equal(observations[0].current.walker,'人工修改');
  script.replace([['編號','犬名','遛狗日期','誰遛的'],['','同名','',''],['','同名','','']]);
  assert.throws(() => script.run({ ...wake, dog: { id: '', name: '同名' } }), /唯一/);
  assert.throws(() => script.run(wake), /唯一/);
  assert.deepEqual(script.writes, []);
});

test('保險掃描按狗比指紋：只回 D1 有記且不同的狗，算法跟 Worker 一樣；沒帶指紋回整份', async () => {
  const script = scriptAdapter(() => { throw new Error('掃描不回呼 Worker'); }, { forbidFullRead:true });
  const fp = { '9001': await walkFingerprint('2026-10-01','') };
  assert.deepEqual(JSON.parse(JSON.stringify(script.run({ action:'walkScan',key:'test-secret',fingerprints:fp }))),{ ok:true,rows:[] });
  script.replace([['編號','犬名','遛狗日期','誰遛的'],['9001','測試狗','2026/9/1','甲'],['9002','D1 沒記','2026/9/1','乙'],['','同名','2026/9/1',''],['','同名','','']]);
  const changed = script.run({ action:'walkScan',key:'test-secret',fingerprints:{ ...fp,'名:同名':'x' } });
  assert.deepEqual(JSON.parse(JSON.stringify(changed.rows)),[{ dog:{ id:'9001',name:'測試狗' },current:{ date:'2026-09-01',walker:'甲' } }]);
  assert.equal(script.run({ action:'walkScan',key:'test-secret' }).rows.length,4);
  assert.deepEqual(script.writes,[]);
});

test('合併派送同鎖逐隻寫，單隻失敗只記在那隻，不擋其他隻', () => {
  const script = scriptAdapter((url, body) => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(url.endsWith('/target')
    ? { ok: true, version: 2, dispatchId: body.dispatchId, current: { date: '2026-10-21', walker: '甲' } }
    : { ok: true, confirmed: true }) }));
  const out = script.run({ action:'walkWakeBatch',key:'test-secret',items:[
    { dog:{ id:'0000',name:'不在表上' },dispatchId:'d-missing' },
    { dog:{ id:'9001',name:'測試狗' },dispatchId:'d-ok' }] });
  assert.equal(out.ok,true);
  assert.equal(out.results[0].ok,false); assert.equal(out.results[0].dispatchId,'d-missing'); assert.match(out.results[0].error,/唯一/);
  assert.equal(out.results[1].ok,true); assert.equal(out.results[1].dispatchId,'d-ok');
  assert.deepEqual(script.writes,[[2,3,'2026/10/21'],[2,4,'甲']]);
  assert.throws(() => script.run({ action:'walkWakeBatch',key:'test-secret',items:Array.from({ length:11 },()=>({})) }),/數量/);
  assert.equal(script.run({ action:'walkWakeBatch',key:'wrong',items:[] }).ok,false);
});

async function machine(env, action, body, key = 'test-secret') {
  const res = await worker.fetch(new Request(`https://worker.example/api/walk-writeback/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sheet-Write-Key': key }, body: JSON.stringify(body) }), env);
  return { status: res.status, ...await res.json() };
}

test('登記後立即復原：延遲喚醒只取復原目標；舊回執不能使名字復活或清除新工作', async () => {
  for (const oldDispatched of [false, true]) {
    const env = await setup(); worker.testing.resetState();
    const dog = { id:'9001',name:'測試狗' }, baseline = { date:'2026-10-01',walker:'' };
    try {
      await post(env,request('undo-delivery-walk'));
      const old = oldDispatched ? await machine(env,'target',{ dog,dispatchId:'before-undo',current:baseline }) : null;
      const undo = await post(env,request('undo-delivery-restore','乙',{ action:'undo',dogs:[{ ...dog,expectedVersion:1 }] }));
      assert.equal(undo.status,200);
      if (old) assert.equal((await machine(env,'receipt',{ dogKey:dog.id,dispatchId:old.dispatchId,version:old.version,current:old.current })).confirmed,false);
      const target = await machine(env,'target',{ dog,dispatchId:'late-wake',current:old?.current || baseline });
      assert.equal(target.status,200);
      assert.equal(target.version,2);
      assert.deepEqual(target.current,baseline);
      assert.equal((await current(env)).walks[0].syncStatus,'dispatching');
      assert.equal((await machine(env,'receipt',{ dogKey:dog.id,dispatchId:target.dispatchId,version:2,current:target.current })).confirmed,true);
      if (old) await machine(env,'receipt',{ dogKey:dog.id,dispatchId:old.dispatchId,version:old.version,current:old.current });
      const data = await current(env);
      assert.equal(data.walks[0].walker,'');
      assert.equal(data.walks[0].walkedDate,baseline.date);
      assert.equal(data.walks[0].version,2);
      assert.equal(data.walks[0].syncStatus,'synced');
    } finally { env.DB.close(); }
  }
});

test('一次派送失敗可靠留存；可信讀回才完成，舊回執不清新版本', async () => {
  const env = await setup(), real = globalThis.fetch;
  worker.testing.resetState();
  try {
    assert.equal((await post(env, request('delivery-0001'))).status, 200);
    globalThis.fetch = async () => { throw new Error('response-lost'); };
    await todayWalks(env).dispatch([{ id: '9001', name: '測試狗' }]);
    assert.equal((await current(env)).walks[0].syncStatus, 'retry');
    assert.equal((await current(env)).walks[0].walker, '甲');
    const old = await env.DB.prepare('SELECT * FROM v3_walk_outbox WHERE version=1').first();
    await post(env, request('delivery-0002','乙'));
    const stale = await machine(env,'receipt',{ dogKey:'9001', version:1, dispatchId:old.dispatch_id, current:{ date:old.target_date, walker:old.target_walker } });
    assert.equal(stale.confirmed, false);
    assert.equal((await current(env)).walks[0].syncStatus, 'pending');
    const target = await machine(env,'target',{ dog:{ id:'9001', name:'測試狗' }, dispatchId:'new-dispatch', current:{ date:'2026-10-01', walker:'' } });
    assert.equal(target.version, 2);
    assert.equal(target.current.walker, '甲、乙');
    const receipt = { dogKey:'9001', version:target.version, dispatchId:target.dispatchId, current:target.current };
    assert.equal((await machine(env,'receipt', { ...receipt, dispatchId:'forged' })).confirmed, false);
    assert.equal((await machine(env,'receipt',receipt)).confirmed,true);
    assert.equal((await current(env)).walks[0].syncStatus, 'synced');
    assert.equal((await machine(env,'target',{},'wrong')).status,403);
  } finally { globalThis.fetch = real; env.DB.close(); }
});

test('同狗已有派送執行中，較新版本不能另外取得派送者', async () => {
  const env = await setup(), real = globalThis.fetch;
  worker.testing.resetState();
  let release, count = 0;
  globalThis.fetch = () => { if (++count > 1) return Promise.reject(new Error('second sender')); return new Promise((_,reject) => { release = () => reject(new Error('lost')); }); };
  try {
    await post(env, request('sender-0001'));
    const first = todayWalks(env).dispatch([{ id:'9001', name:'測試狗' }]);
    while (!release) await new Promise(resolve => setImmediate(resolve));
    await post(env, request('sender-0002','乙'));
    await todayWalks(env).dispatch([{ id:'9001', name:'測試狗' }]);
    assert.equal(count,1);
    release(); await first;
  } finally { release?.(); globalThis.fetch = real; }
});

test('舊目標實際寫入且可信回執抵達後，下一輪可以補正最新目標', async () => {
  const env = await setup(); worker.testing.resetState();
  await post(env,request('intermediate-0001'));
  const first = await machine(env,'target',{ dog:{ id:'9001',name:'測試狗' }, dispatchId:'first-dispatch', current:{ date:'2026-10-01',walker:'' } });
  assert.equal(first.current.walker,'甲');
  await post(env,request('intermediate-0002','乙'));
  assert.equal((await machine(env,'receipt',{ dogKey:'9001',version:first.version,dispatchId:first.dispatchId,current:first.current })).confirmed,false);
  const next = await machine(env,'target',{ dog:{ id:'9001',name:'測試狗' }, dispatchId:'second-dispatch',current:first.current });
  assert.equal(next.status,200);
  assert.equal(next.version,2);
  assert.equal(next.current.walker,'甲、乙');
  assert.equal((await current(env)).walks[0].syncStatus,'dispatching');
  env.DB.close();
});

test('授予目標前版本已變，交易停止而不回傳過期目標', async () => {
  const env = await setup(); worker.testing.resetState();
  await post(env,request('race-target-0001'));
  const batch = env.DB.batch;
  // 拿目標先一次讀齊快照（第 1 次 batch），在授予目標的寫入（第 2 次）之前插入別人的登記。
  let calls = 0;
  env.DB.batch = async statements => {
    if (++calls === 2) { assert.equal((await post(env,request('race-target-0002','乙'))).status,200); }
    return batch(statements);
  };
  const out = await machine(env,'target',{ dog:{ id:'9001',name:'測試狗' },dispatchId:'race-dispatch',current:{ date:'2026-10-01',walker:'' } });
  assert.notEqual(out.status,200);
  assert.equal(out.current,undefined);
  assert.equal((await current(env)).walks[0].walker,'甲、乙');
  env.DB.close();
});
