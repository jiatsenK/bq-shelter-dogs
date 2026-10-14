import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateBusinessDatabase } from './migrate-business-db.mjs';
import worker from '../worker/src/index.js';

async function model(t) {
  const db = fakeD1(); t.after(() => db.close());
  await migrateBusinessDatabase(db);
  const { dog_id } = await db.prepare("INSERT INTO v2_dogs(name) VALUES('測試狗') RETURNING dog_id").first();
  await db.prepare("INSERT INTO v2_admissions(admission_id,dog_id,status) VALUES('a',?,'in')").bind(dog_id).run();
  return { db, dog_id };
}

test('遷移入口建立新模型，可重跑且保留既有 dogs 資料', async t => {
  const db = fakeD1();
  t.after(() => db.close());
  await db.prepare('CREATE TABLE dogs (key TEXT PRIMARY KEY, name TEXT)').run();
  await db.prepare("INSERT INTO dogs VALUES ('old-number', '舊狗')").run();
  await migrateBusinessDatabase(db);
  await migrateBusinessDatabase(db);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v2_dogs').first('COUNT(*)'), 0);
  assert.equal((await db.prepare('SELECT name FROM dogs').first()).name, '舊狗');
  const dog = await db.prepare("INSERT INTO v2_dogs (name) VALUES ('測試狗') RETURNING dog_id").first();
  assert.match(dog.dog_id, /^[a-f0-9]{32}$/);
});

test('日期拒絕不可能的日期，別名要確認，batch 失敗整批回復', async t => {
  const { db, dog_id } = await model(t);
  await assert.rejects(db.prepare("UPDATE v2_admissions SET intake_date='2026-02-30' WHERE admission_id='a'").run(), /CHECK/);
  await assert.rejects(db.prepare("UPDATE v2_admissions SET intake_date='2026-13-01' WHERE admission_id='a'").run(), /CHECK/);
  await db.prepare("UPDATE v2_admissions SET intake_date='2024-02-29' WHERE admission_id='a'").run();
  await db.prepare("INSERT INTO v2_walkers VALUES('walker','2026-10-14T00:00:00Z')").run();
  await assert.rejects(db.prepare("INSERT INTO v2_walker_codes VALUES('123456789012','walker','alias',NULL)").run(), /CHECK/);
  await db.prepare("INSERT INTO v2_walker_codes VALUES('123456789012','walker','alias','2026-10-14T00:00:00Z')").run();
  await assert.rejects(db.batch([
    db.prepare("UPDATE v2_dogs SET intro='不能留下' WHERE dog_id=?").bind(dog_id),
    db.prepare("INSERT INTO v2_rest_settings(admission_id,until_date) VALUES('missing','2026-10-20')"),
  ]), /FOREIGN KEY/);
  assert.equal(await db.prepare('SELECT intro FROM v2_dogs WHERE dog_id=?').bind(dog_id).first('intro'), '');
});

test('預覽 Worker fetch 使用共用 D1，已有新表仍禁止寫入', async t => {
  const { db } = await model(t);
  worker.testing.resetState();
  const res = await worker.fetch(new Request('https://preview.example/api/walk', {
    method: 'POST', headers: { Origin: 'https://preview.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ dogs: [] }),
  }), { DB: db, PREVIEW: '1' });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /預覽/);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v2_operations').first('COUNT(*)'), 0);
});

test('共用 D1 的 batch SELECT 讓 Worker 讀回既有開卡，RETURNING 也保留結果', async t => {
  const { db } = await model(t);
  worker.testing.resetState();
  await db.prepare('CREATE TABLE card_opened(walker_code TEXT, dog_id TEXT, opened_on TEXT)').run();
  await db.prepare("INSERT INTO card_opened VALUES('abcdef123456','2026010101','2026-10-14')").run();
  const res = await worker.fetch(new Request('https://preview.example/api/cards/opened?codes=abcdef123456', {
    headers: { Origin: 'https://preview.example' },
  }), { DB: db, PREVIEW: '1' });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).opened.codes.abcdef123456, { '2026010101': '2026-10-14' });
  const [inserted] = await db.batch([db.prepare("INSERT INTO v2_walkers VALUES('returned','now') RETURNING walker_id")]);
  assert.deepEqual(inserted.results, [{ walker_id: 'returned' }]);
});

