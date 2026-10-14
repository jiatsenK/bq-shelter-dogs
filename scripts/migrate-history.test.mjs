import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateBusinessDatabase } from './migrate-business-db.mjs';
import { migrateIdentities } from './migrate-identities.mjs';
import { migrateHistory } from './migrate-history.mjs';

async function setup(t, input = { dogs: [{ id: '2026010101', name: '測試狗' }] }) {
  const db = fakeD1(); t.after(() => db.close());
  await migrateBusinessDatabase(db); await migrateIdentities(db, input);
  return db;
}

test('快照前的紀錄標 legacy，名單去重、來源逐筆保存、重跑不增筆', async t => {
  const db = await setup(t);
  const input = { asOf: '2026-10-14', walks: [
    { id: '2026010101', name: '測試狗', date: '2026-09-20', walkers: ['abcdef123456', 'abcdef123456'] },
    { id: '2026010101', name: '測試狗', date: '2026-09-20', walkers: ['abcdef123456'] },
  ] };
  const first = await migrateHistory(db, input), second = await migrateHistory(db, input);
  assert.equal(first.counts.walks, 1); assert.equal(second.counts.walks, 1);
  assert.equal(second.counts.sources, 2);
  assert.equal(await db.prepare('SELECT evidence FROM v2_daily_walks').first('evidence'), 'legacy');
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v2_walk_participants').first('COUNT(*)'), 1);
});

test('同狗跨入所同日只算一天，志工別名算同一人，未來日期與未知身分保留', async t => {
  const db = await setup(t, { dogs: [{ id: '2020010101', name: '狗' }], cards: [{ id: '2026010101', formerIds: ['2020010101'] }] });
  const input = { asOf: '2026-10-14', walks: [
    { id: '2020010101', date: '2026-09-20', walkers: ['abcdef123456'] },
    { id: '2026010101', date: '2026-09-20', walkers: ['abcdef123456'] },
    { id: 'missing', date: '2026-09-20' }, { id: '2026010101', date: '2026-12-01' },
  ] };
  const out = await migrateHistory(db, input);
  assert.equal(out.counts.walks, 2); assert.equal(out.counts.dogDays, 1);
  assert.equal(out.pending.length, 2);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v2_walkers').first('COUNT(*)'), 1);
});

test('遛狗日期表頭不冒充離所日，仍在主清單與已出所矛盾不改現況', async t => {
  const db = await setup(t);
  const out = await migrateHistory(db, { asOf: '2026-10-14', departedSheet: [
    { rowNumber: 2, id: '2026010101', name: '測試狗', dateText: '2026/9/20', note: '已被認養' },
    { rowNumber: 3, id: '2025010101', name: '舊狗', dateText: '2026/9/20', dateColumnLabel: '遛狗日期', note: '已被認養' },
  ] });
  assert.equal(await db.prepare("SELECT status FROM v2_admissions JOIN v2_admission_numbers USING(admission_id) WHERE number='2026010101'").first('status'), 'in');
  assert.equal(await db.prepare("SELECT departed_date FROM v2_admissions JOIN v2_admission_numbers USING(admission_id) WHERE number='2025010101'").first('departed_date'), null);
  assert.equal(out.pending.length, 2);
});

test('補登差異沒有決策不算有效，明確保留／排除可重跑且不刪來源', async t => {
  const db = await setup(t);
  const input = { asOf: '2026-10-14', walks: [{ id: '2026010101', date: '2026-09-26' }] };
  const pending = await migrateHistory(db, input);
  assert.equal(pending.counts.dogDays, 0); assert.equal(pending.pending.length, 1);
  input.historyDecisions = { '2026010101|2026-09-26': { decision: 'retain', evidence: 'K 確認歷史補登' } };
  assert.equal((await migrateHistory(db, input)).counts.dogDays, 1);
  input.historyDecisions['2026010101|2026-09-26'] = { decision: 'exclude', evidence: 'K 改為排除' };
  assert.equal((await migrateHistory(db, input)).counts.dogDays, 0);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v2_history_sources').first('COUNT(*)'), 1);
  input.historyDecisions['2026010101|2026-09-26'] = { decision: 'retain', evidence: 'K 保留' };
  assert.equal((await migrateHistory(db, input)).counts.dogDays, 1);
});

