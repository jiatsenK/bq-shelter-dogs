// #315 歷史資料包＋只讀今天（ADR 0009）：輸出和直接讀表逐字元相同，沒變時每次只讀 1 列版本號
// 執行：node --test worker/test/packs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { setPackChunkBytes } from '../src/packs.js';
import { readDogsPayload, readWalks, readDepartures, readRest } from '../src/compact.js';
import { fakeD1 } from './fakes.mjs';
import { migrateCompactDatabase } from '../../scripts/migrate-compact-db.mjs';
import { importCompactDogs } from '../../scripts/import-compact-dogs.mjs';
import { importCompactProfiles } from '../../scripts/import-compact-profiles.mjs';
import { importCompactDepartures } from '../../scripts/import-compact-departures.mjs';

const SITE = 'https://bq-shelter-dogs.<子網域>.workers.dev';
// 台灣時間 2026-10-16 10:00
const NOW = Date.parse('2026-10-16T02:00:00Z');
const TODAY = '2026-10-16';
const dog = (id, name, extra = {}) => ({ cage: 'A1', id, name, walkedDate: null, covered: false, myWalked: false, walkers: [], note: '', sex: '', intro: '', myWalkedDate: null, ...extra });
const SOURCE = { version: 1, syncedAt: '2026-10-16T08:00:00+08:00', dogs: [dog('2025022703', '滿滿'), dog('2026051203', '圓仔'), dog('', '沒編號')] };
const WALKS = [
  { id: '2026051203', name: '圓仔', date: '2026-09-01' },
  { id: '2025022703', name: '滿滿', date: '2026-10-14', walkers: ['e9c69473e76f', 'aaaaaaaaaaaa'] },
  { id: '2026051203', name: '圓仔', date: '2026-10-15', walkers: ['bbbbbbbbbbbb'] },
  { id: '', name: '沒編號', date: TODAY, walkers: ['da53fbdda293'] },
];

async function seededDb(t) {
  const DB = fakeD1(); t.after(() => DB.close());
  await migrateCompactDatabase(DB);
  await importCompactDogs(DB, SOURCE);
  await importCompactProfiles(DB, { walks: { version: 1, walks: WALKS } });
  await importCompactDepartures(DB, [{ id: '2021030913', name: '咪寶', date: '2026-10-13', dateSource: 'note', seen: '2026-10-13', reason: 'adopt', matched: '被領養', flags: [] }]);
  await DB.prepare("INSERT INTO v3_rest SELECT dog_id,'2026-10-30','腳傷' FROM v3_dog_numbers WHERE number='2025022703'").run();
  return DB;
}

