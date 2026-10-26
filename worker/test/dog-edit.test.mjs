import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './fakes.mjs';
import { createCompactDatabase, splitStatements } from '../../scripts/compact-schema.mjs';
import { readDogEdit, saveDogEdit } from '../src/dog-edit.js';
import { fakeR2 } from './fakes.mjs';
import { saveDogPhoto, restoreDogPhoto } from '../src/dog-photo.js';
import { readDogsPayload, readDepartures } from '../src/compact.js';
import { applyDogListRows } from '../src/dog-list.js';
import { readSmall, readDepartureYear } from '../src/packs.js';
import { readEdits } from '../src/editlog.js';
import { readFile } from 'node:fs/promises';
import { editsValue } from '../../public/js/edits.js';
import { servePhoto } from '../src/r2.js';
const dogId = 'a'.repeat(32);
const actor = { subject: 'verified', email: 'private@example.org' };
async function setup(t) {
  const db = fakeD1();
  t.after(() => db.close());
  await createCompactDatabase(db);
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
      { revision: before.revision, field: 'intro', value: '乙' },
      { actor: { subject: 'second', email: 'second@example.org' } }
    )
  ]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.find(result=>result.status==='rejected').reason.status,409);
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
    .prepare('INSERT INTO v3_sheet_main(row_index,dog_id,number,name) VALUES(0,?,?,?)')
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
    .prepare('INSERT INTO v3_sheet_main(row_index,dog_id,number,name) VALUES(0,?,?,?)')
    .bind(dogId, '2020010101', '測試狗')
    .run();
  await db
    .prepare('INSERT INTO v3_dog_departures(number,dog_id,name,departed_date,last_number,last_sex) VALUES(?,?,?,?,?,?)')
    .bind('2019010101', dogId, '測試狗', '2020-01-01', '2019010101', 'female')
    .run();
  await readSmall(db, 'dogs');
  await readDepartureYear(db, '2020');
  let before = await readDogEdit(db, dogId);
  assert.deepEqual(before.sexCopies, []);
  assert.equal(before.sex, 'male');
  await saveDogEdit(db, dogId, { revision: before.revision, field: 'sex', value: '' }, { actor });
  assert.equal((await readDogsPayload(db)).dogs[0].sex, '');
  const departure = (await readDepartures(db))[0];
  assert.equal(departure.sex, '');
  assert.equal(departure.last.sex, 'female');
  assert.equal(await db.prepare('SELECT last_sex FROM v3_dog_departures').first('last_sex'), 'female');
  before = await readDogEdit(db, dogId);
  await db.prepare("UPDATE v3_sheet_main SET number='2021010101' WHERE dog_id=?").bind(dogId).run();
  await assert.rejects(
    saveDogEdit(db, dogId, { revision: before.revision, field: 'sex', value: 'female' }, { actor }),
    (e) => e.status === 409
  );
  assert.equal((await readDogEdit(db, dogId)).sex, '');
  await db.prepare('DELETE FROM v3_sheet_main WHERE dog_id=?').bind(dogId).run();
  await db
    .prepare('INSERT INTO v3_sheet_main(row_index,dog_id,number,name) VALUES(0,?,?,?)')
    .bind(dogId, '2021010101', '測試狗')
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
  await DB.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,cage,note) VALUES(0,?,?,?,'A1','')")
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

test('0009 承接已刪除的性別副本，不造舊值或以空白覆蓋有效值', async (t) => {
  const db = fakeD1();
  t.after(() => db.close());
  for (const name of [
    '0000_compact_schema.sql',
    '0001_sheet_main_dog_id_index.sql',
    '0002_trigger_plan_a.sql',
    '0003_feature_settings.sql'
  ]) {
    const sql = await readFile(new URL('../../migrations/' + name, import.meta.url), 'utf8');
    for (const statement of splitStatements(sql)) await db.prepare(statement).run();
  }
  await db.prepare("INSERT INTO v3_dogs(dog_id,name,sex) VALUES('a','甲','male')").run();
  await db.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,name,sex,synced_at) VALUES(0,'a','甲','','')").run();
  assert.equal(
    await db
      .prepare('SELECT COUNT(*) AS n FROM v3_sheet_main m JOIN v3_dogs d USING(dog_id) WHERE m.sex<>d.sex')
      .first('n'),
    1
  );
  for (const name of [
    '0004_drop_unused_tables.sql',
    '0005_walkers_groups_json.sql',
    '0006_dog_departures.sql',
    '0007_drop_walkers_groups_tables.sql',
    '0008_drop_old_departures.sql',
    '0009_dog_edit.sql'
  ]) {
    const sql = await readFile(new URL('../../migrations/' + name, import.meta.url), 'utf8');
    await db.batch(splitStatements(sql).map((statement) => db.prepare(statement)));
  }
  const snapshot = await readDogEdit(db, 'a');
  assert.equal(snapshot.sex, 'male');
  assert.deepEqual(snapshot.sexCopies, []);
  assert.ok(!(await db.prepare('PRAGMA table_info(v3_sheet_main)').all()).results.some((row) => row.name === 'sex'));
});

