import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { todayWalks } from '../src/today-walks/index.js';
import { appsScript } from './apps-script.mjs';
import { setup, request, post, current, day } from './walk-fixture.mjs';

const dog = { id: '9001', name: '測試狗' }, key = 'test-secret';
const sheetDate = ymd => ymd.split('-').map(Number).join('/');
const wake = (dispatchId, extra = {}) => ({ action: 'walkWake', key, dog, dispatchId, ...extra });

test('保險掃描在相同鎖內只回四個必要欄位，不寫格子且必須驗證', async () => {
  const env = await setup(), gas = appsScript(env);
  try {
    const scan = await gas.run({ action:'walkScan',key });
    assert.deepEqual(scan.rows,[{ dog:{ id:'9001',name:'測試狗' },current:{ date:'2026-10-01',walker:'' } }]);
    assert.deepEqual(gas.writes(),[]);
    assert.deepEqual(gas.posts,[],'掃描不回呼 Worker');
    assert.equal((await gas.run({ action:'walkScan',key:'wrong' })).ok,false);
  } finally { env.DB.close(); }
});

test('接收端同鎖重定位、忽略舊 payload 目標、整格替換並讀回派送版本', async () => {
  const env = await setup(), gas = appsScript(env);
  worker.testing.resetState();
  try {
    await post(env, request('relocate-0001'));
    await post(env, request('relocate-0002', '乙'));
    // 第 2 次讀表前有人在上面插了一列
    gas.onRead = (values, n) => { if (n === 2) values.splice(1, 0, ['9999', '別隻狗', '', '']); };
    const out = await gas.run(wake('dispatch-1', { dog: { id: '9001', name: '已改名也用編號' }, current: { date: '2020-01-01', walker: '錯誤舊目標' } }));
    assert.equal(out.version, 2);
    assert.deepEqual(gas.writes(), [[3, 3, sheetDate(day())], [3, 4, '甲、乙']]);
    assert.deepEqual(gas.posts.map(p => p.action), ['target', 'receipt']);
    assert.equal(gas.posts[1].body.current.walker, '甲、乙');
    assert.equal(gas.posts[1].out.confirmed, true);
    // 寫回改了格子就換表上變動記號，讀表較早的編輯通知不會再送寫回前的舊值
    assert.ok(gas.mark());
  } finally { env.DB.close(); }
});

test('寫前可見人工修改、同名無編號歧義、狗已移走都停止寫入', async () => {
  const env = await setup(), gas = appsScript(env);
  worker.testing.resetState();
  try {
    await post(env, request('manual-0001'));
    gas.onRead = (values, n) => { if (n === 2) values[1][3] = '人工修改'; };
    await assert.rejects(gas.run(wake('dispatch-1')), /人工修改/);
    assert.deepEqual(gas.writes(), []);
    assert.equal(gas.posts.find(p => p.action === 'observe').body.observations[0].current.walker, '人工修改');
    gas.onRead = undefined;
    gas.replace([['', '同名', '', ''], ['', '同名', '', '']]);
    await assert.rejects(gas.run(wake('dispatch-2', { dog: { id: '', name: '同名' } })), /唯一/);
    await assert.rejects(gas.run(wake('dispatch-3')), /唯一/);
    assert.deepEqual(gas.writes(), []);
  } finally { env.DB.close(); }
});

