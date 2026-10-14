import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateBusinessDatabase } from './migrate-business-db.mjs';
import { migrateIdentities } from './migrate-identities.mjs';
import { migrateProfiles } from './migrate-profiles.mjs';

async function setup(t) {
  const db = fakeD1(); t.after(() => db.close());
  await migrateBusinessDatabase(db);
  await migrateIdentities(db, { dogs: [{ id: '2020010101', name: '狗' }], cards: [{ id: '2026010101', formerIds: ['2020010101'] }] });
  await db.prepare('CREATE TABLE walker_names(name TEXT PRIMARY KEY,last_seen TEXT NOT NULL)').run();
  await db.prepare('CREATE TABLE kv(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)').run();
  return db;
}

test('開卡認狗跨入所合併取最早日期，名字推薦與 kv 保留，重跑不增筆', async t => {
  const db = await setup(t);
  const input = {
    cardOpened: [{ walker_code: 'abcdef123456', dog_id: '2020010101', opened_on: '2026-09-01' }, { walker_code: 'abcdef123456', dog_id: '2026010101', opened_on: '2026-09-20' }],
    walkerNames: [{ name: '測試志工', last_seen: '2026-09-20T00:00:00Z' }],
    kv: [{ key: 'syncedAt', value: '"原值"', updated_at: '2026-09-20T00:00:00Z' }],
  };
  await migrateProfiles(db, input); await migrateProfiles(db, input);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v2_card_opened').first('COUNT(*)'), 1);
  assert.equal(await db.prepare('SELECT opened_on FROM v2_card_opened').first('opened_on'), '2026-09-01');
  assert.equal(await db.prepare('SELECT name FROM walker_names').first('name'), '測試志工');
  assert.equal(await db.prepare('SELECT value FROM kv').first('value'), '"原值"');
});

test('重新遷移刪除標記會撤下既有有效照片，不遺留舊縮圖關聯', async t => {
  const db = await setup(t);
  await migrateProfiles(db, { photos: [{ key: 'photos/2026010101.jpg', size: 100 }, { key: 'photos/thumbs/2026010101.jpg', size: 30 }] });
  await migrateProfiles(db, { photos: [{ key: 'photos/2026010101.jpg', size: 0 }, { key: 'photos/thumbs/2026010101.jpg', size: 0 }] });
  assert.equal(await db.prepare("SELECT COUNT(*) FROM v2_dog_photos WHERE state='active'").first('COUNT(*)'), 0);
  assert.equal(await db.prepare('SELECT thumb_key FROM v2_dog_photos').first('thumb_key'), null);
});

test('R2 零位元組或 metadata.deleted 標記不作主照片／縮圖，來源仍保存', async t => {
  const db = await setup(t);
  const out = await migrateProfiles(db, { photos: [
    { key: 'photos/2020010101.jpg', size: 100 }, { key: 'photos/thumbs/2020010101.jpg', size: 0 },
    { key: 'photos/2026010101.jpg', size: 0, metadata: { deleted: '2026-10-14' } },
    { key: 'photos/thumbs/2026010101.jpg', size: 50, metadata: { deleted: '2026-10-14' } },
  ] });
  const active = await db.prepare("SELECT object_key,thumb_key FROM v2_dog_photos WHERE state='active'").first();
  assert.deepEqual(active, { object_key: 'photos/2020010101.jpg', thumb_key: null });
  assert.equal(out.sources, 4);
  assert.equal(await db.prepare("SELECT COUNT(*) FROM v2_profile_sources WHERE state='archived'").first('COUNT(*)'), 3);
});

test('照片跨入所跟狗，沿用 R2 路徑，舊照片與 trash 保留 replaced；重跑不增筆', async t => {
  const db = await setup(t);
  const photos = [
    { key: 'photos/2020010101.jpg' }, { key: 'photos/thumbs/2020010101.jpg' },
    { key: 'photos/2026010101.jpg' }, { key: 'photos/thumbs/2026010101.jpg' },
    { key: 'trash/example/photo.jpg', metadata: { dogId: '2020010101', kind: 'main' } }, { key: 'trash/example/thumb.jpg' },
  ];
  await migrateProfiles(db, { photos }); await migrateProfiles(db, { photos });
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v2_dog_photos').first('COUNT(*)'), 3);
  const active = await db.prepare("SELECT object_key,thumb_key FROM v2_dog_photos WHERE state='active' AND is_primary=1").first();
  assert.deepEqual(active, { object_key: 'photos/2026010101.jpg', thumb_key: 'photos/thumbs/2026010101.jpg' });
  assert.equal(await db.prepare("SELECT COUNT(*) FROM v2_dog_photos WHERE state='replaced'").first('COUNT(*)'), 2);
});

