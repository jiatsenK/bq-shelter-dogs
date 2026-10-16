import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fakeD1 } from './fakes.mjs';
import { migrateCompactDatabase } from '../../scripts/migrate-compact-db.mjs';
import { buildSyncSql } from '../../scripts/sync-compact-d1.mjs';
import { planSync, readPrevious } from '../../scripts/sync-plan.mjs';
import { SYNC_TABLES, planDiff, readSnapshot } from '../src/sheet-sync.js';

const json = async p => JSON.parse(await readFile(new URL(`../../tests/fixtures/${p}`, import.meta.url), 'utf8'));
const KEY = 'test-walker-key';

async function source() {
  const dogs = await json('dogs.json');
  // 同步寫進主清單的介紹一律是空的（#250 起介紹由網站寫 v3_intros）
  dogs.dogs = dogs.dogs.map(d => ({ ...d, intro: '' }));
  const groupColumns = Object.entries(dogs.groups).map(([n, o]) => [n, ...o]);
  return { dogs, walks: await json('walks.json'), departures: (await json('departures.json')).departures, groupColumns, groupLabels: [] };
}

// 先完整同步一次，當作 D1 現況（同一份 SQL，兩個資料庫的狗 ID 才一樣）
let firstSql;
async function seeded(t) {
  const db = fakeD1(); t.after(() => db.close());
  await migrateCompactDatabase(db);
  const sql = firstSql ??= await buildSyncSql({}, await source());
  await db.batch(sql.split(';\n').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
  return db;
}

// 這次試算表的內容：第一隻狗今天被溜了
async function nextSync(db, now) {
  const prev = await readPrevious(db);
  const src = await source();
  const dogs = prev.dogs.dogs.map(({ myWalked, myWalkedDate, sex, intro, formerIds, ...d }, i) => (i === 0 ? { ...d, walkedDate: '2026-10-16', walkers: ['abcdef123456'] } : d));
  const plan = planSync(prev, { dogs, groups: prev.dogs.groups, sheetNotes: prev.dogs.sheetNotes }, null, now, { key: KEY, names: [] });
  return { ...plan, groupColumns: src.groupColumns, groupLabels: [] };
}

const sorted = (table, rows) => rows.map(r => ({ ...r })).sort((a, b) => JSON.stringify(SYNC_TABLES[table].map(c => a[c])).localeCompare(JSON.stringify(SYNC_TABLES[table].map(c => b[c]))));
const dropSyncedAt = (table, rows) => (table === 'v3_sheet_main' ? rows.map(r => (r.row_index === 0 ? r : { ...r, synced_at: '' })) : rows);

test('差異同步寫完的 D1 跟刪光重寫一模一樣（主清單只有第 0 列的同步時間要一樣）', async t => {
  const now = new Date('2026-10-16T10:00:00+08:00');
  const full = await seeded(t), diffDb = await seeded(t);
  const src = await nextSync(full, now);
  const seed = await readSnapshot(full);
  const sql = await buildSyncSql(seed, src);
  await full.batch(['DELETE FROM v3_departure_items', ...sql.split(';\n').map(s => s.trim()).filter(s => s && !/^CREATE/.test(s))].map(s => full.prepare(s)));

  const diff = await planDiff(diffDb, await nextSync(diffDb, now));
  await diffDb.batch(diff.map(s => diffDb.prepare(s.sql).bind(...s.values)));

  const a = await readSnapshot(full), b = await readSnapshot(diffDb);
  for (const table of Object.keys(SYNC_TABLES)) assert.deepEqual(dropSyncedAt(table, sorted(table, b[table])), dropSyncedAt(table, sorted(table, a[table])), table);
  // 一隻狗被溜：主清單那列＋誰遛的＋新的溜狗紀錄＋同步時間，遠少於刪光重寫
  assert.ok(diff.length < 10, `寫了 ${diff.length} 句：${diff.map(s => s.sql).join('\n')}`);
});

test('試算表沒變：只更新第 0 列的同步時間', async t => {
  const db = await seeded(t);
  const prev = await readPrevious(db);
  const src = await source();
  const dogs = prev.dogs.dogs.map(({ myWalked, myWalkedDate, sex, intro, formerIds, ...d }) => d);
  const plan = planSync(prev, { dogs, groups: prev.dogs.groups, sheetNotes: prev.dogs.sheetNotes }, null, new Date('2026-10-16T10:00:00+08:00'), { key: KEY, names: [] });
  const diff = await planDiff(db, { ...plan, groupColumns: src.groupColumns, groupLabels: [], departures: prev.departures });
  assert.deepEqual(diff.map(s => s.sql), ['UPDATE v3_sheet_main SET synced_at=? WHERE row_index=?']);
});
