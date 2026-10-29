// #270 活動紀錄（ADR 0002）：任何人選好名字就能新增、修改、刪除，記編輯紀錄；只有名字的出席照樣存
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { fakeD1 } from './fakes.mjs';
import { createCompactDatabase } from '../../scripts/compact-schema.mjs';
import { importCompactDogs } from './compact-fixtures.mjs';

const SITE = 'https://bq-shelter-dogs.example.workers.dev';
const ME = '小明';

async function makeEnv() {
  const DB = fakeD1();
  await createCompactDatabase(DB);
  await importCompactDogs(DB, { syncedAt: '2026-10-15T12:00:00+08:00', dogs: [
    { id: '2024032902', name: '小白', formerIds: ['2020010101'] },
    { id: '2024010101', name: '小黑' },
  ] });
  return { DB, WALKER_KEY: 'test-walker-key' };
}

test.beforeEach(t => {
  worker.testing.resetState();
  const real = globalThis.fetch;
  globalThis.fetch = async url => { throw new Error(`不應該連外：${url}`); };
  t.after(() => { globalThis.fetch = real; });
});

const req = (method, path, body, ip = '1.1.1.1') => new Request(`${SITE}/api${path}`, {
  method, headers: { Origin: SITE, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: body === undefined ? undefined : JSON.stringify(body),
});
const call = async (env, ...args) => { const res = await worker.fetch(req(...args), env); return { status: res.status, body: await res.json() }; };
const list = async env => (await call(env, 'GET', '/activities')).body.activities;
// 編輯紀錄：dogIds 只看有沒有接上狗（永久 ID 是亂數）
const noIds = v => v && { ...v, dogIds: v.dogIds.map(Boolean) };
const logs = async env => (await env.DB.prepare("SELECT editor_name, before_json, after_json FROM v3_edit_log WHERE kind='activity' ORDER BY id").all()).results
  .map(r => [r.editor_name, noIds(JSON.parse(r.before_json)), noIds(JSON.parse(r.after_json))]);

test('新增：用編號、舊編號選狗，只有名字的也存；讀回新到舊、帶現在的編號', async () => {
  const env = await makeEnv();
  const a = await call(env, 'POST', '/activities', { editor: ME, date: '2026-09-12', kind: 'kids', dogs: [{ number: '2024010101' }] });
  assert.equal(a.status, 200);
  const b = await call(env, 'POST', '/activities', { editor: ME, date: '2026-10-11', kind: 'adoption', dogs: [{ number: '2020010101' }, { name: ' 阿福 ' }, { number: '2024032902' }, { name: '阿福' }] });
  assert.equal(b.status, 200);
  assert.match(b.body.activity.id, /^[a-f0-9]{32}$/);
  const all = await list(env);
  assert.deepEqual(all.map(x => [x.date, x.kind, x.revision]), [['2026-10-11', 'adoption', 1], ['2026-09-12', 'kids', 1]]);
  // 舊編號和現在的編號是同一隻，只留一次；同名只有名字的也只留一次
  assert.deepEqual(all[0].dogs.map(d => [d.number, d.name, Boolean(d.dogId)]), [['2024032902', '小白', true], ['', '阿福', false]]);
  assert.deepEqual(await logs(env), [
    [ME, null, { date: '2026-09-12', kind: 'kids', dogs: ['小黑'], dogIds: [true] }],
    [ME, null, { date: '2026-10-11', kind: 'adoption', dogs: ['小白', '阿福'], dogIds: [true, false] }],
  ]);
});

test('修改：帶打開時的 revision 才能改，改完 revision 加 1；別人先改過就擋下、不蓋掉', async () => {
  const env = await makeEnv();
  const { activity } = (await call(env, 'POST', '/activities', { editor: ME, date: '2026-10-11', kind: 'adoption', dogs: [{ name: '阿福' }] })).body;
  const dogId = (await list(env))[0].dogs[0].dogId;
  assert.equal(dogId, null);
  const keepName = { name: '阿福' };
  const r = await call(env, 'PUT', `/activities/${activity.id}`, { editor: '小華', revision: 1, date: '2026-10-12', kind: 'kids', dogs: [keepName, { number: '2024010101' }] });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.activity.date, r.body.activity.kind, r.body.activity.revision, r.body.activity.dogs.map(d => d.name)], ['2026-10-12', 'kids', 2, ['阿福', '小黑']]);
  const stale = await call(env, 'PUT', `/activities/${activity.id}`, { editor: ME, revision: 1, date: '2026-10-13', kind: 'kids', dogs: [] });
  assert.equal(stale.status, 409);
  assert.equal((await list(env))[0].date, '2026-10-12');
  assert.deepEqual((await logs(env))[1], ['小華', { date: '2026-10-11', kind: 'adoption', dogs: ['阿福'], dogIds: [false] }, { date: '2026-10-12', kind: 'kids', dogs: ['阿福', '小黑'], dogIds: [false, true] }]);
  // 用永久 ID 選的狗（例：沒有編號的狗）照樣接上
  const id = (await list(env))[0].dogs[1].dogId;
  const byId = await call(env, 'PUT', `/activities/${activity.id}`, { editor: ME, revision: 2, date: '2026-10-12', kind: 'kids', dogs: [{ dogId: id }] });
  assert.deepEqual(byId.body.activity.dogs.map(d => d.number), ['2024010101']);
});