test('重新演練同日最後快照可覆蓋當日，但隔天日期不取消昨日 final', async t => {
  const db = await setup(t);
  const day = { date: '2026-10-13', syncedAt: '2026-10-13T08:00:00+08:00', dogs: [{ id: '2026010101', walkedDate: '2026-10-13' }] };
  await migrateHistory(db, { asOf: '2026-10-13', snapshots: [day] });
  const late = { ...day, syncedAt: '2026-10-13T18:00:00+08:00', dogs: [{ id: '2026010101', walkedDate: '2026-10-12' }] };
  assert.equal((await migrateHistory(db, { asOf: '2026-10-14', snapshots: [day, late] })).counts.dogDays, 0);
  await migrateHistory(db, { asOf: '2026-10-14', snapshots: [day] });
  await migrateHistory(db, { asOf: '2026-10-14', snapshots: [{ date: '2026-10-14', syncedAt: '2026-10-14T08:00:00+08:00', dogs: [{ id: '2026010101', walkedDate: '2026-10-14' }] }] });
  assert.equal(await db.prepare("SELECT state FROM v2_daily_walks WHERE walk_date='2026-10-13'").first('state'), 'final');
});

test('已出所分頁補快照前離所，原因每次重判，舊入所不影響新在所', async t => {
  const db = await setup(t, { dogs: [{ id: '2020010101', name: '再入所狗' }], cards: [{ id: '2026010101', formerIds: ['2020010101'] }] });
  const input = { asOf: '2026-10-14', departedSheet: [
    { rowNumber: 2, id: '2025090101', name: '芊芊測試', dateText: '2026/9/18', note: '' },
    { rowNumber: 3, id: '2020010101', name: '再入所狗', dateText: '2025/12/30', note: '2025/12/31被認養' },
  ] };
  await migrateHistory(db, input);
  const old = await db.prepare("SELECT status,departed_date,departed_reason FROM v2_admissions JOIN v2_admission_numbers USING(admission_id) WHERE number='2020010101'").first();
  assert.deepEqual(old, { status: 'departed', departed_date: '2025-12-31', departed_reason: 'adopt' });
  assert.equal(await db.prepare("SELECT status FROM v2_admissions JOIN v2_admission_numbers USING(admission_id) WHERE number='2026010101'").first('status'), 'in');
  assert.equal(await db.prepare("SELECT departed_date FROM v2_admissions JOIN v2_admission_numbers USING(admission_id) WHERE number='2025090101'").first('departed_date'), '2026-09-18');
  input.departedSheet[0].note = '2026/9/18被認養';
  await migrateHistory(db, input);
  assert.equal(await db.prepare("SELECT departed_reason FROM v2_admissions JOIN v2_admission_numbers USING(admission_id) WHERE number='2025090101'").first('departed_reason'), 'adopt');
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v2_dogs').first('COUNT(*)'), 2);
});

test('每日最後成功快照定案，失敗同步不覆蓋、今天維持 provisional', async t => {
  const db = await setup(t);
  await migrateHistory(db, { asOf: '2026-10-14', snapshots: [
    { date: '2026-10-13', syncedAt: '2026-10-13T08:00:00+08:00', dogs: [{ id: '2026010101', walkedDate: '2026-10-13', walkers: ['aaaaaaaaaaaa'] }] },
    { date: '2026-10-13', syncedAt: '2026-10-13T18:00:00+08:00', dogs: [{ id: '2026010101', walkedDate: '2026-10-13', walkers: ['bbbbbbbbbbbb'] }] },
    { date: '2026-10-13', syncedAt: '2026-10-13T20:00:00+08:00', status: 'failed', dogs: [{ id: '2026010101', walkedDate: '2026-10-12' }] },
    { date: '2026-10-14', syncedAt: '2026-10-14T09:00:00+08:00', dogs: [{ id: '2026010101', walkedDate: '2026-10-14' }] },
  ] });
  assert.deepEqual((await db.prepare('SELECT walk_date,state,evidence FROM v2_daily_walks ORDER BY walk_date').all()).results, [
    { walk_date: '2026-10-13', state: 'final', evidence: 'snapshot' }, { walk_date: '2026-10-14', state: 'provisional', evidence: 'snapshot' },
  ]);
  assert.deepEqual((await db.prepare('SELECT code FROM v2_walk_participants JOIN v2_walker_codes USING(walker_id)').all()).results, [{ code: 'bbbbbbbbbbbb' }]);
});
