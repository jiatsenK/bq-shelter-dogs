// #271 K 建只有名字的已出所狗卡，活動紀錄裡同名、還沒對上的出席接到這張卡；也能接到已經有的狗
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateCompactDatabase } from './migrate-compact-db.mjs';
import { cardOptions, planCard, cardSql, planText } from './departed-card.mjs';
import { readActivities } from '../worker/src/activities.js';

async function makeDb() {
  const db = fakeD1();
  await migrateCompactDatabase(db);
  await db.prepare("INSERT INTO v3_dogs(dog_id,name) VALUES('d1','小黑'),('d2','小黑')").run();
  await db.prepare("INSERT INTO v3_dog_numbers VALUES('2020010101','d1'),('2021010101','d2')").run();
  await db.prepare("INSERT INTO v3_activities(activity_id,activity_date,kind) VALUES('a1','2024-05-01','adoption')").run();
  await db.prepare("INSERT INTO v3_activity_dogs VALUES('a1',0,NULL,'老黃'),('a1',1,NULL,'小黑'),('a1',2,'d1','別的名字')").run();
  return db;
}
const queryOf = db => async sql => { assert.match(sql, /^SELECT /); return (await db.prepare(sql).all()).results; };
const run = async (db, sql) => { for (const s of sql) await db.prepare(s).run(); };

test('參數：名字必填、日期與原因要合格，--to 不搭配離所資料', () => {
  assert.deepEqual(cardOptions(['--name', ' 老黃 ', '--left', '2024-05-01', '--reason', 'adopt']), { name: '老黃', to: '', left: '2024-05-01', reason: 'adopt', editor: 'K', write: false });
  assert.throws(() => cardOptions([]), /--name/);
  assert.throws(() => cardOptions(['--name', '老黃', '--left', '2024-02-30']), /--left/);
  assert.throws(() => cardOptions(['--name', '老黃', '--reason', 'lost']), /--reason/);
  assert.throws(() => cardOptions(['--name', '小黑', '--to', '2020010101', '--left', '2024-01-01']), /--to/);
});

test('建只有名字的卡：活動紀錄同名、沒對上的出席接上；網站讀到的是這隻狗；編輯紀錄一筆；不能重複建', async t => {
  const db = await makeDb(); t.after(() => db.close());
  const plan = await planCard(queryOf(db), cardOptions(['--name', '老黃', '--left', '2024-06-01', '--reason', 'adopt', '--editor', 'K']));
  assert.match(planText(plan), /會接上 1 筆出席/);
  await run(db, cardSql(plan, { at: '2026-10-21T00:00:00Z', newId: () => 'm'.repeat(32) }));
  assert.deepEqual((await db.prepare('SELECT dog_id,departed_date,reason FROM v3_departed_cards').all()).results, [{ dog_id: 'm'.repeat(32), departed_date: '2024-06-01', reason: 'adopt' }]);
  const [a] = await readActivities(db);
  assert.deepEqual(a.dogs.map(d => [d.name, d.dogId]), [['老黃', 'm'.repeat(32)], ['小黑', null], ['小黑', 'd1']]);
  const log = await db.prepare("SELECT editor_name, dog_id, after_json FROM v3_edit_log WHERE kind='departed-card'").first();
  assert.deepEqual([log.editor_name, log.dog_id, JSON.parse(log.after_json).attendances], ['K', 'm'.repeat(32), 1]);
  await assert.rejects(planCard(queryOf(db), cardOptions(['--name', '老黃'])), /已經有「老黃」的已出所狗卡/);
});

test('同名好幾隻：建卡前提醒改用 --to；--to 把沒對上的名字接到指定的狗，不建新卡', async t => {
  const db = await makeDb(); t.after(() => db.close());
  const warn = await planCard(queryOf(db), cardOptions(['--name', '小黑']));
  assert.match(warn.warnings[0], /2 隻叫「小黑」.*2020010101、2021010101.*--to/);
  const plan = await planCard(queryOf(db), cardOptions(['--name', '小黑', '--to', '2021010101']));
  await run(db, cardSql(plan));
  assert.equal(await db.prepare("SELECT dog_id FROM v3_activity_dogs WHERE position=1").first('dog_id'), 'd2');
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM v3_departed_cards').first('n'), 0);
  await assert.rejects(planCard(queryOf(db), cardOptions(['--name', '小黑', '--to', '2021010101'])), /沒有還沒對上的/);
  await assert.rejects(planCard(queryOf(db), cardOptions(['--name', '老黃', '--to', '1999999999'])), /沒有編號/);
});

test('部署、同步的 workflow 都不會執行建卡', async () => {
  const dir = new URL('../.github/workflows/', import.meta.url);
  for (const f of await readdir(dir)) assert.doesNotMatch(await readFile(new URL(f, dir), 'utf8'), /departed-card/, f);
});
