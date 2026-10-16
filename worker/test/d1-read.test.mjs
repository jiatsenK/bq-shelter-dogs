// #247 溜狗表改讀精簡 D1（v3_ 表）：GET /api/dogs、開卡、名字推薦、狀態頁
// 執行：node --test worker/test/d1-read.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { fakeD1 } from './fakes.mjs';
import { migrateCompactDatabase } from '../../scripts/migrate-compact-db.mjs';
import { importCompactDogs } from '../../scripts/import-compact-dogs.mjs';
import { importCompactProfiles } from '../../scripts/import-compact-profiles.mjs';
import { importCompactDepartures } from '../../scripts/import-compact-departures.mjs';
import { readMainNames, HISTORY_START } from '../src/compact.js';

const SITE = 'https://bq-shelter-dogs.<子網域>.workers.dev';
const SOURCE = {
  version: 1,
  syncedAt: '2026-10-15T12:00:55+08:00',
  dogs: [
    { cage: '母幼A', id: '2025022703', name: '滿滿', walkedDate: null, covered: true, myWalked: false, walkers: ['e9c69473e76f'], note: '移籠', sex: 'male', intro: '民眾拾獲', myWalkedDate: null },
    { cage: '新B08', id: '2026051203', name: '圓仔', walkedDate: '2026-10-14', covered: false, myWalked: false, walkers: [], note: '', sex: 'female', intro: '', formerIds: ['2018041318'], myWalkedDate: null },
    { cage: '住院', id: '', name: '沒編號', walkedDate: '2026-10-15', covered: false, myWalked: false, walkers: ['da53fbdda293', 'dcda49f5b985'], note: '', sex: '', intro: '', myWalkedDate: null },
  ],
};

async function seededDb() {
  const DB = fakeD1();
  await migrateCompactDatabase(DB);
  await importCompactDogs(DB, SOURCE);
  // 介紹是 D1 自己存的（#250）
  await DB.prepare("INSERT INTO v3_intros SELECT dog_id,'民眾拾獲' FROM v3_dog_numbers WHERE number='2025022703'").run();
  // 分組：第 0 欄 滿滿＋圓仔，第 1 欄 圓仔＋沒編號
  for (const [col, row, name] of [[0, 0, '滿滿'], [0, 1, '圓仔'], [1, 0, '圓仔'], [1, 1, '沒編號']]) {
    await DB.prepare('INSERT INTO v3_sheet_groups VALUES(?,?,?)').bind(col, row, name).run();
  }
  await DB.prepare('INSERT INTO v3_sheet_changes VALUES(?,?,?)').bind(0, '10/14', '圓仔移到新B08').run();
  await DB.prepare('INSERT INTO v3_sheet_changes VALUES(?,?,?)').bind(1, '', '').run();
  return DB;
}

const get = (path, env, headers = { 'Sec-Fetch-Site': 'same-origin' }) =>
  worker.fetch(new Request(`${SITE}/api${path}`, { headers }), env);
const send = (method, path, body, env) => worker.fetch(new Request(`${SITE}/api${path}`, {
  method, headers: { Origin: SITE, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), env);

test.beforeEach(() => worker.testing.resetState());

test('GET /api/dogs：從 D1 組回跟 dogs.json 一樣的形狀（順序、欄位、舊編號、分組、異動紀錄）', async () => {
  const DB = await seededDb();
  const res = await get('/dogs', { DB });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.version, 1);
  assert.equal(body.syncedAt, SOURCE.syncedAt);
  assert.deepEqual(body.dogs, SOURCE.dogs);
  assert.deepEqual(body.groups, { 滿滿: ['圓仔'], 圓仔: ['滿滿', '沒編號'], 沒編號: ['圓仔'] });
  assert.deepEqual(body.sheetNotes, [{ label: '10/14', text: '圓仔移到新B08' }]);
});

test('GET /api/dogs：D1 失敗、沒接、還沒有狗都回 503 和清楚的錯誤，不回空清單', async () => {
  const broken = { prepare: () => ({ bind() { return this; } }), batch: async () => { throw new Error('D1_ERROR'); } };
  for (const env of [{ DB: broken }, {}, { DB: await (async () => { const DB = fakeD1(); await migrateCompactDatabase(DB); return DB; })() }]) {
    const res = await get('/dogs', env);
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'db');
    assert.match(body.error, /資料庫/);
    assert.equal(body.dogs, undefined);
  }
});

