import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { walkerCode } from '../src/editlog.js';
import { setup, request, post, current } from './walk-fixture.mjs';

test.beforeEach(() => worker.testing.resetState());
const undo = (id, version) => request(id, '乙', { action: 'undo', dogs: [{ id: '9001', name: '測試狗', expectedVersion: version }] });
async function edits(env) {
  return (await worker.fetch(new Request('https://bq-shelter-dogs.<子網域>.workers.dev/api/edits', { headers: { Origin: 'https://bq-shelter-dogs.<子網域>.workers.dev' } }), env)).json();
}

test('另一位志工換手機復原：前次日期取自伺服器，不相信手機提供的前值，且原請求重送只生效一次', async () => {
  const env = await setup();
  try {
    await post(env, request('cross-device-walk'));
    const input = undo('cross-device-undo', 1);
    input.dogs[0].prev = { date: { date: '1999-01-01' }, walker: '假前值' };
    const out = await post(env, input);
    assert.equal(out.status, 200);
    assert.equal(out.body.results[0].status, 'restored');
    const data = await current(env);
    assert.equal(data.walks[0].walkedDate, '2026-10-01');
    assert.equal(data.walks[0].walker, '');
    assert.equal(data.walks[0].syncStatus, 'pending');
    assert.equal(data.walks[0].version, 2);
    assert.deepEqual((await post(env, input)).body.results, out.body.results);
    assert.equal((await current(env)).version, data.version);
    const log = await edits(env);
    assert.equal(log.edits.length, 1);
    assert.equal(log.edits[0].editorName, '乙');
    assert.equal(log.edits[0].kind, 'walkundo');
    assert.deepEqual(log.edits[0].after, { date: '2026-10-01', walker: '' });
  } finally { env.DB.close(); }
});

test('修改交易任一步失敗包含編輯紀錄都完整回復，可用原識別重新送出', async () => {
  for (const table of ['v3_walk_state', 'v3_walk_requests', 'v3_walk_outbox', 'v3_walk_pack', 'v3_walk_write_budget', 'v3_edit_log']) {
    const env = await setup();
    try {
      await post(env, request('atomic-walk'));
      const before = await current(env);
      const event = ['v3_walk_state', 'v3_walk_pack'].includes(table) ? 'UPDATE' : 'INSERT';
      await env.DB.prepare(`CREATE TRIGGER fail_edit BEFORE ${event} ON ${table} BEGIN SELECT RAISE(ABORT,'injected'); END`).run();
      assert.equal((await post(env, undo('atomic-undo', 1))).status, 503, table);
      assert.deepEqual(await current(env), before, table);
      assert.equal((await edits(env)).edits.length, 0, table);
      await env.DB.prepare('DROP TRIGGER fail_edit').run();
      assert.equal((await post(env, undo('atomic-undo', 1))).status, 200, table);
    } finally { env.DB.close(); }
  }
});

test('多人不能整筆復原；版本在提交間隙改變即拒絕；午夜後不復原昨天', async () => {
  const env = await setup(), real = Date.now;
  try {
    Date.now = () => Date.parse('2026-10-22T15:59:59Z');
    await post(env, request('boundary-walk'));
    const original = undo('boundary-undo', 1);
    const batch = env.DB.batch.bind(env.DB);
    let race = true;
    env.DB.batch = async statements => {
      if (race) { race = false; await post(env, request('race-add', '乙')); }
      return batch(statements);
    };
    const conflict = await post(env, original);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.results[0].current.walker, '甲、乙');
    assert.equal((await post(env, undo('multi-undo', 2))).status, 409);
    Date.now = () => Date.parse('2026-10-22T16:00:00Z');
    assert.equal((await post(env, original)).status, 400);
    assert.equal((await post(env, undo('after-midnight', 2))).status, 409);
    assert.equal((await current(env)).walks[0].walked, false);
    assert.equal((await current(env)).walks[0].walker, '甲、乙');
    assert.equal((await edits(env)).edits.length, 0);
  } finally { Date.now = real; env.DB.close(); }
});

test('接管今天既有紀錄後仍能找回歷史日期名單；從未溜過則復原空白', async () => {
  for (const history of [true, false]) {
    const env = await setup();
    try {
      if (history) {
        await env.DB.prepare('UPDATE v3_sheet_main SET walked_date=? WHERE row_index=1').bind(request('day').operationDate).run();
        const code = await walkerCode('甲', env.WALKER_KEY);
        await env.DB.prepare('INSERT INTO v3_sheet_main_walkers(row_index,position,walker_code) VALUES(1,0,?)').bind(code).run();
        await env.DB.prepare("INSERT INTO v3_walks(dog_id,walk_date,position,walker_code) VALUES('dog','2026-09-01',0,?)").bind(await walkerCode('丙', env.WALKER_KEY)).run();
      } else await env.DB.prepare("UPDATE v3_sheet_main SET walked_date='' WHERE row_index=1").run();
      await post(env, request('seed-existing'));
      const out = await post(env, undo('restore-history', 1));
      assert.equal(out.status, 200);
      assert.deepEqual(out.body.results[0].current, history ? { date: '2026-09-01', walker: '丙' } : { date: '', walker: '' });
      assert.equal((await current(env)).walks[0].walked, false);
    } finally { env.DB.close(); }
  }
});

test('多人逐名移除以版本比對；衝突回目前狀態，不自動移除新加入的人', async () => {
  const env = await setup();
  try {
    await post(env, request('members-walk', '甲 乙'));
    const edit = request('members-remove', '乙', { action: 'edit', editor: '丙', dogs: [{ id: '9001', name: '測試狗', expectedVersion: 1 }] });
    const changed = await post(env, edit);
    assert.equal(changed.status, 200);
    assert.equal((await current(env)).walks[0].walker, '乙');
    const conflict = await post(env, undo('members-stale', 1));
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.source, 'd1');
    assert.equal(conflict.body.results[0].status, 'changed');
    assert.deepEqual(conflict.body.results[0].current, { date: edit.operationDate, walker: '乙' });
    assert.equal(conflict.body.results[0].version, 2);
    assert.equal((await current(env)).walks[0].version, 2);
    const log = await edits(env);
    assert.equal(log.edits.length, 1);
    assert.equal(log.edits[0].editorName, '丙');
    assert.equal(log.edits[0].kind, 'walkedit');
    assert.equal(log.edits[0].before.walker, '甲、乙');
    assert.equal(log.edits[0].after.walker, '乙');
  } finally { env.DB.close(); }
});