test('所有新外鍵都是 RESTRICT，資料庫檢核沒有孤兒', async t => {
  const { db } = await model(t);
  const { results: tables } = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'v2_%'").all();
  assert.equal(tables.length, 18);
  for (const { name } of tables) {
    const { results: keys } = await db.prepare(`PRAGMA foreign_key_list(${name})`).all();
    for (const key of keys) assert.equal(key.on_delete, 'RESTRICT', name);
  }
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
});

test('異動必須對應同狗入所，來源只能是同步或操作其中一個，刪除不連帶消失', async t => {
  const { db, dog_id } = await model(t);
  const other = await db.prepare("INSERT INTO v2_dogs(name) VALUES('另一隻') RETURNING dog_id").first();
  await db.prepare("INSERT INTO v2_admissions(admission_id,dog_id,status) VALUES('b',?,'unknown')").bind(other.dog_id).run();
  await db.prepare("INSERT INTO v2_sync_runs(run_id,observed_day,started_at,status) VALUES('s','2026-10-14','2026-10-14T00:00:00Z','ok')").run();
  const change = admission => db.prepare("INSERT INTO v2_changes(sync_run_id,dog_id,admission_id,field,observed_at) VALUES('s',?,?,'cage','2026-10-14T00:00:00Z')").bind(dog_id, admission).run();
  await assert.rejects(change('b'), /FOREIGN KEY/);
  await change('a');
  await assert.rejects(db.prepare('DELETE FROM v2_admissions WHERE admission_id=?').bind('a').run(), /FOREIGN KEY/);
  await assert.rejects(db.prepare('DELETE FROM v2_dogs WHERE dog_id=?').bind(dog_id).run(), /FOREIGN KEY/);
  await assert.rejects(db.prepare("INSERT INTO v2_changes(dog_id,field,observed_at) VALUES(?,'cage','now')").bind(dog_id).run(), /CHECK/);
});

test('溜狗按入所與日期唯一，換照片只能留一張有效主照片', async t => {
  const { db, dog_id } = await model(t);
  await db.prepare("INSERT INTO v2_daily_walks(walk_id,admission_id,walk_date,state,participant_quality,evidence) VALUES('w','a','2026-10-14','provisional','unknown','sync')").run();
  await assert.rejects(db.prepare("INSERT INTO v2_daily_walks(walk_id,admission_id,walk_date,state,participant_quality,evidence) VALUES('w2','a','2026-10-14','final','known','snapshot')").run(), /UNIQUE/);
  await db.prepare("INSERT INTO v2_dog_photos(photo_id,dog_id,object_key,state,is_primary) VALUES('p',?,'photos/old.jpg','active',1)").bind(dog_id).run();
  const replacement = () => db.prepare("INSERT INTO v2_dog_photos(photo_id,dog_id,object_key,state,is_primary) VALUES('p2',?,'photos/new.jpg','active',1)").bind(dog_id).run();
  await assert.rejects(replacement(), /UNIQUE/);
  await db.prepare("UPDATE v2_dog_photos SET state='replaced' WHERE photo_id='p'").run();
  await replacement();
});

test('同狗只能一筆在所，同次入所只能一個現行編號', async t => {
  const db = fakeD1(); t.after(() => db.close());
  await migrateBusinessDatabase(db);
  const { dog_id } = await db.prepare("INSERT INTO v2_dogs(name) VALUES('測試狗') RETURNING dog_id").first();
  await db.prepare("INSERT INTO v2_admissions(admission_id,dog_id,status) VALUES('a',?,'in')").bind(dog_id).run();
  await assert.rejects(db.prepare("INSERT INTO v2_admissions(admission_id,dog_id,status) VALUES('b',?,'in')").bind(dog_id).run(), /UNIQUE/);
  await db.prepare("INSERT INTO v2_admissions(admission_id,dog_id,status) VALUES('b',?,'unknown')").bind(dog_id).run();
  await db.prepare("INSERT INTO v2_admission_numbers VALUES('2026010101','a','current')").run();
  await assert.rejects(db.prepare("INSERT INTO v2_admission_numbers VALUES('2026020201','a','current')").run(), /UNIQUE/);
  await db.prepare("INSERT INTO v2_admission_numbers VALUES('2026020201','a','corrected')").run();
  await assert.rejects(db.prepare("INSERT INTO v2_admission_numbers VALUES('2026010101','b','legacy')").run(), /UNIQUE/);
});
