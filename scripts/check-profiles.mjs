// #218：本機演練。正式 D1／R2 來源由唯讀暫存檔傳入，不加入 repo。
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateBusinessDatabase } from './migrate-business-db.mjs';
import { migrateIdentities } from './migrate-identities.mjs';
import { migrateHistory } from './migrate-history.mjs';
import { readHistorySources } from './check-history.mjs';
import { migrateProfiles } from './migrate-profiles.mjs';
import { parseFrontmatterBody, parseFrontmatterSex, markdownToText } from './sync-sheet.mjs';

export async function readProfileSources(departedPath, legacyPath, photosPath, root = new URL('../', import.meta.url)) {
  const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
  const base = await readHistorySources(departedPath, root);
  if (!legacyPath || !photosPath) throw new Error('請提供唯讀 D1 與 R2 來源檔，不能拿缺少來源當空資料');
  const legacy = JSON.parse(await readFile(legacyPath, 'utf8'));
  const photos = JSON.parse(await readFile(photosPath, 'utf8'));
  return { ...base, profiles: {
    cardOpened: legacy.cardOpened, walkerNames: legacy.walkerNames, kv: legacy.kv,
    photos: photos.objects,
    cards: base.identities.cards.map(c => ({ ...c, body: markdownToText(parseFrontmatterBody(c.raw)), sex: parseFrontmatterSex(c.raw) })),
    introOriginal: (await json('data/intro-original.json')).intros,
    rest: await json('data/rest.json'), notes: await json('data/my-notes.json'),
    deferredIntroNumbers: (await json('docs/migration-213/profile-review.json')).groups.filter(g => !g.confirmed).flatMap(g => g.numbers),
  } };
}

export async function checkProfiles(input) {
  const db = fakeD1();
  try {
    await migrateBusinessDatabase(db); await migrateIdentities(db, input.identities); await migrateHistory(db, input.history);
    await db.batch([
      db.prepare('CREATE TABLE walker_names(name TEXT PRIMARY KEY,last_seen TEXT NOT NULL)'),
      db.prepare('CREATE TABLE kv(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)'),
    ]);
    const first = await migrateProfiles(db, input.profiles), second = await migrateProfiles(db, input.profiles);
    if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('重跑附屬資料遷移不一致');
    const p = input.profiles;
    const expected = p.cardOpened.length + p.walkerNames.length + p.kv.length + p.photos.length + p.cards.length + Object.keys(p.introOriginal).length + Object.keys(p.rest).length + Object.keys(p.notes).length + (p.legacyCodes?.length || 0) + (p.walkerAliases?.length || 0) + Object.keys(p.introChoices || {}).length + Object.keys(p.photoChoices || {}).length;
    if (second.sources !== expected) throw new Error('附屬資料來源筆數不平衡');
    if ((await db.prepare('PRAGMA foreign_key_check').all()).results.length) throw new Error('外鍵檢核失敗');
    for (const row of p.kv) if ((await db.prepare('SELECT value FROM kv WHERE key=?').bind(row.key).first('value')) !== row.value) throw new Error('kv 值與來源不一致');
    for (const row of p.walkerNames) if ((await db.prepare('SELECT last_seen FROM walker_names WHERE name=?').bind(row.name).first('last_seen')) !== row.last_seen) throw new Error('名字推薦與來源不一致');
    const counts = {};
    for (const table of ['v2_card_opened','v2_rest_settings','v2_dog_photos','v2_profile_sources','walker_names','kv']) counts[table] = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n');
    const pending = (await db.prepare("SELECT source_kind,reason,COUNT(*) AS n FROM v2_profile_sources WHERE state='pending' GROUP BY source_kind,reason ORDER BY source_kind,reason").all()).results;
    return { counts, sourceBalance: expected, replayIdentical: true, pending };
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await checkProfiles(await readProfileSources(...process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
