// 照片搬到 R2（#130）搬遷程式的測試：真的跑 Worker 程式，但 R2、舊檔、GitHub 都是假的
// 執行：node --test scripts/migrate-photos-r2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import worker from '../worker/src/index.js';
import { fakeR2, fakeAssets } from '../worker/test/fakes.mjs';
import { migrate, listPhotos, BATCH } from './migrate-photos-r2.mjs';

const SITE = 'https://bq.example.workers.dev';
const jpeg = n => new Uint8Array([0xff, 0xd8, 0xff, n]);

async function repo(files) {
  const root = await mkdtemp(join(tmpdir(), 'r2-migrate-'));
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), bytes);
  }
  return root;
}

function site(assets, env = {}) {
  const PHOTOS = fakeR2();
  const e = { NOTES_PASSCODE: '密', PHOTOS, ASSETS: fakeAssets(assets), ...env };
  globalThis.fetch = async () => new Response(JSON.stringify({ sha: 'g', content: Buffer.from('{}').toString('base64') }));
  const fetchImpl = (url, init) => worker.fetch(new Request(url, init), e);
  return { PHOTOS, fetchImpl };
}

test.beforeEach(() => { worker.testing.resetState(); worker.testing.r2.resetR2State(); });

test('清點：原圖在前、縮圖在後，附 sha256 和大小', async () => {
  const root = await repo({ 'photos/thumbs/1.jpg': jpeg(1), 'photos/1.jpg': jpeg(2), 'photos/gallery/1/20260101-000000-abcd.jpg': jpeg(3), 'photos/readme.txt': 'x' });
  const items = await listPhotos(root);
  assert.deepEqual(items.map(i => i.path), ['photos/1.jpg', 'photos/gallery/1/20260101-000000-abcd.jpg', 'photos/thumbs/1.jpg']);
  assert.equal(items[0].size, 4);
  assert.match(items[0].sha256, /^[0-9a-f]{64}$/);
  await rm(root, { recursive: true });
});

test('整批搬遷：分批送、全部複製、逐檔核對；重跑只顯示 R2 已有', async () => {
  const files = {};
  for (let i = 1; i <= BATCH + 3; i++) files[`photos/${2020000000 + i}.jpg`] = jpeg(i);
  files['photos/thumbs/2020000001.jpg'] = jpeg(99);
  const root = await repo(files);
  const { PHOTOS, fetchImpl } = site(files);
  const logs = [];
  const r = await migrate({ root, site: SITE, passcode: '密', fetchImpl, log: m => logs.push(m) });
  assert.equal(r.ok, true);
  assert.equal(r.total, BATCH + 4);
  assert.deepEqual(r.copied, { copied: BATCH + 4 });
  assert.deepEqual(r.verified, { ok: BATCH + 4 });
  assert.match(r.summary, /每一張都核對過/);
  assert.equal([...PHOTOS.objects.keys()].filter(k => k.startsWith('photos/')).length, BATCH + 4);

  const again = await migrate({ root, site: SITE, passcode: '密', fetchImpl, log: () => {} });
  assert.deepEqual(again.copied, { exists: BATCH + 4 });
  assert.equal(again.ok, true);
  await rm(root, { recursive: true });
});

test('部署上去的舊檔跟 repo 不一樣、或找不到：結果標錯、ok 是 false', async () => {
  const root = await repo({ 'photos/1.jpg': jpeg(1), 'photos/2.jpg': jpeg(2) });
  const { fetchImpl } = site({ 'photos/1.jpg': jpeg(7) });
  const r = await migrate({ root, site: SITE, passcode: '密', fetchImpl, log: () => {} });
  assert.equal(r.ok, false);
  assert.deepEqual(r.copied, { mismatch: 1, missing: 1 });
  assert.match(r.summary, /photos\/1\.jpg（內容不符）/);
  await rm(root, { recursive: true });
});

test('通關碼不對：直接失敗，不重試', async () => {
  const root = await repo({ 'photos/1.jpg': jpeg(1) });
  const { fetchImpl } = site({ 'photos/1.jpg': jpeg(1) });
  await assert.rejects(migrate({ root, site: SITE, passcode: '錯', fetchImpl, log: () => {} }), /HTTP 401/);
  await rm(root, { recursive: true });
});
