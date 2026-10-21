// #421 GET /api/edits 可驗證快取：ETag 是最新一筆 id＋筆數，沒變回 304 只讀 1 列，不讀整份紀錄
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { fakeD1 } from './fakes.mjs';
import { migrateCompactDatabase } from '../../scripts/migrate-compact-db.mjs';
import { importCompactDogs } from '../../scripts/import-compact-dogs.mjs';

const SITE = 'https://bq-shelter-dogs.jiatsen-k.workers.dev';

async function makeEnv() {
  const DB = fakeD1();
  await migrateCompactDatabase(DB);
  await importCompactDogs(DB, { syncedAt: '2026-10-15T12:00:00+08:00', dogs: [{ id: '2024032902', name: '測試狗' }] });
  return { DB, WALKER_KEY: 'test-walker-key' };
}

test.beforeEach(t => {
  worker.testing.resetState();
  const real = globalThis.fetch;
  globalThis.fetch = async url => { throw new Error(`不應該連外：${url}`); };
  t.after(() => { globalThis.fetch = real; });
});

const get = (env, path, headers = {}) => worker.fetch(new Request(`${SITE}/api${path}`, { headers: { Origin: SITE, 'CF-Connecting-IP': '1.1.1.1', ...headers } }), env);
const putIntro = (env, text) => worker.fetch(new Request(`${SITE}/api/intro/2024032902`, {
  method: 'PUT', headers: { Origin: SITE, 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.1.1.1' }, body: JSON.stringify({ editor: '小明', text }),
}), env);

test('#421 /api/edits 帶 ETag、可驗證快取；沒變回 304 只讀 1 列', async () => {
  const env = await makeEnv();
  for (let i = 0; i < 5; i++) assert.equal((await putIntro(env, `介紹 ${i}`)).status, 200);
  const first = await get(env, '/edits?limit=200');
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('Cache-Control'), 'private, no-cache');
  const etag = first.headers.get('ETag');
  assert.match(etag, /^"edits-.+"$/);
  assert.equal((await first.json()).edits.length, 5);

  const before = env.DB.stats.rowsRead;
  const same = await get(env, '/edits?limit=200', { 'If-None-Match': etag });
  assert.equal(same.status, 304);
  assert.equal(same.headers.get('ETag'), etag);
  assert.equal(same.headers.get('Cache-Control'), 'private, no-cache');
  assert.equal(same.headers.get('Access-Control-Allow-Origin'), SITE);
  assert.equal(await same.text(), '');
  assert.equal(env.DB.stats.rowsRead - before, 1, '304 只查最新一筆 id');

  // Cloudflare 壓縮時會把 ETag 改成弱 ETag
  assert.equal((await get(env, '/edits?limit=200', { 'If-None-Match': `W/${etag}` })).status, 304);
  assert.equal((await get(env, '/edits?limit=200', { 'If-None-Match': `"other", ${etag}` })).status, 304);
  assert.equal((await get(env, '/edits?limit=200', { 'If-None-Match': '*' })).status, 304);

  // 筆數不同是另一份清單
  const one = await get(env, '/edits?limit=1', { 'If-None-Match': etag });
  assert.equal(one.status, 200);
  assert.notEqual(one.headers.get('ETag'), etag);
});

test('#421 有新編輯時 ETag 改變、回 200 新內容', async () => {
  const env = await makeEnv();
  await putIntro(env, '舊介紹');
  const etag = (await get(env, '/edits')).headers.get('ETag');
  await putIntro(env, '新介紹');
  const res = await get(env, '/edits', { 'If-None-Match': etag });
  assert.equal(res.status, 200);
  assert.notEqual(res.headers.get('ETag'), etag);
  assert.equal((await res.json()).edits[0].after, '新介紹');
});

test('#421 沒有任何編輯也有 ETag；其他 API 仍 no-store', async () => {
  const env = await makeEnv();
  const empty = await get(env, '/edits');
  assert.equal(empty.status, 200);
  assert.ok(empty.headers.get('ETag'));
  assert.equal((await get(env, '/edits', { 'If-None-Match': empty.headers.get('ETag') })).status, 304);
  assert.equal((await get(env, '/rest')).headers.get('Cache-Control'), 'no-store');
});
