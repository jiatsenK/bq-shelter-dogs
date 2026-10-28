import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendModule } from './frontend-module-test-helper.mjs';

const URL_ = 'https://example.workers.dev';
const load = () => loadFrontendModule('share.js');
const abort = () => Object.assign(new Error('canceled'), { name: 'AbortError' });

test('ADR 0023 有分享選單：帶文字和網址，成功回 share', async () => {
  const { shareSite, SHARE_TEXT } = await load();
  const calls = [];
  assert.equal(await shareSite(URL_, { share: async data => { calls.push(data); } }), 'share');
  assert.equal(JSON.stringify(calls), JSON.stringify([{ text: SHARE_TEXT, url: URL_ }]));
  assert.equal(SHARE_TEXT, '來去板橋動物之家遛狗吧 🐕');
});

test('ADR 0023 取消分享選單（AbortError）不算、也不改成複製', async () => {
  const { shareSite } = await load();
  let copied = false;
  assert.equal(await shareSite(URL_, { share: async () => { throw abort(); }, clipboard: { writeText: async () => { copied = true; } } }), 'cancel');
  assert.equal(copied, false);
});

test('ADR 0023 沒有分享選單或分享失敗：複製文字和網址，成功回 copy', async () => {
  const { shareSite, SHARE_TEXT } = await load();
  const copied = [];
  const clipboard = { writeText: async text => { copied.push(text); } };
  assert.equal(await shareSite(URL_, { clipboard }), 'copy');
  assert.equal(await shareSite(URL_, { share: async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); }, clipboard }), 'copy');
  assert.deepEqual(copied, [SHARE_TEXT + '\n' + URL_, SHARE_TEXT + '\n' + URL_]);
});

test('ADR 0023 分享和複製都不行：回 manual，讓畫面顯示網址', async () => {
  const { shareSite } = await load();
  assert.equal(await shareSite(URL_, {}), 'manual');
  assert.equal(await shareSite(URL_, { clipboard: { writeText: async () => { throw new Error('denied'); } } }), 'manual');
});
