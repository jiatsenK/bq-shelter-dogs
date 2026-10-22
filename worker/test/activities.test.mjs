// #270 活動紀錄（ADR 0002）：任何選好名字的人都能新增、修改、刪除，記編輯紀錄；舊名單匯入
// 執行：node --test worker/test/activities.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { fakeD1 } from './fakes.mjs';
import { migrateCompactDatabase } from '../../scripts/migrate-compact-db.mjs';
import { importCompactDogs } from '../../scripts/import-compact-dogs.mjs';
import { parseCsv, planActivityImport, importSql } from '../../scripts/import-activities.mjs';

const SITE = 'https://bq-shelter-dogs.jiatsen-k.workers.dev';
async function setup(t) {
  worker.testing.resetState();
  const DB = fakeD1(); t.after(() => DB.close());
  await migrateCompactDatabase(DB);
  await importCompactDogs(DB, { dogs: [{ id: '2024032902', name: '甲' }, { id: '2024010101', name: '乙' }, { id: '2024010102', name: '乙' }] });
  return { DB, WALKER_KEY: 'test-key' };
}
async function call(env, method, path, body) {
  const res = await worker.fetch(new Request(`${SITE}/api${path}`, {
    method, headers: { Origin: SITE, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: res.status, body: await res.json() };
}
const list = async env => (await call(env, 'GET', '/activities')).body.activities;
const edits = async env => (await call(env, 'GET', '/edits')).body.edits.filter(e => e.kind === 'activity');

test('活動紀錄：新增、修改、刪除都讀得回來，並記編輯紀錄', async t => {
  const env = await setup(t);
  const made = await call(env, 'POST', '/activities', { editor: '小明', date: '2026-10-12', kind: 'adoption', dogs: [{ number: '2024032902' }, { name: '舊名單小黑' }, { number: '2024032902' }] });
  assert.equal(made.status, 200);
  const id = made.body.activity.id;
  assert.deepEqual(await list(env), [{ id, date: '2026-10-12', kind: 'adoption', dogs: [
    { dogId: made.body.activity.dogs[0].dogId, name: '甲', number: '2024032902' },
    { dogId: null, name: '舊名單小黑', number: '' },
  ] }]);
  await call(env, 'POST', '/activities', { editor: '小明', date: '2026-09-01', kind: 'kids', dogs: [] });

  const changed = await call(env, 'PUT', `/activities/${id}`, { editor: '小華', date: '2026-10-13', kind: 'kids', dogs: [{ dogId: made.body.activity.dogs[0].dogId }, { number: '2024010101' }] });
  assert.equal(changed.status, 200);
  const after = await list(env);
  assert.deepEqual(after.map(a => [a.date, a.kind, a.dogs.map(d => d.name)]), [['2026-10-13', 'kids', ['甲', '乙']], ['2026-09-01', 'kids', []]]);

  assert.equal((await call(env, 'DELETE', `/activities/${id}`, { editor: '小華' })).status, 200);
  assert.deepEqual((await list(env)).map(a => a.date), ['2026-09-01']);
  assert.equal((await call(env, 'DELETE', `/activities/${id}`, { editor: '小華' })).status, 404);

  const log = await edits(env);
  assert.deepEqual(log.map(e => [e.editorName, e.before && e.before.date, e.after && e.after.date]), [
    ['小華', '2026-10-13', null], ['小華', '2026-10-12', '2026-10-13'], ['小明', null, '2026-09-01'], ['小明', null, '2026-10-12'],
  ]);
  assert.equal(log[0].kindLabel, '活動紀錄');
});

test('活動紀錄：沒選名字、格式錯、找不到狗、預覽版都不寫入', async t => {
  const env = await setup(t);
  const ok = { editor: '小明', date: '2026-10-12', kind: 'adoption', dogs: [] };
  assert.equal((await call(env, 'POST', '/activities', { ...ok, editor: '' })).body.code, 'editor');
  for (const bad of [{ date: '2026/10/12' }, { date: '2026-13-40' }, { kind: 'party' }, { dogs: [{ number: '9999' }] }, { dogs: [{ name: '' }] }, { dogs: 'x' }]) {
    assert.equal((await call(env, 'POST', '/activities', { ...ok, ...bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call({ ...env, PREVIEW: '1' }, 'POST', '/activities', ok)).status, 403);
  assert.equal((await call(env, 'PUT', '/activities/abc', ok)).status, 404);
  assert.equal((await call(env, 'PATCH', '/activities/abc', ok)).status, 405);
  assert.deepEqual(await list(env), []);
  assert.deepEqual(await edits(env), []);
});

test('舊名單匯入：完全同名且只有一隻才接上，其他列出並只存名字；D1 已有的場次跳過', async t => {
  const env = await setup(t);
  await call(env, 'POST', '/activities', { editor: '小明', date: '2026-01-05', kind: 'kids', dogs: [] });
  const rows = parseCsv('日期,活動類型,狗名\n2026/3/8,認養會,甲\n2026/3/8,認養會,乙\n2026-03-08,認養會,小黑\n2026-03-08,認養會,甲\n2026-01-05,動保小小兵,甲\n壞,認養會,甲\n');
  const dogs = (await env.DB.prepare('SELECT dog_id,name FROM v3_dogs').all()).results;
  const existing = (await env.DB.prepare('SELECT activity_date,kind FROM v3_activities').all()).results;
  const plan = planActivityImport(rows, dogs, existing);
  assert.deepEqual(plan.unmatched.map(u => [u.name, u.reason]), [['乙', '同名 2 隻'], ['小黑', '找不到']]);
  assert.deepEqual(plan.skipped, ['2026-01-05|kids']);
  assert.equal(plan.errors.length, 1);
  for (const s of importSql(plan.activities).trim().split('\n')) await env.DB.prepare(s).run();
  const imported = (await list(env)).find(a => a.date === '2026-03-08');
  assert.deepEqual(imported.dogs.map(d => [d.name, Boolean(d.dogId)]), [['甲', true], ['乙', false], ['小黑', false]]);
});
