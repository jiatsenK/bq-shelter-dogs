import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { walkerCode } from '../src/editlog.js';
import { reconcileWalk } from '../src/walk-accept.js';
import { setup, request, post, day } from './walk-fixture.mjs';

// 稽核第 4 項（K 2026-10-26）：網站按溜了在同一批寫入裡記進溜狗紀錄，不等保險掃描。
test.beforeEach(() => worker.testing.resetState());
const dog = { id: '9001', name: '測試狗' };
const history = async (env, date) => (await env.DB.prepare('SELECT walker_code FROM v3_walks WHERE dog_id=? AND walk_date=? ORDER BY position').bind('dog', date).all()).results.map(r => r.walker_code);
const codes = (...names) => Promise.all(names.map(n => walkerCode(n, 'test')));
const seedYesterday = env => env.DB.prepare("INSERT INTO v3_walks(dog_id,walk_date,position,walker_code,dog_number,dog_name) VALUES('dog','2026-10-01',0,?,'9001','測試狗')").bind('old-code').run();

test('按溜了馬上進溜狗紀錄；第二人加入重寫那天；live 版本號跟著跳', async () => {
  const env = await setup();
  try {
    const live = (await env.DB.prepare('SELECT live FROM v3_walk_versions WHERE id=1').first()).live;
    assert.equal((await post(env, request('history-0001'))).status, 200);
    assert.deepEqual(await history(env, day()), await codes('甲'));
    assert.ok((await env.DB.prepare('SELECT live FROM v3_walk_versions WHERE id=1').first()).live > live);
    assert.equal((await post(env, request('history-0002', '乙'))).status, 200);
    assert.deepEqual(await history(env, day()), await codes('甲', '乙'));
  } finally { env.DB.close(); }
});

test('復原刪掉今天那筆，上一次那天不動', async () => {
  const env = await setup();
  try {
    await seedYesterday(env);
    await post(env, request('history-undo-walk'));
    const out = await post(env, request('history-undo', '乙', { action: 'undo', dogs: [{ ...dog, expectedVersion: 1 }] }));
    assert.equal(out.body.results[0].status, 'restored');
    assert.deepEqual(await history(env, day()), []);
    assert.deepEqual(await history(env, '2026-10-01'), ['old-code']);
  } finally { env.DB.close(); }
});

test('改溜狗人照新名單重寫今天', async () => {
  const env = await setup();
  try {
    await post(env, request('history-edit-walk'));
    const out = await post(env, request('history-edit', '乙', { action: 'edit', editor: '丙', dogs: [{ ...dog, expectedVersion: 1 }] }));
    assert.equal(out.status, 200);
    assert.deepEqual(await history(env, day()), await codes('乙'));
  } finally { env.DB.close(); }
});

test('寫溜狗紀錄失敗時整批回復，今日溜狗紀錄也不留', async () => {
  const env = await setup();
  try {
    await env.DB.prepare("CREATE TRIGGER fail_history BEFORE INSERT ON v3_walks BEGIN SELECT RAISE(ABORT,'injected'); END").run();
    assert.equal((await post(env, request('history-fail'))).status, 503);
    assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM v3_walk_state').first()).n, 0);
  } finally { env.DB.close(); }
});

test('網站記了今天後人工改回較早的日子：溜狗紀錄刪掉今天；清空日期不刪', async () => {
  const env = await setup();
  try {
    await post(env, request('history-manual-walk'));
    const out = await reconcileWalk(env.DB, dog, { date: '2026-09-01', walker: '甲' }, env);
    assert.equal(out.changed, true);
    assert.deepEqual(await history(env, day()), []);
  } finally { env.DB.close(); }
  const cleared = await setup();
  try {
    await post(cleared, request('history-clear-walk'));
    await reconcileWalk(cleared.DB, dog, { date: '', walker: '' }, cleared);
    assert.deepEqual(await history(cleared, day()), await codes('甲'));
  } finally { cleared.DB.close(); }
});
