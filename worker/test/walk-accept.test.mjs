import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { setup, request, post, current, day } from './walk-fixture.mjs';
import { appsScript } from './apps-script.mjs';
import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
test.beforeEach(() => worker.testing.resetState());
test('D1 接受後立即讀到日期、名單與同步中，不必等 Google', async () => {
  const env = await setup(), gas = appsScript(env);
  const tasks = [];
  // 背景派送卡在網路上：先放行的話，晚到的呼叫也立刻失敗，不會卡住。
  let release, released = false;
  gas.network = () => new Promise((_, reject) => { release = () => reject(new Error('Google unavailable')); if (released) release(); });
  try {
    const out = await post(env, request('request-0001'), { waitUntil: p => tasks.push(p) }, gas.worker);
    assert.equal(out.status, 200);
    assert.equal(out.body.results[0].status, 'written');
    assert.equal(out.body.results[0].accepted, true);
    const data = await current(env);
    assert.equal(data.walks[0].walker, '甲');
    assert.equal(data.walks[0].walkedDate, day());
    assert.ok(['pending','dispatching'].includes(data.walks[0].syncStatus));
    assert.equal(tasks.length, 1);
  } finally { released = true; release?.(); await Promise.all(tasks); env.DB.close(); }
});

test('同狗並行保留兩人；同識別重送零寫入；內容不同拒絕', async () => {
  const env = await setup();
  const [a,b] = await Promise.all([post(env, request('parallel-0001')), post(env, request('parallel-0002', '乙'))]);
  assert.deepEqual([a.status,b.status], [200,200]);
  assert.deepEqual((await current(env)).walks[0].walker.split('、').sort(), ['乙','甲']);
  const before = (await current(env)).version;
  const again = await post(env, request('parallel-0001'));
  assert.deepEqual(again.body.results, a.body.results);
  assert.equal((await current(env)).version, before);
  assert.equal((await post(env, request('parallel-0001','丙'))).status, 409);
  env.DB.close();
});

test('接受交易任一步失敗皆回復；預算不足不留半份狀態', async () => {
  for (const table of ['v3_walk_state','v3_walk_requests','v3_walk_outbox','v3_walk_pack','v3_walk_write_budget']) {
    const env = await setup();
    const event = table === 'v3_walk_pack' ? 'UPDATE' : 'INSERT';
    await env.DB.prepare(`CREATE TRIGGER fail_accept BEFORE ${event} ON ${table} BEGIN SELECT RAISE(ABORT,'injected'); END`).run();
    assert.equal((await post(env, request('rollback-0001'))).status, 503, table);
    assert.deepEqual((await current(env)).walks, [], table);
    for (const t of ['v3_walk_state','v3_walk_requests','v3_walk_outbox','v3_walk_write_budget']) assert.equal((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()).n, 0, t);
    env.DB.close();
  }
  const env = await setup();
  assert.equal((await post({ ...env, SYNC_MAX_ROWS: 1 }, request('budget-0001'))).status, 503);
  assert.deepEqual((await current(env)).walks, []);
  env.DB.close();
});

// #591：寫入預算只看單次上限與每日保留量，不查 Cloudflare 帳號用量，也不每次記警告
test('#591 預算不查帳號用量、不記警告；每日保留量照擋', async () => {
  const env = { ...await setup(), CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a' };
  const warn = console.warn, warns = [];
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    // Worker 程式沒有任何地方叫 Cloudflare 的 API 查用量
    const src = new URL('../src/', import.meta.url);
    for (const file of (await readdir(src, { recursive: true })).filter(f => f.endsWith('.js')))
      assert.doesNotMatch(await readFile(new URL(file.replaceAll('\\', '/'), src), 'utf8'), /api\.cloudflare\.com/, file);
    assert.equal((await post(env, request('budget-0101'))).status, 200);
    assert.deepEqual(warns.filter(w => w.includes('walk-budget')), []);
    const reserved = (await env.DB.prepare('SELECT reserved FROM v3_walk_write_budget').first()).reserved;
    assert.equal((await post({ ...env, SYNC_DAILY_BUDGET: String(reserved) }, request('budget-0102', '乙'))).status, 503);
  } finally { console.warn = warn; env.DB.close(); }
});

test('空白拆名沿用既有規則與固定身分；午夜保留最新狀態且拒絕重放昨天操作', async () => {
  const env = await setup();
  const req = request('spaces-0001','甲 乙');
  assert.equal((await post(env, req)).status, 200);
  assert.equal((await current(env)).walks[0].walker, '甲、乙');
  const real = Date.now;
  try {
    Date.now = () => real() + 86400000;
    const data = await current(env);
    assert.equal(data.walks[0].walked, false);
    assert.equal(data.walks[0].walkedDate, req.operationDate);
    assert.equal((await post(env, req)).status, 400);
  } finally { Date.now = real; env.DB.close(); }
});

test('已接管資料不被舊同步回灌；冷讀一列取得一致版本與完整內容', async () => {
  const env = await setup();
  await post(env,request('projection-0001'));
  await env.DB.prepare("UPDATE v3_sheet_main SET walked_date='2000-01-01' WHERE number='9001'").run();
  worker.testing.resetState();
  const before = env.DB.stats.rowsRead;
  const data = await current(env);
  assert.equal(env.DB.stats.rowsRead-before,1);
  assert.equal(data.walks[0].walkedDate,day());
  assert.equal(data.walks[0].walker,'甲');
  assert.equal((await post(env,{ action:'walk', walker:'乙', dogs:[{ id:'9001',name:'測試狗' }] })).status,410);
  env.DB.close();
});

