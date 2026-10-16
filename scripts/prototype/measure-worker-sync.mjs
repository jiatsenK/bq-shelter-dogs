// #301 原型：量一次「刪光重寫」同步的讀寫列數與 CPU 時間（不碰任何 D1，全部在記憶體 D1 裡跑）。
// 跑法：node scripts/prototype/measure-worker-sync.mjs [資料夾]
// 資料夾放正式網站 /api/dogs、/api/walks、/api/departures 存成的 dogs.json、walks.json、departures.json；沒給就用 tests/fixtures
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildSyncSql, SEED_TABLES } from '../sync-compact-d1.mjs';
import { fakeD1 } from '../../worker/test/fakes.mjs';
import { migrateCompactDatabase } from '../migrate-compact-db.mjs';

const dir = process.argv[2] ? pathToFileURL(`${process.argv[2].replace(/[\\/]?$/, '/')}`) : new URL('../../tests/fixtures/', import.meta.url);
const json = async p => JSON.parse(await readFile(new URL(p, dir), 'utf8'));
const dogs = await json('dogs.json');
// /api/dogs 的 groupColumns 是 { column, label, names }；fixtures 只有 groups
const groupColumns = dogs.groupColumns ? dogs.groupColumns.map(c => c.names) : Object.entries(dogs.groups).map(([n, o]) => [n, ...o]);
const groupLabels = dogs.groupColumns ? dogs.groupColumns.map(c => c.label) : [];
const src = { dogs, walks: await json('walks.json'), departures: (await json('departures.json')).departures, groupColumns, groupLabels };

// 第一次寫進記憶體 D1，當作「正式 D1 現況」，再拿它當 seed 量第二次（日常同步的情況）
const first = await buildSyncSql({}, src);
const db = fakeD1();
await migrateCompactDatabase(db);
await db.batch(first.split(';\n').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
const seed = {};
for (const [t, sql] of Object.entries(SEED_TABLES)) seed[t] = (await db.prepare(sql).all()).results;
db.close();

const runs = [];
let sql;
for (let i = 0; i < 5; i++) {
  const c = process.cpuUsage();
  sql = await buildSyncSql(seed, src);
  const u = process.cpuUsage(c);
  runs.push(Math.round((u.user + u.system) / 1000));
}
const lines = sql.split('\n').filter(Boolean);
const count = re => lines.filter(l => re.test(l)).length;
const byTable = {};
for (const l of lines.filter(l => /^INSERT/.test(l))) { const t = l.match(/^INSERT INTO (\w+)/)[1]; byTable[t] = (byTable[t] || 0) + 1; }
console.log(JSON.stringify({
  dogs: dogs.dogs.length, walks: src.walks.walks.length, departures: src.departures.length,
  d1RowsReadForSeed: Object.values(seed).reduce((n, r) => n + r.length, 0),
  statements: lines.length, inserts: count(/^INSERT/), deletes: count(/^DELETE/), creates: count(/^CREATE/), insertsByTable: byTable,
  cpuMsNodeIncludingInMemorySqlite: runs,
}, null, 1));

// 只量核心計算（planSync：比對上一次、算新溜狗紀錄與離所），不含 SQLite。Worker 版本至少要做這段
const { planSync, readPrevious } = await import('../sync-compact-d1.mjs');
const db2 = fakeD1();
await migrateCompactDatabase(db2);
await db2.batch(first.split(';\n').map(s => s.trim()).filter(Boolean).map(s => db2.prepare(s)));
const prev = await readPrevious(db2);
db2.close();
const sheet = { dogs: dogs.dogs.map(({ myWalked, myWalkedDate, sex, intro, ...d }) => d), groups: dogs.groups, sheetNotes: dogs.sheetNotes };
// Windows 的 cpuUsage 一格約 15 ms，改跑多次取平均（暖機後，Worker 每次請求通常也是暖的）
const N = 50;
const t0 = performance.now();
for (let i = 0; i < N; i++) planSync(prev, sheet, null, new Date(), { key: 'prototype-key', names: [] });
console.log(JSON.stringify({ msPlanSyncOnlyAvg: Math.round((performance.now() - t0) / N * 10) / 10 }));