test('連續照片替換後舊版本 URL 仍取同一對原圖／縮圖，資料包給新版本', async (t) => {
  const DB = await setup(t),
    PHOTOS = fakeR2(),
    env = { DB, PHOTOS, ASSETS: { fetch: async () => new Response('Not found', { status: 404 }) } };
  await DB.prepare('INSERT INTO v3_dog_numbers VALUES(?,?)').bind('2020010101', dogId).run();
  await DB.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,cage) VALUES(0,?,?,'測試狗','A1')")
    .bind(dogId, '2020010101')
    .run();
  const jpeg = (n) => new Uint8Array([255, 216, 255, n]);
  const before = await readDogEdit(DB, dogId);
  const first = await saveDogPhoto(
    env,
    dogId,
    before.revision,
    { original: jpeg(1), thumb: jpeg(2) },
    { actor },
    'https://example.org'
  );
  const second = await saveDogPhoto(
    env,
    dogId,
    first.revision,
    { original: jpeg(3), thumb: jpeg(4) },
    { actor },
    'https://example.org'
  );
  const worker = (await import('../src/index.js')).default;
  worker.testing.resetState();
  for (const [key, bytes] of [
    ['photos/2020010101.jpg', jpeg(1)],
    ['photos/thumbs/2020010101.jpg', jpeg(2)]
  ]) {
    const response = await worker.fetch(
      new Request('https://example.org/' + key + '?v=' + first.photo.key.slice(7, -4)),
      env
    );
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  }
  const response = await worker.fetch(
    new Request('https://example.org/api/dogs', { headers: { Origin: 'https://example.org' } }),
    env
  );
  const data = await response.json();
  assert.equal(data.photoVersions['photos/2020010101.jpg'], second.photo.key.slice(7, -4));
  assert.equal(data.dogs[0].photoVersion, second.photo.key.slice(7, -4));
});

test('照片與性別公開前後紀錄顯示新版及舊版格式', () => {
  assert.equal(editsValue('photo', { key: 'photos/one.jpg', thumb: null }), '新照片');
  assert.equal(editsValue('photo', { path: 'photos/old.jpg' }), '新照片');
  assert.match(editsValue('photo', { key: 'photos/one.jpg', trash: 'backup' }), /backup/);
  assert.equal(editsValue('sex', ''), '待確認');
  assert.equal(editsValue('sex', 'female'), '母');
});