test('#408 無關資料增加十倍，既有單狗接受與冷讀的讀寫列數不變', async () => {
  const env = await setup();
  await post(env,request('scale-initial'));
  const seed = async (start,count) => env.DB.batch(Array.from({ length:count },(_,i) => env.DB.prepare("INSERT INTO v3_walk_outbox(dog_key,version,operation_date,target_date,target_walker,status,next_attempt_at) VALUES('9001',?,'2020-01-01','2020-01-01','舊','superseded','x')").bind(start+i)));
  await seed(100,20);
  const measure = async id => {
    const read = env.DB.stats.rowsRead, before = (await env.DB.prepare('SELECT total_changes() AS n').first()).n;
    assert.equal((await post(env,request(id))).status,200);
    const changed = (await env.DB.prepare('SELECT total_changes() AS n').first()).n-before;
    return { read:env.DB.stats.rowsRead-read, changed };
  };
  const small = await measure('scale-small');
  await seed(1000,180);
  assert.deepEqual(await measure('scale-large'),small);
  const before = env.DB.stats.rowsRead;
  await current(env);
  assert.equal(env.DB.stats.rowsRead-before,1);
  const plan = await env.DB.prepare("EXPLAIN QUERY PLAN UPDATE v3_walk_outbox SET status='superseded' WHERE dog_key='9001' AND status NOT IN ('synced','superseded')").all();
  assert.ok(plan.results.some(r => r.detail.includes('v3_walk_outbox_active')));
  env.DB.close();
});

// #681、#747：溜狗的 guard 與寫入預算都是有條件 batch（conditional-batch.js）的條件；條件成立、不成立、NULL 的語意在 conditional-batch.test.mjs。
test('#747 今日溜狗紀錄的 guard 都走有條件 batch，不自己寫 guard 表、不自己分類約束錯誤', async () => {
  const dir = new URL('../src/today-walks/', import.meta.url);
  for (const file of (await readdir(dir)).filter(f => f.endsWith('.js'))) {
    const code = await readFile(new URL(file, dir), 'utf8');
    assert.doesNotMatch(code, /v3_(walk|batch)_guard/, `${file} 的條件要交給 batchIf`);
    assert.doesNotMatch(code, /constraint/i, `${file} 的約束錯誤要用 isConflict 判斷`);
  }
});

// #770：暖暖沒編號時被溜過，溜狗狀態 key 是名字那一份；補編號後狀態還指向有編號那隻，
// 網站上殘留的沒編號暖暖（主清單另一隻、或已不在主清單）按溜了、改溜狗人、復原都回衝突，D1 不寫、不派送寫回。
test('#770 溜狗狀態的狗 ID 跟主清單這隻不同時，網站登記回衝突', async () => {
  for (const residual of ['主清單另一隻', '不在主清單']) {
    const env = await setup(), gas = appsScript(env);
    const warm = { id: '', name: '暖暖' };
    await env.DB.batch([
      env.DB.prepare("INSERT INTO v3_dogs(dog_id,name) VALUES('warm','暖暖')"),
      env.DB.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,walked_date) VALUES(2,'warm','','暖暖','2026-10-01')"),
    ]);
    const first = await post(env, request('warm-walk-0001', '甲', { dogs: [warm] }));
    assert.equal(first.status, 200);
    // 表上補了編號：主清單那一列換成有編號的暖暖，溜狗狀態還是名字那一份
    const sheet = [env.DB.prepare("UPDATE v3_sheet_main SET number='9002' WHERE dog_id='warm'"), env.DB.prepare("INSERT INTO v3_dog_numbers VALUES('9002','warm')")];
    if (residual === '主清單另一隻') sheet.push(env.DB.prepare("INSERT INTO v3_dogs(dog_id,name) VALUES('residual','暖暖')"),
      env.DB.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name) VALUES(3,'residual','','暖暖')"));
    await env.DB.batch(sheet);
    const snapshot = async () => ({
      state: await env.DB.prepare('SELECT dog_id,version,walker FROM v3_walk_state ORDER BY dog_key').all(),
      walks: await env.DB.prepare('SELECT dog_id,walk_date,position,walker_code FROM v3_walks ORDER BY dog_id,walk_date,position').all(),
      outbox: await env.DB.prepare('SELECT dog_key,version,status FROM v3_walk_outbox ORDER BY dog_key,version').all(),
      log: await env.DB.prepare('SELECT COUNT(*) AS n FROM v3_edit_log').first(),
    });
    const before = await snapshot();
    const tasks = [], ctx = { waitUntil: p => tasks.push(p) };
    const version = first.body.results[0].version;
    for (const body of [request('warm-walk-0002', '乙', { dogs: [warm] }),
      request('warm-edit-0003', '乙', { action: 'edit', editor: '甲', dogs: [{ ...warm, expectedVersion: version }] }),
      request('warm-undo-0004', '甲', { action: 'undo', dogs: [{ ...warm, expectedVersion: version }] })]) {
      const out = await post(env, body, ctx, gas.worker);
      assert.equal(out.status, 409, `${residual} ${body.action}`);
    }
    await Promise.all(tasks);
    assert.deepEqual(await snapshot(), before, residual);
    assert.equal(gas.calls.length, 0);
    // 有編號的暖暖（同一隻）照常登記
    assert.equal((await post(env, request('warm-walk-0005', '乙', { dogs: [{ id: '9002', name: '暖暖' }] }))).status, 200);
    env.DB.close();
  }
});
