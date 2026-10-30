// #771（ADR 0025）：試算表上的列消失先當候選，約 10～20 分鐘後還是不見才確認，確認後移出主清單、變成待核對（狗的資料不刪）。
// 跑真的 sheet-write.gs、真的 Worker 與 D1（Apps Script fixture，#769），只看志工網站與管理網站 API 讀到什麼。
// 確認要隔 10 分鐘：t.mock.timers 讓 Worker 的時間往前走，小程式在自己的 vm 裡不受影響。
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { MISSING_MAX } from '../src/dog-list.js';
import { appsScript, CAGE_HEADER } from './apps-script.mjs';
import { manageApi } from './manage-fixture.mjs';
import { setup } from './walk-fixture.mjs';

const SITE = 'https://bq-shelter-dogs.example.workers.dev';
const MINUTE = 60000;
const ROWS = [['A01', '9001', '測試狗', '2026/10/1', '', ''], ['A02', '9002', '小白', '2026/10/28', '甲', ''], ['A03', '9003', '小黑', '2026/10/1', '', '']];

// 志工網站狗清單：[編號, 犬名, 籠位]
async function dogs(env) {
  worker.testing.resetState();
  const res = await worker.fetch(new Request(`${SITE}/api/dogs`, { headers: { Origin: SITE } }), env);
  assert.equal(res.status, 200);
  return (await res.json()).dogs.map(d => [d.id, d.name, d.cage]);
}
const numbers = async env => (await dogs(env)).map(d => d[0]);
// 每個測試的時間差一小時：管理網站把 Access 公鑰快取 5 分鐘（模組層級），不然會拿到上一個測試的公鑰
let hours = 0;
async function start(t, rows = ROWS) {
  const now = Date.now() + ++hours * 3600000;
  t.mock.timers.enable({ apis: ['Date'], now });
  const env = await setup(), { DB } = env;
  t.after(() => DB.close());
  const gas = appsScript(env, { header: CAGE_HEADER, rows });
  await gas.scan();
  return { env, gas, later: minutes => t.mock.timers.setTime(now + minutes * MINUTE) };
}
// 管理網站狗資料：犬名 → { dogId, status }（status：main 在所、unknown 待核對）
async function manageDogs(manage) {
  const { status, body } = await manage('/api/manage/dogs');
  assert.equal(status, 200);
  return body.dogs;
}
// 補充斷言：小程式送了幾次狗清單（API 看不出「沒有送」，結果仍以 API 為準）
const listPosts = gas => gas.posts.filter(p => p.action === 'dog-list');

test('#771 管理者刪掉一列：補送之後確認，志工網站不再列出牠，管理網站是待核對，溜狗紀錄與照片都還在', async t => {
  const { env, gas, later } = await start(t);
  const manage = await manageApi(t, env);
  const white = (await manageDogs(manage)).find(d => d.name === '小白');
  await env.DB.prepare("INSERT INTO v3_photos(object_key,dog_id,thumb_key,is_primary) VALUES('photos/v/white.jpg',?,NULL,1)").bind(white.dogId).run();

  gas.remove('9002'); // Google 刪整列不跑編輯觸發
  await gas.edit('9001', { note: '今天打針' }); // 下一次有人改表，清單裡沒有小白：先當候選
  assert.deepEqual(await numbers(env), ['9001', '9002', '9003'], '候選期間網站照常顯示');
  later(11);
  await gas.timer();
  assert.deepEqual(await numbers(env), ['9001', '9003']);

  const after = await manageDogs(manage);
  const gone = after.find(d => d.dogId === white.dogId);
  assert.equal(gone.status, 'unknown', '移出主清單、沒有離所紀錄：待核對');
  assert.equal(gone.photoUrl, '/photos/v/white.jpg');
  // 狗的資料都還在：合併預覽列得出要搬的溜狗紀錄與照片
  const black = after.find(d => d.name === '小黑');
  const preview = await manage(`/api/manage/dogs/${black.dogId}/merge?source=${white.dogId}`);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.moved['溜狗紀錄'], 1);
  assert.equal(preview.body.moved['照片'], 1);
});

test('#771 先清空犬名、下一次執行再打回原名：什麼都不變，沒有紀錄', async t => {
  const { env, gas, later } = await start(t);
  const manage = await manageApi(t, env);
  const edits = (await manage('/api/manage/edits')).body;
  await gas.edit('9002', { name: '' });
  assert.deepEqual(await numbers(env), ['9001', '9002', '9003']);
  await gas.edit(3, { name: '小白' });
  later(25);
  const posts = listPosts(gas).length;
  await gas.timer();
  assert.equal(listPosts(gas).length, posts, '已經沒有候選，補送不再送清單');
  assert.deepEqual(await dogs(env), [['9001', '測試狗', 'A01'], ['9002', '小白', 'A02'], ['9003', '小黑', 'A03']]);
  assert.deepEqual((await manage('/api/manage/edits')).body, edits, '沒有修改紀錄');
  assert.ok((await manageDogs(manage)).every(d => d.status === 'main'));
});