test('保險掃描按狗比指紋：只回 D1 有記且不同的狗，算法跟 Worker 一樣；沒帶指紋回整份', async () => {
  const env = { ...await setup(), WALK_RETRY_ENABLED: 'true' }, gas = appsScript(env);
  worker.testing.resetState();
  try {
    await post(env, request('fingerprint-0001'));
    await todayWalks(env, { sheet: gas.sheet }).dispatch([dog]);
    const written = gas.writes().length;
    // 掃描只讀四欄，不整張讀
    gas.onRead = (_values, _n, { full }) => assert.equal(full, false, '掃描不得下載完整主清單內容');
    await todayWalks(env, { sheet: gas.sheet }).scan();
    const fp = gas.calls.findLast(c => c.action === 'walkScan').fingerprints;
    assert.deepEqual(Object.keys(fp), ['9001']);
    assert.deepEqual(await gas.run({ action:'walkScan',key,fingerprints:fp }), { ok:true,rows:[] });
    gas.replace([['9001','測試狗','2026/9/1','甲'],['9002','D1 沒記','2026/9/1','乙'],['','同名','2026/9/1',''],['','同名','','']]);
    const changed = await gas.run({ action:'walkScan',key,fingerprints:{ ...fp,'名:同名':'x' } });
    assert.deepEqual(changed.rows,[{ dog:{ id:'9001',name:'測試狗' },current:{ date:'2026-09-01',walker:'甲' } }]);
    assert.equal((await gas.run({ action:'walkScan',key })).rows.length,4);
    assert.equal(gas.writes().length,written);
  } finally { env.DB.close(); }
});

test('合併派送同鎖逐隻寫，單隻失敗只記在那隻，不擋其他隻', async () => {
  const env = await setup(), gas = appsScript(env);
  worker.testing.resetState();
  try {
    await post(env, request('batch-0001'));
    const out = await gas.run({ action:'walkWakeBatch',key,items:[
      { dog:{ id:'0000',name:'不在表上' },dispatchId:'d-missing' },
      { dog,dispatchId:'d-ok' }] });
    assert.equal(out.ok,true);
    assert.equal(out.results[0].ok,false); assert.equal(out.results[0].dispatchId,'d-missing'); assert.match(out.results[0].error,/唯一/);
    assert.equal(out.results[1].ok,true); assert.equal(out.results[1].dispatchId,'d-ok');
    assert.deepEqual(gas.writes(),[[2,3,sheetDate(day())],[2,4,'甲']]);
    await assert.rejects(gas.run({ action:'walkWakeBatch',key,items:Array.from({ length:11 },()=>({})) }),/數量/);
    assert.equal((await gas.run({ action:'walkWakeBatch',key:'wrong',items:[] })).ok,false);
  } finally { env.DB.close(); }
});

test('登記後立即復原：延遲喚醒只取復原目標；舊回執不能使名字復活或清除新工作', async () => {
  for (const oldDispatched of [false, true]) {
    const env = await setup(), gas = appsScript(env); worker.testing.resetState();
    const baseline = { date:'2026-10-01',walker:'' };
    try {
      await post(env,request('undo-delivery-walk'));
      // 復原前的那次寫回：格子寫了甲，回執還沒送到
      let old = null;
      if (oldDispatched) {
        gas.stopAt('receipt');
        await assert.rejects(gas.run(wake('before-undo')));
        old = gas.posts.find(p => p.action === 'receipt' && p.stopped);
      }
      const undo = await post(env,request('undo-delivery-restore','乙',{ action:'undo',dogs:[{ ...dog,expectedVersion:1 }] }));
      assert.equal(undo.status,200);
      if (old) assert.equal((await gas.resend(old)).confirmed,false);
      let midway;
      gas.beforeWorker = async action => { if (action === 'receipt') midway = (await current(env)).walks[0].syncStatus; };
      await gas.run(wake('late-wake'));
      const target = gas.posts.findLast(p => p.action === 'target');
      assert.equal(target.status,200);
      assert.equal(target.out.version,2);
      assert.deepEqual(target.out.current,baseline);
      assert.equal(midway,'dispatching');
      assert.equal(gas.posts.at(-1).out.confirmed,true);
      assert.deepEqual(gas.cell('9001'),baseline);
      if (old) await gas.resend(old);
      const data = await current(env);
      assert.equal(data.walks[0].walker,'');
      assert.equal(data.walks[0].walkedDate,baseline.date);
      assert.equal(data.walks[0].version,2);
      assert.equal(data.walks[0].syncStatus,'synced');
    } finally { env.DB.close(); }
  }
});

