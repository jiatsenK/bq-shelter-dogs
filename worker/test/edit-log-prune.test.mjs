// 修改紀錄保留 14 天（ADR 0004 修訂：保留 14 天）：合併狗快照永久保留，其他超過 14 天就清。
// 執行：node --test worker/test/edit-log-prune.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { editLogWrites, pruneEdits, readEdits } from '../src/editlog.js';
import { readCronStatus } from '../src/admin/checks.js';
import { setup } from './walk-fixture.mjs';

const NOW = Date.parse('2026-10-28T02:00:00.000Z');
const OLD = '2026-10-14T01:59:59.000Z'; // 14 天又 1 秒前
const RECENT = '2026-10-14T02:00:01.000Z'; // 差 1 秒滿 14 天
const add = (db, at, kind, extra = {}) => db.batch(editLogWrites(db, { at, name: '甲', kind, before: null, after: kind, source: 'volunteer', ...extra }));

test('超過 14 天的操作紀錄連同管理者來源一起清；合併、取消合併永久保留', async () => {
  const env = await setup();
  try {
    await add(env.DB, OLD, 'note');
    await add(env.DB, OLD, 'activity', { source: 'access', actor: { requestId: 'r1', subject: 's', email: 'e@example.com' } });
    await add(env.DB, OLD, 'merge', { source: 'access' });
    await add(env.DB, OLD, 'unmerge', { source: 'access' });
    await add(env.DB, RECENT, 'rest');
    assert.equal(await pruneEdits(env.DB, NOW), 2);
    assert.deepEqual((await readEdits(env.DB)).map(e => e.kind), ['rest', 'unmerge', 'merge']);
    assert.equal(await pruneEdits(env.DB, NOW), 0, '清過一次再跑不會多清');
  } finally { env.DB.close(); }
});

// 每天第一次保險掃描（UTC 01:23＝台灣 09:23）順便清，其他兩次不清；跑完記 cron_editlog 給管理網站資料檢查看
async function run(env, at) {
  const tasks = [];
  await worker.scheduled({ scheduledTime: at, cron: '23 1,5,15 * * *' }, env, { waitUntil: p => tasks.push(p) });
  await Promise.allSettled(tasks);
}

test('排程：每天第一次保險掃描清一次並記錄，其他時段不清', async () => {
  const env = await setup();
  try {
    await add(env.DB, '2026-10-01T00:00:00.000Z', 'note');
    await run(env, Date.parse('2026-10-28T05:23:00.000Z'));
    assert.equal((await readEdits(env.DB)).length, 1, '台灣 13:23 那次不清');
    await run(env, Date.parse('2026-10-28T01:23:00.000Z'));
    assert.deepEqual(await readEdits(env.DB), []);
    const [status] = (await readCronStatus(env.DB, Date.parse('2026-10-28T01:30:00.000Z'))).filter(j => j.job === 'editlog');
    assert.deepEqual(status, { job: 'editlog', state: 'ok', okAt: '2026-10-28T01:23:00.000Z', failAt: null, error: '', stale: false });
    assert.equal((await readCronStatus(env.DB, Date.parse('2026-10-29T03:24:00.000Z'))).find(j => j.job === 'editlog').stale, true, '超過 26 小時沒清算過期');
  } finally { env.DB.close(); }
});