test('GET /api/dogs：只收 GET；別的網站擋掉；預覽版照常可讀', async () => {
  const DB = await seededDb();
  assert.equal((await get('/dogs', { DB, PREVIEW: '1' })).status, 200);
  assert.equal((await get('/dogs', { DB }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await send('POST', '/dogs', {}, { DB })).status, 405);
});

test('開卡改用 v3_card_opened：用編號找永久狗 ID 存；讀回時用現在的編號；舊編號開的卡也對到同一隻', async () => {
  const DB = await seededDb();
  const code = 'abcdef123456', other = '123456abcdef';
  assert.equal((await send('PUT', '/cards/opened', { codes: [code], ids: ['2025022703'] }, { DB })).status, 200);
  assert.equal((await send('PUT', '/cards/opened', { codes: [code], ids: ['2025022703'] }, { DB })).status, 200);
  assert.equal((await send('PUT', '/cards/opened', { codes: [code], ids: ['2018041318'] }, { DB })).status, 200, '舊編號');
  const { results } = await DB.prepare('SELECT walker_code, dog_id FROM v3_card_opened').all();
  assert.equal(results.length, 2, '重送不重複');
  const dogIds = (await DB.prepare("SELECT number, dog_id FROM v3_dog_numbers WHERE number IN ('2025022703','2026051203')").all()).results;
  assert.deepEqual(new Set(results.map(r => r.dog_id)), new Set(dogIds.map(r => r.dog_id)), '存永久狗 ID');
  const out = await (await get(`/cards/opened?codes=${code},${other}`, { DB })).json();
  assert.deepEqual(Object.keys(out.opened.codes[code]).sort(), ['2025022703', '2026051203']);
  assert.match(out.opened.codes[code]['2026051203'], /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(out.opened.codes[other], {});
  assert.equal((await send('PUT', '/cards/opened', { codes: [code], ids: ['9999999999'] }, { DB })).status, 400, '不認得的編號');
  assert.equal((await send('PUT', '/cards/opened', { codes: [code], ids: ['2025022703'] }, { DB, PREVIEW: '1' })).status, 403);
  assert.equal((await get(`/cards/opened?codes=${code}`, {})).status, 503);
});

test('#267 常溜永久 ID：跨裝置增刪不覆蓋、合併別名、再入所與無編號狗', async t => {
  const DB = await seededDb(); t.after(() => DB.close());
  const code = 'abcdef123456', alias = '123456abcdef';
  const read = async (codes = [code]) => (await get(`/favorites?codes=${codes.join(',')}`, { DB })).json();
  const initial = await read();
  const a = initial.aliases['2025022703'], b = initial.aliases['2018041318'];
  assert.match(a, /^[a-f0-9]{32}$/);
  assert.equal(b, initial.aliases['2026051203'], '新舊編號對同一永久 ID');
  assert.match(initial.aliases['名:沒編號'], /^[a-f0-9]{32}$/);
  const put = async (dogId, on, codes = [code]) => send('PUT', '/favorites', { dogId, on, codes }, { DB });
  assert.equal((await put(a, true)).status, 200);
  assert.equal((await put(a, true)).status, 200, '重試冪等');
  await put(a, true, [code, alias]);
  assert.deepEqual((await read([alias])).ids, [], 'API 新增只寫首碼');
  assert.equal((await put(b, true)).status, 200, '另一台新增另一隻');
  assert.deepEqual(new Set((await read()).ids), new Set([a, b]));
  await put(a, false);
  assert.deepEqual((await read()).ids, [b], '只刪指定狗，另一台新增仍保留');
  await put(a, true, [alias]);
  assert.deepEqual(new Set((await read([code, alias])).ids), new Set([a, b]));
  await put(a, false, [code, alias]);
  assert.deepEqual((await read([code, alias])).ids, [b]);
  await DB.prepare('INSERT INTO v3_dog_numbers VALUES(?,?)').bind('2026101601', b).run();
  await DB.prepare("UPDATE v3_sheet_main SET number='2026101601',name='新名字' WHERE dog_id=?").bind(b).run();
  const returned = await read();
  assert.equal(returned.aliases['2026101601'], b);
  assert.deepEqual(returned.ids, [b], '換編號仍收藏');
  await DB.prepare("INSERT INTO v3_dogs(name) VALUES('沒編號')").run();
  assert.equal((await read()).aliases['名:沒編號'], undefined, '同名不猜');
});

test('#267 常溜 API 驗證、跨站與預覽寫入保護', async t => {
  const DB = await seededDb(); t.after(() => DB.close());
  const path = '/favorites', codes = ['abcdef123456'];
  assert.equal((await get(path + '?codes=bad', { DB })).status, 400);
  assert.equal((await get(path + '?codes=' + codes[0], {})).status, 503);
  assert.equal((await get(path + '?codes=' + codes[0], { DB }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await send('POST', path, {}, { DB })).status, 405);
  for (const body of [{ codes, dogId: 'bad', on: true }, { codes, dogId: '0'.repeat(32), on: true }, { codes, dogId: '0'.repeat(32), on: 'yes' }, { codes: [], on: true }]) {
    assert.equal((await send('PUT', path, body, { DB })).status, 400);
  }
  assert.equal((await send('PUT', path, { codes }, { DB, PREVIEW: '1' })).status, 403);
});

test('名字推薦改用 v3_volunteers：表上的名字記進去、以前看過的放 older；資料庫壞了照舊', async () => {
  const DB = await seededDb();
  await DB.prepare('INSERT INTO v3_volunteers(name, last_seen) VALUES(?,?)').bind('老K', '2026-10-01T00:00:00.000Z').run();
  await DB.prepare('INSERT INTO v3_volunteers(name, last_seen) VALUES(?,?)').bind('阿德', '2026-09-01T00:00:00.000Z').run();
  const { rememberWalkerNames } = await import('../src/index.js');
  assert.deepEqual(await rememberWalkerNames({ DB }, ['志工乙', '老K'], Date.parse('2026-10-15T00:00:00Z')), ['阿德']);
  const rows = (await DB.prepare('SELECT name, last_seen FROM v3_volunteers ORDER BY name').all()).results;
  assert.deepEqual(rows.map(r => r.name).sort(), ['志工乙', '老K', '阿德'].sort());
  assert.equal(rows.find(r => r.name === '老K').last_seen, '2026-10-15T00:00:00.000Z');
  assert.deepEqual(await rememberWalkerNames({ DB: { prepare() { throw new Error('x'); } } }, ['志工乙']), []);
});

test('狀態頁：顯示新資料庫有沒有接上、狗和主清單幾筆；還沒建表或沒接都不會壞', async () => {
  const status = async env => (await (await worker.fetch(new Request(`${SITE}/api/`), env)).json()).database;
  assert.equal(await status({}), '未設定');
  assert.equal(await status({ DB: await seededDb() }), 'D1 新表（狗 3、主清單 3、溜狗紀錄 0）');
  assert.equal(await status({ DB: fakeD1() }), 'D1（新表還沒建）');
});

// #260 網站不再讀 data/walks.json、data/departures.json、data/history/
test('GET /api/walks：形狀跟 walks.json 一樣，帶開始記錄日；沒記人的舊紀錄沒有 walkers', async () => {
  const DB = await seededDb();
  const walks = [
    { id: '2026051203', name: '圓仔', date: '2026-09-01' },
    { id: '2025022703', name: '滿滿', date: '2026-10-14', walkers: ['e9c69473e76f', 'aaaaaaaaaaaa'] },
    { id: '', name: '沒編號', date: '2026-10-15', walkers: ['da53fbdda293'] },
  ];
  await importCompactProfiles(DB, { walks: { version: 1, walks } });
  const body = await (await get('/walks', { DB })).json();
  assert.equal(body.ok, true);
  assert.equal(body.historyStart, HISTORY_START);
  assert.deepEqual(body.walks, walks);
});

test('GET /api/departures：形狀跟 departures.json 一樣', async () => {
  const DB = await seededDb();
  const departures = [{ id: '2021030913', name: '咪寶', date: '2026-10-13', dateSource: 'note', seen: '2026-10-13', reason: 'adopt', matched: '被領養', flags: [],
    last: { cage: 'C區11', id: '2021030913', name: '咪寶', walkedDate: '2026-10-13', note: '', sex: 'female', intro: '' } }];
  await importCompactDepartures(DB, departures);
  const body = await (await get('/departures', { DB })).json();
  assert.deepEqual(body, { ok: true, version: 1, departures });
});

test('GET /api/walks、/api/departures：D1 壞了或沒接回 503；只收 GET', async () => {
  const broken = { prepare: () => ({ bind() { return this; }, all: async () => { throw new Error('D1_ERROR'); } }), batch: async () => { throw new Error('D1_ERROR'); } };
  for (const path of ['/walks', '/departures']) {
    for (const env of [{ DB: broken }, {}]) {
      const res = await get(path, env);
      assert.equal(res.status, 503);
      assert.equal((await res.json()).code, 'db');
    }
    assert.equal((await send('POST', path, {}, { DB: await seededDb() })).status, 405);
  }
});

test('照片、備註確認編號改讀 D1 主清單：只收有編號的狗；主清單空的丟錯', async () => {
  const DB = await seededDb();
  assert.deepEqual([...await readMainNames(DB)], [['2025022703', '滿滿'], ['2026051203', '圓仔']]);
  const empty = fakeD1(); await migrateCompactDatabase(empty);
  await assert.rejects(readMainNames(empty), /沒有資料/);
});
