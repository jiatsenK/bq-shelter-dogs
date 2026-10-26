// #271 已出所狗卡：GET /api/departed-cards。溜過幾天用各年摘要（不整表讀 v3_walks），出席活動次數、只有名字的卡
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { resetPackCache } from '../src/packs.js';
import { fakeD1 } from './fakes.mjs';
import { createCompactDatabase } from '../../scripts/compact-schema.mjs';
import { importCompactDogs, importCompactDepartures, importCompactProfiles } from './compact-fixtures.mjs';

const SITE = 'https://bq-shelter-dogs.jiatsen-k.workers.dev';
const A = 'aaaaaaaaaaaa', B = 'bbbbbbbbbbbb';
const dog = (id, name) => ({ cage: 'A1', id, name, walkedDate: null, covered: false, myWalked: false, walkers: [], note: '', sex: '', intro: '' , myWalkedDate: null });
const dep = (id, name, date, extra = {}) => ({ id, name, date, dateSource: 'sheet', seen: date, reason: 'adopt', matched: '認養', flags: [], ...extra });
const WALKS = [
  { id: '2019010101', name: '舊號阿福', date: '2024-05-01', walkers: [A] }, // 舊編號的紀錄也算
  { id: '2020010101', name: '阿福', date: '2025-03-01', walkers: [A, B] }, // 兩個人同一天：算一天
  { id: '2020010101', name: '阿福', date: '2025-03-02' }, // 沒記人的舊紀錄也算
  { id: '2020010101', name: '阿福', date: '2026-09-30', walkers: [B] },
  { id: '2021020202', name: '小咪', date: '2026-01-05', walkers: [A] },
  { id: '2025022703', name: '在所狗', date: '2026-10-01', walkers: [A] },
];

async function seeded(t) {
  const DB = fakeD1(); t.after(() => DB.close());
  resetPackCache();
  await createCompactDatabase(DB);
  await importCompactDogs(DB, { version: 1, syncedAt: '2026-10-16T08:00:00+08:00', dogs: [dog('2025022703', '在所狗'), dog('2026010101', '回來了')] });
  await importCompactDepartures(DB, [
    dep('2020010101', '阿福', '2026-10-10', { last: { cage: 'A1', id: '2020010101', name: '阿福', walkedDate: '2026-09-30', note: '', sex: '', intro: '', formerIds: ['2019010101'] } }),
    dep('2019010101', '舊號阿福', '2020-01-01'), // 同一隻上一次離所：只留最新那筆
    dep('2021020202', '小咪', '2026-03-01', { reason: 'death', matched: '死亡' }),
    dep('2022020202', '回來了', '2025-01-01', { returned: '2026010101' }), // 再入所的不算
  ]);
  await importCompactProfiles(DB, { walks: { version: 1, walks: WALKS } });
  const id = n => DB.prepare('SELECT dog_id FROM v3_dog_numbers WHERE number=?').bind(n).first('dog_id');
  await DB.prepare("INSERT INTO v3_activities(activity_id,activity_date,kind) VALUES('a1','2026-09-01','adoption'),('a2','2026-09-15','kids')").run();
  await DB.prepare("INSERT INTO v3_activity_dogs VALUES('a1',0,?,'阿福'),('a2',0,?,'阿福'),('a2',1,NULL,'老黃')").bind(await id('2020010101'), await id('2020010101')).run();
  await DB.prepare("INSERT INTO v3_dogs(dog_id,name) VALUES('manual1','老黃')").run();
  await DB.prepare("INSERT INTO v3_dog_departures(dog_id,number,name,departed_date,seen_date) VALUES('manual1','','老黃','','2026-10-20')").run();
  await DB.prepare("UPDATE v3_activity_dogs SET dog_id='manual1' WHERE dog_id IS NULL AND name='老黃'").run();
  return DB;
}
const get = async DB => (await worker.fetch(new Request(`${SITE}/api/departed-cards`, { headers: { 'Sec-Fetch-Site': 'same-origin' } }), { DB })).json();
const brief = body => body.dogs.map(d => [d.id, d.name, d.departed, d.reason, d.walkDays, d.activities, d.nameOnly]);

