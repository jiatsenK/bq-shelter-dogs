import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateCompactDatabase } from './migrate-compact-db.mjs';
import { readDogsPayload, readDepartures, readWalks } from '../worker/src/compact.js';
import { buildSyncSql, SEED_TABLES, planSync, readPrevious } from './sync-compact-d1.mjs';

const json = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));

async function source() {
  const dogs = await json('data/dogs.json');
  // 常遛狗群照欄存：每隻有群組的狗跟它的群組一欄（真實試算表的欄可能更大，這裡只要能還原）
  const groupColumns = [], seen = new Set();
  for (const [name, others] of Object.entries(dogs.groups)) {
    const column = [name, ...others].sort();
    if (!seen.has(column.join()) && column.every(n => dogs.groups[n]?.length === others.length)) { seen.add(column.join()); groupColumns.push(column); }
  }
  return { dogs, walks: await json('data/walks.json'), departures: (await json('data/departures.json')).departures, groupColumns };
}

async function apply(t, seed, sql) {
  const db = fakeD1(); t.after(() => db.close());
  await migrateCompactDatabase(db);
  for (const [table, rows] of Object.entries(seed)) for (const row of rows) {
    await db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row)).run();
  }
  const statements = sql.split(';\n').map(s => s.trim()).filter(Boolean);
  await db.batch(statements.map(s => db.prepare(s)));
  return db;
}

test('第一次寫入正式 D1：主清單、試算表備註、常遛狗群讀回跟 dogs.json 一樣', async t => {
  const src = await source();
  const db = await apply(t, {}, await buildSyncSql({}, src));
  const payload = await readDogsPayload(db);
  // 介紹 #250 起由網站寫 D1，同步不帶
  assert.deepEqual(payload.dogs, src.dogs.dogs.map(d => ({ ...d, intro: '' })));
  assert.deepEqual(payload.sheetNotes, src.dogs.sheetNotes);
  for (const column of src.groupColumns) for (const name of column) assert.deepEqual([...payload.groups[name]].sort(), column.filter(n => n !== name));
  assert.ok(await db.prepare('SELECT COUNT(*) AS n FROM v3_walks').first('n'));
  assert.deepEqual(await readDepartures(db), src.departures);
});

test('正式 D1 還沒有離所表時，SQL 自己先建', async t => {
  const lines = (await buildSyncSql({}, await source())).split('\n');
  assert.match(lines[0], /^CREATE TABLE IF NOT EXISTS v3_departures /);
  assert.match(lines[1], /^CREATE TABLE IF NOT EXISTS v3_departure_items /);
});

test('再同步一次沿用正式 D1 的永久狗 ID，不新增狗', async t => {
  const src = await source();
  const first = await apply(t, {}, await buildSyncSql({}, src));
  const seed = {};
  for (const [table, sql] of Object.entries(SEED_TABLES)) seed[table] = (await first.prepare(sql).all()).results;
  const db = await apply(t, seed, await buildSyncSql(seed, src));
  assert.deepEqual((await db.prepare('SELECT * FROM v3_dogs ORDER BY dog_id').all()).results, (await first.prepare('SELECT * FROM v3_dogs ORDER BY dog_id').all()).results);
  assert.deepEqual((await readDogsPayload(db)).dogs, src.dogs.dogs.map(d => ({ ...d, intro: '' })));
});

test('開卡、照片、休養、介紹不被同步清掉', async t => {
  const src = await source();
  const first = await apply(t, {}, await buildSyncSql({}, src));
  const dogId = await first.prepare('SELECT dog_id FROM v3_dogs LIMIT 1').first('dog_id');
  await first.prepare("INSERT INTO v3_card_opened VALUES('aaaaaaaaaaaa',?,'2026-10-15')").bind(dogId).run();
  await first.prepare("INSERT INTO v3_photos(object_key,dog_id) VALUES('photos/x.jpg',?)").bind(dogId).run();
  const seed = {};
  for (const [table, sql] of Object.entries(SEED_TABLES)) seed[table] = (await first.prepare(sql).all()).results;
  const sql = await buildSyncSql(seed, src);
  assert.doesNotMatch(sql, /v3_card_opened|v3_photos|v3_volunteer|v3_rest|v3_intros/);
});

test('來源有問題時丟錯，不產生 SQL', async t => {
  const src = await source();
  await assert.rejects(buildSyncSql({}, { ...src, walks: { walks: [{ id: 'x', name: '狗', date: '不是日期' }] } }), /日期/);
});

