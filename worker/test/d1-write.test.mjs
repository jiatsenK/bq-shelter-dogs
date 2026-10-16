// #250 休養、入所介紹的寫入改存 D1（v3_rest、v3_intros），不再提交 GitHub；存完馬上讀得到
// 執行：node --test worker/test/d1-write.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { fakeD1 } from './fakes.mjs';
import { migrateCompactDatabase } from '../../scripts/migrate-compact-db.mjs';
import { importCompactDogs } from '../../scripts/import-compact-dogs.mjs';

const SITE = 'https://bq-shelter-dogs.jiatsen-k.workers.dev';
const PASS = '對的通關碼';

async function makeEnv(extra = {}) {
  const DB = fakeD1();
  await migrateCompactDatabase(DB);
  await importCompactDogs(DB, { syncedAt: '2026-10-15T12:00:00+08:00', dogs: [
    { id: '2024032902', name: '測試狗', formerIds: ['2020010101'] },
    { id: '2024010101', name: '別隻' },
  ] });
  return { DB, NOTES_PASSCODE: PASS, ...extra };
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
  await call(env, 'PUT', '/rest/2024010101', { passcode: PASS, until: twDay(5), reason: '別隻' });
  const until = twDay(11);
  const r = await call(env, 'PUT', '/rest/2024032902', { passcode: PASS, until, reason: ' 術後休養\n ' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.rest.until, r.body.rest.reason, r.body.commit], [until, '術後休養', null]);
  const read = await call(env, 'GET', '/rest');
  assert.deepEqual(read.body.rest, { '2024010101': { until: twDay(5), reason: '別隻' }, '2024032902': { until, reason: '術後休養' } });
  const end = await call(env, 'PUT', '/rest/2024032902', { passcode: PASS, end: true });
  assert.deepEqual([end.status, end.body.rest], [200, null]);
  assert.deepEqual(Object.keys((await call(env, 'GET', '/rest')).body.rest), ['2024010101']);
});

test('休養：用舊編號設定也存在同一隻狗，讀回是現在的編號', async () => {
  const env = await makeEnv();
  await call(env, 'PUT', '/rest/2020010101', { passcode: PASS, until: twDay(3) });
  assert.deepEqual(Object.keys((await call(env, 'GET', '/rest')).body.rest), ['2024032902']);
});

test('休養：通關碼錯、日期不對、超過 180 天、原因太長、編號不對都擋，D1 沒變；預覽版不能存', async () => {
  const env = await makeEnv();
  const bad = async (body, status, id = '2024032902') => assert.equal((await call(env, 'PUT', `/rest/${id}`, body)).status, status, JSON.stringify(body));
  await bad({ passcode: '錯的', until: twDay(3) }, 401);
  await bad({ passcode: PASS, until: '2026/10/20' }, 400);
  await bad({ passcode: PASS, until: '2026-02-30' }, 400);
  await bad({ passcode: PASS, until: twDay(-1) }, 400);
  await bad({ passcode: PASS, until: twDay(181) }, 400);
  await bad({ passcode: PASS, until: twDay(3), reason: '字'.repeat(41) }, 413);
  await bad({ passcode: PASS, until: twDay(3) }, 404, '1999999999');
  await bad({ passcode: PASS, until: twDay(3) }, 400, 'a%2Fb');
  assert.deepEqual((await call(env, 'GET', '/rest')).body.rest, {});
  assert.equal((await call(env, 'GET', '/rest/2024032902')).status, 405);
  assert.equal((await call({ ...env, PREVIEW: '1' }, 'PUT', '/rest/2024032902', { passcode: PASS, until: twDay(3) })).status, 403);
  assert.equal((await call({ NOTES_PASSCODE: PASS }, 'PUT', '/rest/2024032902', { passcode: PASS, until: twDay(3) })).status, 503);
});

