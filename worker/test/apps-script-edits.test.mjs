// #769：Apps Script fixture 的改表操作示範（#768 新狗與暫住的身分辨認從這個接縫測）。
// 管理者照平常的方式改主清單（帶籠位），跑真的 sheet-write.gs、真的 Worker 與 D1，只看志工網站與管理網站 API 讀到什麼。
// 列消失的候選與確認（#771）在 sheet-missing.test.mjs。
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { appsScript, CAGE_HEADER } from './apps-script.mjs';
import { manageApi } from './manage-fixture.mjs';
import { setup } from './walk-fixture.mjs';

const SITE = 'https://bq-shelter-dogs.example.workers.dev';
const ROWS = [['A01', '9001', '測試狗', '2026/10/1', '', ''], ['A02', '9002', '小白', '2026/10/1', '', '']];

// 志工網站狗清單：[編號, 犬名, 籠位]
async function dogs(env) {
  worker.testing.resetState();
  const res = await worker.fetch(new Request(`${SITE}/api/dogs`, { headers: { Origin: SITE } }), env);
  assert.equal(res.status, 200);
  return (await res.json()).dogs.map(d => [d.id, d.name, d.cage]);
}
// 表和 D1 先對齊：保險掃描在 D1 沒有指紋時整份送一次
async function start(t) {
  const env = await setup();
  t.after(() => env.DB.close());
  const gas = appsScript(env, { header: CAGE_HEADER, rows: ROWS });
  await gas.scan();
  assert.deepEqual(await dogs(env), [['9001', '測試狗', 'A01'], ['9002', '小白', 'A02']]);
  return { env, gas };
}
// 補充斷言：小程式送了幾次狗清單同步（API 看不出「只跑一次執行」「沒有執行」，結果仍以 API 為準）
const dogListPosts = gas => gas.posts.filter(p => p.action === 'dog-list');

test('#769 主清單帶籠位改犬名：編輯觸發送狗清單同步，志工網站讀到新名字', async t => {
  const { env, gas } = await start(t);
  await gas.edit('9001', { name: '暖暖' });
  assert.deepEqual(await dogs(env), [['9001', '暖暖', 'A01'], ['9002', '小白', 'A02']]);
});

test('#769 多格貼上：一次改一列的犬名與編號、一次改兩列，各跑一次編輯觸發', async t => {
  const { env, gas } = await start(t);
  await gas.edit(4, { cage: 'A03', name: '(乳白)' });
  assert.deepEqual((await dogs(env)).at(-1), ['', '(乳白)', 'A03']);
  const before = dogListPosts(gas).length;
  await gas.edit(4, { name: '暖暖', id: '9003' });
  assert.equal(dogListPosts(gas).length, before + 1, '犬名和編號一起貼上只跑一次執行');
  assert.ok((await dogs(env)).some(d => d.join() === ['9003', '暖暖', 'A03'].join()));

  await gas.paste('9001', [{ cage: 'B01' }, { cage: 'B02' }]);
  const now = await dogs(env);
  assert.deepEqual(now.filter(d => ['9001', '9002'].includes(d[0])), [['9001', '測試狗', 'B01'], ['9002', '小白', 'B02']]);
});

test('#769 先清空一格、下一次執行再打字：兩次編輯觸發，用列號接著改', async t => {
  const { env, gas } = await start(t);
  await gas.edit('9002', { name: '' });
  assert.deepEqual(await dogs(env), [['9001', '測試狗', 'A01'], ['9002', '小白', 'A02']], '犬名空白的列不是狗，什麼都不送');
  await gas.edit(3, { name: '小黑' });
  assert.deepEqual(await dogs(env), [['9001', '測試狗', 'A01'], ['9002', '小黑', 'A02']]);
});

test('#769 刪列：刪整列不跑編輯觸發；清空到表上一隻都不剩，沒有單位也沒有主清單 key，不送也不當成消失；保險掃描把網站多的列出來', async t => {
  const { env, gas } = await start(t);
  const posts = dogListPosts(gas).length;
  gas.remove('9001');
  assert.equal(dogListPosts(gas).length, posts, 'Google 刪整列不跑編輯觸發，小程式沒有執行');
  await gas.clear(2);
  assert.equal(dogListPosts(gas).length, posts, '表上一隻狗都沒有，沒東西可告訴 Worker（還有狗時清空最後一列照樣送，見 sheet-missing.test.mjs）');
  assert.deepEqual(await dogs(env), [['9001', '測試狗', 'A01'], ['9002', '小白', 'A02']], '表上沒有任何狗，多半是讀錯表，網站照舊');

  await gas.scan();
  const manage = await manageApi(t, env);
  const { status, body } = await manage('/api/manage/data-checks');
  assert.equal(status, 200);
  assert.deepEqual(body.sheetGaps.items.map(x => [x.key, x.name]), [['main:9001', '測試狗'], ['main:9002', '小白']]);
});

test('#769 補送：改表那次執行在送狗清單前被停掉，下一次 10 分鐘補送才送到', async t => {
  const { env, gas } = await start(t);
  gas.stopAt('dog-list');
  await assert.rejects(gas.edit('9001', { cage: 'C01' }), /在送 dog-list 前中斷/);
  assert.deepEqual((await dogs(env))[0], ['9001', '測試狗', 'A01']);
  await gas.timer();
  assert.deepEqual((await dogs(env))[0], ['9001', '測試狗', 'C01']);
});

test('#769 保險掃描：讀表後、送出前有人改表，這次掃描不送舊內容，改表的編輯觸發照送，下次掃描補上', async t => {
  const { env, gas } = await start(t);
  gas.set('9001', { cage: 'D01' }); // 編輯觸發沒送到的改動，等保險掃描補
  gas.during({ afterRead: 1 }, '9002', { name: '小花' });
  await gas.scan();
  await gas.idle();
  assert.deepEqual(await dogs(env), [['9001', '測試狗', 'A01'], ['9002', '小花', 'A02']]);
  await gas.scan();
  assert.deepEqual(await dogs(env), [['9001', '測試狗', 'D01'], ['9002', '小花', 'A02']]);
});

test('#769 保險掃描：拿到指紋比對結果後、送出前有人改表（during 的 after 模式），結果一樣；during 沒跑到就失敗', async t => {
  const { env, gas } = await start(t);
  gas.set('9001', { cage: 'D01' });
  gas.during({ after: 'dog-list-scan' }, '9002', { name: '小花' });
  await gas.scan();
  await gas.idle();
  assert.deepEqual(await dogs(env), [['9001', '測試狗', 'A01'], ['9002', '小花', 'A02']]);

  gas.during({ afterRead: 5 }, '9002', { name: '小灰' });
  await assert.rejects(gas.scan(), /沒跑到 during/);
  await gas.idle();
  assert.deepEqual((await dogs(env))[1], ['9002', '小花', 'A02'], '沒插入的改表不會留到之後的執行');
});
