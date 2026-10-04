// 部署前確認 R2 bucket（#130）的測試；不會真的跑 wrangler
// 執行：node --test scripts/r2-bucket.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseJsonc, ensureBucket, FALLBACK_CONFIG } from './r2-bucket.mjs';

test('讀得懂 repo 的 wrangler.jsonc：有 R2 binding、照片和 dogs.json 先經過 Worker', async () => {
  const c = parseJsonc(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(c.name, 'bq-shelter-dogs');
  assert.deepEqual(c.r2_buckets, [{ binding: 'PHOTOS', bucket_name: 'bq-shelter-photos' }]);
  for (const p of ['/api/*', '/photos/*', '/data/dogs.json', '/data/gallery.json']) assert.ok(c.assets.run_worker_first.includes(p), p);
  assert.equal(c.vars.ALLOWED_ORIGINS, 'https://jiatsenk.github.io', '字串裡的 // 不被當成註解');
});

async function withRepo(fn) {
  const root = await mkdtemp(join(tmpdir(), 'r2-bucket-'));
  await writeFile(join(root, 'wrangler.jsonc'), '{\n  // 註解\n  "name": "x", "vars": { "U": "https://a" },\n  "assets": { "directory": ".", "run_worker_first": ["/api/*", "/api", "/photos/*", "/data/dogs.json"] },\n  "r2_buckets": [{ "binding": "PHOTOS", "bucket_name": "b" }],\n}\n');
  try { await fn(root); } finally { await rm(root, { recursive: true }); }
}

test('bucket 已經有：用原本的設定', () => withRepo(async root => {
  const calls = [];
  const r = await ensureBucket({ root, run: a => calls.push(a.join(' ')) });
  assert.equal(r.status, 'exists');
  assert.equal(r.config, 'wrangler.jsonc');
  assert.deepEqual(calls, ['r2 bucket info b']);
}));

test('沒有 bucket、加 --create：建起來', () => withRepo(async root => {
  const r = await ensureBucket({ root, create: true, run: a => { if (a[2] === 'info') throw new Error('not found'); } });
  assert.equal(r.status, 'created');
}));

test('查詢失敗但建立時說已經有了：當作有', () => withRepo(async root => {
  const r = await ensureBucket({ root, create: true, run: a => { const e = new Error('x'); if (a[2] === 'create') e.stderr = 'The bucket you tried to create already exists [code: 10004]'; throw e; } });
  assert.equal(r.status, 'exists');
  assert.equal(r.config, 'wrangler.jsonc');
}));

test('建不起來（或預覽不建）：產生拿掉 R2 的設定，其他照舊', () => withRepo(async root => {
  const r = await ensureBucket({ root, create: true, run: () => { throw new Error('no'); } });
  assert.equal(r.status, 'missing');
  assert.equal(r.config, FALLBACK_CONFIG);
  const c = JSON.parse(await readFile(join(root, FALLBACK_CONFIG), 'utf8'));
  assert.equal(c.r2_buckets, undefined);
  assert.equal(c.vars.U, 'https://a');
  assert.deepEqual(c.assets, { directory: '.', run_worker_first: ['/api/*', '/api'] }, '照片、dogs.json 不再先經過 Worker');
  const calls = [];
  await ensureBucket({ root, run: a => { calls.push(a[2]); throw new Error('no'); } });
  assert.deepEqual(calls, ['info'], '沒有 --create 就不建');
}));
