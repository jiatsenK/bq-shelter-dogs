// #315 歷史資料包＋只讀今天、#320 溜狗歷史按月分段（ADR 0009）：輸出和直接讀表逐字元相同，沒變時每次只讀 1 列版本號
// 執行：node --test worker/test/packs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { setPackChunkBytes, swapPackCache, readSmall, readWalksPacked, yearVersions, recentStart } from '../src/packs.js';
import { readDogsPayload, readWalks, readDepartures, readRest, readSyncedAt } from '../src/compact.js';
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
  if (path === '/dogs') { const { version, ...rest } = await readDogsPayload(DB); return { ok: true, version, syncedAt: await readSyncedAt(DB), ...rest }; }
  if (path === '/walks') {
    const { version, historyStart, walks } = await readWalks(DB);
    const v = await DB.prepare('SELECT cutoff,live,months FROM v3_walk_versions WHERE id=1').first();
    const from = recentStart(taiwanToday());
    return { ok: true, version, historyStart, recentStart: from, years: yearVersions(v), walks: walks.filter(w => w.date >= from) };
  }
  if (path === '/departures') return { ok: true, version: 1, departures: await readDepartures(DB) };
  return { ok: true, rest: await readRest(DB) };
}
const taiwanToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
async function assertSame(DB, label) {
  for (const path of PATHS) {
    const res = await get(path, { DB });
    assert.equal(res.status, 200, `${label} ${path}`);
    const body = await res.text();
    assert.equal(body, JSON.stringify(await direct(DB, path)), `${label} ${path}`);
    if (path !== '/walks') continue;
    // #347 近期以外按年拿：各年接起來就是全部紀錄
    const years = Object.keys(JSON.parse(body).years).sort();
    const all = [];
    for (const y of years) all.push(...(await (await get(`/walks?year=${y}`, { DB })).json()).walks);
    assert.deepEqual(all, (await readWalks(DB)).walks, `${label} 各年接起來`);
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
  await DB.prepare("UPDATE v3_sheet_main SET note='移籠'").run();
  await DB.prepare("UPDATE v3_sync_state SET value='2026-10-16T09:00:00+08:00' WHERE key='synced_at'").run();
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

test('沒有資料變動時，每次請求只讀版本號（狗清單再加 1 列同步時間；休養是在所＋離所各 1 列）', async t => {
  const DB = await seededDb(t);
  for (const path of PATHS) await get(path, { DB });
  for (const path of PATHS) assert.equal(await readsOf(DB, path), path === '/dogs' || path === '/rest' ? 2 : 1, path);
});

test('今天新增一筆：只重讀今天的列，不重算歷史資料包', async t => {
  const DB = await seededDb(t);
  await get('/walks', { DB }); await get('/dogs', { DB });
  const pack = await packRows(DB, 'walks');
  await DB.prepare("INSERT INTO v3_walks(dog_id,walk_date,position,walker_code,dog_number,dog_name) SELECT dog_id,?,0,'dddddddddddd','2025022703','滿滿' FROM v3_dog_numbers WHERE number='2025022703'").bind(TODAY).run();
  // 版本號 1 列＋今天 2 列
  assert.equal(await readsOf(DB, '/walks'), 3);
  assert.deepEqual(await packRows(DB, 'walks'), pack);
  assert.equal(await readsOf(DB, '/dogs'), 2, '狗清單沒變：版本號＋同步時間');
});

test('別台機器算好的資料包直接拿來用：只讀版本號、資料包和今天的列', async t => {
  const DB = await seededDb(t);
  await get('/walks', { DB }); await get('/rest', { DB });
  worker.testing.resetState(); // 換一台機器（記憶體是空的）
  // 版本號 1 列＋歷史資料包 1 段＋今天 1 列
  assert.equal(await readsOf(DB, '/walks'), 3);
  worker.testing.resetState();
  assert.equal(await readsOf(DB, '/rest'), 4, '在所版本號＋資料包 1 段＋離所版本號＋2026 年資料包 1 段');
});

test('資料包分段：每段上限調小時自動多幾段，讀回一樣', async t => {
  const DB = await seededDb(t);
  setPackChunkBytes(120);
  await assertSame(DB, '分段寫入');
  const small = await packRows(DB, 'main'), deps = await packRows(DB, 'departures:2026'), walks = await packRows(DB, 'walks');
  assert.ok(small.length > 3, `small ${small.length} 段`);
  assert.ok(walks.length > 1, `walks ${walks.length} 段`);
  assert.deepEqual(small.map(r => r.seq), small.map((_, i) => i));
  for (const { body } of (await DB.prepare('SELECT body FROM v3_packs').all()).results) assert.ok(new TextEncoder().encode(body).length <= 120);
  worker.testing.resetState();
  setPackChunkBytes(1_000_000);
  await assertSame(DB, '從分段讀回');
  // 版本號 1 列＋所有段
  assert.equal(await readsOf(DB, '/rest'), 2, '同一台記憶體已有：只讀版本號');
  worker.testing.resetState();
  assert.ok(deps.length > 1, `離所 ${deps.length} 段`);
  assert.equal(await readsOf(DB, '/rest'), 2 + small.length + deps.length);
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

test('讀不到版本號：報錯，不退回整表讀取（整表讀取量隨歷史變多）', async t => {
  const DB = await seededDb(t);
  await DB.prepare('DROP TABLE v3_pack_versions').run();
  await DB.prepare('DROP TABLE v3_walk_versions').run();
  await assert.rejects(readSmall(DB, 'dogs'));
  await assert.rejects(readWalksPacked(DB, TODAY));
  const empty = await seededDb(t);
  await empty.prepare('DELETE FROM v3_walk_versions').run();
  await assert.rejects(readWalksPacked(empty, TODAY), /版本號/);
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
  // 新開的機器：版本號＋近期那一年的段＋今天的列，不重算；更早的年份不讀（#347）
  worker.testing.resetState();
  assert.equal(await readsOf(DB, '/walks'), 1 + await yearSegs(DB, '2026') + await countRows(DB, 'walk_date>=?', TODAY));
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
  assert.equal(await readsOf(DB, '/walks'), 1 + await yearSegs(DB, '2026'), '新機器：版本號＋近期那一年的段，今天還沒有紀錄（#347）');
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

// #322 狗清單、離所、休養讀到的 v3_ 表，每張都要有 packs_ 觸發器，不然改了資料網站不會更新（ADR 0009；0014 換內容改名 packs_）
// 表清單是實際攔到的 SQL，不是手寫的；#399 起狗清單讀 v3_dogs.fixed_care，需有觸發器。
async function readTables(DB) {
  const tables = new Set();
  const spy = { ...DB, prepare(sql) { for (const name of sql.match(/\bv3_\w+/g) || []) tables.add(name); return DB.prepare(sql); } };
  // 資料包實際用的讀法：在所、某一年的離所（ADR 0014）
  await readDogsPayload(spy); await readDepartures(spy, '2026'); await readRest(spy, 'main'); await readRest(spy, '2026');
  return [...tables].sort();
}
// #361 同步時間存 v3_sync_state，改了不讓 small 失效、狗清單照樣拿到新的同步時間（ADR 0014）
test('只改同步時間：small 版本號不變，/api/dogs 的 syncedAt 跟著變', async t => {
  const DB = await seededDb(t);
  await get('/dogs', { DB });
  const ver = async () => (await DB.prepare('SELECT small FROM v3_pack_versions WHERE id=1').first()).small;
  const before = await ver();
  await DB.prepare("UPDATE v3_sync_state SET value='2026-10-16T09:30:00+08:00' WHERE key='synced_at'").run();
  assert.equal(await ver(), before);
  assert.equal((await (await get('/dogs', { DB })).json()).syncedAt, '2026-10-16T09:30:00+08:00');
  assert.ok(!(await readTables(DB)).includes('v3_sync_state'), 'small 不讀 v3_sync_state');
});

async function missingTriggers(DB) {
  const have = new Set((await DB.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name GLOB 'packs_*'").all()).results.map(r => r.name));
  return (await readTables(DB)).flatMap(table => ['INSERT', 'UPDATE', 'DELETE'].map(op => `packs_${table}_${op}`)).filter(name => !have.has(name));
}

test('狗清單、離所、休養讀到的表都有 packs_ 觸發器', async t => {
  const DB = await seededDb(t);
  const tables = await readTables(DB);
  assert.ok(tables.includes('v3_intake_events') && tables.includes('v3_rest') && tables.includes('v3_departures'), tables.join(','));
  assert.ok(tables.includes('v3_dogs') && !tables.includes('v3_sheet_former_numbers'), tables.join(','));
  assert.deepEqual(await missingTriggers(DB), []);
});

test('拿掉任何一個 packs_ 觸發器都抓得到', async t => {
  const DB = await seededDb(t);
  const triggers = (await readTables(DB)).flatMap(table => ['INSERT', 'UPDATE', 'DELETE'].map(op => `packs_${table}_${op}`));
  for (const name of triggers) {
    const { sql } = await DB.prepare("SELECT sql FROM sqlite_master WHERE name=?").bind(name).first();
    await DB.prepare(`DROP TRIGGER ${name}`).run();
    assert.deepEqual(await missingTriggers(DB), [name]);
    await DB.prepare(sql).run();
  }
});

// #346 /api/walks?year=：那一年的紀錄，形狀跟 /api/walks 一樣，網址帶版本號才永久快取
const yearOf = async (DB, year, v) => get(`/walks?year=${year}${v === undefined ? '' : `&v=${encodeURIComponent(v)}`}`, { DB });

test('?year=：內容是那一年的全部紀錄（含今天），跟整份逐筆相同', async t => {
  const DB = await monthlyDb(t);
  const all = await (await get('/walks', { DB })).json();
  assert.deepEqual(Object.keys(all.years).sort(), ['2025', '2026']);
  for (const year of ['2025', '2026', '2019']) {
    const res = await yearOf(DB, year, all.years[year]);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(Object.keys(body), ['ok', 'version', 'historyStart', 'year', 'ver', 'walks']);
    assert.equal(body.ver, all.years[year] || '');
    assert.deepEqual(body.walks, (await readWalks(DB)).walks.filter(w => w.date.startsWith(year)), year);
  }
  assert.ok((await (await yearOf(DB, '2026')).json()).walks.some(w => w.date === TODAY), '今年含今天');
  assert.equal((await yearOf(DB, '26')).status, 400);
});

test('?year=：版本號對得上才 immutable；改那一年的紀錄版本號就變，別年不變', async t => {
  const DB = await monthlyDb(t);
  const before = (await (await get('/walks', { DB })).json()).years;
  assert.match((await yearOf(DB, '2025', before['2025'])).headers.get('Cache-Control'), /immutable/);
  assert.equal((await yearOf(DB, '2025', 'old')).headers.get('Cache-Control'), 'no-store');
  assert.equal((await yearOf(DB, '2025')).headers.get('Cache-Control'), 'no-store');
  await DB.prepare("UPDATE v3_walks SET walker_code='cccccccccccc' WHERE walk_date='2025-11-20'").run();
  const after = (await (await get('/walks', { DB })).json()).years;
  assert.notEqual(after['2025'], before['2025']);
  assert.equal(after['2026'], before['2026']);
  assert.equal((await yearOf(DB, '2025', before['2025'])).headers.get('Cache-Control'), 'no-store', '舊版本號不快取新內容');
  // 今年帶切點和 live：今天多一筆，今年的版本號就變
  await addWalk(DB, TODAY, 1, 'd'.repeat(12));
  assert.notEqual((await (await get('/walks', { DB })).json()).years['2026'], after['2026']);
});

test('?year=：新機器只讀版本號和那一年的資料包', async t => {
  const DB = await monthlyDb(t);
  await get('/walks', { DB });
  worker.testing.resetState();
  const before = DB.stats.rowsRead;
  assert.equal((await yearOf(DB, '2025')).status, 200);
  assert.equal(DB.stats.rowsRead - before, 1 + await yearSegs(DB, '2025'));
  // 同一台再拿：只讀版本號
  const again = DB.stats.rowsRead;
  await yearOf(DB, '2025');
  assert.equal(DB.stats.rowsRead - again, 1);
  await assertSame(DB, '拿過一年後整份照常');
});

// #362 ADR 0014：small 拆成在所＋離所按出所年份，讀取量不隨離所的狗變多
const departed = (id, date, extra = {}) => ({ id, name: `狗${id}`, date, dateSource: 'note', seen: date, reason: 'adopt', matched: '被領養', flags: ['f'],
  last: { cage: 'B1', id, name: `狗${id}`, walkedDate: null, note: '', sex: '', intro: '舊介紹', formerIds: ['x' + id], groups: [] }, ...extra });
// 離所 n 隻（2010～2019 年平均分，另外 1 隻日期不明），每隻都有休養、出入所紀錄、入所事件
async function departedDb(t, n) {
  const DB = await seededDb(t);
  const list = [departed('2021030913', '2026-10-13'), departed('1999000000', null)];
  for (let i = 0; i < n; i++) list.push(departed(`2010${String(i).padStart(6, '0')}`, `${2010 + (i % 10)}-05-0${1 + (i % 9)}`));
  await importCompactDepartures(DB, list);
  await DB.prepare(`INSERT INTO v3_rest SELECT dog_id,'2026-12-01','老了' FROM v3_departures`).run();
  await DB.prepare(`INSERT INTO v3_stays SELECT dog_id,'[{"in":"2009-01-01","out":"2010-01-01","reason":""}]' FROM v3_departures`).run();
  await DB.prepare(`INSERT INTO v3_intake_events(dog_id,position,number,event_date,event) SELECT dog_id,0,number,'2009-01-01','入所' FROM v3_departures`).run();
  return DB;
}
const depYears = async DB => JSON.parse((await DB.prepare('SELECT years FROM v3_departure_versions WHERE id=1').first()).years);
const smallVer = async DB => (await DB.prepare('SELECT small FROM v3_pack_versions WHERE id=1').first()).small;

test('離所按年：輸出逐字元相同，一年一份資料包，日期不明另一份', async t => {
  const DB = await departedDb(t, 20);
  await assertSame(DB, '一開始');
  const parts = (await DB.prepare("SELECT DISTINCT part FROM v3_packs WHERE part LIKE 'departures:%' ORDER BY part").all()).results.map(r => r.part);
  assert.deepEqual(parts, [...Array.from({ length: 10 }, (_, i) => `departures:${2010 + i}`), 'departures:2026', 'departures:none']);
  await DB.prepare("UPDATE v3_departures SET departed_date='2011-01-01' WHERE number='2010000000'").run();
  await assertSame(DB, '改出所日（換年份）');
  await DB.prepare("UPDATE v3_departures SET departed_date=NULL WHERE number='2010000001'").run();
  await assertSame(DB, '出所日改成不明');
  // 不在主清單、也沒有離所紀錄的狗，休養不會出現（ADR 0014 只讀在所＋各年離所），所以連休養一起刪
  await DB.batch([
    DB.prepare("DELETE FROM v3_rest WHERE dog_id=(SELECT dog_id FROM v3_departures WHERE number='2010000002')"),
    DB.prepare("DELETE FROM v3_departures WHERE number='2010000002'"),
  ]);
  await assertSame(DB, '刪一筆');
  await DB.prepare("UPDATE v3_rest SET reason='更老了' WHERE dog_id=(SELECT dog_id FROM v3_departures WHERE number='2010000003')").run();
  await assertSame(DB, '改離所狗的休養');
  await DB.prepare("DELETE FROM v3_sheet_main WHERE number='2025022703'").run();
  await importCompactDepartures(DB, [...(await readDepartures(DB)), departed('2025022703', '2026-10-16')]);
  await assertSame(DB, '主清單的狗出所');
  worker.testing.resetState();
  await assertSame(DB, '換一台機器');
});

test('觸發器：離所只讓那一年加 1；離所狗的休養、出入所紀錄不動在所', async t => {
  const DB = await departedDb(t, 20);
  await get('/departures', { DB }); await get('/rest', { DB }); await get('/dogs', { DB });
  const before = await depYears(DB), small = await smallVer(DB);
  const only = (after, ...years) => assert.deepEqual(Object.keys(after).filter(y => after[y] !== before[y]).sort(), years.sort());
  await DB.prepare("UPDATE v3_departures SET reason='died' WHERE number='2010000004'").run();
  only(await depYears(DB), '2014');
  await DB.prepare("UPDATE v3_departure_items SET value='g' WHERE number='2010000005' AND kind='flag'").run();
  only(await depYears(DB), '2014', '2015');
  await DB.prepare("UPDATE v3_stays SET stays_json='[]' WHERE dog_id=(SELECT dog_id FROM v3_departures WHERE number='2010000006')").run();
  await DB.prepare("UPDATE v3_intake_events SET event='退回' WHERE number='2010000007'").run();
  only(await depYears(DB), '2014', '2015', '2016');
  assert.equal(await smallVer(DB), small, '離所的狗改了，在所不變');
  await DB.prepare("UPDATE v3_rest SET reason='好了' WHERE dog_id=(SELECT dog_id FROM v3_dog_numbers WHERE number='2025022703')").run();
  assert.ok(await smallVer(DB) > small, '主清單上的狗改休養，在所加 1');
  only(await depYears(DB), '2014', '2015', '2016');
  await assertSame(DB, '改完');
});

test('讀取量不隨離所的狗變多：重算在所、某一年的離所，讀的列數 10 隻和 100 隻一樣', async t => {
  const reads = async n => {
    const DB = await departedDb(t, n);
    await get('/dogs', { DB }); await get('/departures', { DB }); await get('/rest', { DB });
    // 主清單改一隻：只重算在所
    await DB.prepare("UPDATE v3_sheet_main SET note='移籠' WHERE number='2025022703'").run();
    const dogs = await readsOf(DB, '/dogs');
    // 今年有狗出所（2026 只有固定幾隻）：只重算 2026 那一份
    await DB.prepare("UPDATE v3_departures SET reason='died' WHERE number='2021030913'").run();
    const deps = await readsOf(DB, '/departures');
    const rest = await readsOf(DB, '/rest');
    worker.testing.resetState();
    await readsOf(DB, '/dogs');
    return { dogs, deps, rest };
  };
  const small = await reads(10), big = await reads(100);
  assert.deepEqual(big, small);
});

test('在所、某一年的離所不整張讀：入所、出入所紀錄照主鍵，離所走出所日索引', async t => {
  const DB = await departedDb(t, 10);
  const plans = [];
  const spy = { ...DB, prepare(sql) { plans.push(sql); return DB.prepare(sql); } };
  await readDogsPayload(spy); await readDepartures(spy, '2015'); await readDepartures(spy, 'none'); await readRest(spy, 'main'); await readRest(spy, '2015');
  for (const sql of plans) {
    const plan = (await DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()).results.map(r => r.detail).join(' | ');
    assert.doesNotMatch(plan, /SCAN (v3_departures|v3_departure_items|v3_intake_events|v3_stays|v3_rest|t)\b(?! USING)/, `${sql}\n${plan}`);
  }
});

test('正式 D1 第一次補建 v3_departure_versions：從現有離所紀錄補上每年的鍵，之後重跑不動', async t => {
  const DB = await departedDb(t, 3);
  await DB.prepare('DROP TABLE v3_departure_versions').run();
  await migrateCompactDatabase(DB);
  assert.deepEqual(Object.keys(await depYears(DB)).sort(), ['2010', '2011', '2012', '2026', 'none']);
  await DB.prepare("UPDATE v3_departures SET reason='died' WHERE number='2010000000'").run();
  const years = await depYears(DB);
  await migrateCompactDatabase(DB);
  assert.deepEqual(await depYears(DB), years);
  await assertSame(DB, '補建後');
});

// #363 ADR 0014：離所名冊索引＋按年詳細資料
async function assertDepartureIndex(DB, label) {
  const all = await readDepartures(DB);
  const index = await (await get('/departures/index', { DB })).json();
  const expect = all.map(e => {
    const dog = { id: e.id, name: e.last && e.last.name ? e.last.name : e.name, date: e.date, dateSource: e.dateSource, reason: e.reason };
    if (e.returned !== undefined) dog.returned = e.returned;
    if (e.last && e.last.formerIds) dog.formerIds = e.last.formerIds;
    return dog;
  });
  assert.deepEqual(index.dogs, expect, `${label} 索引`);
  // 各年詳細資料接起來就是全部，網址帶對版本號才永久快取
  const joined = [];
  for (const [year, ver] of Object.entries(index.years)) {
    const res = await get(`/departures?year=${year}&v=${ver}`, { DB });
    assert.equal(res.headers.get('Cache-Control'), 'public, max-age=31536000, immutable', `${label} ${year}`);
    const body = await res.json();
    assert.equal(body.ver, ver);
    assert.deepEqual(body.departures, await readDepartures(DB, year), `${label} ${year}`);
    joined.push(...body.departures);
  }
  assert.deepEqual(joined.sort((a, b) => a.id.localeCompare(b.id)), [...all].sort((a, b) => a.id.localeCompare(b.id)), `${label} 各年接起來`);
}

test('離所名冊索引、按年詳細資料：跟直接讀表相同；改了只換那一年的版本號', async t => {
  const DB = await departedDb(t, 20);
  await DB.prepare("UPDATE v3_departures SET returned_number='2026100801' WHERE number='2010000008'").run();
  await assertDepartureIndex(DB, '一開始');
  const before = (await (await get('/departures/index', { DB })).json()).years;
  await DB.prepare("UPDATE v3_departures SET reason='died' WHERE number='2010000004'").run();
  const after = (await (await get('/departures/index', { DB })).json()).years;
  assert.deepEqual(Object.keys(after).filter(y => after[y] !== before[y]), ['2014']);
  await assertDepartureIndex(DB, '改了 2014');
  worker.testing.resetState();
  await assertDepartureIndex(DB, '換一台機器');
  // 版本號不對、沒有那一年、壞掉的年份
  assert.equal((await get('/departures?year=2014&v=0', { DB })).headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await (await get('/departures?year=1990&v=', { DB })).json(), { ok: true, version: 1, year: '1990', ver: '', departures: [] });
  assert.equal((await get('/departures?year=abc', { DB })).status, 400);
});

test('讀取量不隨離所的狗變多：名冊索引、點一年的詳細資料，10 隻和 100 隻一樣', async t => {
  const reads = async n => {
    const DB = await departedDb(t, n);
    await get('/departures/index', { DB });
    const same = await readsOf(DB, '/departures/index');
    // 今年有狗出所：只重算 2026 那一份
    await DB.prepare("UPDATE v3_departures SET reason='died' WHERE number='2021030913'").run();
    const changed = await readsOf(DB, '/departures/index');
    const year = await readsOf(DB, '/departures?year=2026');
    return { same, changed, year };
  };
  const small = await reads(10), big = await reads(100);
  assert.equal(small.same, 1, '沒變只讀 1 列版本號');
  assert.deepEqual(big, small);
});
