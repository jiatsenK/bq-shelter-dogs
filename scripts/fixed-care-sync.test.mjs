import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateCompactDatabase } from './migrate-compact-db.mjs';
import { buildSyncPlan, SEED_TABLES } from './sync-compact-d1.mjs';
import { diffTables } from './sync-diff.mjs';

test('同步不擁有 fixed_care 欄位，新增與修改 SQL 都不帶網站設定', () => {
  const before = { v3_dogs: [{ dog_id: 'a', name: '甲', fixed_care: 1 }] };
  const after = { v3_dogs: [{ dog_id: 'a', name: '甲改名', fixed_care: 0 }, { dog_id: 'b', name: '乙', fixed_care: 1 }] };
  const writes = diffTables(before, after);
  assert.equal(writes.length, 2);
  for (const { sql } of writes) assert.doesNotMatch(sql, /fixed_care/);
});

test('同步預演後網站才開啟固定照顧，套用同步 SQL 仍保留，重跑同來源不改狗列', async t => {
  const db = fakeD1(); t.after(() => db.close());
  await migrateCompactDatabase(db);
  const source = { dogs: { version: 1, dogs: [{ id: '2024032902', name: '甲', covered: true }] }, walks: { walks: [] }, departures: [], groupColumns: [] };
  const execute = sql => db.batch(sql.split(';\n').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
  await execute((await buildSyncPlan({}, source)).sql);
  const snapshot = async () => Object.fromEntries(await Promise.all(Object.entries(SEED_TABLES).map(async ([table, sql]) => [table, (await db.prepare(sql).all()).results])));
  const seed = await snapshot();
  source.dogs.dogs[0].name = '甲改名';
  const planned = await buildSyncPlan(seed, source);
  await db.prepare('UPDATE v3_dogs SET fixed_care=1').run();
  await execute(planned.sql);
  assert.deepEqual((await db.prepare('SELECT name,fixed_care FROM v3_dogs').all()).results, [{ name: '甲改名', fixed_care: 1 }]);
  const repeat = await buildSyncPlan(await snapshot(), source);
  assert.equal(repeat.rows, 0);
  assert.doesNotMatch(repeat.sql, /UPDATE v3_dogs SET|INSERT INTO v3_dogs\(/);
});