test('新增照片 GET／替換、編號增刪、事件更新：無關資料十倍仍固定讀寫量及索引計畫', async (t) => {
  const DB = await setup(t),
    PHOTOS = fakeR2(),
    env = { DB, PHOTOS };
  await DB.prepare('INSERT INTO v3_dog_numbers VALUES(?,?)').bind('2020010101', dogId).run();
  await DB.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,cage) VALUES(0,?,?,'測試狗','A1')")
    .bind(dogId, '2020010101')
    .run();
  const jpeg = (n) => new Uint8Array([255, 216, 255, n]);
  let before = await readDogEdit(DB, dogId);
  before = await saveDogEdit(
    DB,
    dogId,
    { revision: before.revision, field: 'intro', value: '原介紹' },
    { editor: { name: '自選' }, events: [{ number: '2020010101', date: '2020-01-01', event: '原事件' }] }
  );
  await saveDogPhoto(
    env,
    dogId,
    before.revision,
    { original: jpeg(1), thumb: jpeg(2) },
    { actor },
    'https://example.org'
  );
  async function measure(action) {
    const total = await DB.prepare('SELECT total_changes() AS n').first('n'),
      reads = DB.stats.rowsRead,
      sql = [];
    const spy = {
      ...DB,
      prepare(query) {
        sql.push(query);
        return DB.prepare(query);
      }
    };
    await action(spy);
    const result = {
      reads: DB.stats.rowsRead - reads,
      writes: (await DB.prepare('SELECT total_changes() AS n').first('n')) - total,
      statements: sql.length
    };
    for (const query of sql.filter((q) => /^SELECT/.test(q))) {
      const plan = (
        await DB.prepare('EXPLAIN QUERY PLAN ' + query.replace(/\?/g, "'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'")).all()
      ).results;
      assert.ok(
        plan.every((row) => !/SCAN (?!\(subquery)/.test(row.detail)),
        query
      );
    }
    return result;
  }
  const seed = async (start, end) => {
    for (let n = start; n < end; n++) {
      const id = n.toString(16).padStart(32, '0');
      await DB.prepare('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)')
        .bind(id, '無關' + n)
        .run();
      await DB.prepare('INSERT INTO v3_dog_numbers VALUES(?,?)')
        .bind('200001' + String(n).padStart(4, '0'), id)
        .run();
      await DB.prepare('INSERT INTO v3_photos(object_key,dog_id,is_primary) VALUES(?,?,1)')
        .bind('photos/' + id + '.jpg', id)
        .run();
    }
  };
  async function measures(value) {
    const result = {};
    for (const [key, field, next] of [
      ['add', 'numbers', ['2019010101', '2020010101']],
      ['remove', 'numbers', ['2020010101']]
    ]) {
      const snapshot = await readDogEdit(DB, dogId);
      result[key] = await measure((db) =>
        saveDogEdit(db, dogId, { revision: snapshot.revision, field, value: next }, { actor })
      );
    }
    let snapshot = await readDogEdit(DB, dogId);
    result.events = await measure((db) =>
      saveDogEdit(
        db,
        dogId,
        { revision: snapshot.revision, field: 'intro', value: '介紹' + value },
        { editor: { name: '自選' }, events: [{ number: '2020010101', date: '2020-01-01', event: '事件' + value }] }
      )
    );
    snapshot = await readDogEdit(DB, dogId);
    result.photo = await measure((db) =>
      saveDogPhoto(
        { ...env, DB: db },
        dogId,
        snapshot.revision,
        { original: jpeg(value), thumb: jpeg(value + 1) },
        { actor },
        'https://example.org'
      )
    );
    snapshot = await readDogEdit(DB, dogId);
    result.photoGet = await measure(async (db) => {
      const response = await servePhoto(
        new Request('https://example.org/photos/2020010101.jpg?v=' + snapshot.photo.key.slice(7, -4)),
        { ...env, DB: db }
      );
      assert.equal(response.status, 200);
    });
    result.noop = await measure((db) =>
      saveDogPhoto(
        { ...env, DB: db },
        dogId,
        snapshot.revision,
        { original: jpeg(value), thumb: jpeg(value + 1) },
        { actor },
        'https://example.org'
      )
    );
    assert.equal(result.noop.writes, 0);
    return result;
  }
  await seed(1, 11);
  const small = await measures(10);
  await seed(11, 101);
  assert.deepEqual(await measures(20), small);
});

test('離所 CAS 失敗不污染同批狗群或主清單 fingerprint', async (t) => {
  const DB = await setup(t);
  await DB.prepare("INSERT INTO v3_dogs(dog_id,name) VALUES('buddy','夥伴')").run();
  await DB.prepare('INSERT INTO v3_dog_numbers VALUES(?,?)').bind('2020010101', dogId).run();
  await DB.prepare(
    "INSERT INTO v3_sheet_main(row_index,dog_id,number,name,cage) VALUES(0,?,?,'測試狗','A1'),(1,'buddy','2020010102','夥伴','A2')"
  )
    .bind(dogId, '2020010101')
    .run();
  await DB.prepare("INSERT INTO v3_sheet_group_columns VALUES(0,'',?)")
    .bind(JSON.stringify(['測試狗', '夥伴']))
    .run();
  await DB.prepare("INSERT INTO v3_sync_state(key,value) VALUES('dog_list_fp',?)")
    .bind(JSON.stringify({ 'main:2020010101': 'old' }))
    .run();
  let raced = false;
  const spy = {
    ...DB,
    async batch(statements) {
      if (!raced) {
        raced = true;
        const snapshot = await readDogEdit(DB, dogId);
        await saveDogEdit(DB, dogId, { revision: snapshot.revision, field: 'intro', value: '競爭修改' }, { actor });
      }
      return DB.batch(statements);
    }
  };
  const result = await applyDogListRows(
    spy,
    [
      { sheet: 'departed', hash: 'departure', dog: { id: '2020010101', name: '測試狗' }, texts: ['被認養'], dates: [] },
      { sheet: 'groups', hash: 'group', column: 0, names: ['測試狗', '夥伴'], label: '' }
    ],
    {}
  );
  assert.equal(result[0].ack, false);
  assert.equal(result[1].ack, true);
  assert.deepEqual(
    JSON.parse(await DB.prepare('SELECT names FROM v3_sheet_group_columns WHERE column_index=0').first('names')),
    ['測試狗', '夥伴']
  );
  assert.equal(
    JSON.parse(await DB.prepare("SELECT value FROM v3_sync_state WHERE key='dog_list_fp'").first('value'))[
      'main:2020010101'
    ],
    'old'
  );
  assert.equal(await DB.prepare('SELECT COUNT(*) AS n FROM v3_dog_departures').first('n'), 0);
});

