import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { fakeD1 } from './fakes.mjs';
import { migrateCompactDatabase } from '../../scripts/migrate-compact-db.mjs';
const site='https://bq-shelter-dogs.jiatsen-k.workers.dev';
const call=async(env,path,body)=>{const r=await worker.fetch(new Request(site+'/api'+path,{method:body?'POST':'GET',headers:{Origin:site,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),env);return {status:r.status,...await r.json()};};

test('#474 已銜接的身分重複讀取不全掃，志工十倍且名字格式不同時讀取量不變', async t => {
 const DB=fakeD1();t.after(()=>DB.close());await migrateCompactDatabase(DB);const env={DB,WALKER_KEY:'test-key'};
 const original=await call(env,'/identity',{name:'Ｍｉｎｉ'});
 const readsOf=async()=>{
  const before=DB.stats.rowsRead;
  const result=await call(env,'/identity',{name:' mini '});
  assert.equal(result.status,200);
  assert.equal(result.identity.volunteerId,original.identity.volunteerId);
  return DB.stats.rowsRead-before;
 };
 const small=await readsOf();
 assert.ok(small>0);
 for(let i=0;i<100;i++)await DB.prepare('INSERT INTO v3_volunteers(volunteer_id,name,last_seen) VALUES(?,?,?)').bind(`unrelated-${i}`,`無關志工${i}`,'2026-01-01').run();
 assert.equal(await readsOf(),small,'已建立對照後只按 code／volunteer_id 索引讀取');
});

test('固定志工身分：兩裝置與舊名字在更名後找到同一人，並可追溯當時的編輯紀錄',async t=>{
 const DB=fakeD1();t.after(()=>DB.close());await migrateCompactDatabase(DB);const env={DB,WALKER_KEY:'test-key'};
 const a=await call(env,'/identity',{name:'小明'});assert.equal(a.status,200);assert.ok(a.identity.volunteerId);
 const b=await call(env,'/identity',{name:'小明'});assert.equal(b.identity.volunteerId,a.identity.volunteerId);
 const renamed=await call(env,'/identity/rename',{code:a.identity.codes[0],name:'明明',operationId:'rename-1'});assert.equal(renamed.status,200);
 const old=await call(env,'/identity',{name:'小明'});const fresh=await call(env,'/identity',{name:'明明'});
 assert.equal(old.identity.name,'明明');assert.equal(fresh.identity.volunteerId,a.identity.volunteerId);assert.deepEqual(old.identity.codes,fresh.identity.codes);
 const edits=await call(env,'/edits');assert.equal(edits.edits[0].kind,'volunteer_rename');assert.equal(edits.edits[0].editorName,'小明');
});
test('名字衝突須確認才合併，聯集常溜與開卡、保留最早日期及兩邊歷史，舊代號重試安全',async t=>{
 const DB=fakeD1();t.after(()=>DB.close());await migrateCompactDatabase(DB);const env={DB,WALKER_KEY:'test-key'};
 const a=(await call(env,'/identity',{name:'甲'})).identity,b=(await call(env,'/identity',{name:'乙'})).identity;
 await DB.prepare("INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)").bind('a'.repeat(32),'狗').run();
 const put=async(path,body)=>{const r=await worker.fetch(new Request(site+'/api'+path,{method:'PUT',headers:{Origin:site,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);return r.status;};
 assert.equal(await put('/favorites',{codes:a.codes,dogId:'a'.repeat(32),on:true}),200);
 assert.equal(await put('/cards/opened',{codes:b.codes,ids:['old']}),400);
 await DB.prepare('INSERT INTO v3_dog_numbers VALUES(?,?)').bind('old','a'.repeat(32)).run();
 assert.equal(await put('/cards/opened',{codes:b.codes,ids:['old']}),200);
 const conflict=await call(env,'/identity/rename',{code:a.codes[0],name:'乙',operationId:'conflict'});assert.equal(conflict.status,409);
 const preview=await call(env,'/identity/merge-preview',{code:a.codes[0],targetCode:b.codes[0]});assert.equal(preview.status,200);assert.equal(preview.source.favorites,1);assert.equal(preview.target.cards,1);
 const body={code:a.codes[0],targetCode:b.codes[0],token:preview.token,confirm:true,operationId:'merge-1'};
 const merged=await call(env,'/identity/merge',body);assert.equal(merged.status,200);assert.equal(merged.identity.volunteerId,b.volunteerId);
 assert.equal((await call(env,'/identity/merge',body)).status,200);
 const old=await call(env,'/identity',{name:'甲'});assert.equal(old.identity.name,'乙');
 const fav=await call(env,'/favorites?codes='+a.codes[0]);assert.deepEqual(fav.ids,['a'.repeat(32)]);
 const opened=await call(env,'/cards/opened?codes='+a.codes[0]);assert.ok(opened.opened.codes[a.codes[0]].old);
 const edits=await call(env,'/edits');assert.equal(edits.edits.filter(e=>e.kind==='volunteer_merge').length,1);
});
test('舊資料銜接可重跑，未知代號保留，取消後不因再登入復活；更名與編輯紀錄失敗一起回復',async t=>{
 const DB=fakeD1();t.after(()=>DB.close());await migrateCompactDatabase(DB);const env={DB,WALKER_KEY:'test-key'};
 const {walkerCode}=await import('../src/editlog.js');const code=await walkerCode('舊名字',env.WALKER_KEY);
 await DB.prepare('INSERT INTO v3_volunteers(volunteer_id,name,last_seen) VALUES(?,?,?)').bind('original-person','舊名字','2026-01-01').run();
 await DB.prepare('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)').bind('b'.repeat(32),'舊狗').run();
 await DB.prepare('INSERT INTO v3_favorites VALUES(?,?,?)').bind(code,'b'.repeat(32),'2026-01-01').run();
 await DB.prepare('INSERT INTO v3_card_opened VALUES(?,?,?)').bind('ffffffffffff','b'.repeat(32),'2026-01-02').run();
 const {migrateVolunteerIdentity}=await import('../../scripts/migrate-volunteer-identity.mjs');
 const report=await migrateVolunteerIdentity(DB,env.WALKER_KEY);assert.deepEqual(report.unknownCodes,['ffffffffffff']);
 assert.equal((await call(env,'/identity',{name:'舊名字'})).identity.volunteerId,'original-person');
 assert.deepEqual((await call(env,'/favorites?codes='+code)).ids,['b'.repeat(32)]);
 await worker.fetch(new Request(site+'/api/favorites',{method:'PUT',headers:{Origin:site,'Content-Type':'application/json'},body:JSON.stringify({codes:[code],dogId:'b'.repeat(32),on:false})}),env);
 await migrateVolunteerIdentity(DB, async name => { assert.equal(name, '舊名字'); return code; });assert.deepEqual((await call(env,'/favorites?codes='+code)).ids,[]);
 await DB.prepare("CREATE TRIGGER reject_identity_log BEFORE INSERT ON v3_edit_log WHEN NEW.kind='volunteer_rename' BEGIN SELECT RAISE(ABORT,'test log failure'); END").run();
 assert.equal((await call(env,'/identity/rename',{code,name:'新名字',operationId:'failed-rename'})).status,409);
 assert.equal((await call(env,'/identity',{name:'舊名字'})).identity.name,'舊名字');
 assert.deepEqual((await call(env,'/edits')).edits,[]);
});
test('確認期間資料變動時拒絕舊合併；跨站、預覽與缺少確認均不寫入',async t=>{
 const DB=fakeD1();t.after(()=>DB.close());await migrateCompactDatabase(DB);const env={DB,WALKER_KEY:'test-key'};
 const a=(await call(env,'/identity',{name:'A'})).identity,b=(await call(env,'/identity',{name:'B'})).identity;
 const preview=await call(env,'/identity/merge-preview',{code:a.codes[0],targetCode:b.codes[0]});
 await call(env,'/identity/rename',{code:b.codes[0],name:'B2',operationId:'changed'});
 const body={code:a.codes[0],targetCode:b.codes[0],token:preview.token,confirm:true,operationId:'stale'};
 assert.equal((await call(env,'/identity/merge',body)).status,409);
 assert.equal((await call({...env,PREVIEW:'1'},'/identity',{name:'預覽'})).status,403);
 const cross=await worker.fetch(new Request(site+'/api/identity',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({name:'其他人'})}),env);assert.equal(cross.status,403);
 assert.equal((await call(env,'/identity/merge',{...body,confirm:false})).status,400);
 assert.equal((await call(env,'/identity',{name:'A'})).identity.volunteerId,a.volunteerId);
});
test('兩裝置同時設定同名只持有同一身分；合併後可改回舊名字，不分裂身分',async t=>{
 worker.testing.resetState();const DB=fakeD1();t.after(()=>DB.close());await migrateCompactDatabase(DB);const env={DB,WALKER_KEY:'test-key'};
 const [a,b]=await Promise.all([call(env,'/identity',{name:'同名'}),call(env,'/identity',{name:'同名'})]);
 assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(a.identity.volunteerId,b.identity.volunteerId);
 const other=(await call(env,'/identity',{name:'另名'})).identity;
 const preview=await call(env,'/identity/merge-preview',{code:a.identity.codes[0],targetCode:other.codes[0]});
 const merged=await call(env,'/identity/merge',{code:a.identity.codes[0],targetCode:other.codes[0],token:preview.token,confirm:true,operationId:'merge-back'});assert.equal(merged.status,200);
 const renamed=await call(env,'/identity/rename',{code:a.identity.codes[0],name:'同名',operationId:'rename-back'});assert.equal(renamed.status,200);assert.equal(renamed.identity.volunteerId,other.volunteerId);
});
test('合併同狗開卡保留最早日期、來源紀錄不刪；合併紀錄失敗回復兩邊資料', async t => {
  worker.testing.resetState();
  const DB = fakeD1(); t.after(() => DB.close());
  await migrateCompactDatabase(DB);
  const env = { DB, WALKER_KEY: 'test-key' };
  const { walkerCode } = await import('../src/editlog.js');
  const a = await walkerCode('先', env.WALKER_KEY), b = await walkerCode('後', env.WALKER_KEY);
  await DB.prepare('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)').bind('c'.repeat(32), '同狗').run();
  await DB.prepare('INSERT INTO v3_dog_numbers VALUES(?,?)').bind('one', 'c'.repeat(32)).run();
  for (const [code, date, position] of [[a, '2026-01-01', 0], [b, '2026-02-01', 1]]) {
    await DB.prepare('INSERT INTO v3_card_opened VALUES(?,?,?)').bind(code, 'c'.repeat(32), date).run();
    await DB.prepare('INSERT INTO v3_walks(dog_id,walk_date,position,walker_code,dog_number,dog_name) VALUES(?,?,?,?,?,?)').bind('c'.repeat(32), '2026-01-01', position, code, 'one', '當時狗名').run();
  }
  await call(env, '/identity', { name: '先' }); await call(env, '/identity', { name: '後' });
  const history = await call(env, '/walks');
  const preview = await call(env, '/identity/merge-preview', { code: a, targetCode: b });
  const body = { code: a, targetCode: b, token: preview.token, confirm: true, operationId: 'union' };
  await DB.prepare("CREATE TRIGGER reject_merge BEFORE INSERT ON v3_edit_log WHEN NEW.kind='volunteer_merge' BEGIN SELECT RAISE(ABORT,'test merge failure'); END").run();
  assert.equal((await call(env, '/identity/merge', body)).status, 409);
  assert.equal((await call(env, '/identity', { name: '先' })).identity.name, '先');
  assert.equal((await call(env, '/cards/opened?codes=' + b)).opened.codes[b].one, '2026-02-01');
  await DB.prepare('DROP TRIGGER reject_merge').run();
  assert.equal((await call(env, '/identity/merge', body)).status, 200);
  assert.equal((await call(env, '/cards/opened?codes=' + b)).opened.codes[b].one, '2026-01-01');
  assert.deepEqual((await call(env, '/walks')).walks, history.walks);
  const edits = (await call(env, '/edits')).edits;
  assert.equal(edits[0].before.source.walkRows, 1); assert.equal(edits[0].before.target.walkRows, 1);
  await call(env, '/identity/rename', { code: a, name: '現在', operationId: 'after-merge' });
  assert.equal((await call(env, '/edits')).edits.find(e => e.kind === 'volunteer_merge').editorName, '先');
});
