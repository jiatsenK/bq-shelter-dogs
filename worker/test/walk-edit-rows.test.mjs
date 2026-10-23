// #500：試算表有人編輯，GAS 只送受影響的列；排程只做寫回重試與每天三次指紋掃描。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { setup, post, request, current, day } from './walk-fixture.mjs';

const dog = { id:'9001', name:'測試狗' };
const rows = (env, body, key = env.SHEET_WRITE_KEY) => worker.fetch(new Request('https://worker.example/api/walk-writeback/rows', {
  method:'POST', headers:{ 'X-Sheet-Write-Key':key }, body:JSON.stringify(body),
}), env);
const writes = async env => (await env.DB.prepare('SELECT total_changes() n').first()).n;
async function run(env, cron) {
  const tasks = [];
  await worker.scheduled({ scheduledTime:Date.now(), cron }, env, { waitUntil:p => tasks.push(p) });
  await Promise.allSettled(tasks);
}

test('#500 改一格只送那一列：Worker 依送來的值更新，不讀整張表', async () => {
  const env = { ...await setup(), D1_WALK_NOTIFY:'1' }, real = globalThis.fetch;
  worker.testing.resetState();
  const outside = [];
  globalThis.fetch = async url => { outside.push(String(url)); return Response.json({ ok:true }); };
  try {
    assert.equal((await rows(env, { rows:[{ sheet:'main', dog, current:{ date:day(), walker:'乙' } }] }, 'forged')).status, 403);
    const response = await rows(env, { rows:[{ sheet:'main', dog, current:{ date:day(), walker:'乙' } }] });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).results.map(r => r.ack), [true]);
    assert.equal((await current(env)).walks[0].walker, '乙');
    assert.deepEqual(outside, [], '不回頭向試算表讀整張表');
    // 只改溜狗欄位不用叫狗清單同步
    assert.equal(await env.DB.prepare("SELECT value FROM v3_sync_state WHERE key='changed'").first(), null);
  } finally { globalThis.fetch = real; env.DB.close(); }
});

test('#500 換籠、移到「已出所」交給狗清單同步；兩處都有時以最後出現為準（GAS 已合併）', async () => {
  const env = { ...await setup(), D1_WALK_NOTIFY:'1' };
  worker.testing.resetState();
  try {
    const moved = await rows(env, { rows:[{ sheet:'departed', dog }] });
    assert.equal(moved.status, 200);
    assert.deepEqual((await moved.json()).results.map(r => r.ack), [true]);
    assert.ok(await env.DB.prepare("SELECT value FROM v3_sync_state WHERE key='changed'").first(), '已出所要叫狗清單同步');
    await env.DB.prepare("DELETE FROM v3_sync_state WHERE key='changed'").run();
    const cage = await rows(env, { rows:[{ sheet:'main', dog, other:true, current:{ date:'2026-10-01', walker:'' } }] });
    assert.equal(cage.status, 200);
    assert.ok(await env.DB.prepare("SELECT value FROM v3_sync_state WHERE key='changed'").first(), '換籠要叫狗清單同步');
  } finally { env.DB.close(); }
});

test('#500 無法確認的列仍回 ack（已記衝突）；D1 寫不進去才讓 GAS 保留待通知', async () => {
  const env = { ...await setup(), D1_WALK_NOTIFY:'1' };
  worker.testing.resetState();
  try {
    const bad = await (await rows(env, { rows:[{ sheet:'main', dog:{ id:'7777', name:'不在' }, current:{ date:'', walker:'' } }] })).json();
    assert.equal(bad.results[0].ack, true);
    assert.equal(bad.results[0].ok, false);
    const batch = env.DB.batch.bind(env.DB);
    env.DB.batch = async () => { throw new Error('D1 down'); };
    const down = await (await rows(env, { rows:[{ sheet:'main', dog, current:{ date:day(), walker:'乙' } }] })).json();
    env.DB.batch = batch;
    assert.equal(down.results[0].ack, false);
    assert.equal((await rows(env, { rows:Array.from({ length:51 }, () => ({ sheet:'main', dog })) })).status, 400);
  } finally { env.DB.close(); }
});

test('#500 功能開關關閉時只標記有改，不動今日溜狗，也不確認（GAS 保留待開啟後補送）', async () => {
  const env = await setup();
  worker.testing.resetState();
  try {
    const out = await (await rows(env, { rows:[{ sheet:'main', dog, current:{ date:day(), walker:'乙' } }, { sheet:'departed', dog }] })).json();
    assert.deepEqual(out.results.map(r => r.ack), [false, true]);
    assert.equal(await env.DB.prepare('SELECT dog_key FROM v3_walk_state').first(), null);
    assert.ok(await env.DB.prepare("SELECT value FROM v3_sync_state WHERE key='changed'").first());
  } finally { env.DB.close(); }
});

test('#500 沒有待寫回時，重試排程不讀試算表、不寫 D1', async () => {
  const env = { ...await setup(), WALK_RETRY_ENABLED:'true' }, real = globalThis.fetch;
  const outside = [];
  globalThis.fetch = async url => { outside.push(String(url)); return Response.json({ ok:true, rows:[] }); };
  try {
    const before = await writes(env);
    await run(env, '5-59/10 * * * *');
    assert.deepEqual(outside, []);
    assert.equal(await writes(env), before);
  } finally { globalThis.fetch = real; env.DB.close(); }
});

