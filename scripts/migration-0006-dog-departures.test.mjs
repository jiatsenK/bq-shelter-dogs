// #560：0006 把舊離所三表（v3_departures、v3_departure_items、v3_departed_cards）搬進 v3_dog_departures。
// 照正式庫的樣子：先跑 0006 以前的 migration、用舊表的寫法放資料，再跑 0006，網站讀到的離所名冊、只有名字的卡跟搬之前一樣
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { splitStatements } from './compact-schema.mjs';
import { MIGRATIONS_DIR, migrationFiles } from './d1-migrations.mjs';
import { readDepartures, readNameOnlyCards } from '../worker/src/compact.js';

const FILE = '0006_dog_departures.sql';
const run = async (db, file) => { for (const sql of splitStatements(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))) await db.prepare(sql).run(); };

// 舊表放 3 筆有編號的離所（一筆有附屬清單、一筆回所、一筆沒有 last_*）和 1 張只有名字的卡
async function oldDb(t) {
  const db = fakeD1(); t.after(() => db.close());
  for (const f of migrationFiles().filter(f => f < FILE)) await run(db, f);
  const dogs = [['d1', '阿福'], ['d2', '小咪'], ['d3', '回來了'], ['m1', '老黃']];
  await db.batch([
    ...dogs.map(([id, name]) => db.prepare('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)').bind(id, name)),
    db.prepare(`INSERT INTO v3_departures(number,dog_id,name,departed_date,date_source,seen_date,reason,matched,returned_number,last_number,last_name,last_cage,last_walked_date,last_note,last_sex,last_intro)
      VALUES('2020010101','d1','阿福','2026-10-10','sheet','2026-10-11','adopt','認養',NULL,'2020010101','阿福','A1','2026-09-30','備註','公','介紹')`),
    db.prepare(`INSERT INTO v3_departures(number,dog_id,name,departed_date,date_source,seen_date,reason,matched) VALUES('2021020202','d2','小咪','2025-03-01','note','2025-03-02','death','死亡')`),
    db.prepare(`INSERT INTO v3_departures(number,dog_id,name,departed_date,reason,returned_number) VALUES('2022020202','d3','回來了',NULL,'unknown','2026010101')`),
    // 故意倒著插，搬過去要照 position 排
    ...[['flag', 1, '旗二'], ['flag', 0, '旗一'], ['former', 0, '2019010101'], ['group', 1, '小咪'], ['group', 0, '回來了']]
      .map(([kind, position, value]) => db.prepare("INSERT INTO v3_departure_items(number,kind,position,value) VALUES('2020010101',?,?,?)").bind(kind, position, value)),
    db.prepare("INSERT INTO v3_departure_items(number,kind,position,value) VALUES('2021020202','flag',0,'只有旗標')"),
    db.prepare("INSERT INTO v3_departed_cards(dog_id,departed_date,reason,created_at) VALUES('m1','2024-06-01','adopt','2026-10-21T08:00:00Z')"),
  ]);
  return db;
}
const years = async db => JSON.parse(await db.prepare('SELECT years FROM v3_departure_versions WHERE id=1').first('years'));

test('0006 搬資料：離所名冊內容不變，附屬清單照順序變 JSON，只有名字的卡變成沒編號的離所', async t => {
  const db = await oldDb(t);
  const before = await years(db);
  await run(db, FILE);
  const expected = [
    { id: '2020010101', name: '阿福', date: '2026-10-10', dateSource: 'sheet', seen: '2026-10-11', reason: 'adopt', matched: '認養', flags: ['旗一', '旗二'],
      last: { cage: 'A1', id: '2020010101', name: '阿福', walkedDate: '2026-09-30', note: '備註', sex: '公', intro: '介紹', formerIds: ['2019010101'], groups: ['回來了', '小咪'] } },
    { id: '2021020202', name: '小咪', date: '2025-03-01', dateSource: 'note', seen: '2025-03-02', reason: 'death', matched: '死亡', flags: ['只有旗標'] },
    { id: '2022020202', name: '回來了', date: null, dateSource: null, seen: null, reason: 'unknown', matched: '', flags: [], returned: '2026010101' },
  ];
  assert.deepEqual(await readNameOnlyCards(db), [{ dogId: 'm1', name: '老黃', date: '2024-06-01', reason: 'adopt' }]);
  // 搬進新表的每一年都加 1（網站的離所資料包會重算）；2024 是只有名字的卡帶來的新鍵
  const after = await years(db);
  for (const y of ['2025', '2026', 'none']) assert.equal(after[y], before[y] + 1, y);
  assert.equal(after['2024'], 1);
  // 舊表原封不動（下一張 PR 才 DROP）
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM v3_departures').first('n'), 3);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM v3_departure_items').first('n'), 6);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM v3_departed_cards').first('n'), 1);
  // Current runtime requires 0009; verify 0006's versions above before adding its read prerequisites.
  await run(db,'0009_dog_edit.sql');
  assert.deepEqual((await readDepartures(db)).map(({editRevision,sex,photoVersion,...snapshot})=>snapshot),expected);
});

test('0006 重跑不重複搬、版本號不再動', async t => {
  const db = await oldDb(t);
  await run(db, FILE);
  const rows = await db.prepare('SELECT * FROM v3_dog_departures ORDER BY dog_id').all(), v = await years(db);
  await run(db, FILE);
  assert.deepEqual(await db.prepare('SELECT * FROM v3_dog_departures ORDER BY dog_id').all(), rows);
  assert.deepEqual(await years(db), v);
});

test('0006 之後：狗的休養改了，改看新表讓牠出所那年加 1', async t => {
  const db = await oldDb(t);
  await run(db, FILE);
  const before = await years(db);
  await db.prepare("INSERT INTO v3_rest(dog_id,until_date,reason) VALUES('d2','2026-12-01','老了')").run();
  assert.deepEqual(await years(db), { ...before, 2025: before['2025'] + 1 });
});
