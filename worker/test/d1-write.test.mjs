import { currentEditRevision } from './edit-fixture.mjs';
// #250 休養、入所介紹的寫入改存 D1（v3_rest、v3_intros），不再提交 GitHub；存完馬上讀得到
// 執行：node --test worker/test/d1-write.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { fakeD1 } from './fakes.mjs';
import { createCompactDatabase } from '../../scripts/compact-schema.mjs';
import { importCompactDogs } from './compact-fixtures.mjs';

const SITE = 'https://bq-shelter-dogs.example.workers.dev';
const ME = '小明';

async function makeEnv(extra = {}) {
  const DB = fakeD1();
  await createCompactDatabase(DB);
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
const call = async (env, ...args) => { if(args[2]&&typeof args[2]==='object')args[2]={...args[2],revision:await currentEditRevision(env.DB,args[1])}; const res = await worker.fetch(req(...args), env); return { status: res.status, body: await res.json() }; };
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

test('網站狗群寫入已退役，POST /groups 回 404 且不呼叫試算表', async t => {
  const env = await makeEnv({ SHEET_WRITE_URL: 'https://script.example/exec' });
  const real = globalThis.fetch;
  globalThis.fetch = async () => { assert.fail('不應呼叫試算表'); };
  t.after(() => { globalThis.fetch = real; });
  const r = await call(env, 'POST', '/groups', { op: 'add', column: 4, name: '測試狗', editor: '志工甲' });
  assert.equal(r.status, 404);
});

// #289 舊編號：誰都能補、都能刪，不用通關碼；/api/dogs 馬上讀得到，D1 留操作紀錄
const dogOf = async (env, id) => (await call(env, 'GET', '/dogs')).body.dogs.find(d => d.id === id);

test('舊編號：補了 /api/dogs 馬上有，刪了就沒有，每次都記編輯紀錄', async () => {
  const env = await makeEnv();
  const add = await call(env, 'POST', '/former/2024032902', { editor: ME, former: ' 2015081801 ' });
  assert.deepEqual([add.status, add.body.former], [200, '2015081801']);
  assert.deepEqual((await dogOf(env, '2024032902')).formerIds, ['2015081801', '2020010101']);
  const del = await call(env, 'DELETE', '/former/2024032902', { editor: ME, former: '2015081801' });
  assert.equal(del.status, 200);
  assert.deepEqual((await dogOf(env, '2024032902')).formerIds, ['2020010101']);
  // 同步匯入的舊編號也能刪
  assert.equal((await call(env, 'DELETE', '/former/2024032902', { editor: ME, former: '2020010101' })).status, 200);
  assert.equal('formerIds' in (await dogOf(env, '2024032902')), false);
  const log = (await call(env, 'GET', '/edits')).body.edits.reverse();
  assert.deepEqual(log.map(r => [r.kind, r.kindLabel, r.editorName, r.dogNumber, r.before, r.after]), [
    ['former', '舊編號', ME, '2024032902', ['2020010101','2024032902'], ['2015081801','2020010101','2024032902']],
    ['former', '舊編號', ME, '2024032902', ['2015081801','2020010101','2024032902'], ['2020010101','2024032902']],
    ['former', '舊編號', ME, '2024032902', ['2020010101','2024032902'], ['2024032902']],
  ]);
});

test('舊編號：格式、日期、別隻狗的、重複、現在的編號都擋，D1 沒變', async () => {
  const env = await makeEnv();
  const bad = async (method, body, status, id = '2024032902') => assert.equal((await call(env, method, `/former/${id}`, body)).status, status, `${method} ${JSON.stringify(body)}`);
  await bad('POST', { editor: ME, former: '123' }, 400);
  await bad('POST', { editor: ME, former: '2015139901' }, 400);
  await bad('POST', { editor: ME, former: '2025010101' }, 400, '2024032902'); // 比現在的編號晚
  await bad('POST', { editor: ME, former: '2024032902' }, 400);
  await bad('POST', { editor: ME, former: '2024010101' }, 409); // 別隻狗的
  await bad('POST', { editor: ME, former: '2020010101' }, 409); // 已經有
  await bad('POST', { editor: ME, former: '2015081801' }, 404, '2030010101');
  await bad('DELETE', { editor: ME, former: '2024010101' }, 404); // 不是這隻的
  await bad('PUT', { editor: ME, former: '2015081801' }, 405);
  await bad('POST', { former: '2015081801' }, 400); // 沒選名字
  await bad('POST', { editor: ME, former: '2015081801', pad: 'x'.repeat(3000) }, 413); // 本文太大（跟其他狗資料編輯一樣有上限）
  assert.deepEqual((await dogOf(env, '2024032902')).formerIds, ['2020010101']);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM v3_edit_log WHERE kind='former'").first('n')), 0);
});

test('舊編號：預覽版不能存', async () => {
  const env = await makeEnv({ PREVIEW: '1' });
  assert.equal((await call(env, 'POST', '/former/2024032902', { editor: ME, former: '2015081801' })).status, 403);
});

// #333 出入所紀錄（ADR 0011）：一隻狗一列、整份覆蓋；送出改之前的內容，別人剛改過就擋（409）
const stays = (env, id, body) => call(env, 'PUT', `/stays/${id}`, { editor: ME, ...body });

test('出入所紀錄：存了 /api/dogs 馬上有、照入所日排，空陣列就刪掉這一列，每次都記編輯紀錄', async () => {
  const env = await makeEnv();
  const list = [{ in: '2019-03-01', out: '2019-06-01', reason: ' 整修移所 ' }, { in: '2015-08-18', out: '', reason: '迷路' }];
  const r = await stays(env, '2024032902', { before: [], stays: list });
  assert.equal(r.status, 200);
  const saved = [{ in: '2015-08-18', out: '', reason: '迷路' }, { in: '2019-03-01', out: '2019-06-01', reason: '整修移所' }];
  assert.deepEqual(r.body.stays, saved);
  assert.deepEqual((await dogOf(env, '2024032902')).stays, saved);
  assert.equal('stays' in (await dogOf(env, '2024010101')), false);
  // 用舊編號改也是同一隻
  assert.equal((await stays(env, '2020010101', { before: saved, stays: [] })).status, 200);
  assert.equal('stays' in (await dogOf(env, '2024032902')), false);
  assert.equal(await env.DB.prepare('SELECT COUNT(*) AS n FROM v3_stays').first('n'), 0);
  const log = (await call(env, 'GET', '/edits')).body.edits.reverse();
  assert.deepEqual(log.map(e => [e.kind, e.kindLabel, e.editorName, e.before, e.after]), [
    ['stays', '出入所紀錄', ME, null, saved],
    ['stays', '出入所紀錄', ME, saved, null],
  ]);
});

test('出入所紀錄：兩支手機同時改，後送的人帶的舊內容對不上就回 409，不蓋掉', async () => {
  const env = await makeEnv();
  const a = [{ in: '2015-08-18', out: '', reason: '迷路' }];
  assert.equal((await stays(env, '2024032902', { before: [], stays: a })).status, 200);
  const late = await stays(env, '2024032902', { before: [], stays: [{ in: '2016-01-01', out: '', reason: '流浪' }] });
  assert.equal(late.status, 409);
  assert.match(late.body.error, /別人剛改過/);
  assert.equal((await stays(env, '2024032902', { stays: [] })).status, 409); // 沒帶舊內容也不行
  assert.deepEqual((await dogOf(env, '2024032902')).stays, a);
});

test('出入所紀錄：日期格式、未來的日子、出所早於入所、原因太長、沒選名字、找不到狗都擋', async () => {
  const env = await makeEnv();
  const bad = async (body, status, id = '2024032902') => assert.equal((await call(env, 'PUT', `/stays/${id}`, { before: [], ...body })).status, status, JSON.stringify(body));
  const one = s => ({ editor: ME, stays: [s] });
  await bad(one({ in: '2015/08/18', out: '', reason: '' }), 400);
  await bad(one({ in: '2015-02-30', out: '', reason: '' }), 400);
  await bad(one({ in: twDay(1), out: '', reason: '' }), 400);
  await bad(one({ in: '2015-08-18', out: twDay(1), reason: '' }), 400);
  await bad(one({ in: '2015-08-18', out: '2015-08-17', reason: '' }), 400);
  await bad(one({ in: '2015-08-18', out: '', reason: '字'.repeat(41) }), 400);
  await bad({ editor: ME, stays: 'x' }, 400);
  await bad({ stays: [] }, 400); // 沒選名字
  await bad(one({ in: '2015-08-18', out: '', reason: '' }), 404, '2030010101');
  assert.equal((await call(env, 'POST', '/stays/2024032902', { editor: ME, before: [], stays: [] })).status, 405);
  assert.equal(await env.DB.prepare('SELECT COUNT(*) AS n FROM v3_stays').first('n'), 0);
  assert.equal(await env.DB.prepare("SELECT COUNT(*) AS n FROM v3_edit_log WHERE kind='stays'").first('n'), 0);
});

test('出入所紀錄：今天可以、預覽版不能存', async () => {
  const env = await makeEnv();
  assert.equal((await stays(env, '2024032902', { before: [], stays: [{ in: twDay(0), out: '', reason: '' }] })).status, 200);
  const preview = await makeEnv({ PREVIEW: '1' });
  assert.equal((await stays(preview, '2024032902', { before: [], stays: [] })).status, 403);
});

test('出入所紀錄：Worker 不看在不在所，用編號找得到狗就能補（ADR 0011，離所的狗也能改）', async () => {
  const env = await makeEnv();
  const id = await env.DB.prepare("SELECT dog_id FROM v3_dog_numbers WHERE number='2024010101'").first('dog_id');
  const r = await stays(env, '2024010101', { before: [], stays: [{ in: '2015-08-18', out: '', reason: '迷路' }] });
  assert.equal(r.status, 200);
  assert.equal(await env.DB.prepare('SELECT COUNT(*) AS n FROM v3_stays WHERE dog_id=?').bind(id).first('n'), 1);
});

test('網址沒帶狗狗編號：每種編輯都回 400「狗狗編號格式不對」，不是要人先選名字', async () => {
  const env = await makeEnv();
  for (const [method, kind] of [['PUT', 'rest'], ['PUT', 'fixed-care'], ['PUT', 'intro'], ['POST', 'former'], ['PUT', 'stays']]) {
    const { status, body } = await call(env, method, `/${kind}/`, { editor: ME });
    assert.equal(status, 400, kind);
    assert.equal(body.error, '狗狗編號格式不對', kind);
  }
});
