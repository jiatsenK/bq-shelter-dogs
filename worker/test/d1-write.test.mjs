// #250 休養、入所介紹的寫入改存 D1（v3_rest、v3_intros），不再提交 GitHub；存完馬上讀得到
// 執行：node --test worker/test/d1-write.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { fakeD1 } from './fakes.mjs';
import { migrateCompactDatabase } from '../../scripts/migrate-compact-db.mjs';
import { importCompactDogs } from '../../scripts/import-compact-dogs.mjs';

const SITE = 'https://bq-shelter-dogs.<子網域>.workers.dev';
const ME = '小明';

async function makeEnv(extra = {}) {
  const DB = fakeD1();
  await migrateCompactDatabase(DB);
  await importCompactDogs(DB, { syncedAt: '2026-10-15T12:00:00+08:00', dogs: [
    { id: '2024032902', name: '測試狗', formerIds: ['2020010101'] },
    { id: '2024010101', name: '別隻' },
  ] });
  return { DB, WALKER_KEY: 'test-walker-key', ...extra };
}

// 不准碰 GitHub：有人呼叫 fetch 就讓測試失敗
test.beforeEach(t => {
  worker.testing.resetState();
  const real = globalThis.fetch;
  globalThis.fetch = async url => { throw new Error(`不應該連外：${url}`); };
  t.after(() => { globalThis.fetch = real; });
});

