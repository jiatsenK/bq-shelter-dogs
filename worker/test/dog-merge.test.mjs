import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './fakes.mjs';
import { createCompactDatabase } from '../../scripts/compact-schema.mjs';
import { previewMerge, mergeDogs, unmergeDogs } from '../src/dog-merge.js';
import { readDogEdit, saveDogEdit } from '../src/dog-edit.js';
import { readEdits } from '../src/editlog.js';

// 留下的狗 T：主清單上的米香（2026082501）。被併的 S：試算表先打名字時多出來、沒編號的米香（#621）。
const T = 'a'.repeat(32), S = 'b'.repeat(32), OTHER = 'c'.repeat(32);
const actor = { subject: 'verified', email: 'private@example.org' };
const TABLES = ['v3_dogs', 'v3_dog_numbers', 'v3_walks', 'v3_intros', 'v3_rest', 'v3_stays', 'v3_intake_events', 'v3_photos', 'v3_dog_departures',
  'v3_activity_dogs', 'v3_volunteer_favorites', 'v3_volunteer_cards', 'v3_card_opened', 'v3_walk_state', 'v3_sheet_main'];
async function setup(t) {
  const db = fakeD1();
  t.after(() => db.close());
  await createCompactDatabase(db);
  const run = (sql, ...args) => db.prepare(sql).bind(...args).run();
  await run("INSERT INTO v3_dogs(dog_id,name,sex) VALUES(?,'米香','female'),(?,'米香',''),(?,'別隻','male')", T, S, OTHER);
  await run("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,cage) VALUES(0,?,'2026082501','米香','C區13'),(1,?,'2026010101','別隻','A1')", T, OTHER);
  await run("INSERT INTO v3_dog_numbers(number,dog_id) VALUES('2026082501',?),('2026010101',?)", T, OTHER);
  await run("INSERT INTO v3_walks(dog_id,walk_date,position,walker_code,dog_number,dog_name) VALUES(?,'2026-09-30',0,'w1','2026082501','米香'),(?,'2026-10-05',0,'w1','2026082501','米香')", T, T);
  await run("INSERT INTO v3_walks(dog_id,walk_date,position,walker_code,dog_number,dog_name) VALUES(?,'2026-09-22',0,'w2','','米香'),(?,'2026-09-26',0,'w2','','米香'),(?,'2026-09-26',1,'w3','','米香'),(?,'2026-09-30',0,'w9','','米香')", S, S, S, S);
  await run("INSERT INTO v3_intros VALUES(?,'留下那隻的介紹'),(?,'被併那隻的介紹')", T, S);
  await run("INSERT INTO v3_rest VALUES(?,'2099-01-01','腳傷')", S);
  await run("INSERT INTO v3_intake_events(dog_id,position,number,event_date,event) VALUES(?,0,'2026082501','2026-08-25','入所'),(?,0,'','2026-08-24','先登記名字')", T, S);
  await run("INSERT INTO v3_photos(object_key,dog_id,thumb_key,is_primary) VALUES('photos/v/t.jpg',?,NULL,1),('photos/v/s.jpg',?,NULL,1)", T, S);
  await run("INSERT INTO v3_volunteers(volunteer_id,name,last_seen) VALUES('v1','小明','2026-10-01'),('v2','小華','2026-10-01')");
  await run("INSERT INTO v3_volunteer_favorites(volunteer_id,dog_id,added_on) VALUES('v1',?,'2026-09-01'),('v1',?,'2026-09-20'),('v2',?,'2026-09-21')", T, S, S);
  await run("INSERT INTO v3_activities(activity_id,activity_date,kind) VALUES('act1','2026-10-01','adoption')");
  await run("INSERT INTO v3_activity_dogs(activity_id,position,dog_id,name) VALUES('act1',0,?,'米香')", S);
  return { db, run };
}
async function dump(db, ids = [T, S]) {
  const out = {};
  for (const table of TABLES) out[table] = (await db.prepare(`SELECT * FROM ${table} WHERE dog_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results
    .map(r => JSON.stringify(r)).sort();
  return out;
}
const revisions = async db => Object.fromEntries((await db.prepare('SELECT dog_id,revision FROM v3_dog_edit_state').all()).results.map(r => [r.dog_id, r.revision]));
async function merge(db) {
  const rev = await revisions(db);
  return mergeDogs(db, T, { sourceId: S, revision: rev[T], sourceRevision: rev[S] }, { actor });
}

test('合併預覽：列出會搬過去的，兩邊都有的留下那隻的', async t => {
  const { db } = await setup(t);
  const p = await previewMerge(db, T, S);
  assert.equal(p.target.number, '2026082501');
  assert.equal(p.source.number, '');
  assert.deepEqual(p.moved, { 溜狗紀錄: 4, 休養: 1, 入所事件: 1, 照片: 1, 活動出席: 1, 常溜: 1 }, '同一天兩邊都有溜狗也全部搬過去');
  assert.deepEqual(p.kept, { 介紹: 1, 常溜: 1 });
  assert.deepEqual(p.lost, { 介紹: '被併那隻的介紹' }, '只留一份、會丟掉的內容先列出來');
  await assert.rejects(previewMerge(db, T, T), e => e.status === 400);
  await assert.rejects(previewMerge(db, T, OTHER), e => e.status === 409, '主清單上的狗不能被併掉');
  await assert.rejects(previewMerge(db, T, 'd'.repeat(32)), e => e.status === 404);
});

test('合併：被併那隻的資料搬到留下那隻、被併那隻刪掉；溜狗紀錄補上目前編號；同一批寫紀錄', async t => {
  const { db } = await setup(t);
  const walkVersion = await db.prepare('SELECT total+live AS n FROM v3_walk_versions').first('n');
  const smallVersion = await db.prepare('SELECT small FROM v3_pack_versions').first('small');
  const before = await revisions(db);
  const result = await merge(db);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM v3_dogs WHERE dog_id=?').bind(S).first('n'), 0);
  assert.equal((await dump(db, [S])).v3_walks.length, 0);
  const walks = (await db.prepare('SELECT walk_date,position,walker_code,dog_number FROM v3_walks WHERE dog_id=? ORDER BY walk_date,position').bind(T).all()).results;
  assert.deepEqual(walks.map(w => `${w.walk_date}/${w.position}/${w.walker_code}/${w.dog_number}`), [
    '2026-09-22/0/w2/2026082501', '2026-09-26/0/w2/2026082501', '2026-09-26/1/w3/2026082501', '2026-09-30/0/w1/2026082501', '2026-09-30/1/w9/2026082501', '2026-10-05/0/w1/2026082501'], '同一天別的志工接在後面，溜狗紀錄不丟');
  const edit = await readDogEdit(db, T);
  assert.equal(edit.intro, '留下那隻的介紹');
  assert.deepEqual(edit.rest, { until: '2099-01-01', reason: '腳傷' });
  assert.deepEqual(edit.intakeEvents.map(e => e.event), ['入所', '先登記名字']);
  assert.equal(edit.photo.key, 'photos/v/t.jpg', '留下那隻的主照片不變');
  // 同一天同一位志工只記一次
  assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM v3_walks WHERE dog_id=? AND walk_date='2026-09-30'").bind(T).first('n'), 2);
  assert.equal(await db.prepare("SELECT is_primary FROM v3_photos WHERE object_key='photos/v/s.jpg'").first('is_primary'), 0);
  assert.deepEqual((await db.prepare('SELECT volunteer_id,added_on FROM v3_volunteer_favorites WHERE dog_id=? ORDER BY volunteer_id').bind(T).all()).results,
    [{ volunteer_id: 'v1', added_on: '2026-09-01' }, { volunteer_id: 'v2', added_on: '2026-09-21' }]);
  assert.equal(await db.prepare("SELECT dog_id FROM v3_activity_dogs WHERE activity_id='act1'").first('dog_id'), T);
  assert.ok((await revisions(db))[T] > before[T], '溜狗紀錄沒有版本觸發器，也要擋住開著的草稿');
  assert.ok(await db.prepare('SELECT total+live AS n FROM v3_walk_versions').first('n') > walkVersion, '溜狗資料包失效');
  assert.ok(await db.prepare('SELECT small FROM v3_pack_versions').first('small') > smallVersion, '狗清單資料包失效');
  const log = await db.prepare("SELECT * FROM v3_edit_log WHERE kind='merge'").first();
  assert.equal(log.id, result.logId);
  assert.equal(log.dog_id, T);
  assert.equal(log.dog_number, '2026082501');
  assert.equal(log.editor_name, '管理者');
  assert.ok(!log.before_json.includes(actor.email));
  assert.equal(await db.prepare('SELECT actor_email FROM v3_dog_edit_actors WHERE log_id=?').bind(log.id).first('actor_email'), actor.email);
  const [pub] = await readEdits(db);
  assert.equal(pub.kind, 'merge');
  assert.equal(pub.kindLabel, '合併狗');
  assert.equal(pub.before.snapshot, undefined, '公開紀錄不帶整份快照');
  assert.equal(pub.after.rows, undefined);
  assert.deepEqual(pub.before.counts, { 溜狗紀錄: 4, 介紹: 1, 休養: 1, 入所事件: 1, 照片: 1, 活動出席: 1, 常溜: 2 });
  assert.equal(pub.before.name, '米香');
});

test('合併：預覽後任何一隻變過就 409，什麼都不寫', async t => {
  const { db, run } = await setup(t);
  const rev = await revisions(db);
  const snapshot = await dump(db);
  await run("UPDATE v3_intros SET intro='改過' WHERE dog_id=?", S);
  await assert.rejects(mergeDogs(db, T, { sourceId: S, revision: rev[T], sourceRevision: rev[S] }, { actor }), e => e.status === 409);
  await run("UPDATE v3_intros SET intro='被併那隻的介紹' WHERE dog_id=?", S);
  assert.deepEqual(await dump(db), snapshot);
  await assert.rejects(mergeDogs(db, T, { sourceId: S, revision: rev[T], sourceRevision: rev[S] }, {}), e => e.status === 403);
  await assert.rejects(mergeDogs(db, T, { sourceId: S, revision: rev[T] }, { actor }), e => e.status === 400);
  // 讀完到寫入之間被併那隻多了一列沒讀到的資料（這張表沒有版本觸發器）：刪狗會被外鍵擋下，整批不寫
  const fresh = await revisions(db);
  const racing = { prepare: sql => db.prepare(sql), batch: async statements => {
    await db.prepare("INSERT INTO v3_card_opened(walker_code,dog_id,opened_on) VALUES('w5',?,'2026-10-02')").bind(S).run();
    return db.batch(statements);
  } };
  await assert.rejects(mergeDogs(racing, T, { sourceId: S, revision: fresh[T], sourceRevision: fresh[S] }, { actor }), e => e.status === 409);
  assert.equal((await dump(db, [S])).v3_dogs.length, 1);
  assert.equal((await dump(db, [S])).v3_walks.length, 4);
});

test('取消合併：照快照整筆拆回來，兩隻狗都回到合併前；同一筆不能取消兩次', async t => {
  const { db } = await setup(t);
  const original = await dump(db);
  const { logId } = await merge(db);
  const targetRevision = (await readDogEdit(db, T)).revision;
  await assert.rejects(unmergeDogs(db, T, { logId, revision: targetRevision - 1 }, { actor }), e => e.status === 409);
  const result = await unmergeDogs(db, T, { logId, revision: targetRevision }, { actor });
  assert.equal(result.source.dogId, S);
  assert.deepEqual(await dump(db), original);
  await assert.rejects(unmergeDogs(db, T, { logId, revision: (await readDogEdit(db, T)).revision }, { actor }), e => e.status === 409);
  const kinds = (await db.prepare('SELECT kind FROM v3_edit_log ORDER BY id').all()).results.map(r => r.kind);
  assert.deepEqual(kinds, ['merge', 'unmerge']);
  // 再合併一次，舊的那筆合併紀錄不能拿來取消
  const again = await merge(db);
  await assert.rejects(unmergeDogs(db, T, { logId, revision: (await readDogEdit(db, T)).revision }, { actor }), e => e.status === 409);
  await unmergeDogs(db, T, { logId: again.logId, revision: (await readDogEdit(db, T)).revision }, { actor });
  assert.deepEqual(await dump(db), original);
});

test('取消合併：合併後留下那隻又改過的列不動，其他照樣拆回來', async t => {
  const { db, run } = await setup(t);
  const { logId } = await merge(db);
  // 試算表後來把 9/22 改成別人溜的（walkDay 刪掉重寫）
  await run("DELETE FROM v3_walks WHERE dog_id=? AND walk_date='2026-09-22'", T);
  await run("INSERT INTO v3_walks(dog_id,walk_date,position,walker_code,dog_number,dog_name) VALUES(?,'2026-09-22',0,'w7','2026082501','米香')", T);
  const edit = await readDogEdit(db, T);
  await saveDogEdit(db, T, { revision: edit.revision, field: 'intro', value: '合併後改的介紹' }, { actor });
  await unmergeDogs(db, T, { logId, revision: (await readDogEdit(db, T)).revision }, { actor });
  const walks = async id => (await db.prepare('SELECT walk_date||\'/\'||walker_code AS w FROM v3_walks WHERE dog_id=? ORDER BY walk_date,position').bind(id).all()).results.map(r => r.w);
  assert.deepEqual(await walks(T), ['2026-09-22/w7', '2026-09-30/w1', '2026-10-05/w1']);
  assert.deepEqual(await walks(S), ['2026-09-22/w2', '2026-09-26/w2', '2026-09-26/w3', '2026-09-30/w9']);
  assert.equal((await readDogEdit(db, T)).intro, '合併後改的介紹');
  assert.equal((await readDogEdit(db, S)).intro, '被併那隻的介紹');
});

test('取消合併：搬過去的編號後來給了別隻就插不回去，整批不寫', async t => {
  const { db, run } = await setup(t);
  await run("INSERT INTO v3_dog_numbers(number,dog_id) VALUES('2019042407',?)", S);
  const { logId } = await merge(db);
  await run("UPDATE v3_dog_numbers SET dog_id=? WHERE number='2019042407'", OTHER);
  const snapshot = await dump(db, [T, S, OTHER]);
  await assert.rejects(unmergeDogs(db, T, { logId, revision: (await readDogEdit(db, T)).revision }, { actor }), e => e.status === 409);
  assert.deepEqual(await dump(db, [T, S, OTHER]), snapshot);
});

test('出所過的狗併進在所的狗：出所紀錄搬過去並記用哪個編號回來，取消後還原', async t => {
  const { db, run } = await setup(t);
  await run("INSERT INTO v3_dog_numbers(number,dog_id) VALUES('2024101903',?)", S);
  await run("INSERT INTO v3_dog_departures(dog_id,number,name,departed_date,reason) VALUES(?,'2024101903','米香','2025-01-01','adopt')", S);
  const original = await dump(db);
  const { logId } = await merge(db);
  assert.deepEqual(await db.prepare('SELECT dog_id,returned_number FROM v3_dog_departures').first(), { dog_id: T, returned_number: '2026082501' });
  await unmergeDogs(db, T, { logId, revision: (await readDogEdit(db, T)).revision }, { actor });
  assert.deepEqual(await dump(db), original);
});

// ADR 0021（#639）：出入所紀錄不再「只留一份」，兩邊全部接在一起
test('合併：兩邊的出入所紀錄全部接在一起、預覽不列會丟的；取消合併兩隻都回原樣', async t => {
  const { db, run } = await setup(t);
  await run("INSERT INTO v3_stays VALUES(?,'[{\"in\":\"2015-08-18\",\"out\":\"2017-09-05\",\"reason\":\"整修移所\"}]')", T);
  await run("INSERT INTO v3_stays VALUES(?,'[{\"in\":\"2010-01-01\",\"out\":\"2011-01-01\",\"reason\":\"退養\"}]')", S);
  await run("INSERT INTO v3_dog_numbers(number,dog_id) VALUES('2019042407',?)", S);
  await run("INSERT INTO v3_dog_departures(dog_id,number,name,departed_date,reason) VALUES(?,'2019042407','米香','2020-01-01','adopt')", S);
  const p = await previewMerge(db, T, S);
  assert.equal('出入所紀錄' in p.lost, false);
  assert.equal(p.moved.出入所紀錄, 1);
  assert.equal('出入所紀錄' in p.kept, false);
  const original = await dump(db), sourceStays = (await readDogEdit(db, S)).stays, targetStays = (await readDogEdit(db, T)).stays;
  const { logId } = await merge(db);
  assert.deepEqual((await readDogEdit(db, T)).stays, [
    { number: '', in: '2010-01-01', out: '2011-01-01', reason: '退養' },
    { number: '', in: '2015-08-18', out: '2017-09-05', reason: '整修移所' },
    { number: '2019042407', in: '2019-04-24', out: '2020-01-01', reason: '認養', departed: true },
    { number: '2026082501', in: '2026-08-25', out: '', reason: '' },
  ]);
  await unmergeDogs(db, T, { logId, revision: (await readDogEdit(db, T)).revision }, { actor });
  assert.deepEqual(await dump(db), original);
  assert.deepEqual((await readDogEdit(db, S)).stays, sourceStays);
  assert.deepEqual((await readDogEdit(db, T)).stays, targetStays);
});

test('取消合併：合併後留下那隻又改過出入所紀錄，保留改過的、拿掉被併那隻的部分，被併那隻照快照拆回來', async t => {
  const { db, run } = await setup(t);
  await run("INSERT INTO v3_stays VALUES(?,'[{\"in\":\"2015-08-18\",\"out\":\"\",\"reason\":\"\"}]'),(?,'[{\"in\":\"2010-01-01\",\"out\":\"\",\"reason\":\"\"}]')", T, S);
  const { logId } = await merge(db);
  const merged = await readDogEdit(db, T);
  // 改自己那筆、被併那隻的 2010 那筆留著：取消後 2010 只回到被併那隻，不會兩隻都有
  const edited = merged.stays.map(r => (r.in === '2015-08-18' ? { ...r, reason: '改過' } : r));
  const after = await saveDogEdit(db, T, { revision: merged.revision, field: 'stays', value: edited }, { actor });
  await unmergeDogs(db, T, { logId, revision: after.revision }, { actor });
  assert.deepEqual((await readDogEdit(db, T)).stays, edited.filter(r => r.in !== '2010-01-01'));
  assert.deepEqual((await readDogEdit(db, S)).stays, [{ number: '', in: '2010-01-01', out: '', reason: '' }]);
});

test('D1 查詢數：每張表都有資料時，合併與取消合併各自在免費方案每次呼叫 50 句以內', async t => {
  const { db, run } = await setup(t);
  // 讓每張表兩邊都有列（最多句的情況）
  await run("INSERT INTO v3_rest VALUES(?,'2099-02-01','')", T);
  await run("INSERT INTO v3_stays VALUES(?,'[]'),(?,'[]')", T, S);
  await run("INSERT INTO v3_dog_numbers(number,dog_id) VALUES('2019042407',?)", S);
  await run("INSERT INTO v3_dog_departures(dog_id,number,name,departed_date,reason) VALUES(?,'2019042407','米香','2020-01-01','adopt')", S);
  await run("INSERT INTO v3_volunteer_cards(volunteer_id,dog_id,opened_on) VALUES('v1',?,'2026-09-01'),('v2',?,'2026-09-02')", T, S);
  await run("INSERT INTO v3_card_opened(walker_code,dog_id,opened_on) VALUES('w1',?,'2026-09-01'),('w2',?,'2026-09-02')", T, S);
  let queries = 0;
  const counted = { prepare: sql => { queries++; return db.prepare(sql); }, batch: statements => db.batch(statements) };
  const rev = await revisions(db);
  const { logId } = await mergeDogs(counted, T, { sourceId: S, revision: rev[T], sourceRevision: rev[S] }, { actor });
  assert.ok(queries <= 50, `合併用了 ${queries} 句`);
  queries = 0;
  await unmergeDogs(counted, T, { logId, revision: (await revisions(db))[T] }, { actor });
  assert.ok(queries <= 50, `取消合併用了 ${queries} 句`);
});

test('D1 不整張掃：合併與取消合併的每一句都用 dog_id 走索引，只有 SCAN_OK 列的小表例外', async t => {
  const { db } = await setup(t);
  const { SCAN_OK } = await import('../src/dog-merge.js');
  const seen = [];
  const recording = {
    prepare: sql => { const stmt = db.prepare(sql); return { ...stmt, bind: (...args) => { seen.push([sql, args]); return stmt.bind(...args); },
      first: (...a) => { seen.push([sql, []]); return stmt.first(...a); }, all: (...a) => { seen.push([sql, []]); return stmt.all(...a); } }; },
    batch: statements => db.batch(statements),
  };
  const rev = await revisions(db);
  const { logId } = await mergeDogs(recording, T, { sourceId: S, revision: rev[T], sourceRevision: rev[S] }, { actor });
  await unmergeDogs(recording, T, { logId, revision: (await revisions(db))[T] }, { actor });
  const scans = new Set();
  for (const [sql, args] of seen) {
    for (const { detail } of (await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...args).all()).results) {
      const table = detail.match(/^SCAN (\w+)/)?.[1];
      if (table && table !== 'json_each') scans.add(table);
    }
  }
  assert.ok(seen.length > 20 && scans.has('v3_volunteer_favorites'), '確認真的攔到 SQL、量得到整張掃');
  assert.deepEqual([...scans].filter(s => !Object.hasOwn(SCAN_OK, s)), [], '其他表都要用 dog_id 走索引');
});
