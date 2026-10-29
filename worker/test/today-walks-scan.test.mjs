// #746：保險掃描跟改表通知同一套規則收下人工修改（ADR 0018 補充）。
// 以前保險掃描自己寫一份：沒用過網站的名字跳過、同一天直接用表上的蓋掉、上一次不管連改、不寫 v3_walk_baselines、失敗只 console.warn。
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { todayWalks } from '../src/today-walks/index.js';
import { appsScript } from './apps-script.mjs';
import { setup as baseSetup, post, request, current, day, addDog } from './walk-fixture.mjs';

const dog = { id: '9001', name: '測試狗' };
// 改表通知走真的編輯觸發（功能開關 D1_WALK_NOTIFY 開著）
const setup = async () => {
  const env = { ...await baseSetup(), D1_WALK_NOTIFY: '1' };
  return { env, gas: appsScript(env) };
};
// 網站登記後寫回試算表並收到回執（試算表原本是 2026-10-01、沒有溜狗人）
async function baseline(env, gas, walker = '甲') {
  await post(env, request('scan-base-0001', walker));
  await todayWalks(env, { sheet: gas.sheet }).dispatch([dog]);
  assert.equal((await current(env)).walks[0].syncStatus, 'synced');
}
// 保險掃描一輪：rows 是表上人工改成的值（只改格子、沒有改表通知）；duringRead 模擬小程式讀完表、回應還沒到 Worker 時發生的事
async function scan(env, gas, rows, duringRead) {
  for (const { dog: d, current: c } of rows) gas.set(d.id, c);
  if (duringRead) gas.network = async (_body, deliver) => { const res = await deliver(); await duringRead(); return res; };
  try { return await todayWalks({ ...env, WALK_RETRY_ENABLED: 'true' }, { sheet: gas.sheet }).scan(); }
  finally { gas.network = (_body, deliver) => deliver(); }
}
const state = env => env.DB.prepare("SELECT * FROM v3_walk_state WHERE dog_key='9001'").first();

test('保險掃描收下沒用過網站的名字，不建立志工身分', async () => {
  const { env, gas } = await setup(); worker.testing.resetState();
  try {
    await baseline(env, gas);
    const volunteers = (await env.DB.prepare('SELECT COUNT(*) AS n FROM v3_volunteers').first()).n;
    assert.deepEqual(await scan(env, gas, [{ dog, current: { date: day(), walker: '甲、丁' } }]), { changed: 1, deferred: 0 });
    const walk = (await current(env)).walks[0];
    assert.equal(walk.walker, '甲、丁');
    assert.equal(walk.syncStatus, 'synced');
    assert.deepEqual(JSON.parse((await state(env)).members_json).map(m => m.name), ['甲', '丁']);
    assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM v3_volunteers').first()).n, volunteers);
  } finally { env.DB.close(); }
});

test('保險掃描同一天合併：表上拿掉的人拿掉，網站還沒寫回的人留著，接著寫回', async () => {
  const { env, gas } = await setup(); worker.testing.resetState();
  try {
    await baseline(env, gas, '甲、丙');
    await post(env, request('scan-add-0002', '乙'));
    assert.deepEqual(await scan(env, gas, [{ dog, current: { date: day(), walker: '丙' } }]), { changed: 1, deferred: 0 });
    const walk = (await current(env)).walks[0];
    assert.equal(walk.walker, '丙、乙');
    assert.equal(walk.syncStatus, 'pending', '合併後的名單跟表上不同，要寫回');
    const s = await state(env);
    assert.deepEqual([s.base_date, s.base_walker], [day(), '丙'], '表上值記成人工改的那份');
  } finally { env.DB.close(); }
});

// 以前保險掃描遇到還沒派送的 pending 一律先不收（base 不變、等派送的 target 收）；#746 起跟改表通知一樣直接收下人工改的日期。
// 已交給 Apps Script 的派送仍不收、base 不變：walk-reconcile.test.mjs「還有差異沒收完（派送結果不明）」
test('保險掃描遇到還沒派送的網站登記：人工改了日期就照表收下，取代還沒寫回的那一版', async () => {
  const { env, gas } = await setup(); worker.testing.resetState();
  try {
    await baseline(env, gas);
    await post(env, request('scan-pending-0002', '乙'));
    assert.deepEqual(await scan(env, gas, [{ dog, current: { date: '2026-09-01', walker: '丁' } }]), { changed: 1, deferred: 0 });
    const walk = (await current(env)).walks[0];
    assert.deepEqual([walk.walkedDate, walk.walker, walk.syncStatus], ['2026-09-01', '丁', 'synced']);
    assert.equal(await env.DB.prepare("SELECT COUNT(*) AS n FROM v3_walk_outbox WHERE dog_key='9001' AND status='pending'").first('n'), 0, '舊的 pending 被取代，不會再寫回');
  } finally { env.DB.close(); }
});