test('#771 只過一次清單不確認：不到 10 分鐘的清單、同一次執行的好幾批都不確認', async t => {
  const many = Array.from({ length: 12 }, (_, i) => [`B${i}`, `80${String(i).padStart(2, '0')}`, `狗${i}`, '', '', '']);
  const { env, gas, later } = await start(t, [...ROWS, ...many]);
  gas.remove('9002');
  // 一次貼上 12 列：同一次執行送兩批，兩批都附上同一次讀表的清單
  const before = listPosts(gas).length;
  await gas.paste('8000', many.map(() => ({ note: '打針' })));
  assert.equal(listPosts(gas).length, before + 2);
  assert.ok((await numbers(env)).includes('9002'));
  later(5);
  await gas.timer(); // 還有候選，補送再送一次清單，但不到 10 分鐘
  assert.ok((await numbers(env)).includes('9002'));
  later(11);
  await gas.timer();
  assert.ok(!(await numbers(env)).includes('9002'));
});

test('#771 刪掉最後一列（清空內容）也會送清單，之後確認', async t => {
  const { env, gas, later } = await start(t);
  const posts = listPosts(gas).length;
  await gas.clear('9003');
  assert.equal(listPosts(gas).length, posts + 1, '清空的列算不出單位，照樣送一次清單');
  later(11);
  await gas.timer();
  assert.deepEqual(await numbers(env), ['9001', '9002']);
});

test('#771 保險掃描讀表後有人新增一列：這次掃描不送指紋，新的那列不會被當成候選', async t => {
  const { env, gas, later } = await start(t);
  const scans = gas.posts.filter(p => p.action === 'dog-list-scan').length;
  gas.during({ afterRead: 1 }, 5, { cage: 'A04', id: '9004', name: '新狗' });
  await gas.scan();
  await gas.idle();
  assert.equal(gas.posts.filter(p => p.action === 'dog-list-scan').length, scans, '讀表後記號換了，指紋不送');
  assert.ok((await numbers(env)).includes('9004'));
  later(11);
  await gas.timer();
  await gas.scan();
  later(25);
  await gas.timer();
  assert.deepEqual(await numbers(env), ['9001', '9002', '9003', '9004']);
});

test('#771 一次少了一半以上的狗不當成消失（多半是讀錯表或整張清空重貼）', async t => {
  const { env, gas, later } = await start(t);
  gas.remove('9001');
  gas.remove('9002');
  await gas.edit('9003', { note: '打針' });
  later(11);
  await gas.timer();
  await gas.scan();
  assert.deepEqual(await numbers(env), ['9001', '9002', '9003']);
});

test('#771 超過單次上限的消失留給下一次，每次請求的 D1 查詢在 50 句以內', async t => {
  const many = Array.from({ length: 30 }, (_, i) => [`C${i}`, `70${String(i).padStart(2, '0')}`, `狗${i}`, '', '', '']);
  const { env, gas, later } = await start(t, [ROWS[0], ...many]);
  // 量查詢次數的做法同 dog-merge.test.mjs：數 prepare 的句數（batch 裡的也算），每次小程式呼叫 Worker 重算
  const db = env.DB, counts = [];
  env.DB = { prepare: sql => { counts[counts.length - 1]++; return db.prepare(sql); }, batch: statements => db.batch(statements) };
  gas.beforeWorker = () => { counts.push(0); };
  const gone = many.slice(0, 12).map(r => r[1]);
  for (const id of gone) gas.remove(id);
  // 最重的一次：同一批送滿 10 列，又有 10 個以上的消失要標
  await gas.paste('7020', Array.from({ length: 10 }, () => ({ note: '打針' })));
  await gas.timer(); // 第一次只標了 MISSING_MAX 隻，還有候選：補送再送一次清單，標剩下的
  later(11);
  await gas.timer();
  assert.equal((await numbers(env)).length, 31 - MISSING_MAX, `一次最多確認 ${MISSING_MAX} 隻`);
  await gas.timer();
  assert.deepEqual(await numbers(env), ['9001', ...many.slice(12).map(r => r[1])]);
  assert.ok(counts.length >= 4);
  assert.ok(Math.max(...counts) <= 50, `一次請求用了 ${Math.max(...counts)} 句`);
});

test('#771 上線時的暖暖殘留：有編號、沒編號同在舊B06，沒編號那隻已不在表上，第一次收到清單後確認移出主清單', async t => {
  const rows = [['舊B06', '2026101403', '暖暖', '2026/10/29', '甲', ''], ['舊B06', '', '暖暖', '2026/10/29', '甲', ''], ['A01', '9001', '測試狗', '2026/10/1', '', '']];
  const { env, gas, later } = await start(t, rows);
  assert.deepEqual((await dogs(env)).filter(d => d[1] === '暖暖').length, 2);
  gas.remove('名:暖暖'); // 上線前就已不在表上（D1 還留著那列）
  await gas.scan(); // 上線後第一次收到清單（保險掃描的指紋表）
  later(11);
  await gas.timer(); // 還有候選，10 分鐘補送再送一次清單
  assert.deepEqual((await dogs(env)).filter(d => d[1] === '暖暖'), [['2026101403', '暖暖', '舊B06']]);

  const manage = await manageApi(t, env);
  const warm = (await manageDogs(manage)).filter(d => d.name === '暖暖');
  const kept = warm.find(d => d.status === 'main'), left = warm.find(d => d.status === 'unknown');
  assert.ok(kept && left);
  // 沒編號那隻已不在主清單，管理者可以把牠併掉（合併規定被併的不能在主清單）
  const preview = await manage(`/api/manage/dogs/${kept.dogId}/merge?source=${left.dogId}`);
  assert.equal(preview.status, 200);
});
