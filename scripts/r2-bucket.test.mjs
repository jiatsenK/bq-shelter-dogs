// #214 部署前確認 R2 的公開入口；不呼叫 Cloudflare。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseJsonc, ensureBucket } from './r2-bucket.mjs';

test('讀得懂正式 R2 綁定與 JSONC 字串中的網址', async () => {
  const c = parseJsonc(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(c.name, 'bq-shelter-dogs');
  assert.deepEqual(c.r2_buckets, [{ binding: 'PHOTOS', bucket_name: 'bq-shelter-photos' }]);
  for (const p of ['/api/*', '/photos/*', '/data/dogs.json']) assert.ok(c.assets.run_worker_first.includes(p));
  assert.equal(parseJsonc('{\n // comment\n "u": "https://a"\n}').u, 'https://a');
});
async function withRepo(fn, buckets = [{ binding: 'PHOTOS', bucket_name: 'photos' }]) {
  const root = await mkdtemp(join(tmpdir(), 'r2-bucket-'));
  await writeFile(join(root, 'wrangler.jsonc'), JSON.stringify({ name: 'x', r2_buckets: buckets }));
  try { await fn(root); } finally { await rm(root, { recursive: true }); }
}

test('#214 R2 存在只做 info，保留綁定，不建立資源', () => withRepo(async root => {
  const calls = [];
  const result = await ensureBucket({ root, run: args => calls.push(args) });
  assert.equal(result.config, 'wrangler.jsonc');
  assert.deepEqual(calls, [['r2', 'bucket', 'info', 'photos']]);
  assert.equal(JSON.parse(await readFile(join(root, result.config), 'utf8')).r2_buckets[0].bucket_name, 'photos');
}));

test('#214 R2 查證失敗停止部署，不建立或移除綁定', () => withRepo(async root => {
  const calls = [];
  await assert.rejects(ensureBucket({ root, run: args => { calls.push(args); throw new Error('missing or authentication'); } }), /停止部署/);
  assert.deepEqual(calls, [['r2', 'bucket', 'info', 'photos']]);
  await assert.rejects(readFile(join(root, 'wrangler.no-r2.json'), 'utf8'), /ENOENT/);
  assert.equal(JSON.parse(await readFile(join(root, 'wrangler.jsonc'), 'utf8')).r2_buckets.length, 1);
}));

test('#214 缺少 PHOTOS 綁定停止，不查 Cloudflare', () => withRepo(async root => {
  await assert.rejects(ensureBucket({ root, run: () => assert.fail('must not query') }), /停止部署/);
}, []));

test('#214 所有 R2 綁定都必須查證成功', () => withRepo(async root => {
  const calls = [];
  await assert.rejects(ensureBucket({ root, run: args => { calls.push(args); if (args[3] === 'extra') throw new Error('missing'); } }), /停止部署/);
  assert.equal(calls.length, 2);
}, [{ binding: 'PHOTOS', bucket_name: 'photos' }, { binding: 'EXTRA', bucket_name: 'extra' }]));

test('#214 舊 --create CLI 會失敗，不再自動建立 bucket', () => withRepo(async root => {
  const script = fileURLToPath(new URL('./r2-bucket.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--create'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /停止部署/);
  assert.equal(result.stdout, '');
}));