const get = (path, env) => worker.fetch(new Request(`${SITE}/api${path}`, { headers: { 'Sec-Fetch-Site': 'same-origin' } }), env);
const send = (method, path, body, env) => worker.fetch(new Request(`${SITE}/api${path}`, {
  method, headers: { Origin: SITE, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), env);
const PATHS = ['/dogs', '/walks', '/departures', '/rest'];

// 現在的讀法（直接讀表）算出來的回應
async function direct(DB, path) {
  if (path === '/dogs') return { ok: true, ...await readDogsPayload(DB) };
  if (path === '/walks') return { ok: true, ...await readWalks(DB) };
  if (path === '/departures') return { ok: true, version: 1, departures: await readDepartures(DB) };
  return { ok: true, rest: await readRest(DB) };
}
async function assertSame(DB, label) {
  for (const path of PATHS) {
    const res = await get(path, { DB });
    assert.equal(res.status, 200, `${label} ${path}`);
    assert.equal(await res.text(), JSON.stringify(await direct(DB, path)), `${label} ${path}`);
  }
}
// 一次請求讀了幾列
async function readsOf(DB, path) {
  const before = DB.stats.rowsRead;
  assert.equal((await get(path, { DB })).status, 200);
  return DB.stats.rowsRead - before;
}
const packRows = async (DB, part) => (await DB.prepare('SELECT seq,ver,cutoff FROM v3_packs WHERE part=? ORDER BY seq').bind(part).all()).results;

test.beforeEach(t => {
  worker.testing.resetState();
  setPackChunkBytes(1_000_000);
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
});

test('輸出和直接讀表逐字元相同：改介紹、改休養、同步、改過去的紀錄、新增今天的紀錄', async t => {
  const DB = await seededDb(t);
  await assertSame(DB, '一開始');
  await DB.prepare("INSERT INTO v3_intros SELECT dog_id,'新介紹' FROM v3_dog_numbers WHERE number='2026051203'").run();
  await assertSame(DB, '改介紹');
  await DB.prepare("INSERT INTO v3_intake_events(dog_id,position,number,event_date,event) SELECT dog_id,0,'2025022703','2025-02-27','入所' FROM v3_dog_numbers WHERE number='2025022703'").run();
  await assertSame(DB, '改入所事件');
  await DB.prepare("UPDATE v3_rest SET reason='好了一半'").run();
  await assertSame(DB, '改休養');
  await DB.prepare("UPDATE v3_sheet_main SET note='移籠', synced_at='2026-10-16T09:00:00+08:00'").run();
  await assertSame(DB, '同步');
  await DB.prepare("UPDATE v3_walks SET walker_code='cccccccccccc' WHERE walk_date='2026-10-14' AND position=0").run();
  await assertSame(DB, '改過去的紀錄');
  await DB.prepare("DELETE FROM v3_walks WHERE walk_date='2026-09-01'").run();
  await assertSame(DB, '刪過去的紀錄');
  await DB.prepare("INSERT INTO v3_walks(dog_id,walk_date,position,walker_code,dog_number,dog_name) SELECT dog_id,?,0,'dddddddddddd','2025022703','滿滿' FROM v3_dog_numbers WHERE number='2025022703'").bind(TODAY).run();
  await assertSame(DB, '新增今天的紀錄');
  // 過去的紀錄改成今天：兩邊都要更新
  await DB.prepare("UPDATE v3_walks SET walk_date=? WHERE walk_date='2026-10-15'").bind(TODAY).run();
  await assertSame(DB, '過去改成今天');
});

test('網站改介紹、休養：改的那台下一次讀就看到', async t => {
  const DB = await seededDb(t);
  await get('/dogs', { DB }); await get('/rest', { DB });
  assert.equal((await send('PUT', '/intro/2025022703', { text: '親人', editor: '甲' }, { DB, WALKER_KEY: 'k' })).status, 200);
  assert.equal((await send('PUT', '/rest/2025022703', { end: true, editor: '甲' }, { DB, WALKER_KEY: 'k' })).status, 200);
  assert.equal((await (await get('/dogs', { DB })).json()).dogs[0].intro, '親人');
  assert.deepEqual((await (await get('/rest', { DB })).json()).rest, {});
  await assertSame(DB, '網站改完');
});

test('跨過午夜：昨天的紀錄併進歷史，今天從空的開始', async t => {
  const DB = await seededDb(t);
  await assertSame(DB, '第一天');
  t.mock.timers.setTime(NOW + 86400e3);
  await assertSame(DB, '第二天');
  assert.deepEqual((await packRows(DB, 'walks')).map(r => r.cutoff), ['2026-10-17']);
  // 新的今天加一筆，不重算歷史
  const walksPack = await packRows(DB, 'walks');
  await DB.prepare("INSERT INTO v3_walks(dog_id,walk_date,position,walker_code,dog_number,dog_name) SELECT dog_id,'2026-10-17',0,'eeeeeeeeeeee','2025022703','滿滿' FROM v3_dog_numbers WHERE number='2025022703'").run();
  await assertSame(DB, '第二天加一筆');
  assert.deepEqual(await packRows(DB, 'walks'), walksPack);
  // 昨天（已經在歷史裡）的紀錄被補登：歷史要更新
  await DB.prepare("INSERT INTO v3_walks(dog_id,walk_date,position,walker_code,dog_number,dog_name) SELECT dog_id,?,1,'ffffffffffff','2025022703','滿滿' FROM v3_dog_numbers WHERE number='2025022703'").bind(TODAY).run();
  await assertSame(DB, '補登昨天');
});

test('沒有資料變動時，每次請求只讀 1 列版本號', async t => {
  const DB = await seededDb(t);
  for (const path of PATHS) await get(path, { DB });
  for (const path of PATHS) assert.equal(await readsOf(DB, path), 1, path);
});

test('今天新增一筆：只重讀今天的列，不重算歷史資料包', async t => {
  const DB = await seededDb(t);
  await get('/walks', { DB }); await get('/dogs', { DB });
  const pack = await packRows(DB, 'walks');
  await DB.prepare("INSERT INTO v3_walks(dog_id,walk_date,position,walker_code,dog_number,dog_name) SELECT dog_id,?,0,'dddddddddddd','2025022703','滿滿' FROM v3_dog_numbers WHERE number='2025022703'").bind(TODAY).run();
  // 版本號 1 列＋今天 2 列
  assert.equal(await readsOf(DB, '/walks'), 3);
  assert.deepEqual(await packRows(DB, 'walks'), pack);
  assert.equal(await readsOf(DB, '/dogs'), 1, '狗清單沒變');
});

test('別台機器算好的資料包直接拿來用：只讀版本號、資料包和今天的列', async t => {
  const DB = await seededDb(t);
  await get('/walks', { DB }); await get('/rest', { DB });
  worker.testing.resetState(); // 換一台機器（記憶體是空的）
  // 版本號 1 列＋歷史資料包 1 段＋今天 1 列
  assert.equal(await readsOf(DB, '/walks'), 3);
  worker.testing.resetState();
  assert.equal(await readsOf(DB, '/rest'), 2, '版本號＋small 資料包 1 段');
});

test('資料包分段：每段上限調小時自動多幾段，讀回一樣', async t => {
  const DB = await seededDb(t);
  setPackChunkBytes(120);
  await assertSame(DB, '分段寫入');
  const small = await packRows(DB, 'small'), walks = await packRows(DB, 'walks');
  assert.ok(small.length > 3, `small ${small.length} 段`);
  assert.ok(walks.length > 1, `walks ${walks.length} 段`);
  assert.deepEqual(small.map(r => r.seq), small.map((_, i) => i));
  for (const { body } of (await DB.prepare('SELECT body FROM v3_packs').all()).results) assert.ok(new TextEncoder().encode(body).length <= 120);
  worker.testing.resetState();
  setPackChunkBytes(1_000_000);
  await assertSame(DB, '從分段讀回');
  // 版本號 1 列＋所有段
  assert.equal(await readsOf(DB, '/rest'), 1, '同一台記憶體已有：只讀版本號');
  worker.testing.resetState();
  assert.equal(await readsOf(DB, '/rest'), 1 + small.length);
});

test('溜狗紀錄不在 SQL 排序，走 walk_date 索引', async t => {
  const DB = await seededDb(t);
  const plan = (await DB.prepare('EXPLAIN QUERY PLAN SELECT dog_id FROM v3_walks WHERE walk_date>=?').bind(TODAY).all()).results.map(r => r.detail).join();
  assert.match(plan, /v3_walks_date/);
});

test('狀態頁不再整表數列數：沒變時只讀版本號', async t => {
  const DB = await seededDb(t);
  const status = async () => (await (await get('/', { DB })).json()).database;
  assert.equal(await status(), 'D1 新表（主清單 3 隻、溜狗紀錄 4 筆）');
  const before = DB.stats.rowsRead;
  await status();
  assert.equal(DB.stats.rowsRead - before, 1);
});

test('正式 D1 還沒有資料包的表（同步還沒補建）：照舊直接讀表', async t => {
  const DB = await seededDb(t);
  await DB.prepare('DROP TABLE v3_pack_versions').run();
  await assertSame(DB, '沒有版本號表');
});

// #322 狗清單、離所、休養讀到的 v3_ 表，每張都要有 pack_ 觸發器，不然改了資料網站不會更新（ADR 0009）
async function readTables(DB) {
  const tables = new Set();
  const spy = { ...DB, prepare(sql) { for (const name of sql.match(/\bv3_\w+/g) || []) tables.add(name); return DB.prepare(sql); } };
  await readDogsPayload(spy); await readDepartures(spy); await readRest(spy);
  return [...tables].sort();
}
async function missingTriggers(DB) {
  const have = new Set((await DB.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'pack_%'").all()).results.map(r => r.name));
  return (await readTables(DB)).flatMap(table => ['INSERT', 'UPDATE', 'DELETE'].map(op => `pack_${table}_${op}`)).filter(name => !have.has(name));
}

test('狗清單、離所、休養讀到的表都有 pack_ 觸發器', async t => {
  const DB = await seededDb(t);
  const tables = await readTables(DB);
  assert.ok(tables.includes('v3_intake_events') && tables.includes('v3_rest') && tables.includes('v3_departures'), tables.join(','));
  assert.deepEqual(await missingTriggers(DB), []);
});

test('拿掉任何一個 pack_ 觸發器都抓得到', async t => {
  const DB = await seededDb(t);
  const triggers = (await readTables(DB)).flatMap(table => ['INSERT', 'UPDATE', 'DELETE'].map(op => `pack_${table}_${op}`));
  for (const name of triggers) {
    const { sql } = await DB.prepare("SELECT sql FROM sqlite_master WHERE name=?").bind(name).first();
    await DB.prepare(`DROP TRIGGER ${name}`).run();
    assert.deepEqual(await missingTriggers(DB), [name]);
    await DB.prepare(sql).run();
  }
});