test('刪除：整場連出席名單一起刪，記改前內容；舊 revision、找不到都擋', async () => {
  const env = await makeEnv();
  const { activity } = (await call(env, 'POST', '/activities', { editor: ME, date: '2026-10-11', kind: 'kids', dogs: [{ number: '2024010101' }] })).body;
  assert.equal((await call(env, 'DELETE', `/activities/${activity.id}`, { editor: ME, revision: 9 })).status, 409);
  const r = await call(env, 'DELETE', `/activities/${activity.id}`, { editor: ME, revision: 1 });
  assert.deepEqual([r.status, r.body.deleted], [200, activity.id]);
  assert.deepEqual(await list(env), []);
  assert.equal(await env.DB.prepare('SELECT COUNT(*) AS n FROM v3_activity_dogs').first('n'), 0);
  assert.deepEqual((await logs(env)).at(-1), [ME, { date: '2026-10-11', kind: 'kids', dogs: ['小黑'], dogIds: [true] }, null]);
  assert.equal((await call(env, 'DELETE', `/activities/${activity.id}`, { editor: ME, revision: 1 })).status, 404);
});

// #745 讀完到寫入之間被別人刪掉：guard 擋下缺列（以前沒狗的修改會靜靜放行、回 200 加一筆紀錄）
test('讀完後活動被別人刪掉：修改回 409 不留紀錄；刪除照舊回成功', async () => {
  const env = await makeEnv();
  let race = null;
  // 只在送出有條件的那個 batch（guard 句是 … IS NOT 1）前插進刪除；讀取也走 batch
  const tag = (st, sql) => ({ ...st, sql, bind: (...args) => tag(st.bind(...args), sql) });
  const racing = { ...env, DB: { ...env.DB, prepare: sql => tag(env.DB.prepare(sql), sql), async batch(list) {
    if (race && list.some(s => /IS NOT 1$/.test(s.sql || ''))) { const f = race; race = null; await f(); }
    return env.DB.batch(list);
  } } };
  const add = async () => (await call(env, 'POST', '/activities', { editor: ME, date: '2026-10-11', kind: 'kids', dogs: [] })).body.activity;
  const gone = id => () => env.DB.prepare('DELETE FROM v3_activities WHERE activity_id=?').bind(id).run();
  const first = await add();
  race = gone(first.id);
  const r = await call(racing, 'PUT', `/activities/${first.id}`, { editor: ME, revision: 1, date: '2026-10-13', kind: 'adoption', dogs: [] });
  assert.deepEqual([r.status, r.body.error], [409, '這場活動剛被別人改過，請重新整理後再改']);
  assert.equal(race, null, '刪除確實插在讀取與寫入之間');
  assert.equal((await logs(env)).length, 1, '只有新增那一筆');
  const second = await add();
  race = gone(second.id);
  assert.equal((await call(racing, 'DELETE', `/activities/${second.id}`, { editor: ME, revision: 1 })).status, 200);
  assert.equal(race, null);
});

test('沒選名字、日期／類型不對、找不到的編號都擋，D1 沒變；預覽版不能存', async () => {
  const env = await makeEnv();
  const bad = async (body, status) => assert.equal((await call(env, 'POST', '/activities', body)).status, status, JSON.stringify(body));
  const ok = { editor: ME, date: '2026-10-11', kind: 'kids', dogs: [] };
  await bad({ ...ok, editor: '' }, 400);
  await bad({ ...ok, date: '2026-02-30' }, 400);
  await bad({ ...ok, date: '2099-01-01' }, 400);
  await bad({ ...ok, kind: 'walk' }, 400);
  await bad({ ...ok, dogs: [{ number: '1999999999' }] }, 400);
  await bad({ ...ok, dogs: [{ name: '字'.repeat(21) }] }, 400);
  await bad({ ...ok, dogs: Array.from({ length: 61 }, (_, i) => ({ name: `狗${i}` })) }, 400);
  assert.equal((await call(env, 'PUT', '/activities/' + 'a'.repeat(32), { ...ok, revision: 1 })).status, 404);
  assert.equal((await call(env, 'PUT', '/activities/' + 'a'.repeat(32), ok)).status, 400);
  assert.equal((await call(env, 'PUT', '/activities/bad', ok)).status, 404);
  assert.equal((await call(env, 'GET', '/activities/' + 'a'.repeat(32))).status, 405);
  assert.deepEqual(await list(env), []);
  assert.deepEqual(await logs(env), []);
  assert.equal((await call({ ...env, PREVIEW: '1' }, 'POST', '/activities', ok)).status, 403);
  assert.equal((await call({}, 'GET', '/activities')).status, 503);
});

