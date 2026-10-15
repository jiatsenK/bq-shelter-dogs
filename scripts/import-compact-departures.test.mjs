import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateCompactDatabase } from './migrate-compact-db.mjs';
import { importCompactDepartures, compareCompactDepartures } from './import-compact-departures.mjs';
import { readDepartures } from '../worker/src/compact.js';

async function freshDb(t) {
  const db = fakeD1(); t.after(() => db.close());
  await migrateCompactDatabase(db);
  return db;
}

const repoDepartures = async () => JSON.parse(await readFile(new URL('../data/departures.json', import.meta.url), 'utf8')).departures;

test('repo 的 departures.json 匯入後讀回一模一樣，重跑也一樣', async t => {
  const db = await freshDb(t);
  const list = await repoDepartures();
  await importCompactDepartures(db, list);
  await importCompactDepartures(db, list);
  assert.deepEqual(await readDepartures(db), list);
  assert.deepEqual(await compareCompactDepartures(db, list), { equal: true, differences: [] });
});

test('舊編號、常遛狗群、旗標、又回來的編號、沒有 last 的舊紀錄都保留', async t => {
  const db = await freshDb(t);
  const list = [
    { id: 'B', name: '乙', date: '2026-10-02', dateSource: 'sheet', seen: '2026-10-03', reason: 'unknown', matched: '認養、死亡', flags: ['conflict', 'duplicate'], returned: 'C',
      last: { cage: 'A1', id: 'B', name: '乙', walkedDate: null, note: '', sex: '', intro: '', formerIds: ['B0', 'B1'], groups: ['甲', '丙'] } },
    { id: 'A', name: '甲', date: '2026-10-02', dateSource: null, seen: '2026-10-02', reason: 'adopt', matched: '認養', flags: [] },
  ];
  await importCompactDepartures(db, list);
  assert.deepEqual(await readDepartures(db), [list[1], list[0]]); // 同一天依編號
});

test('比對抓得到少一筆或欄位不同', async t => {
  const db = await freshDb(t);
  const list = await repoDepartures();
  await importCompactDepartures(db, list.slice(1));
  const { differences } = await compareCompactDepartures(db, [{ ...list[1], reason: 'death' }, list[0], ...list.slice(2)]);
  assert.deepEqual(differences.map(d => [d.key, d.field]), [[list[1].id, 'reason'], [list[0].id, '*']]);
});

test('來源格式錯或編號重複就丟錯，不寫', async t => {
  const db = await freshDb(t);
  const list = await repoDepartures();
  await importCompactDepartures(db, list);
  await assert.rejects(importCompactDepartures(db, [list[0], list[0]]), /重複/);
  await assert.rejects(importCompactDepartures(db, [{ ...list[0], date: '10/1' }]), /日期/);
  assert.deepEqual(await readDepartures(db), list);
});