// ── #251 同步只寫 D1：上一次的狀態從 D1 讀 ──
const KEY = { key: 'test-key', names: [] };
const NOW = new Date('2026-10-16T09:00:00+08:00');
const seedOf = async db => { const seed = {}; for (const [table, sql] of Object.entries(SEED_TABLES)) seed[table] = (await db.prepare(sql).all()).results; return seed; };
const sheetOf = src => ({ dogs: src.dogs.dogs.map(({ myWalkedDate, ...d }) => d), groups: src.dogs.groups, sheetNotes: src.dogs.sheetNotes });
// 正式 D1 的樣子：先用 repo 的 JSON 寫一次
async function production(t) {
  const src = await source();
  return { src, db: await apply(t, {}, await buildSyncSql({}, src)) };
}
const syncOnce = async (t, db, sheet, rows = null) => {
  const seed = await seedOf(db);
  const groupColumns = (await source()).groupColumns;
  return apply(t, seed, await buildSyncSql(seed, async mem => ({ ...planSync(await readPrevious(mem), sheet, rows, NOW, KEY), groupColumns })));
};

test('#251 新的溜狗日期記一筆進 v3_walks，舊紀錄一筆不少', async t => {
  const { src, db } = await production(t);
  const before = (await readWalks(db)).walks;
  const sheet = sheetOf(src);
  const dog = sheet.dogs.find(d => d.id && d.walkedDate);
  dog.walkedDate = '2026-10-16'; dog.walkers = ['aaaaaaaaaaaa'];
  const after = (await readWalks(await syncOnce(t, db, sheet))).walks;
  assert.deepEqual(after.filter(w => w.date === '2026-10-16'), [{ id: dog.id, name: dog.name, date: '2026-10-16', walkers: ['aaaaaaaaaaaa'] }]);
  for (const w of before) assert.ok(after.some(a => a.id === w.id && a.name === w.name && a.date === w.date), `少了 ${w.name} ${w.date}`);
});

test('#251 試算表沒變再同步一次：溜狗紀錄、離所都不變（不重複記）', async t => {
  const { src, db } = await production(t);
  const once = await syncOnce(t, db, sheetOf(src));
  const twice = await syncOnce(t, once, sheetOf(src));
  assert.deepEqual(await readWalks(twice), await readWalks(once));
  assert.deepEqual(await readDepartures(twice), await readDepartures(once));
  assert.deepEqual(await readDepartures(once), src.departures);
});

test('#251 狗從主清單消失記成離所，最後的樣子從 D1 上一次的主清單來；已有的離所保留', async t => {
  const { src, db } = await production(t);
  const sheet = sheetOf(src);
  const gone = sheet.dogs.find(d => d.id && !src.departures.some(e => e.id === d.id));
  sheet.dogs = sheet.dogs.filter(d => d !== gone);
  const deps = await readDepartures(await syncOnce(t, db, sheet));
  const entry = deps.find(e => e.id === gone.id);
  assert.equal(entry.seen, '2026-10-16');
  assert.equal(entry.last.name, gone.name);
  for (const e of src.departures) assert.ok(deps.some(d => d.id === e.id));
});

test('#251 複本可以從試算表整份重建：D1 是空的也能同步，主清單跟試算表一樣', async t => {
  const src = await source();
  const sheet = sheetOf(src);
  const db = await apply(t, {}, await buildSyncSql({}, async mem => ({ ...planSync(await readPrevious(mem), sheet, null, NOW, KEY), groupColumns: src.groupColumns })));
  const payload = await readDogsPayload(db);
  assert.deepEqual(payload.dogs.map(({ myWalkedDate, intro, ...d }) => d), sheet.dogs.map(({ intro, ...d }) => d));
  assert.deepEqual(payload.sheetNotes, src.dogs.sheetNotes);
});

test('#251 只寫 D1：同步不寫 data/、不呼叫 git／GitHub、不寫試算表；workflow 沒有提交步驟', async () => {
  const code = await readFile(new URL('./sync-compact-d1.mjs', import.meta.url), 'utf8');
  const sheetCode = await readFile(new URL('./sync-sheet.mjs', import.meta.url), 'utf8');
  for (const [name, text] of [['sync-compact-d1.mjs', code], ['sync-sheet.mjs', sheetCode]]) {
    assert.doesNotMatch(text, /api\.github\.com|['"]git['"]|method:\s*['"](POST|PUT|PATCH|DELETE)/, name);
    assert.doesNotMatch(text, /writeFile\([^)]*DATA_DIR/, name);
  }
  assert.match(code, /'d1', 'execute'/);
  const workflow = await readFile(new URL('../.github/workflows/sync-sheet.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /git (add|commit|push)/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /contents: write/);
});
