// #774（ADR 0025）：確認消失的一般狗跟可能是同一隻的狗配成一組，管理者在資料頁按「合併」或「不是同一隻」。
// 跑真的 sheet-write.gs、真的 Worker 與 D1（Apps Script fixture，#769），只看志工網站與管理網站 API 讀到什麼。
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { appsScript, CAGE_HEADER } from './apps-script.mjs';
import { manageApi } from './manage-fixture.mjs';
import { setup } from './walk-fixture.mjs';
import { readPairs, rejectPair } from '../src/dog-pairs.js';

const SITE = 'https://bq-shelter-dogs.example.workers.dev';
const MINUTE = 60000;
const ROWS = [['A01', '9001', '測試狗', '2026/10/1', '', ''], ['A02', '9002', '小白', '2026/10/28', '甲', ''], ['A03', '9003', '小黑', '2026/10/1', '', '']];

async function numbers(env) {
  worker.testing.resetState();
  const res = await worker.fetch(new Request(`${SITE}/api/dogs`, { headers: { Origin: SITE } }), env);
  assert.equal(res.status, 200);
  return (await res.json()).dogs.map(d => d.id);
}
// 每個測試的時間差三小時（有的測試自己往前走快兩小時）：管理網站把 Access 公鑰快取 5 分鐘（模組層級）
let hours = 0;
async function start(t, rows = ROWS) {
  const now = Date.now() + 1000 * 3600000 + ++hours * 3 * 3600000;
  t.mock.timers.enable({ apis: ['Date'], now });
  const env = await setup(), { DB } = env;
  t.after(() => DB.close());
  const gas = appsScript(env, { header: CAGE_HEADER, rows });
  await gas.scan();
  const manage = await manageApi(t, env);
  return { env, gas, manage, later: minutes => t.mock.timers.setTime(now + minutes * MINUTE) };
}
const dogsOf = async manage => (await manage('/api/manage/dogs')).body.dogs;
// 等確認的配對：[待核對那隻, 表上那隻, 籠位]
async function pairs(manage) {
  const { status, body } = await manage('/api/manage/dog-pairs');
  assert.equal(status, 200);
  assert.equal(body.count, body.pairs.length);
  return body.pairs.map(p => [p.goneName, p.name, p.cage]);
}
// 管理者刪掉小白那一列、補送確認
async function removeWhite(gas, later, minutes = 11) {
  gas.remove('9002');
  await gas.edit('9001', { note: '今天打針' });
  later(minutes);
  await gas.timer();
}

test('#774 刪掉一列、之後才在同籠新增另一隻：資料頁出現這組配對', async t => {
  const { env, gas, manage, later } = await start(t);
  await removeWhite(gas, later);
  assert.deepEqual(await numbers(env), ['9001', '9003']);
  assert.deepEqual(await pairs(manage), [], '同籠還沒有別隻，不配對');
  await gas.edit(4, { cage: 'A02', id: '9010', name: '阿白' });
  assert.deepEqual(await pairs(manage), [['小白', '阿白', 'A02']]);
  // 別的籠位新增的狗不配對
  await gas.edit(5, { cage: 'A09', id: '9011', name: '路過' });
  assert.equal((await pairs(manage)).length, 1);
});

test('#774 先在同籠新增另一隻、十分鐘後才刪舊的那列：確認時配對；一小時前就在同籠的狗不配對', async t => {
  const rows = [...ROWS, ['A02', '9004', '老室友', '', '', '']];
  const { env, gas, later } = await start(t, rows);
  later(90); // 老室友在一個多小時前就在同籠
  await gas.edit(6, { cage: 'A02', id: '9010', name: '阿白' });
  later(100);
  gas.remove('9002');
  await gas.edit('9001', { note: '今天打針' });
  later(115);
  await gas.timer();
  const manage = await manageApi(t, env); // 登入憑證一小時過期，時間往前走之後重簽
  assert.deepEqual(await pairs(manage), [['小白', '阿白', 'A02']]);
});

test('#774 上線時的暖暖殘留：出現「可能跟 暖暖（舊B06）是同一隻」，合併後只剩一隻、可以取消合併', async t => {
  const rows = [['舊B06', '2026101403', '暖暖', '2026/10/29', '甲', ''], ['舊B06', '', '暖暖', '2026/10/29', '甲', ''], ['A01', '9001', '測試狗', '2026/10/1', '', '']];
  const { env, gas, manage, later } = await start(t, rows);
  gas.remove('名:暖暖');
  await gas.scan();
  later(11);
  await gas.timer();
  assert.deepEqual(await pairs(manage), [['暖暖', '暖暖', '舊B06']]);
  const [pair] = (await manage('/api/manage/dog-pairs')).body.pairs;

  // 按合併：照現有合併狗（預覽帶兩隻的版本再送）
  const preview = await manage(`/api/manage/dogs/${pair.dogId}/merge?source=${pair.goneDogId}`);
  assert.equal(preview.status, 200);
  const merged = await manage(`/api/manage/dogs/${pair.dogId}/merge`, { method: 'POST',
    body: { sourceId: pair.goneDogId, revision: preview.body.target.revision, sourceRevision: preview.body.source.revision } });
  assert.equal(merged.status, 200);
  assert.deepEqual((await dogsOf(manage)).filter(d => d.name === '暖暖').map(d => d.status), ['main'], '只剩一隻暖暖');
  assert.deepEqual(await pairs(manage), []);

  const { body: dog } = await manage(`/api/manage/dogs/${pair.dogId}`);
  const unmerged = await manage(`/api/manage/dogs/${pair.dogId}/unmerge`, { method: 'POST', body: { logId: merged.body.logId, revision: dog.revision } });
  assert.equal(unmerged.status, 200);
  assert.equal((await dogsOf(manage)).filter(d => d.name === '暖暖').length, 2, '取消合併拆回兩隻');
  assert.deepEqual(await pairs(manage), [], '按過合併的這組不再列出');
  assert.deepEqual((await numbers(env)).sort(), ['2026101403', '9001']);
});