test('#500 保險掃描指紋一樣只比一次就結束；同步排程不掃、重試排程不掃', async () => {
  const env = { ...await setup(), WALK_RETRY_ENABLED:'true' }, real = globalThis.fetch;
  const actions = [];
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    actions.push(body.action || String(url));
    return body.sig === 'same' ? Response.json({ ok:true, same:true, sig:'same' }) : Response.json({ ok:true, sig:'same', rows:[{ dog, current:{ date:'2026-10-01', walker:'' } }] });
  };
  try {
    await post(env, request('scan-0001', '甲'));
    await env.DB.prepare("INSERT INTO v3_sync_state(key,value) VALUES('walk_scan_sig','same')").run();
    for (const cron of ['*/10 * * * *', '5-59/10 * * * *']) {
      actions.length = 0;
      await run(env, cron);
      assert.ok(!actions.includes('walkScan'), cron);
    }
    for (const cron of ['43 1 * * *', '53 5,15 * * *']) {
      actions.length = 0;
      const before = await writes(env);
      await run(env, cron);
      assert.deepEqual(actions, ['walkScan'], cron);
      assert.equal(await writes(env), before);
    }
    const wrangler = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
    assert.match(wrangler, /"43 1 \* \* \*"/);
    assert.match(wrangler, /"53 5,15 \* \* \*"/);
  } finally { globalThis.fetch = real; env.DB.close(); }
});

test('#500 試算表通知不再讀表比對溜狗，只標記狗清單有改', async () => {
  const env = { ...await setup(), SHEET_NOTIFY_KEY:'nk', D1_WALK_NOTIFY:'1' }, real = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async () => { reads++; return Response.json({ ok:true, rows:[] }); };
  try {
    await post(env, request('notify-0001', '甲'));
    const response = await worker.fetch(new Request('https://worker.example/api/sheet-changed', { method:'POST', headers:{ 'X-Notify-Key':'nk' } }), env);
    assert.equal(response.status, 200);
    assert.equal(reads, 0);
  } finally { globalThis.fetch = real; env.DB.close(); }
});

test('#500 11 隻整群逐狗接受並各自寫回；部分失敗只重試未成功者', async t => {
  const now = Date.parse('2026-10-22T02:00:00Z');
  t.mock.timers.enable({ apis:['Date'], now });
  const env = { ...await setup(), WALK_RETRY_ENABLED:'true' }, real = globalThis.fetch;
  worker.testing.resetState();
  const machine = async (action, body) => (await worker.fetch(new Request(`https://worker.example/api/walk-writeback/${action}`, {
    method:'POST', headers:{ 'X-Sheet-Write-Key':env.SHEET_WRITE_KEY }, body:JSON.stringify(body) }), env)).json();
  const cells = {}, wakes = [];
  let broken = '9203';
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body), items = body.items || [{ dog:body.dog, dispatchId:body.dispatchId }];
    const results = [];
    for (const item of items) {
      wakes.push(item.dog.id);
      if (item.dog.id === broken) { results.push({ ok:false, dispatchId:item.dispatchId, error:'找不到唯一的狗' }); continue; }
      const target = await machine('target', { dog:item.dog, dispatchId:item.dispatchId, current:cells[item.dog.id] || { date:'2026-10-01', walker:'' } });
      cells[item.dog.id] = target.current;
      const receipt = { dogKey:item.dog.id, version:target.version, dispatchId:target.dispatchId, current:target.current };
      results.push({ ok:true, ...receipt, ...await machine('receipt', receipt) });
    }
    return body.items ? Response.json({ ok:true, results }) : Response.json(results[0]);
  };
  try {
    const tasks = [], ctx = { waitUntil:p => tasks.push(p) };
    for (let i = 0; i < 11; i++) {
      const id = String(9200 + i), dogId = `group-${i}`, name = `整群狗${i}`;
      await env.DB.batch([
        env.DB.prepare('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)').bind(dogId, name),
        env.DB.prepare('INSERT INTO v3_dog_numbers VALUES(?,?)').bind(id, dogId),
        env.DB.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,walked_date,synced_at) VALUES(?,?,?,?,'2026-10-01','x')").bind(i + 2, dogId, id, name),
      ]);
      const out = await post(env, request(`group-req-${String(i).padStart(4, '0')}`, '甲', { dogs:[{ id, name }] }), ctx);
      assert.equal(out.status, 200);
      assert.equal(out.body.results[0].accepted, true);
    }
    await Promise.all(tasks);
    const status = async () => Object.fromEntries((await env.DB.prepare('SELECT o.dog_key,o.status FROM v3_walk_outbox o JOIN v3_walk_state s ON s.dog_key=o.dog_key AND s.version=o.version').all()).results.map(r => [r.dog_key, r.status]));
    let now11 = await status();
    assert.equal(Object.values(now11).filter(s => s === 'synced').length, 10);
    assert.equal(now11['9203'], 'retry');
    wakes.length = 0; broken = '';
    t.mock.timers.setTime(now + 2 * 60000);
    await run(env, '5-59/10 * * * *');
    assert.deepEqual(wakes, ['9203'], '只重試未成功的那隻');
    now11 = await status();
    assert.ok(Object.values(now11).every(s => s === 'synced'));
  } finally { globalThis.fetch = real; env.DB.close(); }
});