test('既有固定路徑同圖重送無差異 0 寫，也回報有效照片', async (t) => {
  const DB = await setup(t),
    PHOTOS = fakeR2();
  await DB.prepare('INSERT INTO v3_dog_numbers VALUES(?,?)').bind('2020010101', dogId).run();
  const original = new Uint8Array([255, 216, 255, 1]),
    thumb = new Uint8Array([255, 216, 255, 2]);
  await PHOTOS.put('photos/2020010101.jpg', original);
  await PHOTOS.put('photos/thumbs/2020010101.jpg', thumb);
  const snapshot = await readDogEdit(DB, dogId),
    before = await DB.prepare('SELECT total_changes() AS n').first('n');
  const result = await saveDogPhoto(
    { DB, PHOTOS },
    dogId,
    snapshot.revision,
    { original, thumb },
    { actor },
    'https://example.org'
  );
  assert.equal(result.photo.key, 'photos/2020010101.jpg');
  assert.equal(await DB.prepare('SELECT total_changes() AS n').first('n'), before);
  assert.equal(PHOTOS.objects.size, 2);
});

test('已有離所年份快取的回所狗：GAS 改籠位後新草稿取得最新revision並可儲存', async (t) => {
  const DB = await setup(t);
  await DB.prepare('INSERT INTO v3_dog_numbers VALUES(?,?),(?,?)').bind('2020010101', dogId, '2021010101', dogId).run();
  await DB.prepare(
    "INSERT INTO v3_sheet_main(row_index,dog_id,number,name,cage) VALUES(0,?,'2021010101','測試狗','A1')"
  )
    .bind(dogId)
    .run();
  await DB.prepare(
    "INSERT INTO v3_dog_departures(dog_id,number,name,departed_date) VALUES(?,'2020010101','測試狗','2020-01-01')"
  )
    .bind(dogId)
    .run();
  const before = await readDepartureYear(DB, '2020');
  const result = await applyDogListRows(
    DB,
    [{ sheet: 'main', hash: 'cage', dog: { id: '2021010101', name: '測試狗' }, cage: 'B1', note: '', walker: '' }],
    {}
  );
  assert.equal(result[0].ok, true);
  const after = await readDepartureYear(DB, '2020'),
    snapshot = await readDogEdit(DB, dogId);
  assert.notEqual(after.ver, before.ver);
  assert.equal(after.departures[0].editRevision, snapshot.revision);
  const worker = (await import('../src/index.js')).default;
  const response = await worker.fetch(
    new Request('https://example.org/api/intro/2020010101', {
      method: 'PUT',
      headers: { Origin: 'https://example.org', 'Content-Type': 'application/json' },
      body: JSON.stringify({ editor: '自選', revision: after.departures[0].editRevision, text: '新的草稿' })
    }),
    { DB }
  );
  assert.equal(response.status, 200);
  assert.equal((await readDogEdit(DB, dogId)).intro, '新的草稿');
});

