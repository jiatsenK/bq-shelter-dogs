// #772（ADR 0025）：暫住列「(皮蛋）」不再建成狗，存成暫住紀錄；消失照候選規則確認後暫住結束。
// 跑真的 sheet-write.gs、真的 Worker 與 D1（Apps Script fixture，#769），只看志工網站與管理網站 API 讀到什麼。
// 志工網站把暫住列合到那隻狗是前端的事（public/js/app.js 的 mergeTempCages，tests/index/rest.js 測），這裡看資料包照舊送出那一列。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../src/index.js';
import { appsScript, CAGE_HEADER } from './apps-script.mjs';
import { manageApi } from './manage-fixture.mjs';
import { setup } from './walk-fixture.mjs';
import { splitStatements } from '../../scripts/compact-schema.mjs';

const SITE = 'https://bq-shelter-dogs.example.workers.dev';
const MINUTE = 60000;
const ROWS = [['A01', '9001', '錢錢', '2026/10/1', '', ''], ['A02', '9002', '皮蛋', '2026/10/28', '甲', ''], ['A03', '9003', '小黑', '2026/10/1', '', '']];

// 志工網站狗清單：[編號, 犬名, 籠位]
async function dogs(env) {
  worker.testing.resetState();
  const res = await worker.fetch(new Request(`${SITE}/api/dogs`, { headers: { Origin: SITE } }), env);
  assert.equal(res.status, 200);
  return (await res.json()).dogs.map(d => [d.id, d.name, d.cage]);
}
// 每個測試的時間差一小時：管理網站把 Access 公鑰快取 5 分鐘（模組層級），不然會拿到上一個測試的公鑰
let hours = 0;
async function start(t) {
  const now = Date.now() + ++hours * 3600000;
  t.mock.timers.enable({ apis: ['Date'], now });
  const env = await setup();
  t.after(() => env.DB.close());
  const gas = appsScript(env, { header: CAGE_HEADER, rows: ROWS });
  await gas.scan();
  const manage = await manageApi(t, env);
  return { env, gas, manage, later: minutes => t.mock.timers.setTime(now + minutes * MINUTE) };
}
// 管理網站：狗資料的犬名、暫住的修改紀錄 [種類, 編號, 改前, 改後]（舊到新）
const dogNames = async manage => (await manage('/api/manage/dogs')).body.dogs.map(d => d.name).sort();
const stayLogs = async manage => (await manage('/api/manage/edits')).body.edits.filter(e => e.kind.startsWith('stay-')).reverse()
  .map(e => [e.kindLabel, e.dogNumber, e.before, e.after]);

test('#772 管理者在錢錢那籠加「(皮蛋）」：資料包照舊送出暫住列，皮蛋原本籠位不變，D1 沒有新建狗，修改紀錄有暫住開始', async t => {
  const { env, gas, manage } = await start(t);
  const names = await dogNames(manage);
  await gas.edit(5, { cage: 'A01', name: '(皮蛋）' });
  assert.deepEqual(await dogs(env), [['9001', '錢錢', 'A01'], ['9002', '皮蛋', 'A02'], ['9003', '小黑', 'A03'], ['', '(皮蛋）', 'A01']]);
  assert.deepEqual(await dogNames(manage), names, '沒有建狗');
  assert.deepEqual(await stayLogs(manage), [['暫住開始', '9002', null, { cage: 'A01' }]]);

  // 同一列改籠位：只更新暫住紀錄，不另記
  await gas.edit('名:(皮蛋）', { cage: 'A03' });
  assert.deepEqual((await dogs(env)).at(-1), ['', '(皮蛋）', 'A03']);
  assert.equal((await stayLogs(manage)).length, 1);
});

test('#772 刪掉暫住列：先當候選，確認後志工網站不再送暫住列，修改紀錄有暫住結束', async t => {
  const { env, gas, manage, later } = await start(t);
  await gas.edit(5, { cage: 'A01', name: '（ 皮蛋 )' }); // 全形半形混用、括號裡有空白也算
  gas.remove('名:（ 皮蛋 )'); // Google 刪整列不跑編輯觸發
  await gas.edit('9001', { note: '今天打針' });
  assert.ok((await dogs(env)).some(d => d[1] === '（ 皮蛋 )'), '候選期間照常送出');
  later(11);
  await gas.timer();
  assert.deepEqual(await dogs(env), [['9001', '錢錢', 'A01'], ['9002', '皮蛋', 'A02'], ['9003', '小黑', 'A03']]);
  assert.deepEqual(await stayLogs(manage), [['暫住開始', '9002', null, { cage: 'A01' }], ['暫住結束', '9002', { cage: 'A01' }, null]]);
});

test('#772 括號裡不是在所狗名的列、有編號的括號列都照舊當新狗', async t => {
  const { env, gas, manage } = await start(t);
  await gas.edit(5, { cage: 'A04', name: '(乳白)' });
  await gas.edit(6, { cage: 'A05', name: '(皮蛋)', id: '9005' });
  assert.deepEqual((await dogs(env)).slice(3), [['', '(乳白)', 'A04'], ['9005', '(皮蛋)', 'A05']]);
  const names = await dogNames(manage);
  assert.ok(names.includes('(乳白)') && names.includes('(皮蛋)'), '兩隻都建成狗');
  assert.deepEqual(await stayLogs(manage), []);
});

test('#772 上線轉換：主清單複本上的「(皮蛋）」假狗轉成暫住紀錄後刪掉；表上已刪的暫住確認後結束；有資料的假狗留著待核對', async t => {
  const { env, gas, manage, later } = await start(t);
  const { DB } = env;
  const run = (sql, ...args) => DB.prepare(sql).bind(...args).run();
  // #772 以前建成狗的暫住列：(皮蛋） 還在主清單複本上（表上已刪）；(小黑) 已被 #771 移出主清單、沒有資料；(錢錢) 移出主清單但有溜狗紀錄
  await run("INSERT INTO v3_dogs(dog_id,name) VALUES('fake1','(皮蛋）'),('fake2','(小黑)'),('fake3','(錢錢)')");
  await run("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,cage) VALUES(90,'fake1','','(皮蛋）','A01')");
  await run("INSERT INTO v3_walks(dog_id,walk_date,position,walker_code,dog_number,dog_name) VALUES('fake3','2026-10-29',0,'w1','','(錢錢)')");
  for (const sql of splitStatements(await readFile(new URL('../../migrations/0021_sheet_stays.sql', import.meta.url), 'utf8'))) await DB.prepare(sql).run();

  const names = await dogNames(manage);
  assert.ok(!names.includes('(皮蛋）') && !names.includes('(小黑)'), '沒有其他資料的假狗刪掉');
  assert.ok(names.includes('(錢錢)'), '有溜狗紀錄的留著');
  assert.deepEqual((await dogs(env)).at(-1), ['', '(皮蛋）', 'A01'], '轉成暫住紀錄，照舊送出');

  await gas.edit('9001', { note: '今天打針' }); // 表上沒有 (皮蛋）：候選
  later(11);
  await gas.timer();
  assert.ok(!(await dogs(env)).some(d => d[1] === '(皮蛋）'));
  assert.deepEqual(await stayLogs(manage), [['暫住結束', '9002', { cage: 'A01' }, null]]);
});
