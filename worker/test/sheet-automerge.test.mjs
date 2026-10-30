// #773（ADR 0025）：同籠自動合併。候選還在時，同一個籠位要新建狗、而且這個籠位剛好只有一個非暫住的候選，就是同一隻：
// 照常建新狗，同一個流程把候選移出主清單、由系統併到新狗（修改紀錄「系統自動合併」，可以取消合併）。
// 跑真的 sheet-write.gs、真的 Worker 與 D1（Apps Script fixture，#769），只看志工網站與管理網站 API 讀到什麼。
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { appsScript, CAGE_HEADER } from './apps-script.mjs';
import { manageApi } from './manage-fixture.mjs';
import { setup } from './walk-fixture.mjs';
import { syncDogList } from '../src/dog-list.js';

const SITE = 'https://bq-shelter-dogs.example.workers.dev';
const MINUTE = 60000;
const WARM = '2026103001';
// 表上第 2 列起：(乳白) 在新A01（第 3 列），上次溜是 10/28
const ROWS = [['A01', '9001', '測試狗', '2026/10/1', '', ''], ['新A01', '', '(乳白)', '2026/10/28', '甲', ''], ['A02', '9002', '小白', '2026/10/1', '', ''], ['A03', '9003', '小黑', '2026/10/1', '', '']];
const MILK_ROW = 3;

// 志工網站狗清單：[編號, 犬名, 籠位]
async function dogs(env) {
  worker.testing.resetState();
  const res = await worker.fetch(new Request(`${SITE}/api/dogs`, { headers: { Origin: SITE } }), env);
  assert.equal(res.status, 200);
  return (await res.json()).dogs.map(d => [d.id, d.name, d.cage]);
}
const named = async (env, name) => (await dogs(env)).filter(d => d[1] === name);
// 每個測試的時間差一小時：管理網站把 Access 公鑰快取 5 分鐘（模組層級）
let hours = 0;
async function start(t, rows = ROWS) {
  const now = Date.now() + ++hours * 3600000;
  t.mock.timers.enable({ apis: ['Date'], now });
  const env = await setup();
  t.after(() => env.DB.close());
  const gas = appsScript(env, { header: CAGE_HEADER, rows });
  await gas.scan();
  const manage = await manageApi(t, env);
  return { env, gas, manage, later: minutes => t.mock.timers.setTime(now + minutes * MINUTE) };
}
async function manageDogs(manage) {
  const { status, body } = await manage('/api/manage/dogs');
  assert.equal(status, 200);
  return body.dogs;
}
const edits = async (manage, kind) => (await manage(`/api/manage/edits?kind=${kind}`)).body.edits;
// 狗的照片和一筆較早的溜狗紀錄（表上那天的溜狗新狗也會記一筆，同一天同一位志工不重複搬）：併過去後要接著用
async function withHistory(env, manage, name = '(乳白)') {
  const dog = (await manageDogs(manage)).find(d => d.name === name);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO v3_photos(object_key,dog_id,thumb_key,is_primary) VALUES('photos/v/milk.jpg',?,NULL,1)").bind(dog.dogId),
    env.DB.prepare("INSERT INTO v3_walks(dog_id,walk_date,position,walker_name,walker_code,dog_number,dog_name) VALUES(?,'2026-10-20',0,'乙','',?,?)").bind(dog.dogId, dog.number, name),
  ]);
  return dog;
}
// 只剩一隻暖暖、(乳白) 的狗資料已併掉；修改紀錄一筆系統自動合併，溜狗紀錄、照片搬過去
async function assertMerged(env, manage, number = '') {
  assert.deepEqual(await named(env, '暖暖'), [[number, '暖暖', '新A01']]);
  assert.deepEqual(await named(env, '(乳白)'), []);
  const all = await manageDogs(manage);
  const warm = all.filter(d => d.name === '暖暖');
  assert.equal(warm.length, 1);
  assert.ok(!all.some(d => d.name === '(乳白)'), '(乳白) 已併到暖暖，不是待核對');
  assert.equal(warm[0].photoUrl, '/photos/v/milk.jpg');
  const [log, ...more] = await edits(manage, 'automerge');
  assert.equal(more.length, 0);
  assert.equal(log.kindLabel, '系統自動合併');
  assert.equal(log.editorName, '系統自動判斷');
  assert.equal(log.source, 'sheet');
  assert.equal(log.dogId, warm[0].dogId);
  assert.equal(log.before.name, '(乳白)');
  assert.equal(log.after.moved['溜狗紀錄'], 1);
  assert.equal(log.after.moved['照片'], 1);
  return { warm: warm[0], log };
}