test('移除離所舊編號映射後，不可覆寫版本仍解析正確原圖／縮圖', async (t) => {
  const DB = await setup(t),
    PHOTOS = fakeR2(),
    env = { DB, PHOTOS };
  await DB.prepare('INSERT INTO v3_dog_numbers VALUES(?,?)').bind('2020010101', dogId).run();
  await DB.prepare(
    "INSERT INTO v3_dog_departures(dog_id,number,name,departed_date) VALUES(?,'2020010101','測試狗','2020-01-01')"
  )
    .bind(dogId)
    .run();
  const original = new Uint8Array([255, 216, 255, 1]),
    thumb = new Uint8Array([255, 216, 255, 2]);
  const snapshot = await readDogEdit(DB, dogId);
  const photo = await saveDogPhoto(
    env,
    dogId,
    snapshot.revision,
    { original, thumb },
    { actor },
    'https://example.org'
  );
  await saveDogEdit(DB, dogId, { revision: photo.revision, field: 'numbers', value: [] }, { actor });
  const entry = (await readDepartureYear(DB, '2020')).departures[0];
  assert.equal(entry.id, '2020010101');
  assert.equal(
    await DB.prepare('SELECT COUNT(*) AS n FROM v3_dog_numbers WHERE number=?').bind(entry.id).first('n'),
    0
  );
  for (const [prefix, bytes] of [
    ['photos/', original],
    ['photos/thumbs/', thumb]
  ]) {
    const response = await servePhoto(
      new Request('https://example.org/' + prefix + entry.id + '.jpg?v=' + entry.photoVersion),
      env
    );
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  }
});

// #639（ADR 0021）：出入所表＝每個編號一列＋沒編號的手填；補、刪編號在同一筆交易
test('出入所表：舊資料同一天接到編號（納卡西）、離所帶出所日；沒改不寫；補編號、手填出所日同一筆交易記一筆紀錄', async (t) => {
  const db = await setup(t);
  await db.prepare("INSERT INTO v3_dog_numbers VALUES('2026042101',?),('2025010101',?)").bind(dogId, dogId).run();
  await db.prepare("INSERT INTO v3_dog_departures(dog_id,number,name,departed_date,reason) VALUES(?,'2025010101','測試狗','2025-06-01','adopt')").bind(dogId).run();
  await db.prepare('INSERT INTO v3_stays VALUES(?,?)').bind(dogId, '[{"in":"2026-04-21","out":"2026-10-18","reason":""}]').run();
  const before = await readDogEdit(db, dogId);
  assert.deepEqual(before.stays, [
    { number: '2025010101', in: '2025-01-01', out: '2025-06-01', reason: '認養', departed: true },
    { number: '2026042101', in: '2026-04-21', out: '2026-10-18', reason: '' },
  ]);
  // 跟看到的一樣就不寫（舊格式的資料也不會因此被改寫）
  const count = await db.prepare('SELECT total_changes() AS n').first('n');
  await saveDogEdit(db, dogId, { revision: before.revision, field: 'stays', value: before.stays }, { actor });
  assert.equal(await db.prepare('SELECT total_changes() AS n').first('n'), count);
  const next = [...before.stays, { number: '2020010101', in: '', out: '2020-05-05', reason: '轉所' }];
  const after = await saveDogEdit(db, dogId, { revision: before.revision, field: 'stays', value: next }, { actor });
  assert.deepEqual(after.numbers, ['2020010101', '2025010101', '2026042101']);
  assert.deepEqual(after.stays[0], { number: '2020010101', in: '2020-01-01', out: '2020-05-05', reason: '轉所' });
  assert.deepEqual(JSON.parse(await db.prepare('SELECT stays_json FROM v3_stays WHERE dog_id=?').bind(dogId).first('stays_json')), [
    { number: '2020010101', in: '2020-01-01', out: '2020-05-05', reason: '轉所' },
    { number: '2026042101', in: '2026-04-21', out: '2026-10-18', reason: '' },
  ]);
  const logs = (await db.prepare("SELECT kind,before_json,after_json FROM v3_edit_log WHERE kind='stays'").all()).results;
  assert.equal(logs.length, 1);
  assert.deepEqual(JSON.parse(logs[0].after_json), after.stays);
  // 刪掉那一列就刪掉那個編號；別隻的編號不能搶
  const removed = await saveDogEdit(db, dogId, { revision: after.revision, field: 'stays', value: after.stays.slice(1) }, { actor });
  assert.deepEqual(removed.numbers, ['2025010101', '2026042101']);
  await db.prepare("INSERT INTO v3_dogs(dog_id,name) VALUES('other','別隻')").run();
  await db.prepare("INSERT INTO v3_dog_numbers VALUES('2019010101','other')").run();
  await assert.rejects(
    saveDogEdit(db, dogId, { revision: removed.revision, field: 'stays', value: [...removed.stays, { number: '2019010101', in: '', out: '', reason: '' }] }, { actor }),
    (e) => e.status === 409
  );
});
