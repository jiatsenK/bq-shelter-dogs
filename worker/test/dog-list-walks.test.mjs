// #747：狗清單同步交出溜狗欄。人工改溜狗欄時，GAS 同一次編輯會送狗清單（/dog-list）和改表通知（/rows）；
// 狗清單同步在更新主清單複本之前，把表上的值當成一筆觀測值交給今日溜狗紀錄，溜狗紀錄、修改紀錄只由 module 寫。
// 不管哪個先到：溜狗紀錄寫一次、修改紀錄記一筆；同時到時晚的被版本擋下、不 ack，補送時一樣。
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { setup, post as postWalk, request, day } from './walk-fixture.mjs';
import { walkerCode } from '../src/editlog.js';

const dog = { id: '9001', name: '測試狗' };
const machine = async (env, action, body) => {
  const res = await worker.fetch(new Request(`https://worker.example/api/walk-writeback/${action}`, {
    method: 'POST', headers: { 'X-Sheet-Write-Key': env.SHEET_WRITE_KEY }, body: JSON.stringify(body),
  }), env);
  assert.equal(res.status, 200);
  return (await res.json()).results;
};
// 同一次人工編輯，兩個通道各送一份
const dogList = (env, date, walker, extra = {}) => machine(env, 'dog-list', { rows: [{ sheet: 'main', hash: `${date}${walker}`, dog, cage: 'A01', note: '', date, walker, ...extra }] });
const rows = (env, date, walker) => machine(env, 'rows', { rows: [{ sheet: 'main', dog, current: { date, walker } }] });
const walks = async env => (await env.DB.prepare("SELECT walk_date,walker_code FROM v3_walks WHERE dog_id='dog' ORDER BY walk_date,position").all()).results.map(w => [w.walk_date, w.walker_code]);
const sheetLogs = async env => (await env.DB.prepare("SELECT editor_name,after_json FROM v3_edit_log WHERE kind='walk' ORDER BY id").all()).results.map(r => [r.editor_name, JSON.parse(r.after_json)]);
const mainCopy = async env => ({ ...await env.DB.prepare("SELECT walked_date,walker FROM v3_sheet_main WHERE number='9001'").first() });
const walkWrites = async env => (await env.DB.prepare('SELECT total FROM v3_walk_versions WHERE id=1').first())?.total;
const stateVersion = async env => (await env.DB.prepare("SELECT version FROM v3_walk_state WHERE dog_key='9001'").first())?.version;
const notifyOn = async () => ({ ...await setup(), D1_WALK_NOTIFY: '1' });

test('#747 沒有溜狗狀態的狗：狗清單先到，溜狗紀錄寫一次、修改紀錄一筆，改表通知晚到不動', async () => {
  const env = await notifyOn(); worker.testing.resetState();
  try {
    const 甲 = await walkerCode('甲', 'test');
    assert.deepEqual((await dogList(env, '2026-10-20', '甲')).map(r => r.ack), [true]);
    assert.deepEqual(await walks(env), [['2026-10-20', 甲]]);
    assert.deepEqual(await mainCopy(env), { walked_date: '2026-10-20', walker: '甲' }, '主清單複本照舊更新');
    assert.equal(await stateVersion(env), 1, '溜狗欄交給今日溜狗紀錄收下');
    const [late] = await rows(env, '2026-10-20', '甲');
    assert.deepEqual([late.ack, late.changed], [true, false], '晚到的跟基準值一樣');
    assert.equal(await stateVersion(env), 1);
    assert.deepEqual(await walks(env), [['2026-10-20', 甲]]);
    assert.deepEqual(await sheetLogs(env), [['甲', { date: '2026-10-20', walker: '甲' }]]);
  } finally { env.DB.close(); }
});

test('#747 沒有溜狗狀態的狗：改表通知先到，狗清單晚到只更新主清單複本', async () => {
  const env = await notifyOn(); worker.testing.resetState();
  try {
    const [乙, 丙] = await Promise.all(['乙', '丙'].map(n => walkerCode(n, 'test')));
    assert.equal((await rows(env, '2026-10-20', '乙、丙'))[0].changed, true);
    assert.deepEqual(await walks(env), [['2026-10-20', 乙], ['2026-10-20', 丙]], '人工改到新的一天由今日溜狗紀錄寫');
    const written = await walkWrites(env);
    assert.deepEqual((await dogList(env, '2026-10-20', '乙、丙')).map(r => r.ack), [true]);
    assert.equal(await stateVersion(env), 1);
    assert.equal(await walkWrites(env), written, '溜狗紀錄沒有再寫');
    assert.deepEqual(await mainCopy(env), { walked_date: '2026-10-20', walker: '乙、丙' });
    assert.deepEqual(await sheetLogs(env), [['乙、丙', { date: '2026-10-20', walker: '乙、丙' }]]);
  } finally { env.DB.close(); }
});