test('#773 (乳白) 直接打字改成暖暖：只有一隻暖暖，溜狗紀錄與照片接著用，修改紀錄一筆系統自動合併', async t => {
  const { env, gas, manage } = await start(t);
  await withHistory(env, manage);
  await gas.edit('名:(乳白)', { name: '暖暖' });
  await assertMerged(env, manage);
});

test('#773 先清空 (乳白) 再打暖暖（兩次執行）：一樣只有一隻暖暖', async t => {
  const { env, gas, manage } = await start(t);
  await withHistory(env, manage);
  await gas.edit('名:(乳白)', { name: '' });
  await gas.edit(MILK_ROW, { name: '暖暖' });
  await assertMerged(env, manage);
});

test('#773 一次貼上犬名與編號：一樣只有一隻暖暖，有編號', async t => {
  const { env, gas, manage } = await start(t);
  await withHistory(env, manage);
  await gas.edit('名:(乳白)', { name: '暖暖', id: WARM });
  await assertMerged(env, manage, WARM);
});

test('#773 暖暖清掉編號再打回：最後只有一隻暖暖，有編號', async t => {
  const rows = ROWS.map(r => (r[2] === '(乳白)' ? ['新A01', WARM, '暖暖', '2026/10/28', '甲', ''] : r));
  const { env, gas, manage } = await start(t, rows);
  const before = await withHistory(env, manage, '暖暖');
  await gas.edit(WARM, { id: '' });
  assert.deepEqual(await named(env, '暖暖'), [['', '暖暖', '新A01']]);
  await gas.edit('名:暖暖', { id: WARM });
  assert.deepEqual(await named(env, '暖暖'), [[WARM, '暖暖', '新A01']]);
  const warm = (await manageDogs(manage)).filter(d => d.name === '暖暖');
  assert.equal(warm.length, 1);
  assert.equal(warm[0].status, 'main');
  const [log] = await edits(manage, 'automerge');
  assert.equal(log.before.name, '暖暖');
  assert.deepEqual(log.before.numbers, [WARM]);
  assert.equal(log.after.moved['溜狗紀錄'], 1);
  assert.equal(warm[0].photoUrl, '/photos/v/milk.jpg');
  assert.notEqual(warm[0].dogId, before.dogId, '舊的那隻併到新建的那隻');
});

test('#773 改名同時換籠：不自動合併，(乳白) 照一般規則確認成待核對', async t => {
  const { env, gas, manage, later } = await start(t);
  await gas.edit('名:(乳白)', { name: '暖暖', cage: '新A09' });
  assert.deepEqual(await named(env, '暖暖'), [['', '暖暖', '新A09']]);
  assert.deepEqual(await edits(manage, 'automerge'), []);
  later(11);
  await gas.timer();
  assert.deepEqual(await named(env, '(乳白)'), []);
  assert.equal((await manageDogs(manage)).find(d => d.name === '(乳白)').status, 'unknown');
});

test('#773 同籠兩個候選：一次把兩隻都改名，不自動合併', async t => {
  const rows = [...ROWS.slice(0, 2), ['新A01', '', '(黑)', '2026/10/28', '乙', ''], ...ROWS.slice(2)];
  const { env, gas, manage } = await start(t, rows);
  await gas.paste('名:(乳白)', [{ name: '暖暖' }, { name: '黑妞' }]);
  assert.deepEqual(await edits(manage, 'automerge'), []);
  const names = (await dogs(env)).map(d => d[1]);
  for (const name of ['暖暖', '黑妞', '(乳白)', '(黑)']) assert.ok(names.includes(name), `${name} 還在（候選期間照常顯示）`);
});

test('#773 同一批裡小白搬到已出所、同籠打上新狗：小白記離所，不被當成候選併掉', async t => {
  const { env, manage } = await start(t);
  // GAS 同一批先送主清單、再送已出所（orderDogListKeys）；表上主清單已經沒有小白
  const mainKeys = ['main:9001', 'main:名:(乳白)', 'main:名:新狗', 'main:9003'];
  const { results } = await syncDogList(env.DB, [
    { sheet: 'main', dog: { id: '', name: '新狗' }, cage: 'A02', date: '', walker: '', note: '' },
    { sheet: 'departed', dog: { id: '9002', name: '小白' }, texts: ['認養'], dates: [] },
  ], mainKeys, env);
  assert.ok(results.every(r => r.ok), JSON.stringify(results));
  assert.deepEqual(await edits(manage, 'automerge'), []);
  const all = await manageDogs(manage);
  assert.equal(all.find(d => d.name === '小白').status, 'departed');
  assert.equal(all.find(d => d.name === '新狗').status, 'main');
});

