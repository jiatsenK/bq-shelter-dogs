import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateCompactDatabase } from './migrate-compact-db.mjs';

test('精簡表可重跑，舊表和資料保持原樣', async t => {
  const db = fakeD1(); t.after(() => db.close());
  await db.prepare('CREATE TABLE dogs(key TEXT PRIMARY KEY, name TEXT)').run();
  await db.prepare("INSERT INTO dogs VALUES('old','舊狗')").run();
  await migrateCompactDatabase(db);
  await migrateCompactDatabase(db);
  assert.deepEqual((await db.prepare('SELECT * FROM dogs').all()).results, [{ key: 'old', name: '舊狗' }]);
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'v3_%' ORDER BY name").all()).results.map(r => r.name);
  assert.deepEqual(tables, ['v3_card_opened', 'v3_departure_items', 'v3_departures', 'v3_dog_numbers', 'v3_dogs', 'v3_intros', 'v3_number_log', 'v3_photos', 'v3_rest', 'v3_sheet_changes', 'v3_sheet_departed', 'v3_sheet_former_numbers', 'v3_sheet_groups', 'v3_sheet_main', 'v3_sheet_main_walkers', 'v3_volunteer_codes', 'v3_volunteers', 'v3_walks']);
  await db.prepare("INSERT INTO v3_dogs(name) VALUES('狗')").run();
  const id = await db.prepare('SELECT dog_id FROM v3_dogs').first('dog_id');
  assert.match(id, /^[a-f0-9]{32}$/);
  await db.prepare('INSERT INTO v3_dog_numbers(number,dog_id) VALUES(?,?)').bind('old', id).run();
  await assert.rejects(db.prepare('INSERT INTO v3_dog_numbers(number,dog_id) VALUES(?,?)').bind('old', id).run(), /UNIQUE/);
  await assert.rejects(db.prepare("INSERT INTO v3_dog_numbers VALUES('orphan','missing')").run(), /FOREIGN KEY/);
  await assert.rejects(db.prepare('DELETE FROM v3_dogs WHERE dog_id=?').bind(id).run(), /FOREIGN KEY/);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
});

test('異動紀錄複本保留試算表實際的標籤與完整文字', async t => {
  const db = fakeD1(); t.after(() => db.close());
  await migrateCompactDatabase(db);
  await db.prepare('INSERT INTO v3_sheet_changes(row_index,label,text) VALUES(?,?,?)').bind(0, '備註1', '移至新B03休養\n保留換行').run();
  assert.deepEqual((await db.prepare('SELECT label,text FROM v3_sheet_changes ORDER BY row_index').all()).results, [{ label: '備註1', text: '移至新B03休養\n保留換行' }]);
});

test('#246 時建好的 v3_walks 重跑後補上當時編號和狗名兩欄', async t => {
  const db = fakeD1(); t.after(() => db.close());
  await db.prepare('CREATE TABLE v3_walks(dog_id TEXT NOT NULL, walk_date TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, walker_name TEXT, walker_code TEXT, PRIMARY KEY(dog_id,walk_date,position))').run();
  await migrateCompactDatabase(db);
  await migrateCompactDatabase(db);
  const columns = (await db.prepare('PRAGMA table_info(v3_walks)').all()).results.map(c => c.name);
  assert.deepEqual(columns.slice(-2), ['dog_number', 'dog_name']);
});