test('介紹跨入所共用並保留舊原文，休養只掛原本入所，舊備註只留封存指紋', async t => {
  const db = await setup(t);
  await migrateProfiles(db, {
    cards: [{ id: '2020010101', body: '舊介紹' }, { id: '2026010101', body: '新的再入所介紹' }],
    introOriginal: { '2020010101': '改寫前原文' },
    rest: { '2020010101': { until: '2026-10-20', reason: '舊入所休養' } },
    notes: { '2020010101': { text: '不要放進 D1 的私密備註', updatedAt: '2026-10-01' } },
  });
  const dog = await db.prepare('SELECT intro,intro_original FROM v2_dogs').first();
  assert.deepEqual(dog, { intro: '新的再入所介紹', intro_original: '改寫前原文' });
  assert.equal(await db.prepare('SELECT n.number FROM v2_rest_settings r JOIN v2_admission_numbers n USING(admission_id)').first('number'), '2020010101');
  assert.doesNotMatch(await db.prepare("SELECT raw_json FROM v2_profile_sources WHERE source_kind='note_archive'").first('raw_json'), /私密備註/);
});

test('志工別名須有確認，既有兩人合併取最早開卡並保留參與者', async t => {
  const db = await setup(t);
  const cards = [
    { walker_code: 'aaaaaaaaaaaa', dog_id: '2020010101', opened_on: '2026-09-20' },
    { walker_code: 'bbbbbbbbbbbb', dog_id: '2026010101', opened_on: '2026-09-01' },
  ];
  await migrateProfiles(db, { cardOpened: cards });
  const oldWalker = await db.prepare("SELECT walker_id FROM v2_walker_codes WHERE code='bbbbbbbbbbbb'").first('walker_id');
  const primaryWalker = await db.prepare("SELECT walker_id FROM v2_walker_codes WHERE code='aaaaaaaaaaaa'").first('walker_id');
  const admission = await db.prepare("SELECT admission_id FROM v2_admissions WHERE status='in'").first('admission_id');
  await db.prepare("INSERT INTO v2_daily_walks(walk_id,admission_id,walk_date,state,participant_quality,evidence) VALUES('walk',?,'2026-09-20','final','known','legacy')").bind(admission).run();
  await db.batch([db.prepare("INSERT INTO v2_walk_participants VALUES('walk',?)").bind(oldWalker), db.prepare("INSERT INTO v2_walk_participants VALUES('walk',?)").bind(primaryWalker)]);
  await db.prepare("INSERT INTO v2_operations(operation_id,request_hash,action,actor_walker_id,state,desired_json,created_at) VALUES('op','hash','walk',?,'prepared','{}','2026-10-14T00:00:00Z')").bind(oldWalker).run();
  const aliases = [{ primaryCode: 'aaaaaaaaaaaa', aliasCodes: ['bbbbbbbbbbbb'], confirmedAt: '2026-10-14T00:00:00Z', evidence: 'K 明確確認' }];
  await migrateProfiles(db, { walkerAliases: aliases, cardOpened: cards });
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v2_card_opened').first('COUNT(*)'), 1);
  assert.equal(await db.prepare('SELECT opened_on FROM v2_card_opened').first('opened_on'), '2026-09-01');
  assert.equal(await db.prepare("SELECT kind FROM v2_walker_codes WHERE code='bbbbbbbbbbbb'").first('kind'), 'alias');
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v2_walk_participants').first('COUNT(*)'), 1);
  assert.equal(await db.prepare('SELECT actor_walker_id FROM v2_operations').first('actor_walker_id'), primaryWalker);
  await assert.rejects(migrateProfiles(db, { walkerAliases: [{ ...aliases[0], evidence: '' }] }), /確認/);
});

test('待確認介紹不覆寫，明確選擇要有證據，未知來源不建狗', async t => {
  const db = await setup(t);
  const input = {
    cards: [{ id: '2026010101', body: '候選介紹' }, { id: 'missing', body: '不能猜配' }],
    deferredIntroNumbers: ['2026010101'], introOriginal: { '2026010101': '原文' },
  };
  const out = await migrateProfiles(db, input);
  assert.equal(await db.prepare('SELECT intro FROM v2_dogs').first('intro'), '');
  assert.equal(out.pending.length, 3);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v2_dogs').first('COUNT(*)'), 1);
  input.introChoices = { '2026010101': { cardId: '2026010101', originalId: '2026010101', evidence: 'K 已確認版本' } };
  await migrateProfiles(db, input);
  assert.equal(await db.prepare('SELECT intro FROM v2_dogs').first('intro'), '候選介紹');
  assert.equal(await db.prepare('SELECT intro_original FROM v2_dogs').first('intro_original'), '原文');
});