test('寫入出錯時整批回復：出席名單寫不進去，活動本身也不改', async () => {
  const env = await makeEnv();
  const { activity } = (await call(env, 'POST', '/activities', { editor: ME, date: '2026-10-11', kind: 'kids', dogs: [{ name: '阿福' }] })).body;
  await env.DB.prepare("CREATE TRIGGER reject_dog BEFORE INSERT ON v3_activity_dogs WHEN NEW.name='壞' BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
  const r = await call(env, 'PUT', `/activities/${activity.id}`, { editor: ME, revision: 1, date: '2026-10-20', kind: 'adoption', dogs: [{ name: '壞' }] });
  assert.equal(r.status, 500);
  const [after] = await list(env);
  assert.deepEqual([after.date, after.kind, after.revision, after.dogs.map(d => d.name)], ['2026-10-11', 'kids', 1, ['阿福']]);
  assert.equal(await env.DB.prepare('SELECT COUNT(*) AS n FROM v3_walk_guard').first('n'), 0);
});

// CODING_STANDARDS「附讀寫量測試」：先用小資料跑，再塞大量無關資料跑，讀寫量一樣
async function readsOf(env) {
  const before = env.DB.stats.rowsRead;
  assert.equal((await call(env, 'GET', '/activities')).status, 200);
  return env.DB.stats.rowsRead - before;
}
// 數送出的寫入句數（一句寫一列）；回傳停止計數的函式
function countWrites(DB) {
  const batch = DB.batch, counter = { n: 0 };
  DB.batch = list => { counter.n += list.length; return batch.call(DB, list); };
  counter.stop = () => { DB.batch = batch; return counter.n; };
  return counter;
}

test('讀取量：沒改時只讀版本號，不隨場次、狗、溜狗紀錄變多；有人改了才重讀', async () => {
  const env = await makeEnv();
  await call(env, 'POST', '/activities', { editor: ME, date: '2026-10-11', kind: 'kids', dogs: [{ number: '2024010101' }, { name: '阿福' }] });
  await readsOf(env);
  const small = await readsOf(env);
  assert.equal(small, 1, '沒改時只讀版本號那 1 列');
  for (let i = 0; i < 300; i++) await env.DB.prepare("INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)").bind(`x${i}`, `無關${i}`).run();
  for (let i = 0; i < 40; i++) {
    await env.DB.prepare('INSERT INTO v3_activities(activity_id,activity_date,kind) VALUES(?,?,?)').bind(`a${i}`, '2025-01-01', 'adoption').run();
    await env.DB.prepare('INSERT INTO v3_activity_dogs VALUES(?,0,?,?)').bind(`a${i}`, `x${i}`, `無關${i}`).run();
  }
  assert.equal((await call(env, 'GET', '/activities')).body.activities.length, 41, '有人改了就重讀');
  assert.equal(await readsOf(env), small, '資料多了，沒改時讀取量一樣');
});

test('寫入量：修改只跟這場的狗數有關，不隨其他場次變多', async () => {
  const env = await makeEnv();
  const writesOfUpdate = async () => {
    const { activity } = (await call(env, 'POST', '/activities', { editor: ME, date: '2026-10-11', kind: 'kids', dogs: [{ name: '甲' }] })).body;
    const counter = countWrites(env.DB);
    await call(env, 'PUT', `/activities/${activity.id}`, { editor: ME, revision: 1, date: '2026-10-11', kind: 'kids', dogs: [{ name: '甲' }, { name: '乙' }] });
    return counter.stop();
  };
  const small = await writesOfUpdate();
  for (let i = 0; i < 40; i++) await call(env, 'POST', '/activities', { editor: ME, date: '2025-01-01', kind: 'adoption', dogs: [{ name: `狗${i}` }] }, `9.9.9.${i}`);
  assert.equal(await writesOfUpdate(), small);
});
