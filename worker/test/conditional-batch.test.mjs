// #745 有條件 batch：條件是 1 才整批寫；0、NULL、資料列不見都擋下、整批回復
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './fakes.mjs';
import { createCompactDatabase } from '../../scripts/compact-schema.mjs';
import { batchIf, isConflict } from '../src/conditional-batch.js';

async function makeDb(t) {
  const db = fakeD1();
  t.after(() => db.close());
  await createCompactDatabase(db);
  await db.prepare('CREATE TABLE t (id INTEGER PRIMARY KEY, revision INTEGER)').run();
  await db.prepare('INSERT INTO t VALUES (1, 5), (2, NULL)').run();
  return db;
}
const revisionIs = (id, revision) => ({ sql: '(SELECT revision FROM t WHERE id=?)=?', args: [id, revision] });
const write = db => db.prepare('UPDATE t SET revision=99 WHERE id=1');
const revision = db => db.prepare('SELECT revision FROM t WHERE id=1').first('revision');
const guardRows = db => db.prepare('SELECT COUNT(*) AS n FROM v3_batch_guard').first('n');

test('條件成立：整批寫，回傳只有呼叫端那幾句的結果，guard 表不留列', async t => {
  const db = await makeDb(t);
  const results = await batchIf(db, [revisionIs(1, 5), { sql: '1' }], [write(db), db.prepare('SELECT revision FROM t WHERE id=1')]);
  assert.equal(results.length, 2);
  assert.equal(results[0].meta.changes, 1);
  assert.deepEqual(results[1].results, [{ revision: 99 }]);
  assert.equal(await guardRows(db), 0);
});

test('不成立、NULL、資料列不見都擋下，整批回復', async t => {
  const db = await makeDb(t);
  for (const [name, condition] of [['版本不對', revisionIs(1, 4)], ['值是 NULL', revisionIs(2, 5)], ['資料列不見', revisionIs(3, 5)]]) {
    await assert.rejects(batchIf(db, [revisionIs(1, 5), condition], [write(db)]), e => isConflict(e), name);
    assert.equal(await revision(db), 5, name);
  }
  assert.equal(await guardRows(db), 0);
});

test('沒有條件時照常寫；外鍵擋下算衝突，NOT NULL 等程式錯誤不算；UNIQUE 要呼叫端指定才算', async t => {
  const db = await makeDb(t);
  assert.equal((await batchIf(db, [], [write(db)]))[0].meta.changes, 1);
  await assert.rejects(batchIf(db, [], [db.prepare("INSERT INTO v3_activity_dogs(activity_id,position,name) VALUES('missing',0,'狗')")]), e => isConflict(e));
  await assert.rejects(batchIf(db, [], [db.prepare("INSERT INTO v3_activities(activity_id,activity_date,kind) VALUES('a',NULL,'kids')")]), e => !isConflict(e) && !isConflict(e, { unique: true }), 'NOT NULL');
  await assert.rejects(batchIf(db, [], [db.prepare('SELECT * FROM no_such_table')]), e => !isConflict(e));
  const duplicate = () => batchIf(db, [], [db.prepare('INSERT INTO t VALUES (1, 0)')]);
  await assert.rejects(duplicate(), e => !isConflict(e), 'UNIQUE 預設不算');
  await assert.rejects(duplicate(), e => isConflict(e, { unique: true }), 'UNIQUE 指定後算');
});
