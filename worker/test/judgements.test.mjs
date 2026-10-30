// #775（ADR 0025）：資料頁「系統自動判斷」與編輯抽屜讀的紀錄。系統自動合併、暫住開始與結束、可能是同一隻、不是同一隻
// 都記在修改紀錄，管理 API /api/manage/edits?kind=judge 一次查這幾種、最新在上；加 dog 只列跟那隻狗有關的。
// 跑真的 sheet-write.gs、真的 Worker 與 D1（Apps Script fixture，#769），只看管理網站 API 讀到什麼。
import test from 'node:test';
import assert from 'node:assert/strict';
import { appsScript, CAGE_HEADER } from './apps-script.mjs';
import { manageApi } from './manage-fixture.mjs';
import { setup } from './walk-fixture.mjs';

const MINUTE = 60000;
const ROWS = [['A01', '9001', '測試狗', '2026/10/1', '', ''], ['新A01', '', '(乳白)', '2026/10/28', '甲', ''], ['A02', '9002', '小白', '2026/10/1', '', ''], ['A03', '9003', '皮蛋', '2026/10/1', '', '']];

// 每個測試的時間差一小時：管理網站把 Access 公鑰快取 5 分鐘（模組層級）
let hours = 0;
async function start(t, rows = ROWS) {
  const now = Date.now() + 2000 * 3600000 + ++hours * 3600000;
  t.mock.timers.enable({ apis: ['Date'], now });
  const env = await setup();
  t.after(() => env.DB.close());
  const gas = appsScript(env, { header: CAGE_HEADER, rows });
  await gas.scan();
  const manage = await manageApi(t, env);
  return { env, gas, manage, later: minutes => t.mock.timers.setTime(now + minutes * MINUTE) };
}
async function judgements(manage, dog = '') {
  const { status, body } = await manage(`/api/manage/edits?kind=judge${dog ? `&dog=${dog}` : ''}`);
  assert.equal(status, 200);
  return body.edits;
}
const dogId = async (manage, name) => (await manage('/api/manage/dogs')).body.dogs.find(d => d.name === name).dogId;

test('#775 系統自動判斷：四種紀錄都在、最新在上，帶狗只列跟牠有關的', async t => {
  const { gas, manage, later } = await start(t);
  await gas.edit(6, { cage: 'A01', name: '(皮蛋）' }); // 暫住開始
  await gas.edit('名:(乳白)', { name: '暖暖' }); // 同籠自動合併
  gas.remove('9002');
  gas.remove('名:(皮蛋）');
  await gas.edit('9001', { note: '今天打針' });
  later(11);
  await gas.timer(); // 小白確認消失（同籠沒有別隻，不配對）、暫住結束
  await gas.edit(5, { cage: 'A02', id: '9010', name: '阿白' }); // 同籠新建狗：可能是同一隻
  const [pair] = (await manage('/api/manage/dog-pairs')).body.pairs;
  assert.equal((await manage(`/api/manage/dog-pairs/${pair.goneDogId}/${pair.dogId}/not-same`, { method: 'POST', body: {} })).status, 200);

  const all = await judgements(manage);
  assert.deepEqual(all.map(e => e.kindLabel), ['不是同一隻', '可能是同一隻', '暫住結束', '系統自動合併', '暫住開始']);
  const [, logged, end, merged, begin] = all;
  assert.deepEqual([logged.editorName, logged.source, logged.before, logged.after],
    ['系統自動判斷', 'sheet', { name: '小白', number: '9002', cage: 'A02' }, { dogId: pair.dogId, name: '阿白', number: '9010', cage: 'A02' }]);
  assert.equal(logged.dogId, pair.goneDogId);
  assert.deepEqual([merged.before.name, merged.before.cage, merged.after.name], ['(乳白)', '新A01', '暖暖'], '自動合併記下候選那一列的籠位');
  assert.deepEqual([begin.dogName, begin.after, end.before], ['皮蛋', { cage: 'A01' }, { cage: 'A01' }]);

  // 帶狗：紀錄掛在牠身上，或配對的另一邊是牠
  const white = await dogId(manage, '小白'), newWhite = await dogId(manage, '阿白'), warm = await dogId(manage, '暖暖');
  assert.deepEqual((await judgements(manage, white)).map(e => e.kind), ['not_same', 'pair']);
  assert.deepEqual((await judgements(manage, newWhite)).map(e => e.kind), ['not_same', 'pair'], '表上那隻也看得到');
  assert.deepEqual((await judgements(manage, warm)).map(e => e.kind), ['automerge']);
  assert.deepEqual((await judgements(manage, await dogId(manage, '皮蛋'))).map(e => e.kind), ['stay-end', 'stay-start']);
  assert.deepEqual(await judgements(manage, await dogId(manage, '測試狗')), []);

  // 修改紀錄頁的類別篩選有「系統自動判斷（全部）」
  const { body } = await manage('/api/manage/edits');
  assert.deepEqual(body.kinds[0], { value: 'judge', label: '系統自動判斷（全部）' });
  assert.ok(body.kinds.some(k => k.value === 'pair' && k.label === '可能是同一隻'));
});

test('#775 確認消失時配的同籠同名：記一筆可能是同一隻；按過不是同一隻的同一組再消失不另記', async t => {
  const rows = [['舊B06', '2026101403', '暖暖', '2026/10/29', '甲', ''], ['舊B06', '', '暖暖', '2026/10/29', '甲', ''], ['A01', '9001', '測試狗', '2026/10/1', '', '']];
  const { gas, manage, later } = await start(t, rows);
  gas.remove('名:暖暖');
  await gas.scan();
  later(11);
  await gas.timer();
  const [pair] = (await manage('/api/manage/dog-pairs')).body.pairs;
  const [logged, ...more] = await judgements(manage);
  assert.equal(more.length, 0);
  assert.deepEqual([logged.kind, logged.dogId, logged.before, logged.after],
    ['pair', pair.goneDogId, { name: '暖暖', number: '', cage: '舊B06' }, { dogId: pair.dogId, name: '暖暖', number: '2026101403', cage: '舊B06' }]);
  await manage(`/api/manage/dog-pairs/${pair.goneDogId}/${pair.dogId}/not-same`, { method: 'POST', body: {} });

  await gas.edit(4, { cage: '舊B06', name: '暖暖' });
  later(20);
  gas.remove('名:暖暖');
  await gas.edit('9001', { note: '打針' });
  later(35);
  await gas.timer();
  assert.deepEqual((await judgements(manage)).map(e => e.kind), ['not_same', 'pair'], '同一組不再建立，也不另記');
});

test('#775 類別篩選不認得的值照舊回 400', async t => {
  const { manage } = await start(t);
  assert.equal((await manage('/api/manage/edits?kind=judges')).status, 400);
});
