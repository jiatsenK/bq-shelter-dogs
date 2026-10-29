import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { setup as baseSetup, post, request, current, day } from './walk-fixture.mjs';
import { resolveIdentity } from '../src/identity.js';
import { todayWalks } from '../src/today-walks/index.js';
import { appsScript } from './apps-script.mjs';

// 人工改表走真的編輯觸發送 /rows（功能開關 D1_WALK_NOTIFY 開著）
const setup = async () => {
  const env = { ...await baseSetup(), D1_WALK_NOTIFY: '1' };
  return { env, gas: appsScript(env) };
};
const walks = (env, gas) => todayWalks(env, { sheet: gas.sheet });
// 保險掃描一輪（排程才跑，測試直接開功能）
const scanWalks = (env, gas) => todayWalks({ ...env, WALK_RETRY_ENABLED: 'true' }, { sheet: gas.sheet }).scan();
const dog = { id: '9001', name: '測試狗' };
// 人工改那隻狗的格子（沒給的欄照舊，等於重打一次），回 Worker 對那一列的比對結果
async function edit(gas, change = {}) {
  await gas.edit(dog.id, change);
  return gas.posts.findLast(p => p.action === 'rows').out.results[0];
}
// 派送送到小程式、Worker 那邊被停掉沒收尾；stop 是小程式自己停在哪（stopAt／stopAfter）
async function lostDispatch(env, gas, stop) {
  stop();
  const ran = gas.cutOff();
  walks(env, gas).dispatch([dog]);
  await ran;
}
// 網站登記後照常寫回表上、回執確認
async function baseline(env, gas, walker = '甲、丙') {
  await post(env, request('baseline-0001', walker));
  await walks(env, gas).dispatch([dog]);
  assert.deepEqual(gas.cell(dog.id), { date: day(), walker });
  assert.equal((await current(env)).walks[0].syncStatus, 'synced');
}

test('同日人工刪甲、網站加乙，三方比較保留丙乙且不復活甲', async () => {
  const { env, gas } = await setup(); worker.testing.resetState();
  try {
    await baseline(env, gas);
    await post(env, request('website-0002', '乙'));
    gas.set(dog.id, { walker: '丙' });
    await walks(env, gas).dispatch([dog]);
    assert.equal(gas.cell(dog.id).walker, '丙、乙');
    assert.equal((await current(env)).walks[0].walker, '丙、乙');
    assert.ok(gas.posts.findLast(p => p.action === 'target').out.version > 2);
  } finally { env.DB.close(); }
});

test('舊基準不蓋網站新登記；無差異比較零寫入；未確認舊派送不冒充人工值', async () => {
  const { env, gas } = await setup(); worker.testing.resetState();
  try {
    await baseline(env, gas, '甲');
    const total=async ()=>(await env.DB.prepare('SELECT total_changes() AS n').first()).n;
    const before=await total();
    await edit(gas);
    assert.equal(await total(),before);
    await post(env,request('stale-0002','乙'));
    await edit(gas);
    assert.equal((await current(env)).walks[0].walker,'甲、乙');
    // 乙的派送寫進格子，但回執沒送到
    await lostDispatch(env, gas, () => gas.stopAt('receipt'));
    assert.equal(gas.cell(dog.id).walker,'甲、乙');
    await post(env,request('newer-0003','丙'));
    const ambiguous=await edit(gas);
    assert.equal(ambiguous.ok,false);
    assert.equal((await current(env)).walks[0].walker,'甲、乙、丙');
    const diagnostic=await env.DB.prepare('SELECT observation,error FROM v3_walk_conflicts WHERE dog_key=?').bind(dog.id).first();
    assert.match(diagnostic.error,/未確認/);
    const after=await total(); await edit(gas); assert.equal(await total(),after);
  } finally { env.DB.close(); }
});

test('未知派送可能只寫了一欄，不能把半格結果接受成新的人工修正', async () => {
  const { env, gas } = await setup(); worker.testing.resetState();
  try {
    await post(env,request('partial-0001','甲'));
    await lostDispatch(env, gas, () => gas.stopAfter('target'));
    const result=await edit(gas,{ date:day() });
    assert.equal(result.ok,false);
    assert.equal((await current(env)).walks[0].walker,'甲');
  } finally { env.DB.close(); }
});

