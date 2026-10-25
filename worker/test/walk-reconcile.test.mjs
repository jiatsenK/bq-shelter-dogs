import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { setup, post, request, current, day } from './walk-fixture.mjs';
import { resolveIdentity } from '../src/identity.js';
import { scanWalks, walkFingerprint } from '../src/walk-reconcile.js';

async function machine(env, action, body) {
  const response = await worker.fetch(new Request(`https://worker.example/api/walk-writeback/${action}`, {
    method: 'POST', headers: { 'X-Sheet-Write-Key': 'test-secret' }, body: JSON.stringify(body),
  }), env);
  return { status: response.status, ...await response.json() };
}
const dog = { id: '9001', name: '測試狗' };
async function baseline(env, walker = '甲、丙') {
  await post(env, request('baseline-0001', walker));
  const target = await machine(env, 'target', { dog, dispatchId: 'baseline', current: { date: '2026-10-01', walker: '' } });
  assert.equal(target.status, 200);
  assert.equal((await machine(env, 'receipt', { dogKey: dog.id, ...target })).confirmed, true);
}

test('同日人工刪甲、網站加乙，三方比較保留丙乙且不復活甲', async () => {
  const env = await setup(); worker.testing.resetState();
  try {
    await baseline(env);
    await post(env, request('website-0002', '乙'));
    const target = await machine(env, 'target', { dog, dispatchId: 'merged', current: { date: day(), walker: '丙' } });
    assert.equal(target.status, 200);
    assert.equal(target.current.walker, '丙、乙');
    assert.equal((await current(env)).walks[0].walker, '丙、乙');
    assert.ok(target.version > 2);
  } finally { env.DB.close(); }
});

test('舊基準不蓋網站新登記；無差異比較零寫入；未確認舊派送不冒充人工值', async () => {
  const env=await setup(); worker.testing.resetState();
  try {
    await baseline(env,'甲');
    const total=async ()=>(await env.DB.prepare('SELECT total_changes() AS n').first()).n;
    const observe=value=>machine(env,'observe',{ observations:[{ dog,current:value }] });
    const before=await total();
    await observe({ date:day(),walker:'甲' });
    assert.equal(await total(),before);
    await post(env,request('stale-0002','乙'));
    await observe({ date:day(),walker:'甲' });
    assert.equal((await current(env)).walks[0].walker,'甲、乙');
    const dispatched=await machine(env,'target',{ dog,dispatchId:'unknown-dispatch',current:{ date:day(),walker:'甲' } });
    await post(env,request('newer-0003','丙'));
    const ambiguous=await observe(dispatched.current);
    assert.equal(ambiguous.results[0].ok,false);
    assert.equal((await current(env)).walks[0].walker,'甲、乙、丙');
    const diagnostic=await env.DB.prepare('SELECT observation,error FROM v3_walk_conflicts WHERE dog_key=?').bind(dog.id).first();
    assert.match(diagnostic.error,/未確認/);
    const after=await total(); await observe(dispatched.current); assert.equal(await total(),after);
  } finally { env.DB.close(); }
});

test('未知派送可能只寫了一欄，不能把半格結果接受成新的人工修正', async () => {
  const env=await setup(); worker.testing.resetState();
  try {
    await post(env,request('partial-0001','甲'));
    await machine(env,'target',{ dog,dispatchId:'partial-write',current:{ date:'2026-10-01',walker:'' } });
    const result=await machine(env,'observe',{ observations:[{ dog,current:{ date:day(),walker:'' } }] });
    assert.equal(result.results[0].ok,false);
    assert.equal((await current(env)).walks[0].walker,'甲');
  } finally { env.DB.close(); }
});

test('掃描回應只有 HTTP 200 或 ok、沒有整份四欄，不能宣稱已完成比對', async () => {
  const env=await setup(),real=globalThis.fetch;
  try {
    await baseline(env,'甲');
    globalThis.fetch=async ()=>Response.json({ ok:true });
    await assert.rejects(scanWalks(env,Date.now()),/不完整/);
  } finally { globalThis.fetch=real; env.DB.close(); }
});

