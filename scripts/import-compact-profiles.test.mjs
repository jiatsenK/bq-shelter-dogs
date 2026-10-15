import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateCompactDatabase } from './migrate-compact-db.mjs';
import { importCompactDogs } from './import-compact-dogs.mjs';
import { importCompactProfiles, readCompactProfiles, compareCompactProfiles, canonicalWalks } from './import-compact-profiles.mjs';

async function setup(t, dogs = [{ id: 'new', name: '圓仔', formerIds: ['old'] }, { id: 'b', name: '乙' }, { id: '', name: '金寶' }]) {
  const db = fakeD1(); t.after(() => db.close());
  await migrateCompactDatabase(db);
  await importCompactDogs(db, { dogs });
  return db;
}

const source = () => ({
  walks: { version: 1, walks: [
    { id: 'old', name: '圓圓', date: '2026-09-01' },
    { id: 'b', name: '乙', date: '2026-09-02', mine: true, walkers: ['aaaaaaaaaaaa'] },
    { id: 'b', name: '乙', date: '2026-09-02', walkers: ['bbbbbbbbbbbb', 'cccccccccccc'] },
    { id: 'gone', name: '已出所', date: '2026-09-03' },
    { id: '', name: '金寶', date: '2026-09-03', walkers: ['aaaaaaaaaaaa'] },
  ] },
  intros: { new: '新卡介紹', b: '乙的介紹' },
  rest: { b: { until: '2026-12-01', reason: '術後', updatedAt: '2026-10-01T00:00:00.000Z' } },
  photos: [
    { key: 'photos/new.jpg', last_modified: '2026-10-01T00:00:00.000Z' },
    { key: 'photos/thumbs/new.jpg' },
    { key: 'photos/old.jpg' },
    { key: 'photos/b.jpg', size: 0, customMetadata: { deleted: '1' } },
    { key: 'photos/thumbs/b.jpg' },
    { key: 'trash/123/photo.jpg' },
  ],
});

test('同一隻狗同一天以最後一筆有 walkers 的為準，沒記人的舊紀錄仍算有溜', () => {
  assert.deepEqual(canonicalWalks(source().walks), [
    { id: 'old', name: '圓圓', date: '2026-09-01' },
    { id: 'b', name: '乙', date: '2026-09-02', walkers: ['bbbbbbbbbbbb', 'cccccccccccc'] },
    { id: '', name: '金寶', date: '2026-09-03', walkers: ['aaaaaaaaaaaa'] },
    { id: 'gone', name: '已出所', date: '2026-09-03' },
  ]);
});

test('匯入後新表內容正確：當時編號狗名、再入所同狗、已出所狗建身分', async t => {
  const db = await setup(t);
  await importCompactProfiles(db, source());
  const idOf = async n => db.prepare('SELECT dog_id FROM v3_dog_numbers WHERE number=?').bind(n).first('dog_id');
  const walks = (await db.prepare('SELECT dog_id,walk_date,position,walker_code,dog_number,dog_name FROM v3_walks ORDER BY walk_date,dog_number,position').all()).results;
  assert.deepEqual(walks.map(w => [w.dog_number, w.dog_name, w.walk_date, w.position, w.walker_code]), [
    ['old', '圓圓', '2026-09-01', 0, null],
    ['b', '乙', '2026-09-02', 0, 'bbbbbbbbbbbb'],
    ['b', '乙', '2026-09-02', 1, 'cccccccccccc'],
    ['', '金寶', '2026-09-03', 0, 'aaaaaaaaaaaa'],
    ['gone', '已出所', '2026-09-03', 0, null],
  ]);
  assert.equal(walks[0].dog_id, await idOf('new'));
  assert.ok(await idOf('gone'));
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM v3_walks WHERE walker_name IS NOT NULL').first('n'), 0);
  assert.equal((await db.prepare('SELECT intro FROM v3_intros WHERE dog_id=?').bind(await idOf('new')).first('intro')), '新卡介紹');
  assert.deepEqual(await db.prepare('SELECT until_date,reason FROM v3_rest').first(), { until_date: '2026-12-01', reason: '術後' });
  const photos = (await db.prepare('SELECT object_key,thumb_key,is_primary,uploaded_at,dog_id FROM v3_photos ORDER BY object_key').all()).results;
  assert.deepEqual(photos.map(p => [p.object_key, p.thumb_key, p.is_primary, p.uploaded_at]), [
    ['photos/new.jpg', 'photos/thumbs/new.jpg', 1, '2026-10-01T00:00:00.000Z'],
    ['photos/old.jpg', null, 0, null],
  ]);
  assert.equal(photos[1].dog_id, await idOf('new'));
});

