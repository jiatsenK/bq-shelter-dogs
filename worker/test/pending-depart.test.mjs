// 待核對的狗記成已出所（K 2026-10-30）：真的出所、離所沒記到的狗原本只能合併，卡在待核對。
// - 同步：主清單那列先確認消失、之後才收到「已出所」那列，照樣記離所。
// - 管理網站：待核對的狗按「記成已出所」，填離所日與原因。
// 跑真的 sheet-write.gs、真的 Worker 與 D1（Apps Script fixture，#769），已出所那列直接送狗清單同步（fixture 沒有已出所分頁）。
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { appsScript, CAGE_HEADER } from './apps-script.mjs';
import { manageApi } from './manage-fixture.mjs';
import { setup } from './walk-fixture.mjs';

const MINUTE = 60000;
const ROWS = [['A01', '9001', '測試狗', '2026/10/1', '', ''], ['A02', '9002', '小白', '2026/10/28', '甲', ''], ['A03', '9003', '小黑', '2026/10/1', '', '']];
// 每個測試的時間差三小時：管理網站把 Access 公鑰快取 5 分鐘（模組層級）
let hours = 0;
// 小白那列被刪、確認消失，變成待核對
async function start(t) {
  const now = Date.now() + 2000 * 3600000 + ++hours * 3 * 3600000;
  t.mock.timers.enable({ apis: ['Date'], now });
  const env = await setup(), { DB } = env;
  t.after(() => DB.close());
  const gas = appsScript(env, { header: CAGE_HEADER, rows: ROWS });
  await gas.scan();
  gas.remove('9002');
  await gas.edit('9001', { note: '今天打針' });
  t.mock.timers.setTime(now + 11 * MINUTE);
  await gas.timer();
  const manage = await manageApi(t, env);
  const white = (await dogsOf(manage)).find(d => d.name === '小白');
  assert.equal(white.status, 'unknown');
  return { env, manage, white };
}
const dogsOf = async manage => (await manage('/api/manage/dogs')).body.dogs;
const statusOf = async (manage, name) => (await dogsOf(manage)).find(d => d.name === name);
const departed = (env, dog) => worker.fetch(new Request('https://worker.example/api/walk-writeback/dog-list', {
  method: 'POST', headers: { 'X-Sheet-Write-Key': env.SHEET_WRITE_KEY },
  body: JSON.stringify({ rows: [{ sheet: 'departed', hash: `d-${dog.id}`, dog, texts: [dog.id, dog.name, '2026/10/20被認養'], dates: [] }] }),
}), env);

test('確認消失之後才收到已出所那列：照樣記離所，待核對變已出所', async t => {
  const { env, manage } = await start(t);
  assert.equal((await departed(env, { id: '9002', name: '小白' })).status, 200);
  const white = await statusOf(manage, '小白');
  assert.equal(white.status, 'departed');
  assert.deepEqual({ date: white.departure.date, reason: white.departure.reason }, { date: '2026-10-20', reason: 'adopt' });
  const row = await env.DB.prepare("SELECT last_cage,last_name,date_source,former_json FROM v3_dog_departures WHERE number='9002'").first();
  assert.deepEqual({ ...row }, { last_cage: 'A02', last_name: '小白', date_source: 'note', former_json: '[]' }, '籠位從確認消失時記的抄');
  // 在主清單上的狗照舊記離所、從主清單移走
  await departed(env, { id: '9001', name: '測試狗' });
  assert.equal((await statusOf(manage, '測試狗')).status, 'departed');
  // 編號找不到狗：不記
  await departed(env, { id: '9099', name: '路過' });
  assert.equal(await env.DB.prepare("SELECT 1 FROM v3_dog_departures WHERE number='9099'").first(), null);
  // 退養回來換新編號、還在主清單上的狗：已出所那列是舊編號，不記
  const black = await statusOf(manage, '小黑');
  await env.DB.prepare("INSERT INTO v3_dog_numbers(number,dog_id) VALUES('8003',?)").bind(black.dogId).run();
  await departed(env, { id: '8003', name: '小黑' });
  assert.equal((await statusOf(manage, '小黑')).status, 'main');
  assert.equal(await env.DB.prepare("SELECT 1 FROM v3_dog_departures WHERE number='8003'").first(), null);
});

