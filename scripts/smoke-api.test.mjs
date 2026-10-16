import test from 'node:test';
import assert from 'node:assert/strict';
import { smokeApi, READ_PATHS } from './smoke-api.mjs';

const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });

test('全部 ok:true 就沒有失敗，而且帶 Origin', async () => {
  const seen = [];
  const failures = await smokeApi('https://x.test', { fetchFn: async (url, init) => { seen.push([url, init.headers.Origin]); return reply(200, { ok: true }); } });
  assert.deepEqual(failures, []);
  assert.deepEqual(seen.map(s => s[0]), READ_PATHS.map(p => `https://x.test/api/${p}`));
  assert.ok(seen.every(s => s[1] === 'https://x.test'));
});

test('缺表（503 code:db）列出哪一支、原因', async () => {
  const fetchFn = async url => url.endsWith('/edits') ? reply(503, { ok: false, error: '暫時讀不到編輯紀錄', code: 'db' }) : reply(200, { ok: true });
  assert.deepEqual(await smokeApi('https://x.test', { fetchFn, tries: 2, waitMs: 0 }), ['/api/edits：503 暫時讀不到編輯紀錄（db）']);
});

test('剛部署完第一次失敗、重試成功就算過', async () => {
  let n = 0;
  const fetchFn = async url => (url.endsWith('/dogs') && n++ === 0) ? reply(500, null) : reply(200, { ok: true });
  assert.deepEqual(await smokeApi('https://x.test', { fetchFn, tries: 2, waitMs: 0 }), []);
});

test('連線錯誤也算失敗', async () => {
  const failures = await smokeApi('https://x.test', { fetchFn: async () => { throw new Error('連不上'); }, tries: 1, waitMs: 0 });
  assert.equal(failures.length, READ_PATHS.length);
  assert.match(failures[0], /連不上/);
});
