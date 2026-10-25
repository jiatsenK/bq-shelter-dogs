import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './fakes.mjs';
import { migrateCompactDatabase } from '../../scripts/migrate-compact-db.mjs';
import { readSettings, saveSettings, requireVolunteerEdit, settingForWrite } from '../src/feature-settings.js';
const manager = { subject: 'verified-subject', email: 'private@example.org' };
async function db(t) { const db = fakeD1(); t.after(() => db.close()); await migrateCompactDatabase(db); return db; }
test('十項 boolean 預設全開；無差異不寫，衝突不覆蓋，前後紀錄一致', async t => {
 const DB = await db(t), initial = await readSettings(DB);
 assert.equal(Object.keys(initial.values).length, 10);
 assert.ok(Object.values(initial.values).every(v => v === true));
 const before = await DB.prepare('SELECT total_changes() AS n').first('n');
 assert.equal((await saveSettings(DB, initial, manager)).revision, initial.revision);
 assert.equal(await DB.prepare('SELECT total_changes() AS n').first('n'), before);
 const values = { ...initial.values, editIntro: false };
 const changed = await saveSettings(DB, { revision: initial.revision, values }, manager);
 assert.equal(changed.revision, initial.revision + 1);
 await assert.rejects(saveSettings(DB, { ...initial, values }, manager), e => e.status === 409);
 const logs = (await DB.prepare('SELECT * FROM v3_feature_settings_log').all()).results;
 assert.equal(logs.length, 1); assert.deepEqual(JSON.parse(logs[0].before_json), initial.values);
 assert.deepEqual(JSON.parse(logs[0].after_json), values); assert.equal(logs[0].actor_email, manager.email);
 assert.ok(!JSON.stringify(await readSettings(DB)).includes(manager.email));
});
test('未知鍵、缺鍵、非 boolean、錯 revision 均拒絕', async t => {
 const DB = await db(t), initial = await readSettings(DB);
 for (const input of [{ ...initial, extra: true }, { ...initial, revision: '1' }, { ...initial, values: { ...initial.values, extra: true } }, { ...initial, values: { ...initial.values, editPhoto: 1 } }, { ...initial, values: {} }]) {
  await assert.rejects(saveSettings(DB, input, manager), e => e.status === 400);
 }
});
test('七項寫入各自檢查；機器與核心路由不進 gate；關閉與故障拒絕新編輯', async t => {
 const DB = await db(t), initial = await readSettings(DB);
 const routes = [['/intro/1','PUT','editIntro'],['/photos/1','POST','editPhoto'],['/rest/1','PUT','editRest'],['/activities','POST','editActivity'],['/fixed-care/1','PUT','editFixedCare'],['/stays/1','PUT','editStays'],['/former/1','DELETE','editFormer']];
 for (const [path, method, key] of routes) {
  assert.equal(settingForWrite(path, method), key);
  await requireVolunteerEdit(DB, key);
  const current = await readSettings(DB);
  await saveSettings(DB, { revision: current.revision, values: { ...current.values, [key]: false } }, manager);
  await assert.rejects(requireVolunteerEdit(DB, key), e => e.status === 403);
 }
 for (const path of ['/walk','/walk/result','/walk-writeback/rows','/admin/trash','/identity/rename','/favorites']) assert.equal(settingForWrite(path, 'POST'), null);
 assert.equal(settingForWrite('/activities', 'GET'), null);
 await DB.prepare('DROP TABLE v3_feature_settings').run();
 await assert.rejects(requireVolunteerEdit(DB, 'editIntro'), e => e.status === 503);
});
test('紀錄寫入失敗整筆回復；競爭儲存只接受一個版本', async t => {
 const DB = await db(t), initial = await readSettings(DB);
 await DB.prepare("CREATE TRIGGER fail_settings_log BEFORE INSERT ON v3_feature_settings_log BEGIN SELECT RAISE(ABORT, 'log failed'); END").run();
 await assert.rejects(saveSettings(DB, { ...initial, values: { ...initial.values, showUpdates: false } }, manager));
 assert.deepEqual(await readSettings(DB), initial);
 await DB.prepare('DROP TRIGGER fail_settings_log').run();
 const results = await Promise.allSettled([saveSettings(DB, { ...initial, values: { ...initial.values, showUpdates: false } }, manager),saveSettings(DB, { ...initial, values: { ...initial.values, showQuality: false } }, manager)]);
 assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
 assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
});

test('公開路由：七項關閉拒絕舊頁；讀取服務與核心請求不被設定故障阻斷', async t => {
 const worker = (await import('../src/index.js')).default;
 const DB = await db(t), initial = await readSettings(DB);
 const origin = 'https://volunteer.example';
 const call = (path, method='GET', headers={}) => worker.fetch(new Request(origin+'/api'+path, {method,headers:{Origin:origin,...headers}}), { DB });
 const values = Object.fromEntries(Object.keys(initial.values).map(k=>[k,false]));
 await saveSettings(DB, {...initial,values}, manager);
 for (const [path,method] of [['/intro/1','PUT'],['/photos/1','POST'],['/rest/1','PUT'],['/activities','POST'],['/activities/id','DELETE'],['/fixed-care/1','PUT'],['/stays/1','PUT'],['/former/1','DELETE']]) assert.equal((await call(path,method)).status,403,path);
 assert.equal((await call('/activities')).status,200,'display setting does not shut down reads');
 const res=await call('/feature-settings'); const etag=res.headers.get('ETag');
 assert.equal((await call('/feature-settings','GET',{'If-None-Match':etag})).status,304);
 await DB.prepare('DROP TABLE v3_feature_settings').run();
 assert.equal((await call('/intro/1','PUT')).status,503);
 assert.equal((await call('/activities')).status,200);
 const walk=await call('/walk','POST'); assert.notEqual((await walk.json()).code,'feature-setting');
 const gas=await call('/walk-writeback/rows','POST'); assert.doesNotMatch(await gas.text(),/功能設定/);
 const machine=await call('/admin/trash'); assert.doesNotMatch(await machine.text(),/功能設定/);
});
