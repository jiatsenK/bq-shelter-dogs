// #672：修改紀錄「溜了」與來源。網站按溜了記志工網站、試算表人工改表記試算表；網站寫回又讀回不重複記。
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { setup, post, request, day } from './walk-fixture.mjs';
import { reconcileWalk, writebackTarget, confirmWalk } from '../src/walk-accept.js';
import { reconcileWalkSnapshot } from '../src/walk-reconcile.js';
import { searchEdits } from '../src/admin/edits.js';

const SITE = 'https://bq-shelter-dogs.example.workers.dev';
const dog = { id: '9001', name: '測試狗' };
const logs = async (env, where = '1') => (await env.DB.prepare(`SELECT * FROM v3_edit_log WHERE ${where} ORDER BY id`).all()).results
  .map(r => ({ kind: r.kind, source: r.source, editor: r.editor_name, dogId: r.dog_id, number: r.dog_number, before: JSON.parse(r.before_json), after: JSON.parse(r.after_json) }));
const modify = (id, action, version, walker = '乙') => request(id, walker, { action, editor: '甲', dogs: [{ ...dog, expectedVersion: version }] });
// 網站登記後寫回試算表並收到回執（試算表原本是 2026-10-01、沒有溜狗人）
async function written(env, walker = '甲') {
  await post(env, request('written-0001', walker));
  const target = await writebackTarget(env.DB, { dog, dispatchId: 'written', current: { date: '2026-10-01', walker: '' } }, env);
  await confirmWalk(env.DB, { dogKey: dog.id, ...target }, env);
}

test('網站按溜了記一筆「溜了／志工網站」，改前改後是上一次與這一次', async () => {
  const env = await setup();
  try {
    assert.equal((await post(env, request('walk-0001'))).status, 200);
    assert.deepEqual(await logs(env), [{ kind: 'walk', source: 'volunteer', editor: '甲', dogId: 'dog', number: '9001',
      before: { date: '2026-10-01', walker: '' }, after: { date: day(), walker: '甲' } }]);
    // 第二個人再按：改前是今天甲那次
    await post(env, request('walk-0002', '乙'));
    assert.deepEqual((await logs(env)).at(-1).before, { date: day(), walker: '甲' });
    assert.deepEqual((await logs(env)).at(-1).after, { date: day(), walker: '甲、乙' });
    // 同一個人重按、名單沒變：不記
    await post(env, request('walk-0003', '甲'));
    assert.equal((await logs(env)).length, 2);
  } finally { env.DB.close(); }
});

test('一起溜時操作者列出全部溜狗人；每日寫入預算算進修改紀錄', async () => {
  const env = await setup();
  try {
    await post(env, request('group-0001', '甲、乙'));
    assert.equal((await logs(env))[0].editor, '甲、乙');
    // 32（今日溜狗）＋8（修改紀錄）＋溜狗紀錄兩人各 4
    assert.equal((await env.DB.prepare('SELECT reserved FROM v3_walk_write_budget').first()).reserved, 48);
  } finally { env.DB.close(); }
});

test('撤銷、改溜狗人維持原類型，來源是志工網站', async () => {
  const env = await setup();
  try {
    await post(env, request('base-0001'));
    assert.equal((await post(env, modify('edit-0001', 'edit', 1))).status, 200);
    assert.equal((await post(env, modify('undo-0001', 'undo', 2, '甲'))).status, 200);
    assert.deepEqual((await logs(env)).map(l => [l.kind, l.source]), [['walk', 'volunteer'], ['walkedit', 'volunteer'], ['walkundo', 'volunteer']]);
  } finally { env.DB.close(); }
});

test('試算表改溜狗人記一筆「溜了／試算表」，操作者是表上寫的人', async () => {
  const env = await setup();
  try {
    await written(env);
    await reconcileWalk(env.DB, dog, { date: day(), walker: '丙' }, env);
    assert.deepEqual(await logs(env, "source='sheet'"), [{ kind: 'walk', source: 'sheet', editor: '丙', dogId: 'dog', number: '9001',
      before: { date: day(), walker: '甲' }, after: { date: day(), walker: '丙' } }]);
  } finally { env.DB.close(); }
});

test('網站登記寫回試算表又讀回，不會多一筆試算表紀錄', async () => {
  const env = await setup();
  try {
    // 回執還沒到就先讀回寫好的值
    await post(env, request('readback-0001'));
    const target = await writebackTarget(env.DB, { dog, dispatchId: 'readback', current: { date: '2026-10-01', walker: '' } }, env);
    await reconcileWalk(env.DB, dog, { date: day(), walker: '甲' }, env);
    // 回執到了之後再讀回一次
    await confirmWalk(env.DB, { dogKey: dog.id, ...target }, env);
    await reconcileWalk(env.DB, dog, { date: day(), walker: '甲' }, env);
    assert.deepEqual((await logs(env)).map(l => l.source), ['volunteer']);
  } finally { env.DB.close(); }
});

test('試算表清空日期不記；改回較早一天記成那天', async () => {
  const env = await setup();
  try {
    await written(env);
    await reconcileWalk(env.DB, dog, { date: '', walker: '' }, env);
    assert.equal((await logs(env, "source='sheet'")).length, 0);
    await reconcileWalk(env.DB, dog, { date: '2026-09-01', walker: '乙' }, env);
    assert.deepEqual((await logs(env, "source='sheet'")).map(l => l.after), [{ date: '2026-09-01', walker: '乙' }]);
  } finally { env.DB.close(); }
});

test('保險掃描收下人工改表也記「溜了／試算表」', async () => {
  const env = await setup();
  try {
    await written(env);
    const observed = (await env.DB.prepare('SELECT s.*,o.status FROM v3_walk_state s JOIN v3_walk_outbox o ON o.dog_key=s.dog_key AND o.version=s.version').all()).results;
    assert.deepEqual(await reconcileWalkSnapshot(env.DB, [{ dog, current: { date: '2026-09-02', walker: '乙' } }], observed, env, Date.now()), { changed: 1, deferred: 0 });
    assert.deepEqual((await logs(env, "source='sheet'")).map(l => [l.editor, l.number, l.before, l.after]),
      [['乙', '9001', { date: day(), walker: '甲' }, { date: '2026-09-02', walker: '乙' }]]);
  } finally { env.DB.close(); }
});

test('管理網站來源篩選試算表只出現試算表紀錄；志工網站編輯紀錄不含溜了', async () => {
  const env = await setup();
  try {
    await written(env);
    await reconcileWalk(env.DB, dog, { date: day(), walker: '丙' }, env);
    await post(env, request('walk-0002', '乙'));
    const page = await searchEdits(env.DB, new URLSearchParams('source=sheet'));
    assert.deepEqual(page.edits.map(e => [e.kind, e.source, e.editorName]), [['walk', 'sheet', '丙']]);
    assert.equal(page.kinds.find(k => k.value === 'walk').label, '溜了');
    assert.deepEqual((await searchEdits(env.DB, new URLSearchParams('source=volunteer'))).edits.map(e => e.kind), ['walk', 'walk']);
    const res = await worker.fetch(new Request(`${SITE}/api/edits`, { headers: { Origin: SITE } }), env);
    assert.deepEqual((await res.json()).edits, []);
  } finally { env.DB.close(); }
});