const req = (method, path, body, ip = '1.1.1.1') => new Request(`${SITE}/api${path}`, {
  method, headers: { Origin: SITE, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: body === undefined ? undefined : JSON.stringify(body),
});
const call = async (env, ...args) => { const res = await worker.fetch(req(...args), env); return { status: res.status, body: await res.json() }; };
const twDay = n => new Date(Date.now() + 8 * 3600 * 1000 + n * 86400000).toISOString().slice(0, 10);

test('休養：存進 D1 後 GET /api/rest 馬上讀得到，不動別隻；結束休養就拿掉', async () => {
  const env = await makeEnv();
  await call(env, 'PUT', '/rest/2024010101', { editor: ME, until: twDay(5), reason: '別隻' });
  const until = twDay(11);
  const r = await call(env, 'PUT', '/rest/2024032902', { editor: ME, until, reason: ' 術後休養\n ' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.rest.until, r.body.rest.reason, r.body.commit], [until, '術後休養', null]);
  const read = await call(env, 'GET', '/rest');
  assert.deepEqual(read.body.rest, { '2024010101': { until: twDay(5), reason: '別隻' }, '2024032902': { until, reason: '術後休養' } });
  const end = await call(env, 'PUT', '/rest/2024032902', { editor: ME, end: true });
  assert.deepEqual([end.status, end.body.rest], [200, null]);
  assert.deepEqual(Object.keys((await call(env, 'GET', '/rest')).body.rest), ['2024010101']);
});

test('休養：用舊編號設定也存在同一隻狗，讀回是現在的編號', async () => {
  const env = await makeEnv();
  await call(env, 'PUT', '/rest/2020010101', { editor: ME, until: twDay(3) });
  assert.deepEqual(Object.keys((await call(env, 'GET', '/rest')).body.rest), ['2024032902']);
});

test('休養：沒選名字、日期不對、超過 180 天、原因太長、編號不對都擋，D1 沒變；預覽版不能存', async () => {
  const env = await makeEnv();
  const bad = async (body, status, id = '2024032902') => assert.equal((await call(env, 'PUT', `/rest/${id}`, body)).status, status, JSON.stringify(body));
  await bad({ until: twDay(3) }, 400);
  await bad({ editor: ME, until: '2026/10/20' }, 400);
  await bad({ editor: ME, until: '2026-02-30' }, 400);
  await bad({ editor: ME, until: twDay(-1) }, 400);
  await bad({ editor: ME, until: twDay(181) }, 400);
  await bad({ editor: ME, until: twDay(3), reason: '字'.repeat(41) }, 413);
  await bad({ editor: ME, until: twDay(3) }, 404, '1999999999');
  await bad({ editor: ME, until: twDay(3) }, 400, 'a%2Fb');
  assert.deepEqual((await call(env, 'GET', '/rest')).body.rest, {});
  assert.equal((await call(env, 'GET', '/rest/2024032902')).status, 405);
  assert.equal((await call({ ...env, PREVIEW: '1' }, 'PUT', '/rest/2024032902', { editor: ME, until: twDay(3) })).status, 403);
  assert.equal((await call({}, 'PUT', '/rest/2024032902', { editor: ME, until: twDay(3) })).status, 503);
});

test('介紹：存進 D1 後 /api/dogs 馬上是新的介紹；清空就拿掉', async () => {
  const env = await makeEnv();
  const r = await call(env, 'PUT', '/intro/2024032902', { editor: ME, text: '  親人\r\n喜歡散步  ' });
  assert.deepEqual([r.status, r.body.intro, r.body.commit], [200, '親人\n喜歡散步', null]);
  const intro = async () => (await call(env, 'GET', '/dogs')).body.dogs.find(d => d.id === '2024032902').intro;
  assert.equal(await intro(), '親人\n喜歡散步');
  assert.equal((await call(env, 'PUT', '/intro/2024032902', { editor: ME, text: '' })).status, 200);
  assert.equal(await intro(), '');
});

test('介紹：沒選名字、太長、格式錯、編號不對都擋；預覽版不能存', async () => {
  const env = await makeEnv();
  const bad = async (body, status, id = '2024032902') => assert.equal((await call(env, 'PUT', `/intro/${id}`, body)).status, status);
  await bad({ text: 'x' }, 400);
  await bad({ editor: ME, text: '字'.repeat(1001) }, 413);
  await bad({ editor: ME, text: 3 }, 400);
  await bad({ editor: ME, text: 'x' }, 404, '1999999999');
  assert.equal(await env.DB.prepare('SELECT COUNT(*) AS n FROM v3_intros').first('n'), 0);
  assert.equal((await call(env, 'GET', '/intro/2024032902')).status, 405);
  assert.equal((await call({ ...env, PREVIEW: '1' }, 'PUT', '/intro/2024032902', { editor: ME, text: 'x' })).status, 403);
});

test('編輯紀錄（ADR 0004）：休養、介紹存好記一筆誰改的、改前改後；GET /api/edits 新到舊；沒選名字不能改也不記', async () => {
  const env = await makeEnv();
  await call(env, 'PUT', '/intro/2024032902', { editor: ME, text: '親人' });
  await call(env, 'PUT', '/intro/2024032902', { editor: '阿華', text: '很親人' });
  await call(env, 'PUT', '/rest/2020010101', { editor: ME, until: twDay(3), reason: '術後' });
  const bad = await call(env, 'PUT', '/intro/2024032902', { editor: '  ', text: 'x' });
  assert.deepEqual([bad.status, bad.body.code], [400, 'editor']);
  const { body } = await call(env, 'GET', '/edits');
  assert.equal(body.edits.length, 3);
  const [rest, intro2, intro1] = body.edits;
  assert.deepEqual([rest.kind, rest.kindLabel, rest.editorName, rest.dogNumber, rest.before, rest.after], ['rest', '休養', ME, '2020010101', null, { until: twDay(3), reason: '術後' }]);
  assert.deepEqual([intro2.editorName, intro2.before, intro2.after], ['阿華', '親人', '很親人']);
  assert.deepEqual([intro1.before, intro1.after], ['', '親人']);
  assert.equal(intro1.editorCode, await worker.testing.walkerCode(ME, 'test-walker-key'));
  assert.equal(rest.dogId, intro1.dogId);
  assert.equal((await call(env, 'GET', '/edits?limit=1')).body.edits.length, 1);
  assert.equal((await call(env, 'POST', '/edits', {})).status, 405);
});

// ── 編輯常遛狗群（K 2026-10-16）：轉給小程式，成功後 D1 那一欄馬上換成小程式回的名單 ──
async function groupEnv() {
  const env = await makeEnv({ SHEET_WRITE_URL: 'https://script.example/exec' });
  await env.DB.prepare("UPDATE v3_sheet_main SET name = 'MINI' WHERE name = '別隻'").run(); // 主清單寫法是大寫
  await env.DB.prepare('INSERT INTO v3_sheet_groups VALUES(4,0,?)').bind('測試狗').run();
  return env;
}
function fakeGroupScript(t, reply) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { const body = JSON.parse(init.body); calls.push(body); return new Response(JSON.stringify(reply(body))); };
  t.after(() => { globalThis.fetch = real; });
  return calls;
}

