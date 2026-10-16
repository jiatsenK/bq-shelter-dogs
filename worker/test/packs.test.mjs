// #315 歷史資料包＋只讀今天、#320 溜狗歷史按月分段（ADR 0009）：輸出和直接讀表逐字元相同，沒變時每次只讀 1 列版本號
// 執行：node --test worker/test/packs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { setPackChunkBytes, swapPackCache } from '../src/packs.js';
import { readDogsPayload, readWalks, readDepartures, readRest } from '../src/compact.js';
import { fakeD1 } from './fakes.mjs';
import { migrateCompactDatabase } from '../../scripts/migrate-compact-db.mjs';
import { importCompactDogs } from '../../scripts/import-compact-dogs.mjs';
import { importCompactProfiles } from '../../scripts/import-compact-profiles.mjs';
import { importCompactDepartures } from '../../scripts/import-compact-departures.mjs';

const SITE = 'https://bq-shelter-dogs.jiatsen-k.workers.dev';
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
const packRows = async (DB, part) => part === 'walks'
  ? (await DB.prepare('SELECT year,seq,vers FROM v3_walk_packs ORDER BY year,seq').all()).results
  : (await DB.prepare('SELECT seq,ver,cutoff FROM v3_packs WHERE part=? ORDER BY seq').bind(part).all()).results;
const walkCutoff = async DB => (await DB.prepare('SELECT cutoff FROM v3_walk_versions WHERE id=1').first()).cutoff;
const addWalk = (DB, date, position, code) => DB.prepare("INSERT INTO v3_walks(dog_id,walk_date,position,walker_code,dog_number,dog_name) SELECT dog_id,?,?,?,'2025022703','滿滿' FROM v3_dog_numbers WHERE number='2025022703'").bind(date, position, code).run();

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
  assert.equal(await walkCutoff(DB), '2026-10-17');
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
  for (const [where, args] of [['walk_date>=?', [TODAY]], ['walk_date>=? AND walk_date<?', [TODAY, TODAY]]]) {
    const plan = (await DB.prepare(`EXPLAIN QUERY PLAN SELECT dog_id FROM v3_walks WHERE ${where}`).bind(...args).all()).results.map(r => r.detail).join();
    assert.match(plan, /v3_walks_date/, where);
  }
});

test('狀態頁不再整表數列數：沒變時只讀版本號', async t => {
  const DB = await seededDb(t);
  const status = async () => (await (await get('/', { DB })).json()).database;
  assert.equal(await status(), 'D1 新表（主清單 3 隻、溜狗紀錄 4 筆）');
  const before = DB.stats.rowsRead;
  await status();
  // small 和溜狗紀錄各 1 列版本號
  assert.equal(DB.stats.rowsRead - before, 2);
});

test('正式 D1 還沒有資料包的表（同步還沒補建）：照舊直接讀表', async t => {
  const DB = await seededDb(t);
  await DB.prepare('DROP TABLE v3_pack_versions').run();
  await DB.prepare('DROP TABLE v3_walk_versions').run();
  await assertSame(DB, '沒有版本號表');
});

// #320 溜狗歷史按月分段：跨月、跨年的資料
const MONTHS = [['2025-11-20', 'a1'], ['2025-12-31', 'a2'], ['2026-01-01', 'a3'], ['2026-08-31', 'a4'], ['2026-09-01', 'a5'], ['2026-09-15', 'a6']];
async function monthlyDb(t) {
  const DB = await seededDb(t);
  for (const [date, c] of MONTHS) await addWalk(DB, date, 0, c.repeat(6));
  return DB;
}
const countRows = async (DB, where, ...args) => (await DB.prepare(`SELECT COUNT(*) AS n FROM v3_walks WHERE ${where}`).bind(...args).first()).n;
const yearSegs = async (DB, year) => (await packRows(DB, 'walks')).filter(r => r.year === year).length;

test('跨月、跨年：輸出逐字元相同，資料包一年一份，每段記著月份版本號', async t => {
  const DB = await monthlyDb(t);
  await assertSame(DB, '一開始');
  assert.deepEqual([...new Set((await packRows(DB, 'walks')).map(r => r.year))], ['2025', '2026']);
  assert.deepEqual(Object.keys(JSON.parse((await packRows(DB, 'walks'))[0].vers)).sort(), ['2025-11', '2025-12']);
  await DB.prepare("UPDATE v3_walks SET walk_date='2026-01-02' WHERE walk_date='2025-12-31'").run();
  await assertSame(DB, '跨年搬日期');
  await DB.prepare("DELETE FROM v3_walks WHERE walk_date='2025-11-20'").run();
  await assertSame(DB, '刪掉一整個月');
  await DB.prepare("UPDATE v3_walks SET walk_date=? WHERE walk_date='2026-09-15'").bind(TODAY).run();
  await assertSame(DB, '過去改成今天');
  t.mock.timers.setTime(NOW + 86400e3);
  await assertSame(DB, '第二天');
  t.mock.timers.setTime(NOW + 3 * 86400e3);
  await assertSame(DB, '隔了兩天沒人看');
});

