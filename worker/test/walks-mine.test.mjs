// #344 我溜過的狗（ADR 0013）：POST /api/walks/mine 和用全部紀錄算的 bqMyDogs 逐筆相同，讀取列數不隨紀錄筆數變多
// 執行：node --test worker/test/walks-mine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { readWalks } from '../src/compact.js';
import { fakeD1 } from './fakes.mjs';
import { createCompactDatabase } from '../../scripts/compact-schema.mjs';
import { importCompactDogs, importCompactProfiles } from './compact-fixtures.mjs';

const SITE = 'https://bq-shelter-dogs.example.workers.dev';
const NOW = Date.parse('2026-10-16T02:00:00Z'); // 台灣 2026-10-16 10:00
const TODAY = '2026-10-16';
const A = 'aaaaaaaaaaaa', A2 = 'a2a2a2a2a2a2', B = 'bbbbbbbbbbbb';
const dog = (id, name) => ({ cage: 'A1', id, name, walkedDate: null, covered: false, myWalked: false, walkers: [], note: '', sex: '', intro: '', myWalkedDate: null });
const SOURCE = { version: 1, syncedAt: '2026-10-16T08:00:00+08:00', dogs: [dog('2025022703', '滿滿'), dog('2026051203', '圓仔')] };
const WALKS = [
  { id: '2025022703', name: '滿滿', date: '2024-12-30', walkers: [A2] },
  { id: '2025022703', name: '滿滿', date: '2025-01-02', walkers: [A, A2] }, // 一個人的兩個代號同一天：算一天
  { id: '2025022703', name: '滿滿', date: '2025-06-01', walkers: [B] },
  { id: '2026051203', name: '圓仔', date: '2025-12-31', walkers: [A] },
  { id: '2026051203', name: '圓仔', date: '2026-01-01' },
  { id: '2026051203', name: '圓仔', date: '2026-09-01', walkers: [A, B] },
  { id: '2025022703', name: '滿滿', date: '2026-10-15', walkers: [A2] },
  { id: '2025022703', name: '滿滿', date: TODAY, walkers: [B, A] },
];

// public/js/cards.js 原本的 bqMyDogs（日期用字串）
function reference(walks, codes) {
  const mine = {};
  if (!codes.length) return mine;
  const text = v => (v == null ? '' : String(v).trim());
  const last = new Map();
  walks.forEach(w => { if (w && Array.isArray(w.walkers) && text(w.id)) last.set(`${text(w.id)}|${w.date}`, w); });
  for (const w of last.values()) {
    if (!w.walkers.some(c => codes.includes(c))) continue;
    const id = text(w.id), m = mine[id] ||= { times: 0, first: w.date, last: w.date };
    m.times++;
    if (w.date < m.first) m.first = w.date;
    if (w.date > m.last) m.last = w.date;
  }
  return mine;
}

async function seededDb(t) {
  const DB = fakeD1(); t.after(() => DB.close());
  await createCompactDatabase(DB);
  await importCompactDogs(DB, SOURCE);
  await importCompactProfiles(DB, { walks: { version: 1, walks: WALKS } });
  return DB;
}
const mine = (DB, codes) => worker.fetch(new Request(`${SITE}/api/walks/mine`, {
  method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json' }, body: JSON.stringify({ codes }),
}), { DB });
const CASES = [[A], [A2], [A, A2], [B], [A, A2, B], ['cccccccccccc'], []];
async function assertSame(DB, label) {
  const all = (await readWalks(DB)).walks;
  for (const codes of CASES) {
    const res = await mine(DB, codes);
    assert.equal(res.status, 200, label);
    assert.deepEqual((await res.json()).dogs, reference(all, codes), `${label} ${codes}`);
  }
}
async function readsOf(DB, codes) {
  const before = DB.stats.rowsRead;
  assert.equal((await mine(DB, codes)).status, 200);
  return DB.stats.rowsRead - before;
}

test.beforeEach(t => {
  worker.testing.resetState();
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
});

test('跟全部紀錄算的 bqMyDogs 相同：跨年、舊代號、改舊紀錄、今天新增、跨日', async t => {
  const DB = await seededDb(t);
  await assertSame(DB, '一開始');
  await DB.prepare("UPDATE v3_walks SET walker_code=? WHERE walk_date='2025-06-01'").bind(A).run();
  await assertSame(DB, '改舊紀錄');
  await DB.prepare("INSERT INTO v3_walks(dog_id,walk_date,position,walker_code,dog_number,dog_name) SELECT dog_id,?,5,?,'2026051203','圓仔' FROM v3_dog_numbers WHERE number='2026051203'").bind(TODAY, A2).run();
  await assertSame(DB, '今天新增');
  worker.testing.resetState();
  await assertSame(DB, '換一台機器');
  t.mock.timers.setTime(NOW + 86400000);
  await assertSame(DB, '跨日');
});

test('代號放在請求內容；格式不對回 400，只能用 POST', async t => {
  const DB = await seededDb(t);
  assert.equal((await mine(DB, ['not-a-code'])).status, 400);
  assert.equal((await mine(DB, 'x')).status, 400);
  const res = await worker.fetch(new Request(`${SITE}/api/walks/mine`, { headers: { 'Sec-Fetch-Site': 'same-origin' } }), { DB });
  assert.equal(res.status, 405);
});

test('讀取列數固定：每年 1 列摘要加版本號，不隨溜狗紀錄筆數變多', async t => {
  const DB = await seededDb(t);
  await mine(DB, [A]);
  worker.testing.resetState();
  const small = await readsOf(DB, [A]);
  for (let i = 0; i < 200; i++) await DB.prepare("INSERT INTO v3_walks(dog_id,walk_date,position,walker_code,dog_number,dog_name) SELECT dog_id,?,?,?,'2025022703','滿滿' FROM v3_dog_numbers WHERE number='2025022703'").bind('2025-03-' + String(1 + i % 28).padStart(2, '0'), 10 + i, B).run();
  await mine(DB, [A]);
  worker.testing.resetState();
  const years = (await DB.prepare('SELECT COUNT(DISTINCT year) n FROM v3_walk_summaries').first()).n;
  assert.equal(years, 3);
  const big = await readsOf(DB, [A]);
  assert.equal(big, small, '多 200 筆紀錄，讀取列數一樣');
  // 版本號 1 列＋每年 1 列摘要＋今天的列
  const today = (await DB.prepare('SELECT COUNT(*) n FROM v3_walks WHERE walk_date=?').bind(TODAY).first()).n;
  assert.equal(big, 1 + years + today);
  assert.equal(await readsOf(DB, [A]), 1, '同一台機器沒變：只讀版本號');
});
