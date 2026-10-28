// #746：寫入預算的保留量由 today-walks/budget.js 依要寫的表自動算（ADR 0008 規則不變）。
// 取代手動腳本 walk-cost-preview.mjs、walk-reconcile-cost-preview.mjs：每種轉換用 SQLite total_changes()（含觸發器）
// 確認保留量 ≥ 實際寫入列數；索引不算在 total_changes 裡，ROW_COST 另外照 db/compact-schema.sql 算進去。
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { todayWalks } from '../src/today-walks/index.js';
import { ROW_COST, DISPATCH_COST } from '../src/today-walks/budget.js';
import { setup, post, request, day } from './walk-fixture.mjs';

const dog = { id: '9001', name: '測試狗' };
async function machine(env, action, body) {
  const response = await worker.fetch(new Request(`https://worker.example/api/walk-writeback/${action}`, {
    method: 'POST', headers: { 'X-Sheet-Write-Key': 'test-secret' }, body: JSON.stringify(body),
  }), env);
  return { status: response.status, ...await response.json() };
}
const total = async env => (await env.DB.prepare('SELECT total_changes() AS n').first()).n;
const reserved = async env => (await env.DB.prepare('SELECT COALESCE(SUM(reserved),0) AS n FROM v3_walk_write_budget').first()).n;
// 量一次轉換：保留量的增加要 ≥ 實際寫入列數；回傳兩個數字給個別測試再看
async function measure(env, name, fn) {
  const [changes0, reserved0] = [await total(env), await reserved(env)];
  await fn();
  const changes = await total(env) - changes0, kept = await reserved(env) - reserved0;
  assert.ok(changes > 0, `${name}：要真的有寫入才量得到`);
  assert.ok(kept >= changes, `${name}：保留 ${kept} 列，實際寫了 ${changes} 列`);
  return { changes, kept };
}
// 寫回試算表的假 GAS：照真的小程式回呼 target、receipt（同一個 D1）；sheet.cells 是每隻狗表上的兩欄，fail 讓寫入失敗
function fakeSheet(env, sheet) {
  return async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.action === 'walkScan') return Response.json({ ok: true, rows: sheet.scan || [] });
    const items = body.action === 'walkWake' ? [body] : body.items;
    const results = [];
    for (const item of items) {
      const current = sheet.cells[item.dog.id] || { date: '2026-10-01', walker: '' };
      const target = await machine(env, 'target', { dog: item.dog, dispatchId: item.dispatchId, current });
      if (sheet.fail) { results.push({ ok: false, dispatchId: item.dispatchId, error: 'injected' }); continue; }
      sheet.cells[item.dog.id] = target.current;
      const receipt = { dogKey: item.dog.id, version: target.version, dispatchId: target.dispatchId, current: target.current };
      results.push({ ok: true, ...receipt, ...await machine(env, 'receipt', receipt) });
    }
    return Response.json(body.action === 'walkWake' ? results[0] : { ok: true, results });
  };
}

test('ROW_COST 照 db/compact-schema.sql：每列＝表＋索引＋觸發器連帶寫的列（＋AUTOINCREMENT 序號）', async () => {
  const env = await setup();
  try {
    const all = async sql => (await env.DB.prepare(sql).all()).results;
    const indexes = async table => (await all(`PRAGMA index_list(${table})`)).length;
    for (const table of Object.keys(ROW_COST)) {
      const [{ sql }] = await all(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${table}'`);
      let triggered = 0;
      for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
        let rows = 0;
        for (const t of await all(`SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name='${table}'`)) {
          if (!new RegExp(`\\b(BEFORE|AFTER|INSTEAD OF)\\s+${event}\\b`, 'i').test(t.sql)) continue;
          const body = t.sql.slice(t.sql.search(/\bBEGIN\b/i) + 5);
          for (const [, target] of body.matchAll(/\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+(\w+)/gi)) rows += 1 + await indexes(target);
        }
        triggered = Math.max(triggered, rows);
      }
      const expected = 1 + await indexes(table) + triggered + (/AUTOINCREMENT/i.test(sql) ? 1 : 0);
      assert.equal(ROW_COST[table], expected, `${table} 的 ROW_COST 跟結構不符（today-walks/budget.js）`);
    }
  } finally { env.DB.close(); }
});

test('志工接受：溜了、同日加人、修改、復原的保留量都 ≥ 實際寫入', async () => {
  const env = await setup(); worker.testing.resetState();
  try {
    await measure(env, '第一次溜了（從主清單建狀態）', async () => assert.equal((await post(env, request('cost-walk-0001'))).status, 200));
    await measure(env, '同一天加一起溜的人', async () => assert.equal((await post(env, request('cost-walk-0002', '乙、丙'))).status, 200));
    const edit = request('cost-edit-0003', '乙', { action: 'edit', editor: '甲', dogs: [{ ...dog, expectedVersion: 2 }] });
    await measure(env, '改溜狗人（三人改一人，刪多的溜狗紀錄）', async () => assert.equal((await post(env, edit)).status, 200));
    const undo = request('cost-undo-0004', '甲', { action: 'undo', dogs: [{ ...dog, expectedVersion: 3 }] });
    await measure(env, '復原（刪今天的溜狗紀錄）', async () => assert.equal((await post(env, undo)).status, 200));
  } finally { env.DB.close(); }
});