test('改某個月的紀錄：只讀版本號、那一年的資料包和那個月的列', async t => {
  const DB = await monthlyDb(t);
  await get('/walks', { DB });
  await DB.prepare("UPDATE v3_walks SET walker_code='cccccccccccc' WHERE walk_date='2026-09-15'").run();
  const month = await countRows(DB, "walk_date>='2026-09-01' AND walk_date<'2026-10-01'");
  assert.equal(await readsOf(DB, '/walks'), 1 + await yearSegs(DB, '2026') + month);
  await assertSame(DB, '改完');
  // 新開的機器：版本號＋所有段＋今天的列，不重算
  worker.testing.resetState();
  assert.equal(await readsOf(DB, '/walks'), 1 + (await packRows(DB, 'walks')).length + await countRows(DB, 'walk_date>=?', TODAY));
});

test('跨日：只讀昨天的列和當年的資料包', async t => {
  const DB = await monthlyDb(t);
  await get('/walks', { DB });
  t.mock.timers.setTime(NOW + 86400e3);
  const segs = await yearSegs(DB, '2026');
  const yesterday = await countRows(DB, 'walk_date=?', TODAY);
  // 版本號移切點前後各 1 列＋昨天的列＋當年的資料包
  assert.equal(await readsOf(DB, '/walks'), 2 + yesterday + segs);
  assert.equal(await walkCutoff(DB), '2026-10-17');
  await assertSame(DB, '第二天');
  assert.equal(await readsOf(DB, '/walks'), 1, '跨日後沒變');
  worker.testing.resetState();
  assert.equal(await readsOf(DB, '/walks'), 1 + (await packRows(DB, 'walks')).length, '新機器：版本號＋所有段，今天還沒有紀錄');
});

test('跨日跨到新的一年', async t => {
  const DB = await monthlyDb(t);
  t.mock.timers.setTime(Date.parse('2026-12-31T02:00:00Z'));
  await addWalk(DB, '2026-12-31', 0, 'b'.repeat(12));
  await assertSame(DB, '12/31');
  t.mock.timers.setTime(Date.parse('2027-01-01T02:00:00Z'));
  await addWalk(DB, '2027-01-01', 0, 'c'.repeat(12));
  await assertSame(DB, '1/1');
  t.mock.timers.setTime(Date.parse('2027-01-02T02:00:00Z'));
  await assertSame(DB, '1/2');
  assert.ok((await packRows(DB, 'walks')).some(r => r.year === '2027'));
});

test('另一台機器先跨日：記憶體裡是舊資料的那台照版本號更新，結果一樣', async t => {
  const DB = await monthlyDb(t);
  await get('/walks', { DB }); // 這台記著昨天以前的資料
  t.mock.timers.setTime(NOW + 86400e3);

  const saved = swapPackCache(null);
  // 換別台跨日
  await get('/walks', { DB });
  swapPackCache(saved);
  await assertSame(DB, '舊機器');
  assert.equal(await readsOf(DB, '/walks'), 1);
});

test('跨日讀昨天的列時有人寫入：切點這次不移，下一次再來，結果一樣', async t => {
  const DB = await monthlyDb(t);
  await get('/walks', { DB });
  t.mock.timers.setTime(NOW + 86400e3);
  const prepare = DB.prepare;
  let once = true;
  DB.prepare = sql => {
    const stmt = prepare(sql);
    if (!once || !/walk_date>=\? AND walk_date<\?$/.test(sql)) return stmt;
    once = false;
    return { bind: (...a) => ({ all: async () => { const r = await stmt.bind(...a).all(); await addWalk(DB, TODAY, 5, 'f'.repeat(12)); return r; } }) };
  };
  t.after(() => { DB.prepare = prepare; });
  await assertSame(DB, '跨日時有人寫入');
  assert.equal(once, false);
  assert.equal(await walkCutoff(DB), '2026-10-17');
});

test('觸發器：只讓改到的月份變，今天的紀錄只動 live', async t => {
  const DB = await monthlyDb(t);
  await get('/walks', { DB });
  const ver = async () => { const r = await DB.prepare('SELECT total,live,months FROM v3_walk_versions WHERE id=1').first(); return { ...r, months: JSON.parse(r.months) }; };
  const before = await ver();
  await DB.prepare("UPDATE v3_walks SET walker_code='cccccccccccc' WHERE walk_date='2026-08-31'").run();
  const after = await ver();
  assert.ok(after.months['2026-08'] > before.months['2026-08']);
  assert.deepEqual({ ...after.months, '2026-08': 0 }, { ...before.months, '2026-08': 0 });
  assert.ok(after.total > before.total);
  await addWalk(DB, TODAY, 3, 'd'.repeat(12));
  const live = await ver();
  assert.deepEqual([live.months, live.total, live.live], [after.months, after.total, after.live + 1]);
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
