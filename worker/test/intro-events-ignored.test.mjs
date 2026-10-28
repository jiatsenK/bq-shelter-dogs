import { currentEditRevision } from './edit-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { fakeD1 } from './fakes.mjs';
import { createCompactDatabase } from '../../scripts/compact-schema.mjs';
import { importCompactDogs } from './compact-fixtures.mjs';

// ADR 0022（#667）：入所事件（#285）不再讀寫；表留到下一張 PR 才 DROP。舊版網頁快取還會在存介紹時送 events，不能壞
const site = 'https://bq-shelter-dogs.example.workers.dev';
async function setup(t) {
  const DB = fakeD1();
  t.after(() => DB.close());
  await createCompactDatabase(DB);
  await importCompactDogs(DB, { dogs: [{ id: '2024022801', name: '測試狗', formerIds: ['2019042401'] }] });
  worker.testing.resetState();
  return { DB, WALKER_KEY: 'test-key' };
}
async function call(env, method, path, body) {
  if (body && typeof body === 'object') body = { ...body, revision: await currentEditRevision(env.DB, path) };
  const response = await worker.fetch(new Request(site + '/api' + path, {
    method, headers: { Origin: site, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: response.status, ...await response.json() };
}

test('存介紹：舊網頁送的 events 收下不理，不寫入所事件；狗清單、回應、修改紀錄都不帶入所事件', async t => {
  const env = await setup(t);
  await env.DB.prepare("INSERT INTO v3_intake_events(dog_id,position,number,event_date,event) SELECT dog_id,0,'2019042401','2019-04-24','舊事件' FROM v3_dog_numbers WHERE number='2019042401'").run();
  const events = [{ number: '2017090505', date: '2023-02-29', event: '格式不對也不管' }];
  const saved = await call(env, 'PUT', '/intro/2024022801', { editor: '測試志工', text: '親人，喜歡散步', events });
  assert.equal(saved.status, 200);
  assert.equal(saved.intro, '親人，喜歡散步');
  assert.equal(saved.intakeEvents, undefined);
  const [row] = (await env.DB.prepare('SELECT event FROM v3_intake_events').all()).results;
  assert.equal(row.event, '舊事件', '入所事件表不動');
  const dog = (await call(env, 'GET', '/dogs')).dogs[0];
  assert.equal(dog.intro, '親人，喜歡散步');
  assert.equal(dog.intakeEvents, undefined);
  assert.deepEqual((await call(env, 'GET', '/edits')).edits[0].after, '親人，喜歡散步', '修改紀錄只記介紹文字');
  assert.equal((await call(env, 'PUT', '/intro/2024022801', { editor: '測試志工', text: '親人', other: 1 })).status, 400, '其他欄位照樣擋');
});

test('入所事件表已經 DROP（下一張 PR）時，狗清單與存介紹照常', async t => {
  const env = await setup(t);
  await env.DB.prepare('DROP TABLE v3_intake_events').run();
  assert.equal((await call(env, 'PUT', '/intro/2024022801', { editor: '測試志工', text: '原介紹', events: [] })).status, 200);
  const read = await call(env, 'GET', '/dogs');
  assert.equal(read.status, 200);
  assert.equal(read.dogs[0].intro, '原介紹');
});
