import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateCompactDatabase } from './migrate-compact-db.mjs';
import { importCompactDogs } from './import-compact-dogs.mjs';
import { importCompactLegacy, readCompactLegacy, compareCompactLegacy, renderCompactLegacySql } from './import-compact-legacy.mjs';

async function setup(t) {
  const db = fakeD1(); t.after(() => db.close());
  await migrateCompactDatabase(db);
  await importCompactDogs(db, { dogs: [{ id: 'new', name: '圓仔', formerIds: ['old'] }] });
  return db;
}

test('舊新編號開卡合為同狗取最早日，名字推薦取較新時間，重跑不換志工 ID', async t => {
  const db = await setup(t);
  const input = {
    cardOpened: [
      { walker_code: 'aaaaaaaaaaaa', dog_id: 'old', opened_on: '2026-10-02' },
      { walker_code: 'aaaaaaaaaaaa', dog_id: 'new', opened_on: '2026-10-01' },
    ],
    walkerNames: [
      { name: '測試志工', last_seen: '2026-10-02T00:00:00.000Z' },
      { name: '測試志工', last_seen: '2026-10-01T00:00:00.000Z' },
    ],
  };
  await importCompactLegacy(db, input);
  const dogId = await db.prepare("SELECT dog_id FROM v3_dog_numbers WHERE number='new'").first('dog_id');
  assert.deepEqual(await readCompactLegacy(db), {
    cardOpened: [{ walker_code: 'aaaaaaaaaaaa', dog_id: dogId, opened_on: '2026-10-01' }],
    walkerNames: [{ name: '測試志工', last_seen: '2026-10-02T00:00:00.000Z' }],
  });
  const before = (await db.prepare('SELECT * FROM v3_volunteers').all()).results;
  await importCompactLegacy(db, input);
  assert.deepEqual((await db.prepare('SELECT * FROM v3_volunteers').all()).results, before);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM v3_volunteer_codes').first('n'), 0);
});

test('保留既有較早開卡、較新名字與其他志工，比對可用匯入前 baseline', async t => {
  const db = await setup(t);
  const older = { cardOpened: [{ walker_code: 'aaaaaaaaaaaa', dog_id: 'old', opened_on: '2026-09-01' }], walkerNames: [{ name: '測試志工', last_seen: '2026-10-02T00:00:00Z' }, { name: '其他志工', last_seen: '2026-10-01T00:00:00Z' }] };
  await importCompactLegacy(db, older);
  const baseline = await readCompactLegacy(db);
  const input = { cardOpened: [{ walker_code: 'aaaaaaaaaaaa', dog_id: 'new', opened_on: '2026-10-01' }], walkerNames: [{ name: '測試志工', last_seen: '2026-10-01T23:00:00+08:00' }] };
  await importCompactLegacy(db, input);
  assert.deepEqual(await readCompactLegacy(db), baseline);
  assert.deepEqual(await compareCompactLegacy(db, input, baseline), { equal: true, differences: [] });
});

test('比對差異指出開卡代號和永久狗 ID、名字推薦姓名與欄位；缺少或多出也指出', async t => {
  const db = await setup(t);
  const input = { cardOpened: [{ walker_code: 'aaaaaaaaaaaa', dog_id: 'old', opened_on: '2026-10-01' }], walkerNames: [{ name: '測試志工', last_seen: '2026-10-01T00:00:00Z' }] };
  await importCompactLegacy(db, input);
  assert.deepEqual(await compareCompactLegacy(db, input), { equal: true, differences: [] });
  const id = (await readCompactLegacy(db)).cardOpened[0].dog_id;
  await db.prepare("UPDATE v3_card_opened SET opened_on='2026-10-02'").run();
  await db.prepare("UPDATE v3_volunteers SET last_seen='2026-10-03T00:00:00Z'").run();
  assert.deepEqual((await compareCompactLegacy(db, input)).differences, [
    { kind: 'cardOpened', key: `aaaaaaaaaaaa|${id}`, field: 'opened_on', expected: '2026-10-01', actual: '2026-10-02' },
    { kind: 'walkerNames', key: '測試志工', field: 'last_seen', expected: '2026-10-01T00:00:00Z', actual: '2026-10-03T00:00:00Z' },
  ]);
  await db.prepare('DELETE FROM v3_card_opened').run();
  await db.prepare("INSERT INTO v3_volunteers(name,last_seen) VALUES('多出志工','2026-10-01T00:00:00Z')").run();
  assert.deepEqual((await compareCompactLegacy(db, input)).differences.map(r => [r.kind, r.field]), [['cardOpened', '*'], ['walkerNames', 'last_seen'], ['walkerNames', '*']]);
});

