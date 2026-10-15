import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateCompactDatabase } from './migrate-compact-db.mjs';
import { readDogsPayload } from '../worker/src/compact.js';
import { readCardSources } from './check-compact-profiles.mjs';
import { buildSyncSql, SEED_TABLES } from './sync-compact-d1.mjs';

const json = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));

async function source() {
  const dogs = await json('data/dogs.json');
  // 常遛狗群照欄存：每隻有群組的狗跟它的群組一欄（真實試算表的欄可能更大，這裡只要能還原）
  const groupColumns = [], seen = new Set();
  for (const [name, others] of Object.entries(dogs.groups)) {
    const column = [name, ...others].sort();
    if (!seen.has(column.join()) && column.every(n => dogs.groups[n]?.length === others.length)) { seen.add(column.join()); groupColumns.push(column); }
  }
  return { dogs, walks: await json('data/walks.json'), rest: await json('data/rest.json'), ...(await readCardSources()), groupColumns };
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
  assert.deepEqual(payload.dogs, src.dogs.dogs);
  assert.deepEqual(payload.sheetNotes, src.dogs.sheetNotes);
  for (const column of src.groupColumns) for (const name of column) assert.deepEqual([...payload.groups[name]].sort(), column.filter(n => n !== name));
  assert.ok(await db.prepare('SELECT COUNT(*) AS n FROM v3_walks').first('n'));
});

test('再同步一次沿用正式 D1 的永久狗 ID，不新增狗', async t => {
  const src = await source();
  const first = await apply(t, {}, await buildSyncSql({}, src));
  const seed = {};
  for (const [table, sql] of Object.entries(SEED_TABLES)) seed[table] = (await first.prepare(sql).all()).results;
  const db = await apply(t, seed, await buildSyncSql(seed, src));
  assert.deepEqual((await db.prepare('SELECT * FROM v3_dogs ORDER BY dog_id').all()).results, (await first.prepare('SELECT * FROM v3_dogs ORDER BY dog_id').all()).results);
  assert.deepEqual((await readDogsPayload(db)).dogs, src.dogs.dogs);
});

test('開卡和照片表不被同步清掉', async t => {
  const src = await source();
  const first = await apply(t, {}, await buildSyncSql({}, src));
  const dogId = await first.prepare('SELECT dog_id FROM v3_dogs LIMIT 1').first('dog_id');
  await first.prepare("INSERT INTO v3_card_opened VALUES('aaaaaaaaaaaa',?,'2026-10-15')").bind(dogId).run();
  await first.prepare("INSERT INTO v3_photos(object_key,dog_id) VALUES('photos/x.jpg',?)").bind(dogId).run();
  const seed = {};
  for (const [table, sql] of Object.entries(SEED_TABLES)) seed[table] = (await first.prepare(sql).all()).results;
  const sql = await buildSyncSql(seed, src);
  assert.doesNotMatch(sql, /v3_card_opened|v3_photos|v3_volunteer/);
});

test('來源有問題時丟錯，不產生 SQL', async t => {
  const src = await source();
  await assert.rejects(buildSyncSql({}, { ...src, rest: { x: { until: '不是日期' } } }), /休養/);
});