test('掃描回應只有 HTTP 200 或 ok、沒有整份四欄，不能宣稱已完成比對', async () => {
  const { env, gas } = await setup();
  try {
    await baseline(env, gas, '甲');
    gas.network=async ()=>Response.json({ ok:true }); // 壞掉或舊版的小程式
    await assert.rejects(scanWalks(env, gas),/不完整/);
  } finally { env.DB.close(); }
});

test('人工新名字不建立身分，之後本人設定相同名字再登記不重複', async () => {
  const { env, gas } = await setup(); worker.testing.resetState();
  try {
    const before=(await env.DB.prepare('SELECT COUNT(*) AS n FROM v3_volunteers').first()).n;
    await edit(gas,{ date:day(),walker:'丁' });
    assert.equal((await current(env)).walks[0].walker,'丁');
    assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM v3_volunteers').first()).n,before);
    await resolveIdentity(env.DB,'丁',env.WALKER_KEY);
    await post(env,request('new-name-0001','丁'));
    assert.equal((await current(env)).walks[0].walker,'丁');
  } finally { env.DB.close(); }
});

test('D1 狗對應變成歧義，即使已接管也不能接受人工修正', async () => {
  const { env, gas } = await setup(); worker.testing.resetState();
  try {
    await baseline(env, gas, '甲');
    await env.DB.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,walked_date) VALUES(2,'dog','9001','測試狗','2026-10-01')").run();
    const result=await edit(gas,{ date:'',walker:'' });
    assert.equal(result.ok,false);
    assert.equal((await current(env)).walks[0].walker,'甲');
  } finally { env.DB.close(); }
});

test('人工刪名剛好回到更早的已同步名單，也必須保留刪除而非當成中間值', async () => {
  const { env, gas } = await setup(); worker.testing.resetState();
  try {
    await baseline(env, gas, '丙');
    await post(env,request('history-add-0002','甲'));
    await walks(env, gas).dispatch([dog]);
    assert.equal(gas.cell(dog.id).walker,'丙、甲');
    await post(env,request('history-add-0003','乙'));
    gas.set(dog.id,{ walker:'丙' });
    await walks(env, gas).dispatch([dog]);
    assert.equal(gas.posts.findLast(p => p.action === 'target').status,200);
    assert.equal(gas.cell(dog.id).walker,'丙、乙');
    assert.equal((await current(env)).walks[0].walker,'丙、乙');
  } finally { env.DB.close(); }
});

test('人工同日刪名保留原復原前值，不因同步複本已到今天而遺失上次溜', async () => {
  const { env, gas } = await setup(); worker.testing.resetState();
  try {
    await baseline(env, gas, '甲、乙');
    await env.DB.prepare('UPDATE v3_sheet_main SET walked_date=? WHERE number=?').bind(day(),dog.id).run();
    const corrected=await edit(gas,{ walker:'乙' });
    assert.equal(corrected.ok,true);
    const state=(await current(env)).walks[0];
    const undo=await post(env,request('after-human-undo','丙',{ action:'undo',dogs:[{ ...dog,expectedVersion:state.version }] }));
    assert.equal(undo.status,200);
    assert.equal(undo.body.results[0].current.date,'2026-10-01');
  } finally { env.DB.close(); }
});

test('復原可信人工前次名單中的未註冊名字，仍只驗證操作人而不建立被還原者身分', async () => {
  const { env, gas } = await setup(); worker.testing.resetState();
  try {
    await edit(gas,{ date:'2026/9/1',walker:'丁' });
    await post(env,request('after-manual-walk','甲'));
    const state=(await current(env)).walks[0];
    const undo=await post(env,request('restore-manual-name','乙',{ action:'undo',dogs:[{ ...dog,expectedVersion:state.version }] }));
    assert.equal(undo.status,200);
    assert.deepEqual(undo.body.results[0].current,{ date:'2026-09-01',walker:'丁' });
    assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM v3_volunteers').first()).n,3);
  } finally { env.DB.close(); }
});

