import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './fakes.mjs';
import { createCompactDatabase } from '../../scripts/compact-schema.mjs';
import { readSettings, saveSettings } from '../src/feature-settings.js';
import { countShare, readShareCounts } from '../src/share-counts.js';

const manager = { subject: 'verified-subject', email: 'private@example.org' };
const origin = 'https://volunteer.example';
async function db(t) { const db = fakeD1(); t.after(() => db.close()); await createCompactDatabase(db); return db; }
async function setShare(DB, on) { const s = await readSettings(DB); await saveSettings(DB, { ...s, values: { ...s.values, showShare: on } }, manager); }
// 台灣 10/28 08:00（UTC 10/28 00:00）與台灣 10/29 07:00（UTC 10/28 23:00）
const DAY1 = Date.UTC(2026, 9, 28, 0), DAY2 = Date.UTC(2026, 9, 28, 23);

test('ADR 0023 分享次數：台灣日期、分方式累加，不記人；讀最近 30 天和總數', async t => {
  const DB = await db(t);
  await countShare(DB, 'share', DAY1);
  await countShare(DB, 'share', DAY1);
  await countShare(DB, 'copy', DAY1);
  await countShare(DB, 'share', DAY2);
  const rows = (await DB.prepare('SELECT * FROM v3_share_counts ORDER BY day, method').all()).results;
  assert.deepEqual(rows.map(r => ({ ...r })), [
    { day: '2026-10-28', method: 'copy', count: 1 },
    { day: '2026-10-28', method: 'share', count: 2 },
    { day: '2026-10-29', method: 'share', count: 1 },
  ]);
  await DB.prepare("INSERT INTO v3_share_counts(day,method,count) VALUES('2026-01-01','share',5)").run();
  await DB.prepare("UPDATE v3_share_totals SET count=count+5 WHERE method='share'").run();
  assert.deepEqual(await readShareCounts(DB, DAY2), {
    total: { share: 8, copy: 1 },
    days: [{ day: '2026-10-29', share: 1, copy: 0 }, { day: '2026-10-28', share: 2, copy: 1 }],
  });
  await assert.rejects(countShare(DB, 'click', DAY1));
});

test('ADR 0023 POST /api/share：開關關著拒絕；開著記一筆；方式不對 400；GET 設定帶分享網址', async t => {
  const worker = (await import('../src/index.js')).default;
  const DB = await db(t);
  const call = (body, env = { DB }) => worker.fetch(new Request(origin + '/api/share', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env);
  const closed = await call({ method: 'share' });
  assert.equal(closed.status, 403, '預設關閉');
  assert.match((await closed.json()).error, /這項功能目前未開放/);
  await setShare(DB, true);
  assert.equal((await call({ method: 'share' })).status, 200);
  assert.equal((await call({ method: 'copy' })).status, 200);
  assert.equal((await call({ method: 'cancel' })).status, 400);
  assert.equal((await call({})).status, 400);
  assert.equal((await DB.prepare('SELECT SUM(count) AS n FROM v3_share_counts').first('n')), 2);
  assert.equal((await call({ method: 'share' }, { DB, PREVIEW: '1' })).status, 403, '預覽版不寫');
  const read = env => worker.fetch(new Request(origin + '/api/feature-settings', { headers: { Origin: origin } }), env).then(r => r.json());
  assert.equal((await read({ DB })).shareUrl, origin, '沒設 SHARE_URL 就回自己的網址');
  assert.equal((await read({ DB, SHARE_URL: 'https://prod.example' })).shareUrl, 'https://prod.example', '測試站、預覽帶正式網址');
  const etag = env => worker.fetch(new Request(origin + '/api/feature-settings', { headers: { Origin: origin } }), env).then(r => r.headers.get('ETag'));
  assert.notEqual(await etag({ DB }), await etag({ DB, SHARE_URL: 'https://prod.example' }), '分享網址變了，快取要失效');
});

test('ADR 0023 讀寫量：記一次固定寫 2 列；舊資料多 10 倍，管理網站讀的列數不變', async t => {
  const DB = await db(t);
  const changes = async action => { const before = await DB.prepare('SELECT total_changes() AS n').first('n'); await action(); return await DB.prepare('SELECT total_changes() AS n').first('n') - before; };
  const readsOf = async () => { const before = DB.stats.rowsRead; await readShareCounts(DB, DAY2); return DB.stats.rowsRead - before; };
  const fill = async (from, n) => { for (let i = from; i < from + n; i++) await DB.prepare("INSERT INTO v3_share_counts(day,method,count) VALUES(?, 'share', 1)").bind(new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10)).run(); };
  assert.equal(await changes(() => countShare(DB, 'share', DAY1)), 2);
  await fill(0, 20);
  const small = await readsOf();
  await fill(20, 200);
  assert.equal(await readsOf(), small, '30 天以前的舊資料不讀');
  assert.equal(await changes(() => countShare(DB, 'copy', DAY1)), 2);
});