test('收下人工改表：同日刪人、改回較早的日子（刪溜狗紀錄＋修改紀錄）、清空、保險掃描、記衝突', async () => {
  const env = await setup(); worker.testing.resetState();
  const real = globalThis.fetch, sheet = { cells: {} };
  globalThis.fetch = fakeSheet(env, sheet);
  try {
    await post(env, request('cost-base-0001', '甲、丙'));
    await todayWalks(env).dispatch([dog]);
    await post(env, request('cost-add-0002', '乙'));
    const observe = current => todayWalks(env).observe([{ dog, current }]);
    await measure(env, '同日人工刪人、網站加的人留著', () => observe({ date: day(), walker: '丙' }));
    await measure(env, '人工改回較早的日子', () => observe({ date: '2026-09-01', walker: '甲' }));
    await measure(env, '人工清空', () => observe({ date: '', walker: '' }));
    sheet.scan = [{ dog, current: { date: '2026-09-02', walker: '乙、丁' } }];
    await measure(env, '保險掃描收下', async () => assert.equal((await todayWalks({ ...env, WALK_RETRY_ENABLED: 'true' }).scan()).changed, 1));
    await env.DB.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,walked_date) VALUES(2,'dog','9001','測試狗','2026-10-01')").run();
    await measure(env, '比對失敗記進 v3_walk_conflicts', async () => assert.equal((await observe({ date: '2026-09-03', walker: '乙' }))[0].ok, false));
  } finally { globalThis.fetch = real; env.DB.close(); }
});

test('派送：整條協定成功、失敗轉重試、合併多隻都在認領時一次保留夠', async () => {
  const env = await setup(); worker.testing.resetState();
  const real = globalThis.fetch, sheet = { cells: {} };
  globalThis.fetch = fakeSheet(env, sheet);
  try {
    await post(env, request('cost-send-0001'));
    const ok = await measure(env, '派送成功（認領＋target＋回執）', () => todayWalks(env).dispatch([dog]));
    assert.equal(ok.kept, DISPATCH_COST + ROW_COST.v3_walk_write_budget, 'target、回執已預付，不另外扣');
    await post(env, request('cost-send-0002', '乙'));
    sheet.fail = true;
    await measure(env, '派送失敗轉重試', () => todayWalks(env).dispatch([dog]));
    sheet.fail = false;
    for (let i = 0; i < 3; i++) {
      const d = { id: String(9400 + i), name: `派送狗${i}` };
      await env.DB.batch([
        env.DB.prepare('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)').bind(`send-${i}`, d.name),
        env.DB.prepare('INSERT INTO v3_dog_numbers VALUES(?,?)').bind(d.id, `send-${i}`),
        env.DB.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,walked_date) VALUES(?,?,?,?,'2026-10-01')").bind(i + 2, `send-${i}`, d.id, d.name),
      ]);
      worker.testing.resetState();
      await post(env, request(`cost-many-${i}000`, '甲', { dogs: [d] }));
    }
    await measure(env, '合併派送三隻', () => todayWalks(env).dispatch([0, 1, 2].map(i => ({ id: String(9400 + i), name: `派送狗${i}` }))));
  } finally { globalThis.fetch = real; env.DB.close(); }
});

test('單獨的 target、回執（沒有預付的派送）也各自保留夠', async () => {
  const env = await setup(); worker.testing.resetState();
  try {
    await post(env, request('cost-alone-0001'));
    let target;
    await measure(env, '單獨 target 授予派送識別', async () => { target = await machine(env, 'target', { dog, dispatchId: 'alone', current: { date: '2026-10-01', walker: '' } }); });
    await measure(env, '單獨回執確認', async () => assert.equal((await machine(env, 'receipt', { dogKey: dog.id, ...target })).confirmed, true));
    await post(env, request('cost-alone-0002', '乙'));
    const old = await machine(env, 'target', { dog, dispatchId: 'older', current: target.current });
    await post(env, request('cost-alone-0003', '丙'));
    await measure(env, '可信舊回執只記讀回', async () => assert.equal((await machine(env, 'receipt', { dogKey: dog.id, ...old })).confirmed, false));
  } finally { env.DB.close(); }
});

test('重試用完當天上限，延到隔天也保留夠', async () => {
  const env = await setup(); worker.testing.resetState();
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('lost'); };
  try {
    await post(env, request('cost-defer-0001'));
    await todayWalks(env).dispatch([dog]);
    const { next_attempt_at: due } = await env.DB.prepare("SELECT next_attempt_at FROM v3_walk_outbox WHERE dog_key='9001' AND status='retry'").first();
    const capped = { ...env, WALK_RETRY_ENABLED: 'true', SYNC_RETRY_DAILY_BUDGET: '0' };
    await measure(env, '重試延到隔天（只改 next_attempt_at）', () => todayWalks(capped, { now: () => Date.parse(due) }).dispatchDue());
  } finally { globalThis.fetch = real; env.DB.close(); }
});
