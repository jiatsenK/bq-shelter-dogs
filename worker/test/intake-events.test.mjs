import { currentEditRevision } from './edit-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { fakeD1 } from './fakes.mjs';
import { createCompactDatabase } from '../../scripts/compact-schema.mjs';
import { importCompactDogs } from './compact-fixtures.mjs';

const site = 'https://bq-shelter-dogs.example.workers.dev';
async function setup(t) {
  const DB = fakeD1();
  t.after(() => DB.close());
  await createCompactDatabase(DB);
  await importCompactDogs(DB, { dogs: [
    { id: '2024022801', name: '測試狗', formerIds: ['2019042401'] },
    { id: '2017090505', name: '別隻狗' },
  ] });
  worker.testing.resetState();
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('入所介紹不應連外或寫試算表'); };
  t.after(() => { globalThis.fetch = original; });
  return { DB, WALKER_KEY: 'test-key' };
}
async function call(env, method, path, body) {
  if(body&&typeof body==='object')body={...body,revision:await currentEditRevision(env.DB,path)};
  const response = await worker.fetch(new Request(site + '/api' + path, {
    method, headers: { Origin: site, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: response.status, ...await response.json() };
}

test('#285 入所事件日期獨立於編號、缺事件留空，從舊編號存後新編號可讀回且原介紹保留', async t => {
  const env = await setup(t);
  const text = '2019/4/24 被棄養。2023/2/23 被認養，2/28 退回（年份未確認）。';
  await call(env, 'PUT', '/intro/2024022801', { editor: '測試志工', text });
  const events = [
    { number: '2019042401', date: '2019-04-24', event: '被棄養入所' },
    { number: '2024022801', date: '', event: '' },
    { number: '', date: '2023-02-23', event: '被認養' },
  ];
  const saved = await call(env, 'PUT', '/intro/2019042401', { editor: '測試志工', text, events });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.intakeEvents, events);
  const dogs = (await call(env, 'GET', '/dogs')).dogs;
  assert.equal(dogs[0].intro, text);
  assert.deepEqual(dogs[0].intakeEvents, events);
  assert.equal(dogs[1].intakeEvents, undefined);
  const latest = (await call(env, 'GET', '/edits')).edits[0];
  assert.deepEqual(latest.after, { text, events });
  await call(env, 'PUT', '/intro/2024022801', { editor: '測試志工', text: '舊版編輯器只改原介紹' });
  assert.deepEqual((await call(env, 'GET', '/dogs')).dogs[0].intakeEvents, events, '舊版編輯器不清掉逐次紀錄');
  await importCompactDogs(env.DB, { dogs: [
    { id: '2025010101', name: '測試狗', formerIds: ['2019042401', '2024022801'] },
    { id: '2017090505', name: '別隻狗' },
  ] });
  const reentered = (await call(env, 'GET', '/dogs')).dogs.find(d => d.id === '2025010101');
  assert.deepEqual(reentered.intakeEvents, events, '再入所換編號不遺失事件');
});

test('#285 擋下別隻狗的編號、錯誤日期、過量資料；失敗不改原介紹與事件，未選身分或預覽版不能存', async t => {
  const env = await setup(t);
  const events = [{ number: '2024022801', date: '2023-02-28', event: '' }];
  const body = { editor: '測試志工', text: '保留原文', events };
  assert.equal((await call(env, 'PUT', '/intro/2024022801', body)).status, 200);
  for (const bad of [
    [{ number: '2017090505', date: '', event: '' }],
    [{ number: '', date: '2023-02-29', event: '' }],
    [{ number: '', date: '2023/02/28', event: '' }],
    [{ number: '', date: '', event: '字'.repeat(1001) }],
    Array.from({ length: 31 }, () => ({ number: '', date: '', event: '' })),
    [null],
  ]) {
    assert.equal((await call(env, 'PUT', '/intro/2024022801', { ...body, text: '不能寫入', events: bad })).status, 400);
  }
  assert.equal((await call(env, 'PUT', '/intro/2024022801', { ...body, editor: '' })).status, 400);
  assert.equal((await call({ ...env, PREVIEW: '1' }, 'PUT', '/intro/2024022801', body)).status, 403);
  const dog = (await call(env, 'GET', '/dogs')).dogs[0];
  assert.equal(dog.intro, '保留原文');
  assert.deepEqual(dog.intakeEvents, events);
});

test('#285 新表尚未由同步建立時，狗清單與原介紹仍可讀；事件儲存失敗不覆寫原介紹', async t => {
  const env = await setup(t);
  await call(env, 'PUT', '/intro/2024022801', { editor: '測試志工', text: '原介紹' });
  await env.DB.prepare('DROP TABLE v3_intake_events').run();
  const read = await call(env, 'GET', '/dogs');
  assert.equal(read.status, 200);
  assert.equal(read.dogs[0].intro, '原介紹');
  assert.equal((await call(env, 'PUT', '/intro/2024022801', { editor: '測試志工', text: '不能改掉', events: [] })).status, 500);
  assert.equal((await call(env, 'GET', '/dogs')).dogs[0].intro, '原介紹');
});
