import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateCompactDatabase } from './migrate-compact-db.mjs';
import { compareCleanup, snapshotDb, TABLES } from './compare-cleanup.mjs';

test('#252 六類比對逐隻指出差異，不修改 D1；同日舊溜狗紀錄取最後代號', async t => {
  const db = fakeD1(); t.after(() => db.close()); await migrateCompactDatabase(db);
  await db.prepare("INSERT INTO v3_dogs VALUES('d','甲','male')").run();
  await db.prepare("INSERT INTO v3_dog_numbers VALUES('A','d')").run();
  const source = { dogs: { dogs: [{id:'A',name:'甲',sex:'female',intro:'介紹',formerIds:['OLD']}] }, cards: [], rest: { A:{until:'2026-10-20',reason:'休息'} }, walks: {walks:[{id:'A',name:'甲',date:'2026-10-01',walkers:['x']},{id:'A',name:'甲',date:'2026-10-01',walkers:['y']}]}, departures: [{id:'A',name:'甲',date:'2026-10-02',flags:[]}] };
  const r = await compareCleanup(db,source);
  assert.deepEqual([...new Set(r.differences.map(d=>d.kind))].sort(), ['departures','formerIds','intro','rest','sex','walks']);
  assert.equal(r.differences.find(d=>d.kind==='walks').expected[0].walkers[0], 'y');
  assert.equal(await db.prepare("SELECT sex FROM v3_dogs WHERE dog_id='d'").first('sex'),'male');
});

test('#252 比對也抓得到多出的舊編號關係，不把錯誤合併當一致', async t => {
  const db = fakeD1(); t.after(()=>db.close()); await migrateCompactDatabase(db);
  await db.prepare("INSERT INTO v3_dogs VALUES('d','甲','male')").run();
  await db.prepare("INSERT INTO v3_dog_numbers VALUES('A','d'),('UNRELATED','d')").run();
  const { importCompactDogs }=await import('./import-compact-dogs.mjs');
  await importCompactDogs(db,{dogs:[{id:'A',name:'甲',sex:'male'}]});
  const source = { dogs:{dogs:[{id:'A',name:'甲',sex:'male'}]},cards:[],rest:{},walks:{walks:[]},departures:[] };
  const r = await compareCleanup(db,source);
  assert.deepEqual(r.differences, [{kind:'formerIds',key:'A',expected:[],actual:['UNRELATED']}]);
});


test('#252 缺表或截斷的 D1 快照必須失敗，不能報成資料遺失', () => {
  assert.throws(() => snapshotDb([]), /快照/);
  const raw = TABLES.map(() => ({ success:true, results:[], meta:{ rows_read:0, rows_written:0 } }));
  raw[0] = { success:true, results:[{dog_id:'d'}], meta:{rows_read:2,rows_written:0} };
  assert.throws(() => snapshotDb(raw), /快照/);
});

test('#252 永久資料正確但網站主清單性別／舊編號複本壞掉也要報差異', async t => {
  const db = fakeD1(); t.after(()=>db.close()); await migrateCompactDatabase(db);
  const { importCompactDogs } = await import('./import-compact-dogs.mjs');
  const source = {dogs:{dogs:[{id:'A',name:'甲',sex:'male',formerIds:['OLD']}]},cards:[],rest:{},walks:{walks:[]},departures:[]};
  await importCompactDogs(db,source.dogs);
  await db.prepare("UPDATE v3_sheet_main SET sex=''").run();
  await db.prepare('DELETE FROM v3_sheet_former_numbers').run();
  const r=await compareCleanup(db,source);
  assert.deepEqual(r.differences.map(d=>[d.kind,d.field,d.key]), [['sex','main','A'],['formerIds','main','A']]);
});

test('#252 D1 多出的狗與介紹要明列，不能只巡舊來源就回一致', async t => {
  const db = fakeD1(); t.after(()=>db.close()); await migrateCompactDatabase(db);
  await db.prepare("INSERT INTO v3_dogs VALUES('new-dog','新狗','female')").run();
  await db.prepare("INSERT INTO v3_dog_numbers VALUES('NEW','new-dog')").run();
  await db.prepare("INSERT INTO v3_intros VALUES('new-dog','新的介紹')").run();
  const r=await compareCleanup(db,{dogs:{dogs:[]},cards:[],rest:{},walks:{walks:[]},departures:[]});
  assert.deepEqual(r.differences.map(d=>[d.kind,d.key,d.expected,d.actual]), [['sex','NEW',null,'female'],['intro','NEW',null,'新的介紹']]);
});

test('#252 主清單少一隻狗不能被永久身分資料掩蓋', async t => {
  const db=fakeD1(); t.after(()=>db.close()); await migrateCompactDatabase(db);
  const { importCompactDogs }=await import('./import-compact-dogs.mjs');
  const source={dogs:{dogs:[{id:'A',name:'甲',sex:'male'}]},cards:[],rest:{},walks:{walks:[]},departures:[]};
  await importCompactDogs(db,source.dogs);
  assert.equal((await compareCleanup(db,source)).equal,true);
  await db.prepare('DELETE FROM v3_sheet_main').run();
  const r=await compareCleanup(db,source);
  assert.equal(r.equal,false);
  assert.ok(r.differences.some(d=>d.kind==='sex' && d.field==='main' && d.actual===null));
});

test('#252 同性別狗的主清單永久 ID 對調，不能漏掉 API 介紹串錯', async t => {
  const db=fakeD1(); t.after(()=>db.close()); await migrateCompactDatabase(db);
  const { importCompactDogs }=await import('./import-compact-dogs.mjs');
  const source={dogs:{dogs:[{id:'A',name:'甲',sex:'male',intro:'甲介紹'},{id:'B',name:'乙',sex:'male',intro:'乙介紹'}]},cards:[],rest:{},walks:{walks:[]},departures:[]};
  await importCompactDogs(db,source.dogs);
  const a=await db.prepare("SELECT dog_id FROM v3_dog_numbers WHERE number='A'").first('dog_id');
  const b=await db.prepare("SELECT dog_id FROM v3_dog_numbers WHERE number='B'").first('dog_id');
  await db.prepare('INSERT INTO v3_intros VALUES(?,?)').bind(a,'甲介紹').run();
  await db.prepare('INSERT INTO v3_intros VALUES(?,?)').bind(b,'乙介紹').run();
  assert.equal((await compareCleanup(db,source)).equal,true);
  await db.prepare("UPDATE v3_sheet_main SET dog_id=CASE number WHEN 'A' THEN ? ELSE ? END").bind(b,a).run();
  const r=await compareCleanup(db,source);
  assert.equal(r.equal,false);
  assert.equal(r.differences.filter(d=>d.field==='mainIdentity').length,2);
});