test('#408 單狗比對及寫回在主清單與同狗歷史十倍後，讀寫量固定且歷史使用索引', async () => {
  async function sample(count) {
    const { env, gas } = await setup(); worker.testing.resetState();
    try {
      await baseline(env, gas); await post(env,request('cost-add-0002','乙'));
      await env.DB.batch(Array.from({ length:count },(_,i)=>env.DB.prepare("INSERT INTO v3_walk_outbox(dog_key,version,operation_date,target_date,target_walker,status,next_attempt_at,dispatch_id,readback_seen) VALUES('9001',?,'2020-01-01','2020-01-01','舊',?,'x','old-dispatch',?)").bind(-i-1,i%2 ? 'synced':'superseded',i%2)));
      for (let i=0;i<count;i++) await env.DB.batch([
        env.DB.prepare('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)').bind(`other${i}`,`別狗${i}`),
        env.DB.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,walked_date) VALUES(?,?,?,?,'')").bind(i+2,`other${i}`,`B${i}`,`別狗${i}`),
      ]);
      const prepare=env.DB.prepare, queries=[];
      const wrap=(sql,args=[])=>{
        const stmt=prepare(sql).bind(...args);
        const track=method=>(...params)=>{ queries.push({ sql,args }); return stmt[method](...params); };
        return { bind:(...values)=>wrap(sql,values),first:track('first'),all:track('all'),run:track('run') };
      };
      const before=(await prepare('SELECT total_changes() n').first()).n,read=env.DB.stats.rowsRead;
      env.DB.prepare=wrap;
      const observed=await edit(gas,{ walker:'丙' });
      assert.equal(observed.ok,true);
      await walks(env, gas).dispatch([dog]);
      env.DB.prepare=prepare;
      assert.equal(gas.posts.findLast(p => p.action === 'target').status,200);
      const reads=env.DB.stats.rowsRead-read;
      const writes=(await prepare('SELECT total_changes() n').first()).n-before;
      for (const { sql,args } of queries.filter(q=>/^SELECT/.test(q.sql) && q.sql.includes('FROM v3_walk_outbox'))) {
        const plan=(await prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...args).all()).results.map(p=>p.detail).join(';');
        // 查詢可能用別名 o；不管名字，待寫回工作都要走索引。
        assert.doesNotMatch(plan,/SCAN (v3_walk_outbox|o)/);
        assert.match(plan,/SEARCH (v3_walk_outbox|o) /);
      }
      return { reads,writes };
    } finally { env.DB.close(); }
  }
  assert.deepEqual(await sample(200),await sample(20));
});

test('保險掃描按狗送指紋，讀寫量不隨歷史增加；沒有不同的狗就不比對、不寫入', async () => {
  const { env, gas } = await setup();
  try {
    await baseline(env, gas, '甲');
    const sample=async ()=>{
      const before=(await env.DB.prepare('SELECT total_changes() n').first()).n,read=env.DB.stats.rowsRead;
      await scanWalks(env, gas);
      return { reads:env.DB.stats.rowsRead-read,writes:(await env.DB.prepare('SELECT total_changes() n').first()).n-before };
    };
    const small=await sample();
    assert.equal(small.writes,0);
    // 只送 D1 有記的狗的指紋，算法跟小程式一樣：表上沒改，小程式就不回這隻
    const [scan]=gas.calls.filter(c=>c.action==='walkScan');
    assert.deepEqual(Object.keys(scan.fingerprints),['9001']);
    assert.equal(scan.sig,undefined);
    assert.deepEqual((await gas.run({ action:'walkScan',key:'test-secret',fingerprints:scan.fingerprints })).rows,[]);
    await env.DB.batch(Array.from({ length:200 },(_,i)=>env.DB.prepare("INSERT INTO v3_walk_outbox(dog_key,version,operation_date,target_date,target_walker,status,next_attempt_at) VALUES('9001',?,'2020-01-01','2020-01-01','舊','synced','x')").bind(i+100)));
    assert.deepEqual(await sample(),small);
  } finally { env.DB.close(); }
});

