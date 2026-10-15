// 資料庫（第 2 步）：repo 的資料轉成四張表、每日快照轉成異動紀錄
// 執行：node --test scripts/build-db.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dogKey, dogRows, walkRows, changesFromSnapshots, kvRows, sqlValue, insertSql, seedSql, loadRepoData, buildAll } from './build-db.mjs';

const NOW = '2026-10-10T12:00:00.000Z';

test('狗的現況：一隻一列；沒編號用「名:犬名」；休養設定併進來；離所的狗用最後看到的樣子，回來的不重複', () => {
  const rows = dogRows(
    { dogs: [
      { id: '2024032902', name: '阿湯', cage: 'C區35', note: "it's ok", sex: 'male', intro: '親人', covered: false, walkedDate: '2026-10-07', walkers: ['aaaaaaaaaaaa'] },
      { id: '', name: '金寶', cage: '新A01', covered: true },
      { id: '2024032902', name: '阿湯（重複列）', cage: 'X' },
      { id: '', name: '' },
    ] },
    [
      { id: '2026092401', name: '豆花', date: '2026-10-02', dateSource: 'seen', reason: 'adopt', last: { id: '2026092401', name: '豆花', cage: 'C區24', walkedDate: '2026-10-01', note: '', sex: '', intro: '' } },
      { id: '2024032902', name: '阿湯', date: '2026-09-01', reason: 'unknown', last: { id: '2024032902', name: '阿湯', cage: '舊' } },
    ],
    { '2024032902': { until: '2026-10-20', reason: '術後休養' } }, NOW);
  assert.deepEqual(rows.map(r => [r.key, r.name, r.status]), [['2024032902', '阿湯', 'in'], ['名:金寶', '金寶', 'in'], ['2026092401', '豆花', 'departed']]);
  assert.deepEqual([rows[0].rest_until, rows[0].rest_reason, rows[0].walkers, rows[0].walked_date, rows[0].sort], ['2026-10-20', '術後休養', '["aaaaaaaaaaaa"]', '2026-10-07', 0]);
  assert.deepEqual([rows[1].covered, rows[1].walkers, rows[1].rest_until], [1, '[]', null]);
  assert.deepEqual([rows[2].departed_date, rows[2].departed_reason, rows[2].departed_source, rows[2].cage], ['2026-10-02', 'adopt', 'seen', 'C區24']);
  assert.equal(dogKey({ id: ' 12 ', name: 'x' }), '12');
});

test('溜狗紀錄：同一隻同一天一筆、以最後一筆為準；日期不對的丟掉；只存代號', () => {
  const rows = walkRows({ walks: [
    { id: '1', name: '甲', date: '2026-09-24', walkers: ['aaaaaaaaaaaa'] },
    { id: '1', name: '甲', date: '2026-09-24', walkers: ['bbbbbbbbbbbb'] },
    { id: '1', name: '甲', date: '2026-09-22' },
    { id: '2', name: '乙', date: '2026-09-23', walkers: ['aaaaaaaaaaaa'] },
    { id: '2', name: '乙', date: '2026-09-23' },
    { id: '', name: '丙', date: '2026-09-23' },
    { id: '3', name: '丁', date: '2026/09/23' },
    null,
  ] });
  assert.deepEqual(rows.map(r => [r.dog_key, r.date, r.walkers]), [
    ['1', '2026-09-22', '[]'], ['2', '2026-09-23', '["aaaaaaaaaaaa"]'], ['名:丙', '2026-09-23', '[]'], ['1', '2026-09-24', '["bbbbbbbbbbbb"]'],
  ]);
  assert.deepEqual(walkRows(null), []);
});