test('讀回跟來源一致；重跑不增筆、不換狗 ID（含不在主清單上的無編號狗）', async t => {
  const db = await setup(t);
  const input = source();
  input.walks.walks.push({ id: '', name: '走失', date: '2026-09-04' });
  await importCompactProfiles(db, input);
  const dogs = (await db.prepare('SELECT * FROM v3_dogs ORDER BY dog_id').all()).results;
  assert.deepEqual((await importCompactProfiles(db, input)).newDogs, []);
  assert.deepEqual((await db.prepare('SELECT * FROM v3_dogs ORDER BY dog_id').all()).results, dogs);
  assert.deepEqual(await compareCompactProfiles(db, input), { equal: true, differences: [] });
  const back = await readCompactProfiles(db);
  assert.deepEqual(back.rest, { b: { until: '2026-12-01', reason: '術後' } });
  assert.deepEqual(back.intros, { new: '新卡介紹', b: '乙的介紹' });
  assert.deepEqual(back.photos, ['photos/new.jpg', 'photos/old.jpg', 'photos/thumbs/new.jpg']);
});

test('比對有差異時指出類別和哪一筆', async t => {
  const db = await setup(t);
  await importCompactProfiles(db, source());
  await db.prepare("UPDATE v3_walks SET walker_code='dddddddddddd' WHERE dog_number='b' AND position=1").run();
  await db.prepare("UPDATE v3_rest SET reason='改過'").run();
  await db.prepare("DELETE FROM v3_intros WHERE intro='乙的介紹'").run();
  await db.prepare("UPDATE v3_photos SET thumb_key=NULL WHERE object_key='photos/new.jpg'").run();
  const report = await compareCompactProfiles(db, source());
  assert.equal(report.equal, false);
  assert.deepEqual(report.differences.map(d => [d.kind, d.key, d.field]), [
    ['walks', 'b|2026-09-02', 'walkers'],
    ['intros', 'b', '*'],
    ['rest', 'b', 'reason'],
    ['photos', 'photos/thumbs/new.jpg', '*'],
  ]);
});

test('格式錯誤在寫入前停止，舊資料保留', async t => {
  const db = await setup(t);
  await importCompactProfiles(db, source());
  for (const bad of [
    { ...source(), walks: { walks: [{ id: 'b', name: '乙', date: '2026/09/02' }] } },
    { ...source(), rest: { b: { until: '不是日期' } } },
    { ...source(), intros: { b: 3 } },
    { ...source(), photos: [{ key: 'photos/b.jpg' }, { key: 'photos/b.jpg' }] },
  ]) await assert.rejects(importCompactProfiles(db, bad));
  assert.equal((await compareCompactProfiles(db, source())).equal, true);
});

test('已出所狗的介紹和照片用編號建身分保留，再入所時跟著同一隻狗', async t => {
  const db = await setup(t);
  const input = { ...source(), intros: { ...source().intros, left: '出所狗介紹' }, names: { left: '小離' }, photos: [{ key: 'photos/left.jpg' }] };
  const result = await importCompactProfiles(db, input);
  const dogId = await db.prepare("SELECT dog_id FROM v3_dog_numbers WHERE number='left'").first('dog_id');
  assert.equal(await db.prepare('SELECT name FROM v3_dogs WHERE dog_id=?').bind(dogId).first('name'), '小離');
  assert.equal(await db.prepare('SELECT dog_id FROM v3_photos').first('dog_id'), dogId);
  assert.deepEqual(result.newDogs, ['gone', 'left']);
  assert.equal((await compareCompactProfiles(db, input)).equal, true);
  await importCompactDogs(db, { dogs: [{ id: 'new', name: '圓仔', formerIds: ['old'] }, { id: 'b', name: '乙' }, { id: '', name: '金寶' }, { id: 'back', name: '小離', formerIds: ['left'] }] });
  assert.deepEqual((await readCompactProfiles(db)).intros, { new: '新卡介紹', b: '乙的介紹', back: '出所狗介紹' });
});

test('不是主照片或縮圖的 R2 物件、沒有主照片的縮圖列在略過清單', async t => {
  const db = await setup(t);
  const result = await importCompactProfiles(db, source());
  assert.deepEqual(result.skipped, ['photos/thumbs/b.jpg', 'trash/123/photo.jpg']);
});
