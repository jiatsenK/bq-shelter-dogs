import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './fakes.mjs';
import { migrateCompactDatabase } from '../../scripts/migrate-compact-db.mjs';
import { readDogEdit, saveDogEdit } from '../src/dog-edit.js';
import { fakeR2 } from './fakes.mjs';
import { saveDogPhoto, restoreDogPhoto } from '../src/dog-photo.js';
import { readDogsPayload, readDepartures } from '../src/compact.js';
import { applyDogListRows } from '../src/dog-list.js';
import { readSmall, readDepartureYear } from '../src/packs.js';
import { readEdits } from '../src/editlog.js';
const dogId = 'a'.repeat(32);
const actor = { subject: 'verified', email: 'private@example.org' };
async function setup(t) {
  const db = fakeD1();
  t.after(() => db.close());
  await migrateCompactDatabase(db);
  await db.prepare('INSERT INTO v3_dogs(dog_id,name,sex) VALUES(?,?,?)').bind(dogId, '測試狗', 'male').run();
  return db;
}
test('同交易修改及公開紀錄、私人身分分離；無差異不寫；舊版本衝突', async (t) => {
  const db = await setup(t),
    before = await readDogEdit(db, dogId);
  const after = await saveDogEdit(db, dogId, { revision: before.revision, field: 'intro', value: '介紹' }, { actor });
  assert.equal(after.intro, '介紹');
  await assert.rejects(
    saveDogEdit(db, dogId, { revision: before.revision, field: 'intro', value: '覆蓋' }, { actor }),
    (e) => e.status === 409
  );
  const count = await db.prepare('SELECT total_changes() AS n').first('n');
  await saveDogEdit(db, dogId, { revision: after.revision, field: 'intro', value: '介紹' }, { actor });
  assert.equal(await db.prepare('SELECT total_changes() AS n').first('n'), count);
  const log = await db.prepare('SELECT * FROM v3_edit_log').first();
  assert.equal(log.before_json, '""');
  assert.equal(log.after_json, '"介紹"');
  assert.ok(!JSON.stringify(log).includes(actor.email));
  assert.equal((await db.prepare('SELECT actor_email FROM v3_dog_edit_actors').first()).actor_email, actor.email);
});
test('紀錄失敗整筆回復；GAS 與志工變更使草稿衝突', async (t) => {
  const db = await setup(t),
    before = await readDogEdit(db, dogId);
  await db.prepare("CREATE TRIGGER fail_log BEFORE INSERT ON v3_edit_log BEGIN SELECT RAISE(ABORT,'fail'); END").run();
  await assert.rejects(saveDogEdit(db, dogId, { revision: before.revision, field: 'sex', value: 'female' }, { actor }));
  assert.equal((await readDogEdit(db, dogId)).sex, 'male');
  await db.prepare('DROP TRIGGER fail_log').run();
  await db.prepare('UPDATE v3_dogs SET name=? WHERE dog_id=?').bind('GAS改名', dogId).run();
  await assert.rejects(
    saveDogEdit(db, dogId, { revision: before.revision, field: 'sex', value: 'female' }, { actor }),
    (e) => e.status === 409
  );
});
test('管理者／管理者、志工／管理者同版本只接受一筆；公開紀錄不含登入資訊', async (t) => {
  const db = await setup(t),
    before = await readDogEdit(db, dogId);
  const results = await Promise.allSettled([
    saveDogEdit(db, dogId, { revision: before.revision, field: 'intro', value: '甲' }, { actor }),
    saveDogEdit(
      db,
      dogId,
      { revision: before.revision, field: 'rest', value: null },
      { actor: { subject: 'second', email: 'second@example.org' } }
    )
  ]);
  // A no-op is permitted to return the version it read, but cannot overwrite a change.
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM v3_edit_log').first('n'), 1);
  const snapshot = await readDogEdit(db, dogId);
  const race = await Promise.allSettled([
    saveDogEdit(
      db,
      dogId,
      { revision: snapshot.revision, field: 'intro', value: '志工' },
      { editor: { name: '自行選名', code: 'self' } }
    ),
    saveDogEdit(db, dogId, { revision: snapshot.revision, field: 'intro', value: '管理者' }, { actor })
  ]);
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(race.find((r) => r.status === 'rejected').reason.status, 409);
  assert.ok(!JSON.stringify(await readEdits(db)).includes(actor.email));
});
test('欄位白名單及驗證；無編號性別；介紹不動事件；不能搶編號或刪目前編號', async (t) => {
  const db = await setup(t);
  await db.prepare('INSERT INTO v3_intake_events VALUES(?,0,?,?,?)').bind(dogId, '', '2020-01-01', '歷史').run();
  for (const [field, value, status] of [
    ['name', '改名', 400],
    ['sex', '猜測', 400],
    ['fixedCare', 1, 400],
    ['intro', 'a'.repeat(1001), 413],
    ['rest', { until: '2026-02-30', reason: '' }, 400],
    ['stays', [{ in: '2020-01-01', out: '', reason: '', sql: 'x' }], 400]
  ]) {
    const before = await readDogEdit(db, dogId);
    await assert.rejects(
      saveDogEdit(db, dogId, { revision: before.revision, field, value }, { actor }),
      (e) => e.status === status
    );
  }
  let before = await readDogEdit(db, dogId);
  await assert.rejects(
    saveDogEdit(db, dogId, { revision: before.revision, field: 'sex', value: '' }, { editor: { name: '自選' } }),
    (e) => e.status === 403
  );
  await saveDogEdit(db, dogId, { revision: before.revision, field: 'sex', value: '' }, { actor });
  before = await readDogEdit(db, dogId);
  assert.equal(before.sex, '');
  await saveDogEdit(db, dogId, { revision: before.revision, field: 'intro', value: '新介紹' }, { actor });
  assert.equal((await readDogEdit(db, dogId)).intakeEvents[0].event, '歷史');
  await db.prepare('INSERT INTO v3_dog_numbers VALUES(?,?)').bind('2020010101', dogId).run();
  await db
    .prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,synced_at) VALUES(0,?,?,?,'')")
    .bind(dogId, '2020010101', '測試狗')
    .run();
  before = await readDogEdit(db, dogId);
  await assert.rejects(
    saveDogEdit(db, dogId, { revision: before.revision, field: 'numbers', value: [] }, { actor }),
    (e) => e.status === 409
  );
  await db.prepare("INSERT INTO v3_dogs(dog_id,name) VALUES('other','別隻')").run();
  await db.prepare("INSERT INTO v3_dog_numbers VALUES('2019010101','other')").run();
  await assert.rejects(
    saveDogEdit(
      db,
      dogId,
      { revision: before.revision, field: 'numbers', value: ['2019010101', '2020010101'] },
      { actor }
    ),
    (e) => e.status === 409
  );
});
test('性別舊複本、換號與再入所不覆寫正本；在所／離所快取同源、歷史快照保留', async (t) => {
  const db = await setup(t);
  await db.prepare('INSERT INTO v3_dog_numbers VALUES(?,?)').bind('2020010101', dogId).run();
  await db
    .prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,sex,synced_at) VALUES(0,?,?,?,?,'')")
    .bind(dogId, '2020010101', '測試狗', 'female')
    .run();
  await db
    .prepare('INSERT INTO v3_departures(number,dog_id,name,departed_date,last_number,last_sex) VALUES(?,?,?,?,?,?)')
    .bind('2019010101', dogId, '測試狗', '2020-01-01', '2019010101', 'female')
    .run();
  await readSmall(db, 'dogs');
  await readDepartureYear(db, '2020');
  let before = await readDogEdit(db, dogId);
  assert.equal(before.sexCopies[0].sex, 'female');
  assert.equal(before.sex, 'male');
  await saveDogEdit(db, dogId, { revision: before.revision, field: 'sex', value: '' }, { actor });
  assert.equal((await readDogsPayload(db)).dogs[0].sex, '');
  const departure = (await readDepartures(db))[0];
  assert.equal(departure.sex, '');
  assert.equal(departure.last.sex, 'female');
  assert.equal(await db.prepare('SELECT last_sex FROM v3_departures').first('last_sex'), 'female');
  before = await readDogEdit(db, dogId);
  await db.prepare("UPDATE v3_sheet_main SET number='2021010101',sex='female' WHERE dog_id=?").bind(dogId).run();
  await assert.rejects(
    saveDogEdit(db, dogId, { revision: before.revision, field: 'sex', value: 'female' }, { actor }),
    (e) => e.status === 409
  );
  assert.equal((await readDogEdit(db, dogId)).sex, '');
  await db.prepare('DELETE FROM v3_sheet_main WHERE dog_id=?').bind(dogId).run();
  await db
    .prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,sex,synced_at) VALUES(0,?,?,?,?,'')")
    .bind(dogId, '2021010101', '測試狗', 'female')
    .run();
  assert.equal((await readDogsPayload(db)).dogs[0].sex, '');
});
test('照片原圖／縮圖中途失敗、audit失敗、重送、連續替換與復原均保留正確舊圖', async (t) => {
  const db = await setup(t);
  let failing = '';
  const PHOTOS = fakeR2({ failPut: (key) => failing && key.includes(failing) });
  const env = { DB: db, PHOTOS };
  const jpeg = (n) => new Uint8Array([255, 216, 255, n]);
  let before = await readDogEdit(db, dogId);
  const first = await saveDogPhoto(
    env,
    dogId,
    before.revision,
    { original: jpeg(1), thumb: jpeg(2) },
    { actor },
    'https://example.org'
  );
  failing = 'thumbs';
  await assert.rejects(
    saveDogPhoto(env, dogId, first.revision, { original: jpeg(3), thumb: jpeg(4) }, { actor }, 'https://example.org')
  );
  assert.deepEqual((await readDogEdit(db, dogId)).photo, first.photo);
  failing = '';
  await db
    .prepare("CREATE TRIGGER fail_photo_log BEFORE INSERT ON v3_edit_log BEGIN SELECT RAISE(ABORT,'log'); END")
    .run();
  await assert.rejects(
    saveDogPhoto(env, dogId, first.revision, { original: jpeg(3), thumb: jpeg(4) }, { actor }, 'https://example.org')
  );
  assert.deepEqual((await readDogEdit(db, dogId)).photo, first.photo);
  await db.prepare('DROP TRIGGER fail_photo_log').run();
  const second = await saveDogPhoto(
    env,
    dogId,
    first.revision,
    { original: jpeg(3), thumb: jpeg(4) },
    { actor },
    'https://example.org'
  );
  assert.notEqual(second.photo.key, first.photo.key);
  assert.ok(PHOTOS.objects.has(first.photo.key));
  await assert.rejects(
    saveDogPhoto(env, dogId, first.revision, { original: jpeg(5), thumb: null }, { actor }, 'https://example.org'),
    (e) => e.status === 409
  );
  const total = await db.prepare('SELECT total_changes() AS n').first('n');
  await saveDogPhoto(
    env,
    dogId,
    second.revision,
    { original: jpeg(3), thumb: jpeg(4) },
    { actor },
    'https://example.org'
  );
  assert.equal(await db.prepare('SELECT total_changes() AS n').first('n'), total);
  const restored = await restoreDogPhoto(env, dogId, second.revision, second.trash, { actor }, 'https://example.org');
  assert.deepEqual(PHOTOS.objects.get(restored.photo.key).bytes, jpeg(1));
  assert.deepEqual(PHOTOS.objects.get(restored.photo.thumb).bytes, jpeg(2));
  assert.ok(PHOTOS.objects.has(second.photo.key));
});
test('GAS 準備完才遇到人工修改：同交易拒絕舊身分快照，保留待送，重試成功', async (t) => {
  const DB = await setup(t);
  await DB.prepare('INSERT INTO v3_dog_numbers VALUES(?,?)').bind('2020010101', dogId).run();
  await DB.prepare(
    "INSERT INTO v3_sheet_main(row_index,dog_id,number,name,cage,note,synced_at) VALUES(0,?,?,?,'A1','','')"
  )
    .bind(dogId, '2020010101', '測試狗')
    .run();
  let raced = false;
  const wrapper = {
    ...DB,
    async batch(statements) {
      if (!raced) {
        raced = true;
        const snapshot = await readDogEdit(DB, dogId);
        await saveDogEdit(
          DB,
          dogId,
          { revision: snapshot.revision, field: 'intro', value: '競爭中存的介紹' },
          { actor }
        );
      }
      return DB.batch(statements);
    }
  };
  const row = {
    sheet: 'main',
    hash: 'new',
    dog: { id: '2020010101', name: '測試狗' },
    cage: 'B1',
    note: 'GAS',
    walker: ''
  };
  const result = await applyDogListRows(wrapper, [row], {});
  assert.equal(result[0].ack, false);
  assert.equal(result[0].ok, false);
  assert.equal(await DB.prepare('SELECT cage FROM v3_sheet_main').first('cage'), 'A1');
  assert.equal((await readDogEdit(DB, dogId)).intro, '競爭中存的介紹');
  assert.equal((await applyDogListRows(DB, [row], {}))[0].ok, true);
  assert.equal(await DB.prepare('SELECT cage FROM v3_sheet_main').first('cage'), 'B1');
});