test('#774 按「不是同一隻」：配對消失、記一筆修改紀錄，之後同一組不再出現', async t => {
  const rows = [['舊B06', '2026101403', '暖暖', '2026/10/29', '甲', ''], ['舊B06', '', '暖暖', '2026/10/29', '甲', ''], ['A01', '9001', '測試狗', '2026/10/1', '', '']];
  const { gas, manage, later } = await start(t, rows);
  gas.remove('名:暖暖');
  await gas.scan();
  later(11);
  await gas.timer();
  const [pair] = (await manage('/api/manage/dog-pairs')).body.pairs;
  const path = `/api/manage/dog-pairs/${pair.goneDogId}/${pair.dogId}/not-same`;
  const res = await manage(path, { method: 'POST', body: {} });
  assert.equal(res.status, 200);
  assert.deepEqual(await pairs(manage), []);
  assert.equal((await manage(path, { method: 'POST', body: {} })).status, 404, '已經處理過');
  const { body: edits } = await manage('/api/manage/edits?kind=not_same');
  assert.equal(edits.edits.length, 1);
  assert.equal(edits.edits[0].dogId, pair.goneDogId);
  assert.equal(edits.edits[0].actorEmail, 'manager@example.org');

  // 沒編號的暖暖又寫回表上、再刪掉：確認後同一組不再建立
  await gas.edit(4, { cage: '舊B06', name: '暖暖' });
  assert.equal((await dogsOf(manage)).filter(d => d.name === '暖暖' && d.status === 'main').length, 2);
  later(20);
  gas.remove('名:暖暖');
  await gas.edit('9001', { note: '打針' });
  later(35);
  await gas.timer();
  assert.equal((await dogsOf(manage)).filter(d => d.name === '暖暖' && d.status === 'main').length, 1);
  assert.deepEqual(await pairs(manage), []);
});

test('#774 配對 API 只給管理網站：別的來源不能按不是同一隻、路徑不對回 404', async t => {
  const { manage } = await start(t);
  assert.equal((await manage('/api/manage/dog-pairs/abc/not-same', { method: 'POST', body: {} })).status, 404);
  assert.equal((await manage(`/api/manage/dog-pairs/${'a'.repeat(32)}/${'b'.repeat(32)}/not-same`, { method: 'POST', body: {} })).status, 404);
  assert.equal((await manage('/api/manage/dog-pairs', { method: 'POST', body: {} })).status, 405);
});

// CODING_STANDARDS「D1 不整張讀」：配對相關的每一句（同步時的確認與新建狗、資料頁讀配對、不是同一隻）都走索引，
// 塞了大量無關的狗、離所紀錄、已處理的配對、別籠的籠位紀錄也一樣。量法同 dog-merge.test.mjs：攔下 SQL 看查詢計畫
test('#774 D1 不整張掃：配對的讀寫都走索引，等確認的配對只掃部分索引', async t => {
  const { env, gas, later } = await start(t);
  const db = env.DB;
  for (let i = 0; i < 200; i++) {
    const id = i.toString(16).padStart(32, 'e');
    await db.prepare('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)').bind(id, `無關${i}`).run();
    await db.prepare("INSERT INTO v3_dog_departures(dog_id,number,name,departed_date) VALUES(?,?,?,'2026-01-01')").bind(id, `8${i}`, `無關${i}`).run();
    await db.prepare("INSERT INTO v3_sheet_gone(dog_id,cage,gone_at) VALUES(?,?,'2026-01-01T00:00:00.000Z')").bind(id, `Z${i}`).run();
    await db.prepare("INSERT INTO v3_dog_pairs(gone_dog_id,dog_id,status,created_at) VALUES(?,'dog','not_same','2026-01-01T00:00:00.000Z')").bind(id).run();
  }
  const seen = [];
  const recording = {
    prepare: sql => {
      const stmt = db.prepare(sql);
      return { ...stmt, bind: (...args) => { seen.push([sql, args]); return stmt.bind(...args); },
        first: (...a) => { seen.push([sql, []]); return stmt.first(...a); }, all: (...a) => { seen.push([sql, []]); return stmt.all(...a); } };
    },
    batch: statements => db.batch(statements),
  };
  env.DB = recording;
  await removeWhite(gas, later);
  await gas.edit(4, { cage: 'A02', id: '9010', name: '阿白' });
  const { pairs: [pair] } = await readPairs(recording);
  await rejectPair(recording, pair.goneDogId, pair.dogId, { actor: { subject: 's', email: 'e@example.org' } });
  env.DB = db;
  const ours = seen.filter(([sql]) => /v3_dog_pairs|v3_sheet_gone/.test(sql));
  assert.ok(ours.length >= 5, '確認、新建狗、讀配對、不是同一隻都攔到');
  const scans = new Set();
  for (const [sql, args] of ours) {
    for (const { detail } of (await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...args).all()).results) {
      // 等確認的配對：部分索引只有等確認的列；有條件 batch 的 guard 不讀表
      if (/^SCAN (CONSTANT ROW|\w+ USING (COVERING )?INDEX v3_dog_pairs_pending)/.test(detail)) continue;
      const table = detail.match(/^SCAN (\w+)/)?.[1];
      if (table) scans.add(`${table}：${detail}`);
    }
  }
  assert.deepEqual([...scans], []);
});
