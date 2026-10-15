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
