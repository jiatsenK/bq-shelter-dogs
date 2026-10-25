// #560 第二步：0008 刪舊離所三表。照正式庫的順序：舊表有資料 → 0006 搬進 v3_dog_departures → 跑到最後一號，
// 新表與網站讀到的離所名冊、只有名字的卡不變，舊表與它們的 9 個觸發器都不在了
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { splitStatements } from './migrate-compact-db.mjs';
import { MIGRATIONS_DIR, migrationFiles, changesData } from './d1-migrations.mjs';
import { readDepartures, readNameOnlyCards } from '../worker/src/compact.js';

const FILE = '0008_drop_old_departures.sql';
const run = async (db, file) => { for (const sql of splitStatements(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))) await db.prepare(sql).run(); };
const OLD = ['v3_departures', 'v3_departure_items', 'v3_departed_cards'];

test('0008：舊離所三表和觸發器刪掉，新表的離所名冊、只有名字的卡不變；會刪資料要先備份', async t => {
  const db = fakeD1(); t.after(() => db.close());
  for (const f of migrationFiles().filter(f => f < '0006')) await run(db, f);
  await db.batch([
    db.prepare("INSERT INTO v3_dogs(dog_id,name) VALUES('d1','阿福'),('m1','老黃')"),
    db.prepare("INSERT INTO v3_departures(number,dog_id,name,departed_date,reason,last_number,last_name,last_cage,last_note,last_sex,last_intro) VALUES('2020010101','d1','阿福','2026-10-10','adopt','2020010101','阿福','A1','','','介紹')"),
    db.prepare("INSERT INTO v3_departure_items(number,kind,position,value) VALUES('2020010101','group',0,'小咪')"),
    db.prepare("INSERT INTO v3_departed_cards(dog_id,departed_date,reason,created_at) VALUES('m1','2024-06-01','adopt','2026-10-21T08:00:00Z')"),
  ]);
  for (const f of migrationFiles().filter(f => f >= '0006' && f < FILE)) await run(db, f);
  // Current reader needs the additive dog-edit tables; keep both sides of the DROP comparison identical.
  await run(db, '0009_dog_edit.sql');
  const departures = await readDepartures(db), cards = await readNameOnlyCards(db);
  assert.equal(departures.length, 1);
  await run(db, FILE);
  assert.deepEqual(await readDepartures(db), departures);
  assert.deepEqual(await readNameOnlyCards(db), cards);
  const marks = OLD.map(() => '?').join(',');
  const left = (await db.prepare(`SELECT name FROM sqlite_master WHERE name IN (${marks}) OR tbl_name IN (${marks})`).bind(...OLD, ...OLD).all()).results;
  assert.deepEqual(left, []);
  assert.equal(changesData(readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8')), true, '套用 workflow 要先複製到備用庫');
  // 重跑不出錯（DROP … IF EXISTS）
  await run(db, FILE);
});
