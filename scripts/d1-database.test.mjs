// 部署前準備資料庫（D1）：找得到就用、沒有就建、空的才匯入；失敗就不帶資料庫部署
// 執行：node --test scripts/d1-database.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDatabase, parseJsonOutput, findDatabase, withD1, DB_NAME, DEPLOY_CONFIG } from './d1-database.mjs';

async function repo(config = '{\n  // 註解\n  "name": "x",\n  "r2_buckets": [{ "binding": "PHOTOS", "bucket_name": "b" }],\n}\n') {
  const root = await mkdtemp(join(tmpdir(), 'bq-d1-'));
  await writeFile(join(root, 'wrangler.jsonc'), config);
  await mkdir(join(root, 'db'));
  return root;
}
// 假的 wrangler：list 回 dbs；execute 的 COUNT 回 count；記下所有呼叫
function fake({ dbs = [], count = 0, fail = '' } = {}) {
  const calls = [];
  const run = args => {
    calls.push(args.join(' '));
    const cmd = args.slice(0, 2).join(' ');
    if (fail && args.join(' ').includes(fail)) { const e = new Error('boom'); e.stderr = 'Authentication error [code: 10000]\n'; throw e; }
    if (cmd === 'd1 list') return `some notice\n${JSON.stringify(dbs)}`;
    if (cmd === 'd1 create') { dbs.push({ uuid: 'new-id', name: args[2] }); return 'created'; }
    if (cmd === 'd1 execute' && args.includes('--command')) return JSON.stringify([{ results: [{ n: count }], success: true }]);
    return '';
  };
  return { run, calls };
}

test('wrangler 的 JSON 輸出前面有提示也讀得懂；照名字找資料庫', () => {
  assert.deepEqual(parseJsonOutput('⛅️ wrangler\n[{"a":1}]'), [{ a: 1 }]);
  assert.throws(() => parseJsonOutput('nothing'));
  assert.equal(findDatabase([{ uuid: 'u1', name: 'other' }, { uuid: 'u2', name: DB_NAME }]), 'u2');
  assert.equal(findDatabase([{ uuid: 'u1', name: 'other' }]), '');
  assert.deepEqual(withD1({ name: 'x' }, 'u2').d1_databases, [{ binding: 'DB', database_name: DB_NAME, database_id: 'u2' }]);
});

test('已經有資料庫、裡面有資料：套資料表、不重複匯入；部署設定加上 d1_databases，原本的設定（R2）照留', async () => {
  const root = await repo();
  const { run, calls } = fake({ dbs: [{ uuid: 'abc', name: DB_NAME }], count: 120 });
  let seeded = false;
  const r = await ensureDatabase({ run, root, seed: async () => { seeded = true; return ''; } });
  assert.deepEqual([r.config, r.status, r.id, seeded], [DEPLOY_CONFIG, 'exists', 'abc', false]);
  const cfg = JSON.parse(await readFile(join(root, DEPLOY_CONFIG), 'utf8'));
  assert.deepEqual([cfg.name, cfg.r2_buckets[0].bucket_name, cfg.d1_databases[0].database_id], ['x', 'b', 'abc']);
  assert.ok(calls.some(c => c.includes('--file db/schema.sql') && c.includes('--remote') && c.includes(`--config ${DEPLOY_CONFIG}`)));
  assert.ok(!calls.some(c => c.startsWith('d1 create') || c.includes('seed.sql')));
});

test('沒有資料庫：建起來、套資料表、空的就匯入一次', async () => {
  const root = await repo();
  const { run, calls } = fake({ dbs: [], count: 0 });
  const r = await ensureDatabase({ run, root, seed: async () => 'INSERT INTO kv VALUES (1);\n' });
  assert.deepEqual([r.status, r.id], ['created-seeded', 'new-id']);
  assert.equal(await readFile(join(root, 'db/seed.sql'), 'utf8'), 'INSERT INTO kv VALUES (1);\n');
  assert.deepEqual(calls.map(c => c.split(' ').slice(0, 2).join(' ')), ['d1 list', 'd1 create', 'd1 list', 'd1 execute', 'd1 execute', 'd1 execute']);
  assert.ok(calls.at(-1).includes('--file db/seed.sql'));
});

test('token 沒有 D1 權限：不帶資料庫，照上一步的設定部署，不丟錯', async () => {
  const root = await repo();
  await writeFile(join(root, 'wrangler.no-r2.json'), '{"name":"x"}');
  const { run } = fake({ fail: 'd1 list' });
  const r = await ensureDatabase({ run, root, config: 'wrangler.no-r2.json' });
  assert.deepEqual([r.config, r.status], ['wrangler.no-r2.json', 'missing']);
  assert.match(r.error, /Authentication error/);
  await assert.rejects(readFile(join(root, DEPLOY_CONFIG), 'utf8'));
});

test('資料庫在、建表失敗：還是帶著資料庫部署，下次再試', async () => {
  const root = await repo();
  const { run } = fake({ dbs: [{ uuid: 'abc', name: DB_NAME }], fail: 'schema.sql' });
  const r = await ensureDatabase({ run, root });
  assert.deepEqual([r.config, r.status, r.id], [DEPLOY_CONFIG, 'schema-failed', 'abc']);
});
