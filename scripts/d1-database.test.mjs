// #214 驗證部署準備的外部行為，不呼叫正式 Cloudflare。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureDatabase, parseJsonOutput, findDatabase, DB_NAME, DEPLOY_CONFIG, PREVIEW_CONFIG } from './d1-database.mjs';

const production = { binding: 'DB', database_name: DB_NAME, database_id: 'prod-id', preview_database_id: 'test-id' };
const testing = { binding: 'DB', database_name: 'bq-shelter-dogs-test', database_id: 'test-id' };
async function repo(binding = production) {
  const root = await mkdtemp(join(tmpdir(), 'bq-d1-'));
  await writeFile(join(root, 'wrangler.jsonc'), JSON.stringify({ name: 'x', r2_buckets: [{ binding: 'PHOTOS', bucket_name: 'photos' }], vars: { GITHUB_BRANCH: 'main' }, d1_databases: binding ? [binding] : [] }));
  await writeFile(join(root, 'wrangler.preview-db.jsonc'), JSON.stringify({ d1_databases: [testing] }));
  return root;
}
function fake({ dbs = [ { uuid: 'prod-id', name: DB_NAME }, { uuid: 'test-id', name: testing.database_name } ], fail = '', probe = [{ success: true, results: [{ ok: 1 }] }] } = {}) {
  const calls = [];
  const run = args => {
    calls.push(args);
    if (fail && args.join(' ').includes(fail)) throw new Error('authentication failure');
    if (args[1] === 'list') return `notice\n${JSON.stringify(dbs)}`;
    if (args[1] === 'execute') return JSON.stringify(probe);
    throw new Error('Unexpected Cloudflare mutation');
  };
  return { run, calls };
}

test('Wrangler 的 JSON 提示與資料庫名稱查找', () => {
  assert.deepEqual(parseJsonOutput('⛅️ wrangler\n[{"a":1}]'), [{ a: 1 }]);
  assert.throws(() => parseJsonOutput('nothing'));
  assert.equal(findDatabase([{ uuid: 'u1', name: 'other' }, { uuid: 'u2', name: DB_NAME }]), 'u2');
  assert.equal(findDatabase([]), '');
});

test('#214 正式部署不管空庫或有資料，都只查證不建表／匯入', async () => {
  const root = await repo();
  const { run, calls } = fake();
  const result = await ensureDatabase({ root, run });
  assert.equal(result.config, DEPLOY_CONFIG);
  const cfg = JSON.parse(await readFile(join(root, result.config), 'utf8'));
  assert.deepEqual(cfg.d1_databases, [{ binding: 'DB', database_name: DB_NAME, database_id: 'prod-id' }]);
  assert.equal(cfg.r2_buckets[0].bucket_name, 'photos');
  assert.equal(cfg.vars.PREVIEW, undefined);
  assert.deepEqual(calls, [['d1', 'list', '--json'], ['d1', 'execute', DB_NAME, '--remote', '--json', '--config', DEPLOY_CONFIG, '--command', 'SELECT 1 AS ok']]);
  await assert.rejects(readFile(join(root, 'db/seed.sql'), 'utf8'), /ENOENT/);
});

test('#214 預覽只查證隔離測試庫，保留 R2 並強制 PREVIEW', async () => {
  const root = await repo();
  const { run, calls } = fake();
  const result = await ensureDatabase({ root, run, preview: true });
  const cfg = JSON.parse(await readFile(join(root, result.config), 'utf8'));
  assert.equal(result.config, PREVIEW_CONFIG);
  assert.deepEqual(cfg.d1_databases, [testing]);
  assert.equal(cfg.vars.PREVIEW, '1');
  assert.equal(cfg.vars.GITHUB_BRANCH, 'main');
  assert.equal(cfg.r2_buckets[0].bucket_name, 'photos');
  assert.equal(calls[1][2], testing.database_name);
});

for (const [title, options] of [ ['不存在', { dbs: [] }], ['名稱對但 ID 不符', { dbs: [{ uuid: 'other-id', name: DB_NAME }] }], ['查證失敗', { fail: 'd1 list' }], ['唯讀查詢失敗', { fail: 'd1 execute' }], ['查詢回失敗', { probe: [{ success: false, results: [{ ok: 1 }] }] }], ['查詢不完整', { probe: [] }] ]) {
  test(`#214 D1 ${title}會停止，不建立或降級`, async () => {
    const root = await repo();
    const { run, calls } = fake(options);
    await assert.rejects(ensureDatabase({ root, run }), /停止部署/);
    assert.ok(calls.every(c => c[1] === 'list' || (c[1] === 'execute' && c.at(-1) === 'SELECT 1 AS ok')));
  });
}

test('#214 預覽若指向正式 ID 或同名即停止，不接觸 Cloudflare', async () => {
  for (const bad of [{ ...testing, database_id: production.database_id }, { ...testing, database_name: production.database_name }]) {
    const root = await repo();
    await writeFile(join(root, 'wrangler.preview-db.jsonc'), JSON.stringify({ d1_databases: [bad] }));
    await assert.rejects(ensureDatabase({ root, preview: true, run: () => assert.fail('must not query') }), /預覽不能使用正式 D1/);
  }
});

test('#214 缺少正式 DB 的 CLI 以失敗結束，沒有可繼續部署的輸出', async () => {
  const root = await repo(null);
  const script = fileURLToPath(new URL('./d1-database.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /停止部署/);
  assert.equal(result.stdout, '');
});