test('保險掃描連改：先改人名（改表通知）再改日期（掃描補到），上一次記連改前的值', async () => {
  const { env, gas } = await setup(); worker.testing.resetState();
  try {
    await baseline(env, gas);
    await gas.edit(dog.id, { walker: '乙' });
    assert.equal(gas.posts.findLast(p => p.action === 'rows').out.results[0].changed, true);
    await scan(env, gas, [{ dog, current: { date: '2026-09-01', walker: '乙' } }]);
    const s = await state(env);
    assert.deepEqual([s.effective_date, s.walker], ['2026-09-01', '乙']);
    assert.deepEqual([s.previous_date, s.previous_walker], [day(), '甲'], '不記改一半的「今天／乙」');
  } finally { env.DB.close(); }
});

test('保險掃描收下時寫 v3_walk_baselines，之後同一份讀回不再當成人工修改', async () => {
  const { env, gas } = await setup(); worker.testing.resetState();
  try {
    await baseline(env, gas);
    await scan(env, gas, [{ dog, current: { date: '2026-09-01', walker: '乙' } }]);
    const s = await state(env);
    assert.equal((await env.DB.prepare("SELECT version FROM v3_walk_baselines WHERE dog_key='9001'").first()).version, s.version);
    const total = async () => (await env.DB.prepare('SELECT total_changes() AS n').first()).n;
    const before = await total();
    await scan(env, gas, [{ dog, current: { date: '2026-09-01', walker: '乙' } }]);
    assert.equal(await total(), before, '同一份讀回寫 0 列');
  } finally { env.DB.close(); }
});

test('保險掃描某隻比對失敗記進 v3_walk_conflicts，之後比對成功清掉', async () => {
  const { env, gas } = await setup(); worker.testing.resetState();
  const warn = console.warn, warns = [];
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    await baseline(env, gas);
    await env.DB.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,walked_date) VALUES(2,'dog','9001','測試狗','2026-10-01')").run();
    assert.deepEqual(await scan(env, gas, [{ dog, current: { date: '2026-09-01', walker: '乙' } }]), { changed: 0, deferred: 1 });
    const conflict = await env.DB.prepare("SELECT observation,error FROM v3_walk_conflicts WHERE dog_key='9001'").first();
    assert.deepEqual(JSON.parse(conflict.observation), { date: '2026-09-01', walker: '乙' });
    assert.match(conflict.error, /唯一/);
    assert.equal((await current(env)).walks[0].walker, '甲');
    await env.DB.prepare('DELETE FROM v3_sheet_main WHERE row_index=2').run();
    assert.deepEqual(await scan(env, gas, [{ dog, current: { date: '2026-09-01', walker: '乙' } }]), { changed: 1, deferred: 0 });
    assert.equal(await env.DB.prepare("SELECT COUNT(*) AS n FROM v3_walk_conflicts").first('n'), 0);
  } finally { console.warn = warn; env.DB.close(); }
});

test('保險掃描讀表期間有新登記：版本變了先不收，新登記不被撤銷', async () => {
  const { env, gas } = await setup(); worker.testing.resetState();
  try {
    await baseline(env, gas);
    const out = await scan(env, gas, [{ dog, current: { date: '2026-09-01', walker: '乙' } }], () => post(env, request('scan-during-0002', '丙')));
    assert.deepEqual(out, { changed: 0, deferred: 1 });
    assert.equal((await current(env)).walks[0].walker, '甲、丙');
  } finally { env.DB.close(); }
});

test('保險掃描每輪最多收 10 隻，其餘留給下一輪', async () => {
  const { env, gas } = await setup(); worker.testing.resetState();
  try {
    const dogs = [];
    for (let i = 0; i < 12; i++) {
      const d = { id: String(9300 + i), name: `掃描狗${i}` };
      await addDog(env, gas, { ...d, dogId: `scan-${i}`, row: i + 2 });
      worker.testing.resetState();
      assert.equal((await post(env, request(`scan-many-${String(i).padStart(4, '0')}`, '甲', { dogs: [d] }))).status, 200);
      dogs.push(d);
    }
    const rows = dogs.map(d => ({ dog: d, current: { date: '2026-09-01', walker: '乙' } }));
    assert.deepEqual(await scan(env, gas, rows), { changed: 10, deferred: 2 });
    assert.deepEqual(await scan(env, gas, []), { changed: 2, deferred: 0 }, '表上沒再改，小程式只回還沒收的兩隻');
  } finally { env.DB.close(); }
});
