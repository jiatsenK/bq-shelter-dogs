// #270 一次性匯入舊活動名單：完全同名的自動接上，其他先存名字並列出清單；不在部署或同步時執行
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateCompactDatabase } from './migrate-compact-db.mjs';
import { parseActivityCsv, planImport, importSql, reportText } from './import-activities.mjs';
import { readActivities } from '../worker/src/activities.js';

async function makeDb() {
  const db = fakeD1();
  await migrateCompactDatabase(db);
  for (const [id, name] of [['d1', '小白'], ['d2', '小黑'], ['d3', '小黑'], ['d4', '阿福']]) await db.prepare('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)').bind(id, name).run();
  return db;
}
const queryOf = db => async sql => { assert.match(sql, /^SELECT /); return (await db.prepare(sql).all()).results; };
const run = async (db, sql) => { for (const s of sql) await db.prepare(s).run(); };

const CSV = `﻿日期,活動類型,狗名
2026/9/12,動保小小兵,小白
2026/9/12,動保小小兵,小黑
2026-09-12,動保小小兵,小白
2026-10-11,認養會," 阿福 "
2026-10-11,認養會,沒建卡的狗
2026-10-11,散步會,小白
2026-02-30,認養會,小白
2026-10-11,認養會,
`;

test('讀表格：日期格式統一、略過標題和空白列，看不懂的列出原因', () => {
  const { rows, errors } = parseActivityCsv(CSV);
  assert.deepEqual(rows.map(r => [r.line, r.date, r.kind, r.name]), [
    [2, '2026-09-12', 'kids', '小白'], [3, '2026-09-12', 'kids', '小黑'], [4, '2026-09-12', 'kids', '小白'],
    [5, '2026-10-11', 'adoption', '阿福'], [6, '2026-10-11', 'adoption', '沒建卡的狗'],
  ]);
  assert.deepEqual(errors.map(e => [e.line, e.reason]), [[7, '活動類型只能是動保小小兵或認養會'], [8, '日期看不懂'], [9, '沒有狗名']]);
});

test('完全同名且只有一隻才接上；同名多隻、找不到只存名字並列出；同一場同一隻只記一次', async t => {
  const db = await makeDb(); t.after(() => db.close());
  const plan = await planImport(queryOf(db), parseActivityCsv(CSV).rows);
  assert.deepEqual(plan.activities, [
    { date: '2026-09-12', kind: 'kids', dogs: [{ dogId: 'd1', name: '小白' }, { dogId: null, name: '小黑' }] },
    { date: '2026-10-11', kind: 'adoption', dogs: [{ dogId: 'd4', name: '阿福' }, { dogId: null, name: '沒建卡的狗' }] },
  ]);
  assert.deepEqual(plan.unmatched.map(u => [u.line, u.name, u.reason]), [[3, '小黑', '同名 2 隻'], [6, '沒建卡的狗', 'D1 找不到這個名字']]);
  assert.match(reportText(plan), /會匯入 2 場、4 隻次出席；2 筆只存名字/);
});

test('寫進 D1 後網站讀得到（只有名字的照樣顯示），每場一筆編輯紀錄；重跑不重複匯入', async t => {
  const db = await makeDb(); t.after(() => db.close());
  const rows = parseActivityCsv(CSV).rows;
  let n = 0;
  await run(db, importSql(await planImport(queryOf(db), rows), { at: '2026-10-21T00:00:00.000Z', newId: () => String(++n).padStart(32, '0') }));
  const acts = await readActivities(db);
  assert.deepEqual(acts.map(a => [a.date, a.kind, a.dogs.map(d => [d.name, Boolean(d.dogId)])]), [
    ['2026-10-11', 'adoption', [['阿福', true], ['沒建卡的狗', false]]],
    ['2026-09-12', 'kids', [['小白', true], ['小黑', false]]],
  ]);
  const log = (await db.prepare("SELECT editor_name, after_json FROM v3_edit_log WHERE kind='activity' ORDER BY id").all()).results;
  assert.deepEqual(log.map(r => [r.editor_name, JSON.parse(r.after_json).dogs]), [['舊名單匯入', ['小白', '小黑']], ['舊名單匯入', ['阿福', '沒建卡的狗']]]);
  const again = await planImport(queryOf(db), rows);
  assert.deepEqual([again.activities.length, again.skipped.map(s => s.date)], [0, ['2026-09-12', '2026-10-11']]);
  assert.deepEqual(importSql(again), []);
});

test('部署、同步的 workflow 都不會執行匯入', async () => {
  const dir = new URL('../.github/workflows/', import.meta.url);
  for (const f of await readdir(dir)) assert.doesNotMatch(await readFile(new URL(f, dir), 'utf8'), /import-activities/, f);
});