test('缺少來源、未知編號、不可能日期與格式錯誤全部在寫入前停止', async t => {
  const db = await setup(t);
  const name = { name: '測試志工', last_seen: '2026-10-01T00:00:00.000Z' };
  const card = { walker_code: 'aaaaaaaaaaaa', dog_id: 'new', opened_on: '2026-10-01' };
  for (const input of [
    {}, { cardOpened: [] }, { cardOpened: [], walkerNames: null },
    { cardOpened: [card, { ...card, dog_id: 'missing' }], walkerNames: [name] },
    { cardOpened: [{ ...card, opened_on: '2026-02-30' }], walkerNames: [name] },
    { cardOpened: [{ ...card, opened_on: '9999-99-99' }], walkerNames: [name] },
    { cardOpened: [card], walkerNames: [{ ...name, last_seen: '2026-02-30T00:00:00Z' }] },
    { cardOpened: [card], walkerNames: [{ ...name, last_seen: '2026-10-01T25:00:00Z' }] },
    { cardOpened: [card], walkerNames: [{ ...name, last_seen: '2026-10-03T00:00:00+15:00' }] },
    { cardOpened: [card], walkerNames: [{ ...name, last_seen: '2026-10-03T00:00:00+14:01' }] },
    { cardOpened: [card], walkerNames: [{ ...name, name: '\0' }] },
  ]) {
    await assert.rejects(importCompactLegacy(db, input));
    assert.deepEqual(await readCompactLegacy(db), { cardOpened: [], walkerNames: [] });
  }
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM v3_dogs').first('n'), 1);
});

test('batch 失敗整批回復；兩個空陣列是真正的空來源且不刪現有資料', async t => {
  const db = await setup(t);
  const input = { cardOpened: [{ walker_code: 'aaaaaaaaaaaa', dog_id: 'old', opened_on: '2026-10-01' }], walkerNames: [{ name: '測試志工', last_seen: '2026-10-01T00:00:00Z' }] };
  const batch = db.batch.bind(db);
  db.batch = statements => batch([...statements, db.prepare("INSERT INTO v3_card_opened VALUES('fail','missing','2026-10-01')")]);
  await assert.rejects(importCompactLegacy(db, input), /FOREIGN KEY/);
  db.batch = batch;
  assert.deepEqual(await readCompactLegacy(db), { cardOpened: [], walkerNames: [] });
  await importCompactLegacy(db, input);
  const before = await readCompactLegacy(db);
  assert.deepEqual(await importCompactLegacy(db, { cardOpened: [], walkerNames: [] }), { cardOpened: 0, walkerNames: 0 });
  assert.deepEqual(await readCompactLegacy(db), before);
});

test('產生的 SQL 在目標庫才查永久狗 ID；安全保留引號、問號、分號和換行，重跑不換志工 ID', async t => {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(await readFile(new URL('../db/compact-schema.sql', import.meta.url), 'utf8'));
  sqlite.exec("INSERT INTO v3_dogs(dog_id,name) VALUES('target-dog','圓仔'); INSERT INTO v3_dog_numbers VALUES('old','target-dog'); INSERT INTO v3_dog_numbers VALUES('new','target-dog'); CREATE TABLE old_table(value TEXT); INSERT INTO old_table VALUES('保留');");
  const input = {
    cardOpened: [{ walker_code: 'aaaaaaaaaaaa', dog_id: 'old', opened_on: '2026-10-01' }, { walker_code: 'aaaaaaaaaaaa', dog_id: 'new', opened_on: '2026-10-02' }],
    walkerNames: [{ name: "O'Neil ?; DROP TABLE v3_dogs;--\n志工", last_seen: '2026-10-01T00:00:00Z' }],
  };
  const sql = renderCompactLegacySql(input);
  assert.ok(!sql.includes('target-dog'));
  sqlite.exec(sql);
  const before = sqlite.prepare('SELECT * FROM v3_volunteers').all().map(r => ({ ...r }));
  sqlite.exec(sql);
  assert.deepEqual(sqlite.prepare('SELECT * FROM v3_volunteers').all().map(r => ({ ...r })), before);
  assert.equal(before[0].name, input.walkerNames[0].name);
  assert.deepEqual({ ...sqlite.prepare('SELECT * FROM v3_card_opened').get() }, { walker_code: 'aaaaaaaaaaaa', dog_id: 'target-dog', opened_on: '2026-10-01' });
  assert.equal(sqlite.prepare('SELECT value FROM old_table').get().value, '保留');
  assert.throws(() => sqlite.exec(renderCompactLegacySql({ cardOpened: [{ walker_code: 'aaaaaaaaaaaa', dog_id: 'unknown', opened_on: '2026-10-01' }], walkerNames: [] })), /NOT NULL/);
});