test('人工新名字不建立身分，之後本人設定相同名字再登記不重複', async () => {
  const env=await setup(); worker.testing.resetState();
  try {
    const before=(await env.DB.prepare('SELECT COUNT(*) AS n FROM v3_volunteers').first()).n;
    await machine(env,'observe',{ observations:[{ dog,current:{ date:day(),walker:'丁' } }] });
    assert.equal((await current(env)).walks[0].walker,'丁');
    assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM v3_volunteers').first()).n,before);
    await resolveIdentity(env.DB,'丁',env.WALKER_KEY);
    await post(env,request('new-name-0001','丁'));
    assert.equal((await current(env)).walks[0].walker,'丁');
  } finally { env.DB.close(); }
});

test('D1 狗對應變成歧義，即使已接管也不能接受人工修正', async () => {
  const env=await setup(); worker.testing.resetState();
  try {
    await baseline(env,'甲');
    await env.DB.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,walked_date) VALUES(2,'dog','9001','測試狗','2026-10-01')").run();
    const result=await machine(env,'observe',{ observations:[{ dog,current:{ date:'',walker:'' } }] });
    assert.equal(result.results[0].ok,false);
    assert.equal((await current(env)).walks[0].walker,'甲');
  } finally { env.DB.close(); }
});

test('人工刪名剛好回到更早的已同步名單，也必須保留刪除而非當成中間值', async () => {
  const env=await setup(); worker.testing.resetState();
  try {
    await baseline(env,'丙');
    await post(env,request('history-add-0002','甲'));
    const agreed=await machine(env,'target',{ dog,dispatchId:'new-baseline',current:{ date:day(),walker:'丙' } });
    assert.equal((await machine(env,'receipt',{ dogKey:dog.id,...agreed })).confirmed,true);
    await post(env,request('history-add-0003','乙'));
    const target=await machine(env,'target',{ dog,dispatchId:'after-human-removal',current:{ date:day(),walker:'丙' } });
    assert.equal(target.status,200);
    assert.equal(target.current.walker,'丙、乙');
    assert.equal((await current(env)).walks[0].walker,'丙、乙');
  } finally { env.DB.close(); }
});

test('人工同日刪名保留原復原前值，不因同步複本已到今天而遺失上次溜', async () => {
  const env=await setup(); worker.testing.resetState();
  try {
    await baseline(env,'甲、乙');
    await env.DB.prepare('UPDATE v3_sheet_main SET walked_date=? WHERE number=?').bind(day(),dog.id).run();
    const corrected=await machine(env,'observe',{ observations:[{ dog,current:{ date:day(),walker:'乙' } }] });
    assert.equal(corrected.results[0].ok,true);
    const state=(await current(env)).walks[0];
    const undo=await post(env,request('after-human-undo','丙',{ action:'undo',dogs:[{ ...dog,expectedVersion:state.version }] }));
    assert.equal(undo.status,200);
    assert.equal(undo.body.results[0].current.date,'2026-10-01');
  } finally { env.DB.close(); }
});

test('復原可信人工前次名單中的未註冊名字，仍只驗證操作人而不建立被還原者身分', async () => {
  const env=await setup(); worker.testing.resetState();
  try {
    await machine(env,'observe',{ observations:[{ dog,current:{ date:'2026-09-01',walker:'丁' } }] });
    await post(env,request('after-manual-walk','甲'));
    const state=(await current(env)).walks[0];
    const undo=await post(env,request('restore-manual-name','乙',{ action:'undo',dogs:[{ ...dog,expectedVersion:state.version }] }));
    assert.equal(undo.status,200);
    assert.deepEqual(undo.body.results[0].current,{ date:'2026-09-01',walker:'丁' });
    assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM v3_volunteers').first()).n,3);
  } finally { env.DB.close(); }
});