test('狗群 add：狗名換成主清單寫法再送小程式，D1 那一欄和群名馬上更新，api/dogs 讀得到', async t => {
  const env = await groupEnv();
  const calls = fakeGroupScript(t, () => ({ ok: true, result: { status: 'written', column: 4, label: '新十', names: ['測試狗', 'Mini'] } }));
  const r = await call(env, 'POST', '/groups', { op: 'add', column: 4, name: 'mini', editor: '志工甲' });
  assert.equal(r.status, 200);
  assert.deepEqual(calls, [{ action: 'group', op: 'add', name: 'MINI', column: 4 }]);
  assert.deepEqual(r.body.group, { column: 4, label: '新十', names: ['測試狗', 'MINI'] });
  const rows = (await env.DB.prepare('SELECT column_index, row_index, name FROM v3_sheet_groups ORDER BY row_index').all()).results;
  assert.deepEqual(rows, [{ column_index: 4, row_index: 0, name: '測試狗' }, { column_index: 4, row_index: 1, name: 'MINI' }]);
  assert.deepEqual((await env.DB.prepare('SELECT * FROM v3_sheet_group_labels').all()).results, [{ column_index: 4, label: '新十' }]);
  const log = (await env.DB.prepare('SELECT editor_name, kind, before_json, after_json FROM v3_edit_log').all()).results;
  assert.deepEqual(log, [{ editor_name: '志工甲', kind: 'group', before_json: JSON.stringify({ label: '新十', names: ['測試狗'] }), after_json: JSON.stringify({ label: '新十', names: ['測試狗', 'MINI'] }) }]);
});

test('狗群：擋掉不在主清單的狗、沒群名的新群、壞的欄號，不連小程式', async t => {
  const env = await groupEnv();
  const calls = fakeGroupScript(t, () => ({ ok: true }));
  assert.equal((await call(env, 'POST', '/groups', { op: 'add', column: 4, name: 'MINI' })).body.code, 'editor', '沒選名字不能編輯');
  assert.equal((await call(env, 'POST', '/groups', { op: 'add', column: 4, name: '路人狗', editor: '志工甲' })).status, 400);
  assert.equal((await call(env, 'POST', '/groups', { op: 'create', name: 'MINI', label: '' })).status, 400);
  assert.equal((await call(env, 'POST', '/groups', { op: 'remove', column: -1, name: 'MINI' })).status, 400);
  assert.equal((await call(env, 'POST', '/groups', { op: 'rename', column: 4, name: 'MINI' })).status, 400);
  assert.equal((await call(env, 'GET', '/groups')).status, 405);
  assert.equal(calls.length, 0);
});

test('狗群：小程式回錯誤就不動 D1', async t => {
  const env = await groupEnv();
  fakeGroupScript(t, () => ({ ok: false, error: '找不到這一群' }));
  const r = await call(env, 'POST', '/groups', { op: 'remove', column: 4, name: '測試狗', editor: '志工甲' });
  assert.equal(r.status, 502);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM v3_sheet_groups').first()).n, 1);
});