test('#747 人工改回較早一天：較新那天刪掉、那天照表上名單寫；清空日期不刪', async () => {
  const env = await notifyOn(); worker.testing.resetState();
  try {
    const [甲, 乙] = await Promise.all(['甲', '乙'].map(n => walkerCode(n, 'test')));
    await dogList(env, '2026-10-20', '甲');
    await dogList(env, '2026-10-10', '乙');
    assert.deepEqual(await walks(env), [['2026-10-10', 乙]]);
    await rows(env, '2026-10-10', '乙');
    await dogList(env, '', '');
    assert.deepEqual(await walks(env), [['2026-10-10', 乙]], '清空不刪');
    assert.deepEqual(await mainCopy(env), { walked_date: null, walker: '' });
    // 改表通知先到也一樣
    await rows(env, '2026-10-22', '甲');
    await rows(env, '2026-10-12', '甲');
    await dogList(env, '2026-10-12', '甲');
    assert.deepEqual(await walks(env), [['2026-10-10', 乙], ['2026-10-12', 甲]]);
    assert.deepEqual((await sheetLogs(env)).map(([, after]) => after.date), ['2026-10-20', '2026-10-10', '2026-10-22', '2026-10-12'], '清空不記');
  } finally { env.DB.close(); }
});

test('#747 網站登記過的狗：狗清單交來同一份名單不另寫；人工改人照合併規則寫那天', async () => {
  const env = await notifyOn(); worker.testing.resetState();
  try {
    assert.equal((await postWalk(env, request('747-walk-01', '甲'))).status, 200);
    const [甲, 乙] = await Promise.all(['甲', '乙'].map(n => walkerCode(n, 'test')));
    const written = await walkWrites(env);
    await dogList(env, day(), '甲');
    assert.equal(await walkWrites(env), written, '表上剛好是網站登記的名單，溜狗紀錄不動');
    await dogList(env, day(), '甲、乙');
    assert.deepEqual(await walks(env), [[day(), 甲], [day(), 乙]]);
    assert.deepEqual((await rows(env, day(), '甲、乙'))[0].changed, false);
  } finally { env.DB.close(); }
});

test('#747 同時到：狗清單交的觀測值被版本擋下就不 ack、不更新複本；補送時一樣，只記一筆', async () => {
  const env = await notifyOn(); worker.testing.resetState();
  try {
    const db = env.DB, batch = db.batch.bind(db);
    let raced = false;
    // 狗清單交出的觀測值寫新版本那一批送出前，改表通知先收下同一筆
    db.batch = async statements => {
      if (!raced && statements.length >= 8) { raced = true; assert.equal((await rows(env, '2026-10-20', '甲'))[0].changed, true); }
      return batch(statements);
    };
    const [lost] = await dogList(env, '2026-10-20', '甲');
    assert.equal(raced, true);
    assert.deepEqual([lost.ok, lost.ack], [false, false], 'GAS 保留待通知、之後補送');
    assert.deepEqual(await mainCopy(env), { walked_date: '2026-10-01', walker: null }, '複本還沒更新');
    assert.deepEqual((await dogList(env, '2026-10-20', '甲')).map(r => [r.ok, r.ack]), [[true, true]]);
    assert.deepEqual(await mainCopy(env), { walked_date: '2026-10-20', walker: '甲' });
    assert.equal(await stateVersion(env), 1);
    assert.deepEqual(await walks(env), [['2026-10-20', await walkerCode('甲', 'test')]]);
    assert.equal((await sheetLogs(env)).length, 1);
  } finally { env.DB.close(); }
});

test('#747 新出現在主清單的狗：那天溜狗紀錄還沒有才照表寫，不記修改紀錄', async () => {
  const env = await notifyOn(); worker.testing.resetState();
  try {
    const fresh = { id: '9002', name: '新來的' };
    await machine(env, 'dog-list', { rows: [{ sheet: 'main', hash: 'n1', dog: fresh, cage: 'C03', note: '', date: '2026-10-15', walker: '丙' }] });
    const dogId = (await env.DB.prepare("SELECT dog_id FROM v3_dog_numbers WHERE number='9002'").first()).dog_id;
    const list = (await env.DB.prepare('SELECT walk_date,walker_code,dog_number FROM v3_walks WHERE dog_id=?').bind(dogId).all()).results;
    assert.deepEqual(list.map(w => [w.walk_date, w.walker_code, w.dog_number]), [['2026-10-15', await walkerCode('丙', 'test'), '9002']]);
    assert.deepEqual(await sheetLogs(env), []);
  } finally { env.DB.close(); }
});