test('一次派送失敗可靠留存；可信讀回才完成，舊回執不清新版本', async () => {
  const env = await setup(), gas = appsScript(env);
  worker.testing.resetState();
  try {
    assert.equal((await post(env, request('delivery-0001'))).status, 200);
    // 小程式寫了格子，送回執前被停掉；Worker 那邊等不到回應
    gas.stopAt('receipt');
    await todayWalks(env, { sheet: gas.sheet }).dispatch([dog]);
    assert.equal((await current(env)).walks[0].syncStatus, 'retry');
    assert.equal((await current(env)).walks[0].walker, '甲');
    const stale = gas.posts.find(p => p.action === 'receipt' && p.stopped);
    await post(env, request('delivery-0002','乙'));
    assert.equal((await gas.resend(stale)).confirmed, false);
    assert.equal((await current(env)).walks[0].syncStatus, 'pending');
    let forged;
    gas.beforeWorker = async (action, body) => { if (action === 'receipt') forged = await gas.resend({ action, body }, { dispatchId:'forged' }); };
    const out = await gas.run(wake('new-dispatch'));
    assert.equal(out.version, 2);
    assert.equal(out.current.walker, '甲、乙');
    assert.equal(forged.confirmed, false);
    assert.equal(out.confirmed, true);
    assert.equal((await current(env)).walks[0].syncStatus, 'synced');
    assert.equal((await gas.resend({ action:'target',body:{} }, {}, 'wrong')).status, 403);
  } finally { env.DB.close(); }
});

test('同狗已有派送執行中，較新版本不能另外取得派送者', async () => {
  const env = await setup(), gas = appsScript(env);
  worker.testing.resetState();
  let release;
  gas.network = () => { if (release) return Promise.reject(new Error('second sender')); return new Promise((_,reject) => { release = () => reject(new Error('lost')); }); };
  try {
    await post(env, request('sender-0001'));
    const first = todayWalks(env, { sheet: gas.sheet }).dispatch([dog]);
    while (!release) await new Promise(resolve => setImmediate(resolve));
    await post(env, request('sender-0002','乙'));
    await todayWalks(env, { sheet: gas.sheet }).dispatch([dog]);
    assert.equal(gas.calls.length,1);
    release(); await first;
  } finally { release?.(); env.DB.close(); }
});

test('舊目標實際寫入且可信回執抵達後，下一輪可以補正最新目標', async () => {
  const env = await setup(), gas = appsScript(env); worker.testing.resetState();
  try {
    await post(env,request('intermediate-0001'));
    gas.stopAt('receipt');
    await assert.rejects(gas.run(wake('first-dispatch')));
    assert.equal(gas.cell('9001').walker,'甲');
    const late = gas.posts.find(p => p.action === 'receipt' && p.stopped);
    await post(env,request('intermediate-0002','乙'));
    assert.equal((await gas.resend(late)).confirmed,false);
    gas.stopAfter('target');
    await assert.rejects(gas.run(wake('second-dispatch')));
    const next = gas.posts.at(-1);
    assert.equal(next.status,200);
    assert.equal(next.out.version,2);
    assert.equal(next.out.current.walker,'甲、乙');
    assert.equal((await current(env)).walks[0].syncStatus,'dispatching');
  } finally { env.DB.close(); }
});

test('授予目標前版本已變，交易停止而不回傳過期目標', async () => {
  const env = await setup(), gas = appsScript(env); worker.testing.resetState();
  try {
    await post(env,request('race-target-0001'));
    const batch = env.DB.batch;
    // 拿目標先一次讀齊快照（第 1 次 batch），在授予目標的寫入（第 2 次）之前插入別人的登記。
    let calls = 0;
    env.DB.batch = async statements => {
      if (++calls === 2) { assert.equal((await post(env,request('race-target-0002','乙'))).status,200); }
      return batch(statements);
    };
    await assert.rejects(gas.run(wake('race-dispatch')),/Worker 停止寫回/);
    const target = gas.posts.at(-1);
    assert.notEqual(target.status,200);
    assert.equal(target.out.current,undefined);
    assert.deepEqual(gas.writes(),[]);
    assert.equal((await current(env)).walks[0].walker,'甲、乙');
  } finally { env.DB.close(); }
});