test('#408 單狗比對及 target 在主清單與同狗歷史十倍後，讀寫量固定且歷史使用索引', async () => {
  async function sample(count) {
    const env=await setup(); worker.testing.resetState();
    try {
      await baseline(env); await post(env,request('cost-add-0002','乙'));
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
      const observed=await machine(env,'observe',{ observations:[{ dog,current:{ date:day(),walker:'丙' } }] });
      assert.equal(observed.results[0].ok,true);
      assert.equal((await machine(env,'target',{ dog,dispatchId:'cost-target',current:{ date:day(),walker:'丙' } })).status,200);
      env.DB.prepare=prepare;
      const reads=env.DB.stats.rowsRead-read;
      const writes=(await prepare('SELECT total_changes() n').first()).n-before;
      for (const { sql,args } of queries.filter(q=>/^SELECT/.test(q.sql) && q.sql.includes('FROM v3_walk_outbox'))) {
        const plan=(await prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...args).all()).results.map(p=>p.detail).join(';');
        // 查詢可能用別名 o；不管名字，待寫回工作都要走索引。
        assert.doesNotMatch(plan,/SCAN (v3_walk_outbox|o)/);
        assert.match(plan,/SEARCH (v3_walk_outbox|o) /);
      }
      return { reads,writes };
    } finally { env.DB.close(); }
  }
  assert.deepEqual(await sample(200),await sample(20));
});

test('保險掃描按狗送指紋，讀寫量不隨歷史增加；沒有不同的狗就不比對、不寫入', async () => {
  const env=await setup(),real=globalThis.fetch;
  try {
    await baseline(env,'甲');
    const sent=[];
    globalThis.fetch=async (_url,init)=>{ sent.push(JSON.parse(init.body)); return Response.json({ ok:true,rows:[] }); };
    const sample=async ()=>{
      const before=(await env.DB.prepare('SELECT total_changes() n').first()).n,read=env.DB.stats.rowsRead;
      await scanWalks(env,Date.now());
      return { reads:env.DB.stats.rowsRead-read,writes:(await env.DB.prepare('SELECT total_changes() n').first()).n-before };
    };
    const small=await sample();
    assert.equal(small.writes,0);
    const base=await env.DB.prepare("SELECT base_date,base_walker FROM v3_walk_state WHERE dog_key='9001'").first();
    assert.deepEqual(sent[0].fingerprints,{ '9001':await walkFingerprint(base.base_date,base.base_walker) });
    assert.equal(sent[0].sig,undefined);
    await env.DB.batch(Array.from({ length:200 },(_,i)=>env.DB.prepare("INSERT INTO v3_walk_outbox(dog_key,version,operation_date,target_date,target_walker,status,next_attempt_at) VALUES('9001',?,'2020-01-01','2020-01-01','舊','synced','x')").bind(i+100)));
    assert.deepEqual(await sample(),small);
  } finally { globalThis.fetch=real; env.DB.close(); }
});

test('還有差異沒收完（未決派送）base 不變，下次掃描同一隻還會被找出來', async () => {
  const env=await setup(),real=globalThis.fetch;
  try {
    await baseline(env,'甲');
    await post(env,request('pending-sig-0002','乙'));
    const sent=[];
    globalThis.fetch=async (_url,init)=>{ sent.push(JSON.parse(init.body).fingerprints); return Response.json({ ok:true,rows:[{ dog,current:{ date:'2026-09-01',walker:'丁' } }] }); };
    await scanWalks(env,Date.now());
    await scanWalks(env,Date.now());
    assert.equal((await current(env)).walks[0].walker,'甲、乙');
    assert.deepEqual(sent[1],sent[0]);
  } finally { globalThis.fetch=real; env.DB.close(); }
});

test('可信人工清空及改早日期先成為新版本，舊 pending 不復活，其後可再登記', async () => {
  const env = await setup(); worker.testing.resetState();
  try {
    await baseline(env);
    await post(env, request('pending-0002','乙'));
    const cleared = await machine(env,'observe',{ observations:[{ dog, current:{ date:'',walker:'' } }] });
    assert.equal(cleared.status,200);
    let state = (await current(env)).walks[0];
    assert.equal(state.walker,''); assert.equal(state.walkedDate,''); assert.equal(state.syncStatus,'synced');
    await post(env,request('after-clear-0003','乙'));
    assert.equal((await current(env)).walks[0].walker,'乙');
    const earlier = await machine(env,'observe',{ observations:[{ dog,current:{ date:'2026-09-01',walker:'甲' } }] });
    assert.equal(earlier.status,200);
    state = (await current(env)).walks[0];
    assert.equal(state.walkedDate,'2026-09-01'); assert.equal(state.walked,false);
    assert.equal(state.walker,'甲'); assert.equal(state.syncStatus,'synced');
  } finally { env.DB.close(); }
});