test('#676 保險掃描先掃在所的狗再用主鍵查寫回紀錄，結果跟原本 JOIN 相同', async () => {
  const { env, gas } = await setup(), prepare=env.DB.prepare;
  try {
    await baseline(env, gas, '甲');
    // 多隻狗、每隻多版本（含 superseded 舊版），再加一隻沒有任何寫回紀錄的狗：兩種寫法都不能回它。
    for (let i=0;i<5;i++) {
      const key=`scan${i}`;
      await env.DB.batch([
        env.DB.prepare('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)').bind(key,`掃描狗${i}`),
        env.DB.prepare("INSERT INTO v3_walk_state(dog_key,dog_id,number,name,version,effective_date,walker,members_json,base_date,base_walker,previous_date,previous_walker,updated_at) VALUES(?,?,?,?,3,'2026-10-01','乙','[]','2026-10-01','乙','','','x')").bind(key,key,`S${i}`,`掃描狗${i}`),
        ...(i===4 ? [] : [1,2,3].map(v=>env.DB.prepare("INSERT INTO v3_walk_outbox(dog_key,version,operation_date,target_date,target_walker,status,next_attempt_at) VALUES(?,?,'2026-10-01','2026-10-01','乙',?,'x')").bind(key,v,v===3 ? (i%2 ? 'pending':'synced') : 'superseded'))),
      ]);
    }
    const queries=[];
    env.DB.prepare=sql=>{ queries.push(sql); return prepare(sql); };
    await scanWalks(env, gas);
    env.DB.prepare=prepare;
    const sql=queries.find(q=>q.includes('FROM v3_walk_state s'));
    const plan=(await prepare(`EXPLAIN QUERY PLAN ${sql}`).all()).results.map(p=>p.detail).join(';');
    assert.match(plan,/^SCAN s;SEARCH o USING .*\(dog_key=\? AND version=\?\)$/);
    const rows=async q=>(await prepare(`${q} ORDER BY s.dog_key`).all()).results;
    const now=await rows(sql);
    assert.deepEqual(now,await rows('SELECT s.*,o.status FROM v3_walk_state s JOIN v3_walk_outbox o ON o.dog_key=s.dog_key AND o.version=s.version'));
    assert.deepEqual(now.map(r=>[r.dog_key,r.status]),[['9001','synced'],['scan0','synced'],['scan1','pending'],['scan2','synced'],['scan3','pending']]);
  } finally { env.DB.prepare=prepare; env.DB.close(); }
});

// #746 起保險掃描跟改表通知同一套規則，還沒派送的 pending 也收下人工修改；已交給 GAS、結果不明的派送才留給派送自己收尾
test('還有差異沒收完（派送結果不明）base 不變，下次掃描同一隻還會被找出來', async () => {
  const { env, gas } = await setup();
  try {
    await baseline(env, gas, '甲');
    await post(env,request('pending-sig-0002','乙'));
    gas.set(dog.id,{ date:'2026/9/1',walker:'丁' });
    gas.network=(body,deliver)=>body.action==='walkScan' ? deliver() : Promise.reject(new Error('lost'));
    await walks(env, gas).dispatch([dog]);
    await scanWalks(env, gas);
    await scanWalks(env, gas);
    assert.equal((await current(env)).walks[0].walker,'甲、乙');
    assert.equal((await current(env)).walks[0].syncStatus,'retry');
    const [first,second]=gas.calls.filter(c=>c.action==='walkScan');
    assert.deepEqual(second.fingerprints,first.fingerprints);
  } finally { env.DB.close(); }
});

test('可信人工清空及改早日期先成為新版本，舊 pending 不復活，其後可再登記', async () => {
  const { env, gas } = await setup(); worker.testing.resetState();
  try {
    await baseline(env, gas);
    await post(env, request('pending-0002','乙'));
    const cleared = await edit(gas,{ date:'',walker:'' });
    assert.equal(cleared.ok,true);
    let state = (await current(env)).walks[0];
    assert.equal(state.walker,''); assert.equal(state.walkedDate,''); assert.equal(state.syncStatus,'synced');
    await post(env,request('after-clear-0003','乙'));
    assert.equal((await current(env)).walks[0].walker,'乙');
    const earlier = await edit(gas,{ date:'2026/9/1',walker:'甲' });
    assert.equal(earlier.ok,true);
    state = (await current(env)).walks[0];
    assert.equal(state.walkedDate,'2026-09-01'); assert.equal(state.walked,false);
    assert.equal(state.walker,'甲'); assert.equal(state.syncStatus,'synced');
  } finally { env.DB.close(); }
});