test('介紹：存進 D1 後 /api/dogs 馬上是新的介紹；清空就拿掉', async () => {
  const env = await makeEnv();
  const r = await call(env, 'PUT', '/intro/2024032902', { passcode: PASS, text: '  親人\r\n喜歡散步  ' });
  assert.deepEqual([r.status, r.body.intro, r.body.commit], [200, '親人\n喜歡散步', null]);
  const intro = async () => (await call(env, 'GET', '/dogs')).body.dogs.find(d => d.id === '2024032902').intro;
  assert.equal(await intro(), '親人\n喜歡散步');
  assert.equal((await call(env, 'PUT', '/intro/2024032902', { passcode: PASS, text: '' })).status, 200);
  assert.equal(await intro(), '');
});

test('介紹：通關碼錯、太長、格式錯、編號不對都擋；預覽版不能存', async () => {
  const env = await makeEnv();
  const bad = async (body, status, id = '2024032902') => assert.equal((await call(env, 'PUT', `/intro/${id}`, body)).status, status);
  await bad({ passcode: '錯的', text: 'x' }, 401);
  await bad({ passcode: PASS, text: '字'.repeat(1001) }, 413);
  await bad({ passcode: PASS, text: 3 }, 400);
  await bad({ passcode: PASS, text: 'x' }, 404, '1999999999');
  assert.equal(await env.DB.prepare('SELECT COUNT(*) AS n FROM v3_intros').first('n'), 0);
  assert.equal((await call(env, 'GET', '/intro/2024032902')).status, 405);
  assert.equal((await call({ ...env, PREVIEW: '1' }, 'PUT', '/intro/2024032902', { passcode: PASS, text: 'x' })).status, 403);
});

// #289 舊編號：誰都能補、都能刪，不用通關碼；/api/dogs 馬上讀得到，D1 留操作紀錄
const dogOf = async (env, id) => (await call(env, 'GET', '/dogs')).body.dogs.find(d => d.id === id);

test('舊編號：補了 /api/dogs 馬上有，刪了就沒有，兩次都記操作紀錄', async () => {
  const env = await makeEnv();
  const add = await call(env, 'POST', '/former/2024032902', { former: ' 2015081801 ' });
  assert.deepEqual([add.status, add.body.former], [200, '2015081801']);
  assert.deepEqual((await dogOf(env, '2024032902')).formerIds, ['2015081801', '2020010101']);
  const del = await call(env, 'DELETE', '/former/2024032902', { former: '2015081801' });
  assert.equal(del.status, 200);
  assert.deepEqual((await dogOf(env, '2024032902')).formerIds, ['2020010101']);
  // 同步匯入的舊編號也能刪
  assert.equal((await call(env, 'DELETE', '/former/2024032902', { former: '2020010101' })).status, 200);
  assert.equal('formerIds' in (await dogOf(env, '2024032902')), false);
  const log = (await env.DB.prepare('SELECT action, number FROM v3_number_log ORDER BY id').all()).results;
  assert.deepEqual(log.map(r => `${r.action}:${r.number}`), ['add:2015081801', 'remove:2015081801', 'remove:2020010101']);
});

test('舊編號：格式、日期、別隻狗的、重複、現在的編號都擋，D1 沒變', async () => {
  const env = await makeEnv();
  const bad = async (method, body, status, id = '2024032902') => assert.equal((await call(env, method, `/former/${id}`, body)).status, status, `${method} ${JSON.stringify(body)}`);
  await bad('POST', { former: '123' }, 400);
  await bad('POST', { former: '2015139901' }, 400);
  await bad('POST', { former: '2025010101' }, 400, '2024032902'); // 比現在的編號晚
  await bad('POST', { former: '2024032902' }, 400);
  await bad('POST', { former: '2024010101' }, 409); // 別隻狗的
  await bad('POST', { former: '2020010101' }, 409); // 已經有
  await bad('POST', { former: '2015081801' }, 404, '2030010101');
  await bad('DELETE', { former: '2024010101' }, 404); // 不是這隻的
  await bad('PUT', { former: '2015081801' }, 405);
  assert.deepEqual((await dogOf(env, '2024032902')).formerIds, ['2020010101']);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM v3_number_log').first('n')), 0);
});

test('舊編號：預覽版不能存', async () => {
  const env = await makeEnv({ PREVIEW: '1' });
  assert.equal((await call(env, 'POST', '/former/2024032902', { former: '2015081801' })).status, 403);
});