test('每日快照 → 異動紀錄：第一天是起點不記；之後只記有變的欄位、入所、離所；上次溜不算', () => {
  const day = (date, dogs) => ({ date, syncedAt: `${date}T18:00:00+08:00`, dogs });
  const changes = changesFromSnapshots([
    day('2026-09-27', [{ id: '1', name: '甲', cage: 'B', note: '新備註', walkedDate: '2026-09-27' }, { id: '3', name: '丙', cage: 'C', covered: true }]),
    day('2026-09-25', [{ id: '1', name: '甲', cage: 'A', note: '', walkedDate: '2026-09-20' }, { id: '2', name: '乙', cage: 'X' }]),
    day('2026-09-26', [{ id: '1', name: '甲', cage: 'B', note: '', walkedDate: '2026-09-26' }, { id: '2', name: '乙', cage: 'X' }]),
    { date: '2026-09-28', dogs: [{ id: '1', name: '甲', cage: 'B', note: '新備註' }, { id: '3', name: '丙', cage: 'C', covered: false }] },
  ]);
  assert.deepEqual(changes.map(c => [c.at.slice(0, 10), c.dog_key, c.field, c.old, c.new]), [
    ['2026-09-26', '1', 'cage', 'A', 'B'],
    ['2026-09-27', '1', 'note', '', '新備註'],
    ['2026-09-27', '3', 'status', null, 'in'],
    ['2026-09-27', '2', 'status', 'in', 'departed'],
    ['2026-09-28', '3', 'covered', '1', '0'],
  ]);
  assert.ok(changes.every(c => c.source === 'import' && c.by === ''));
  assert.equal(changes[4].at, '2026-09-28T00:00:00+08:00', '沒有同步時間就用那天');
  assert.deepEqual(changesFromSnapshots([]), []);
});

test('印成 SQL：單引號跳脫、NULL、數字；一次最多 50 列；整份可以重跑', () => {
  assert.deepEqual([sqlValue("it's"), sqlValue(null), sqlValue(undefined), sqlValue(3), sqlValue(''), sqlValue(NaN)], ["'it''s'", 'NULL', 'NULL', '3', "''", 'NULL']);
  const sql = insertSql('walks', Array.from({ length: 120 }, (_, i) => ({ dog_key: String(i), date: '2026-01-01' })));
  assert.equal(sql.split('INSERT OR REPLACE INTO walks').length - 1, 3);
  assert.equal(insertSql('walks', []), '');
  const seed = seedSql({ dogs: [{ key: '1', name: "O'Neil" }], walks: [], changes: [{ at: 'x', dog_key: '1', field: 'cage', old: null, new: 'A' }], kv: kvRows({ groups: { 甲: ['乙'] }, syncedAt: 't' }, NOW) });
  assert.match(seed, /INSERT OR REPLACE INTO dogs \(key, name\) VALUES\n  \('1', 'O''Neil'\);/);
  assert.match(seed, /DELETE FROM changes WHERE source = 'import';\n\nINSERT INTO changes /);
  assert.match(seed, /INSERT OR REPLACE INTO kv /);
});

test('repo 裡現在的資料轉得進去，而且真的能放進 db/schema.sql 的表（有 node:sqlite 才跑這段）', async t => {
  const live = JSON.parse(await readFile(new URL('../tests/fixtures/dogs.json', import.meta.url), 'utf8'));
  const walksData = JSON.parse(await readFile(new URL('../tests/fixtures/walks.json', import.meta.url), 'utf8'));
  const all = buildAll({ dogsData: live, departures: [], rest: {}, walksData, snapshots: [{ date: '2026-10-14', syncedAt: live.syncedAt, dogs: live.dogs }, { date: '2026-10-15', syncedAt: live.syncedAt, dogs: live.dogs.map(d => ({ ...d, cage: 'B1' })) }] }, NOW);
  assert.equal(all.dogs.filter(d => d.status === 'in').length, new Set(live.dogs.filter(d => d.name).map(dogKey)).size, '在所的狗一隻不少');
  assert.ok(all.walks.length > 0 && all.changes.length > 0);
  // 公開資料不放志工名字：誰溜的只能是代號
  for (const w of all.walks) for (const c of JSON.parse(w.walkers)) assert.match(c, /^[0-9a-f]{12}$/);
  for (const d of all.dogs) for (const c of JSON.parse(d.walkers)) assert.match(c, /^[0-9a-f]{12}$/);

  let sqlite;
  try { sqlite = await import('node:sqlite'); } catch (e) { t.skip('這個 Node 沒有 node:sqlite'); return; }
  const db = new sqlite.DatabaseSync(':memory:');
  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  db.exec(schema);
  db.exec(schema); // 可以重複執行
  const seed = seedSql(all);
  db.exec(seed);
  db.exec(seed); // 重跑不會重複
  const count = table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  assert.deepEqual([count('dogs'), count('walks'), count('changes'), count('kv')], [all.dogs.length, all.walks.length, all.changes.length, all.kv.length]);
  assert.throws(() => db.exec("INSERT INTO dogs (key, name, status, updated_at) VALUES ('x', 'x', 'gone', 'now')"), /CHECK/);
});
