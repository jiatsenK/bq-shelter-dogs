// #460：CPU 驗收用的測速 Worker 在本機 SQLite 跑得通：一批 20 輪派完 200 隻，保險掃描不寫資料，清除後不留測速資料。
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './fakes.mjs';
import { migrateCompactDatabase } from '../../scripts/migrate-compact-db.mjs';
import { benchSql } from '../../scripts/cpu-bench.mjs';
import bench from '../cpu-bench/index.js';

async function exec(DB, sql) {
  for (const line of sql.split('\n').filter(Boolean)) await DB.prepare(line).run();
}
const round = env => bench.fetch(new Request('https://bench.example/cpu-round', { method: 'POST', headers: { 'X-Bench-Key': env.BENCH_KEY } }), env);

test('測速 Worker：兩批各 20 輪派完 200 隻，沒有失敗；清除後不留測速資料', async () => {
  const DB = fakeD1();
  await migrateCompactDatabase(DB);
  const env = { DB, BENCH_KEY: 'bench', SHEET_WRITE_KEY: 'sheet', WALKER_KEY: 'walker', WALK_RETRY_ENABLED: 'true', D1_WALK_NOTIFY: '1',
    SHEET_WRITE_URL: 'https://fake-gas.invalid/exec', SYNC_DAILY_BUDGET: '1000000' };
  assert.equal((await bench.fetch(new Request('https://bench.example/cpu-round', { method: 'POST' }), env)).status, 403);
  await exec(DB, benchSql('seed'));
  for (let batch = 0; batch < 2; batch++) {
    await exec(DB, benchSql('reset'));
    const started = performance.now();
    let out;
    for (let i = 0; i < 20; i++) out = await (await round(env)).json();
    console.log(`本機一輪平均 ${((performance.now() - started) / 20).toFixed(1)} ms（含 SQLite，非 Cloudflare CPU）`);
    assert.equal(out.waiting, 0);
    assert.equal(await DB.prepare("SELECT COUNT(*) n FROM v3_walk_conflicts WHERE dog_key LIKE 'CPU%'").first('n'), 0);
    assert.equal(await DB.prepare("SELECT COUNT(*) n FROM v3_walk_outbox WHERE dog_key LIKE 'CPU%' AND status='synced' AND version=?").bind(batch + 2).first('n'), 200);
  }
  await exec(DB, benchSql('cleanup'));
  for (const t of ['v3_walk_state', 'v3_walk_outbox', 'v3_sheet_main', 'v3_dogs']) assert.equal(await DB.prepare(`SELECT COUNT(*) n FROM ${t}`).first('n'), 0, t);
  assert.equal(await DB.prepare('SELECT payload FROM v3_walk_pack WHERE id=1').first('payload'), '{}');
});

test('測速 Worker 有 CALLBACK 綁定時，回呼走回呼 Worker（分開的呼叫），一隻狗兩次；回呼 Worker 不接 /cpu-round', async () => {
  const DB = fakeD1();
  await migrateCompactDatabase(DB);
  const vars = { DB, SHEET_WRITE_KEY: 'sheet', WALKER_KEY: 'walker', WALK_RETRY_ENABLED: 'true', D1_WALK_NOTIFY: '1',
    SHEET_WRITE_URL: 'https://fake-gas.invalid/exec', SYNC_DAILY_BUDGET: '1000000' };
  const cb = { ...vars, BENCH_ROLE: 'callback' }, paths = [];
  const env = { ...vars, BENCH_KEY: 'bench', CALLBACK: { fetch: req => (paths.push(new URL(req.url).pathname), bench.fetch(req, cb, { waitUntil() {} })) } };
  assert.equal((await bench.fetch(new Request('https://cb.example/cpu-round', { method: 'POST', headers: { 'X-Bench-Key': 'bench' } }), cb)).status, 404);
  await exec(DB, benchSql('seed'));
  await exec(DB, benchSql('reset'));
  const out = await (await round(env)).json();
  assert.equal(paths.length, 20);
  assert.deepEqual([...new Set(paths)].sort(), ['/api/walk-writeback/receipt', '/api/walk-writeback/target']);
  assert.equal(out.waiting, 190, '一輪派十隻');
});
