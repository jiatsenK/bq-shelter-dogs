import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { createCompactDatabase } from './compact-schema.mjs';

test('精簡表可重跑，舊表和資料保持原樣', async t => {
  const db = fakeD1(); t.after(() => db.close());
  await db.prepare('CREATE TABLE dogs(key TEXT PRIMARY KEY, name TEXT)').run();
  await db.prepare("INSERT INTO dogs VALUES('old','舊狗')").run();
  await createCompactDatabase(db);
  await createCompactDatabase(db);
  assert.deepEqual((await db.prepare('SELECT * FROM dogs').all()).results, [{ key: 'old', name: '舊狗' }]);
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'v3_%' ORDER BY name").all()).results.map(r => r.name);
  assert.deepEqual(tables, ['v3_activities', 'v3_activity_dogs', 'v3_activity_versions', 'v3_batch_guard', 'v3_card_opened', 'v3_data_versions', 'v3_departure_versions', 'v3_dog_departures', 'v3_dog_edit_actors', 'v3_dog_edit_state', 'v3_dog_numbers', 'v3_dog_pairs', 'v3_dogs', 'v3_edit_log', 'v3_feature_settings', 'v3_feature_settings_log', 'v3_identity_names', 'v3_identity_operations', 'v3_identity_redirects', 'v3_identity_revision', 'v3_intake_events', 'v3_intros', 'v3_pack_versions', 'v3_packs', 'v3_photos', 'v3_rest', 'v3_share_counts', 'v3_share_totals', 'v3_sheet_changes', 'v3_sheet_gone', 'v3_sheet_group_columns', 'v3_sheet_main', 'v3_stays', 'v3_sync_state', 'v3_today_walks', 'v3_volunteer_cards', 'v3_volunteer_favorites', 'v3_volunteers', 'v3_walk_baselines', 'v3_walk_conflicts', 'v3_walk_delivery', 'v3_walk_guard', 'v3_walk_outbox', 'v3_walk_pack', 'v3_walk_packs', 'v3_walk_requests', 'v3_walk_retry', 'v3_walk_state', 'v3_walk_summaries', 'v3_walk_versions', 'v3_walk_write_budget', 'v3_walks']);
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
  await createCompactDatabase(db);
  await db.prepare('INSERT INTO v3_sheet_changes(row_index,label,text) VALUES(?,?,?)').bind(0, '備註1', '移至新B03休養\n保留換行').run();
  assert.deepEqual((await db.prepare('SELECT label,text FROM v3_sheet_changes ORDER BY row_index').all()).results, [{ label: '備註1', text: '移至新B03休養\n保留換行' }]);
});