test('離所的狗加上只有名字的卡；溜過幾天含舊編號、沒記人的紀錄；出席活動次數；再入所的不算', async t => {
  const DB = await seeded(t);
  const body = await get(DB);
  assert.equal(body.ok, true);
  assert.deepEqual(brief(body), [
    ['2020010101', '阿福', '2026-10-10', 'adopt', 4, 2, false],
    ['2021020202', '小咪', '2026-03-01', 'death', 1, 0, false],
    ['manual1', '老黃', '', 'unknown', 0, 1, true],
  ]);
  assert.deepEqual(body.dogs[0].formerIds, ['2019010101']);
});

test('#271 以前存的摘要沒有每隻狗的天數：重算一次，答案一樣；之後不再讀 v3_walks', async t => {
  const DB = await seeded(t);
  const first = brief(await get(DB));
  const rows = (await DB.prepare('SELECT year,seq,body FROM v3_walk_summaries ORDER BY year,seq').all()).results;
  assert(rows.length > 0, '已經存了摘要');
  for (const [year, list] of Object.entries(Object.groupBy(rows, r => r.year))) {
    const { dogs, ...old } = JSON.parse(list.map(r => r.body).join(''));
    assert(dogs, '新摘要有 dogs');
    await DB.prepare('DELETE FROM v3_walk_summaries WHERE year=? AND seq>0').bind(year).run();
    await DB.prepare('UPDATE v3_walk_summaries SET body=? WHERE year=? AND seq=0').bind(JSON.stringify(old), year).run();
  }
  resetPackCache();
  assert.deepEqual(brief(await get(DB)), first);
});

test('#560 以前存的離所資料包沒有 cards（套 migration 到部署之間舊程式存的）：重算一次，只有名字的卡照樣出現', async t => {
  const DB = await seeded(t);
  const first = brief(await get(DB));
  const rows = (await DB.prepare("SELECT part,seq,body FROM v3_packs WHERE part LIKE 'departures:%' ORDER BY part,seq").all()).results;
  for (const [part, list] of Object.entries(Object.groupBy(rows, r => r.part))) {
    const { cards, ...old } = JSON.parse(list.map(r => r.body).join(''));
    assert(Array.isArray(cards), '新資料包有 cards');
    await DB.prepare('DELETE FROM v3_packs WHERE part=? AND seq>0').bind(part).run();
    await DB.prepare('UPDATE v3_packs SET body=? WHERE part=? AND seq=0').bind(JSON.stringify(old), part).run();
  }
  resetPackCache();
  assert.deepEqual(brief(await get(DB)), first);
});

// CODING_STANDARDS「附讀寫量測試」：先用小資料跑，再塞大量無關資料跑，沒變時讀取量一樣
async function readsOf(DB) {
  const before = DB.stats.rowsRead;
  await get(DB);
  return DB.stats.rowsRead - before;
}
test('讀取量：沒變時只讀版本號，不隨狗、活動、溜狗紀錄變多', async t => {
  const DB = await seeded(t);
  await get(DB);
  const small = await readsOf(DB);
  for (let i = 0; i < 300; i++) await DB.prepare('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)').bind(`x${i}`, `無關${i}`).run();
  for (let i = 0; i < 40; i++) {
    await DB.prepare("INSERT INTO v3_activities(activity_id,activity_date,kind) VALUES(?,'2025-01-01','kids')").bind(`b${i}`).run();
    await DB.prepare('INSERT INTO v3_activity_dogs VALUES(?,0,?,?)').bind(`b${i}`, `x${i}`, `無關${i}`).run();
    await DB.prepare("INSERT INTO v3_walks(dog_id,walk_date,position,dog_number,dog_name) VALUES(?,'2025-02-01',0,'',?)").bind(`x${i}`, `無關${i}`).run();
  }
  await get(DB); // 有變：重讀一次
  assert.equal(await readsOf(DB), small, '資料多了，沒變時讀取量一樣');
  assert(small <= 5, `沒變時只讀幾列版本號：${small}`);
});

test('沒有 D1 回 503，不是空名單', async () => {
  const res = await worker.fetch(new Request(`${SITE}/api/departed-cards`, { headers: { 'Sec-Fetch-Site': 'same-origin' } }), {});
  assert.equal(res.status, 503);
});