test('#773 在修改紀錄按取消合併：拆回兩隻，(乳白) 變待核對', async t => {
  const { env, gas, manage } = await start(t);
  const milk = await withHistory(env, manage);
  await gas.edit('名:(乳白)', { name: '暖暖' });
  const { warm, log } = await assertMerged(env, manage);
  const dog = await manage(`/api/manage/dogs/${warm.dogId}`);
  const res = await manage(`/api/manage/dogs/${warm.dogId}/unmerge`, { method: 'POST', body: { logId: log.id, revision: dog.body.revision } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const all = await manageDogs(manage);
  assert.equal(all.find(d => d.dogId === milk.dogId).status, 'unknown');
  assert.equal(all.find(d => d.dogId === milk.dogId).photoUrl, '/photos/v/milk.jpg');
  assert.equal(all.find(d => d.dogId === warm.dogId).status, 'main');
  assert.deepEqual(await named(env, '暖暖'), [['', '暖暖', '新A01']]);
});

test('#773 下一隻新的 (乳白) 不會被接到舊 (乳白) 身上', async t => {
  const { env, gas, manage } = await start(t);
  await withHistory(env, manage);
  await gas.edit('名:(乳白)', { name: '暖暖' });
  const { warm } = await assertMerged(env, manage);
  await gas.edit(ROWS.length + 2, { cage: '新B02', name: '(乳白)' });
  const all = await manageDogs(manage);
  const milk = all.find(d => d.name === '(乳白)');
  assert.ok(milk && milk.dogId !== warm.dogId, '新的 (乳白) 是另一隻狗');
  assert.equal(all.find(d => d.dogId === warm.dogId).name, '暖暖');
  assert.deepEqual(await named(env, '(乳白)'), [['', '(乳白)', '新B02']]);
});

test('#773 合併時版本變了：不合併，(乳白) 留成候選，之後照一般規則確認', async t => {
  const { env, gas, manage, later } = await start(t);
  const milk = (await manageDogs(manage)).find(d => d.name === '(乳白)');
  // 自動合併那一批送出前，別的請求改了 (乳白)（版本加 1）
  const db = env.DB;
  let racing = false;
  env.DB = {
    prepare: sql => { if (sql.startsWith('DELETE FROM v3_sheet_main WHERE row_index=? AND dog_id=?')) racing = true; return db.prepare(sql); },
    async batch(statements) {
      if (racing) { racing = false; await db.prepare('UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id=?').bind(milk.dogId).run(); }
      return db.batch(statements);
    },
  };
  await gas.edit('名:(乳白)', { name: '暖暖' });
  env.DB = db;
  assert.deepEqual(await edits(manage, 'automerge'), []);
  assert.deepEqual(await named(env, '(乳白)'), [['', '(乳白)', '新A01']], '候選期間照常顯示');
  later(11);
  await gas.timer();
  assert.deepEqual(await named(env, '(乳白)'), []);
  assert.equal((await manageDogs(manage)).find(d => d.dogId === milk.dogId).status, 'unknown');
});

test('#773 D1 查詢次數：同一批送滿 10 列（其中一列自動合併）、又有 10 個以上消失，每次請求在 50 次以內', async t => {
  const many = Array.from({ length: 30 }, (_, i) => [`C${i}`, `70${String(i).padStart(2, '0')}`, `狗${i}`, '', '', '']);
  const { env, gas, manage } = await start(t, [...ROWS, ...many]);
  // D1 官方限制：每次呼叫 50 次查詢，db.batch() 整批算 1 次（https://developers.cloudflare.com/d1/platform/limits/）。
  // 數 first／all／run 與 batch 的次數，每次小程式呼叫 Worker 重算
  const db = env.DB, counts = [];
  const count = () => { counts[counts.length - 1]++; };
  const wrap = stmt => ({ inner: stmt, bind: (...a) => wrap(stmt.bind(...a)), first: (...a) => { count(); return stmt.first(...a); }, all: (...a) => { count(); return stmt.all(...a); }, run: (...a) => { count(); return stmt.run(...a); } });
  env.DB = { prepare: sql => wrap(db.prepare(sql)), batch: statements => { count(); return db.batch(statements.map(s => s.inner)); } };
  gas.beforeWorker = () => { counts.push(0); };
  for (const r of many.slice(0, 12)) gas.remove(r[1]);
  await gas.paste('名:(乳白)', [{ name: '暖暖' }, ...Array.from({ length: 9 }, () => ({ note: '打針' }))]);
  env.DB = db;
  assert.equal((await edits(manage, 'automerge')).length, 1);
  assert.ok(counts.length >= 1);
  assert.ok(Math.max(...counts) <= 50, `一次請求用了 ${Math.max(...counts)} 次查詢`);
});