test('管理者把待核對的狗記成已出所：檢查日期、原因、版本，記一筆修改紀錄', async t => {
  const { manage, white } = await start(t);
  const path = `/api/manage/dogs/${white.dogId}/depart`;
  const { body: edit } = await manage(`/api/manage/dogs/${white.dogId}`);
  const send = body => manage(path, { method: 'POST', body: { revision: edit.revision, date: '2026-09-18', reason: 'adopt', ...body } });
  assert.equal((await manage(path)).status, 405, '只能 POST');
  assert.equal((await send({ reason: 'unknown' })).status, 400, '原因要選認養、離世或其他');
  assert.equal((await send({ date: '2999-01-01' })).status, 400, '不能填之後的日期');
  assert.equal((await send({ date: '2026-02-30' })).status, 400);
  assert.equal((await send({ revision: edit.revision - 1 })).status, 409, '版本變了要重新讀取');
  const main = await statusOf(manage, '小黑');
  const { body: mainEdit } = await manage(`/api/manage/dogs/${main.dogId}`);
  assert.equal((await manage(`/api/manage/dogs/${main.dogId}/depart`, { method: 'POST', body: { revision: mainEdit.revision, date: '2026-09-18', reason: 'adopt' } })).status, 409, '在所的狗不能記');

  const ok = await send({ reason: 'death' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.departure, { number: '9002', date: '2026-09-18', reason: 'death' });
  const after = await statusOf(manage, '小白');
  assert.equal(after.status, 'departed');
  assert.deepEqual({ date: after.departure.date, reason: after.departure.reason }, { date: '2026-09-18', reason: 'death' });
  const { body: log } = await manage('/api/manage/edits?kind=depart');
  assert.deepEqual(log.edits.map(e => [e.kind, e.dogNumber, e.after]), [['depart', '9002', { number: '9002', date: '2026-09-18', reason: 'death' }]]);
  const { body: again } = await manage(`/api/manage/dogs/${white.dogId}`);
  assert.equal((await send({ revision: again.revision })).status, 409, '已經不是待核對');
  assert.equal(again.stays.find(s => s.number === '9002').out, '2026-09-18', '出入所表那列變成離所紀錄的日期');
});

// CODING_STANDARDS「附讀寫量測試」：記成已出所的讀寫量不隨其他狗、溜狗紀錄變多
test('記成已出所的讀寫量：塞大量無關的狗與溜狗紀錄後一樣', async t => {
  const { env, manage, white } = await start(t);
  const black = await statusOf(manage, '小黑');
  await env.DB.prepare('DELETE FROM v3_sheet_main WHERE dog_id=?').bind(black.dogId).run(); // 小黑也變待核對
  const measure = async dog => {
    const { body } = await manage(`/api/manage/dogs/${dog.dogId}`);
    const reads = env.DB.stats.rowsRead, batch = env.DB.batch, counter = { n: 0 };
    env.DB.batch = list => { counter.n += list.length; return batch.call(env.DB, list); };
    const res = await manage(`/api/manage/dogs/${dog.dogId}/depart`, { method: 'POST', body: { revision: body.revision, date: '2026-09-18', reason: 'other' } });
    env.DB.batch = batch;
    assert.equal(res.status, 200);
    return [env.DB.stats.rowsRead - reads, counter.n];
  };
  const small = await measure(white);
  for (let i = 0; i < 200; i++) {
    const id = `${i}`.padStart(32, 'f');
    await env.DB.prepare('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)').bind(id, `無關${i}`).run();
    await env.DB.prepare('INSERT INTO v3_dog_numbers(number,dog_id) VALUES(?,?)').bind(`7${String(i).padStart(9, '0')}`, id).run();
    await env.DB.prepare("INSERT INTO v3_walks(dog_id,walk_date) VALUES(?,'2026-10-01')").bind(id).run();
  }
  assert.deepEqual(await measure(black), small);
});
