import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createWalkRegistration } = createRequire(import.meta.url)('../public/js/walk-registration.js');
const dog = { id: '9001', name: '測試狗' }, day = '2026-10-21';
function client(send, saved = {}) {
  let records = {}, requests = saved;
  const registration = createWalkRegistration({ d1: true, key: d => d.id, date: () => day, walker: () => '甲', alias: () => '', split: s => s.split('、').filter(Boolean), canonical: s => s,
    base: () => ({ date: '2026-10-01', walker: '舊' }), syncedAt: () => Date.now() + 10000,
    read: () => records, save: r => { records = r; }, local: () => [], apply: () => {}, send,
    readRequests: () => requests, saveRequests: r => { requests = r; } });
  return { registration, requests: () => requests };
}
const accepted = payload => ({ ok: true, source: 'd1', today: day, results: [{ id: dog.id, name: dog.name, status: 'written', accepted: true, requestId: payload.requestId, operationDate: day, version: 1, current: { date: day, walker: '甲' }, syncStatus: 'pending', at: new Date().toISOString() }] });
test('D1 接受之前不變已溜；未知結果在重新建立手機介面後仍用同一請求重送', async () => {
  let payload;
  const first = client(async body => { payload = body; throw new Error('lost response'); });
  const result = await first.registration.register([dog]);
  assert.equal(first.registration.state(dog).today, false);
  assert.equal(result.rows[0].status, 'unknown');
  assert.ok(payload.requestId);
  const second = client(async body => { assert.deepEqual(body, payload); return accepted(body); }, first.requests());
  const next = await second.registration.register([dog]);
  assert.equal(next.successful.length, 1);
  assert.equal(second.registration.state(dog).today, true);
  assert.equal(second.registration.state(dog).syncStatus, 'pending');
  assert.deepEqual(second.requests(), {});
});

test('已接管狀態不被舊 today、walkers 或同步時間覆蓋；較舊版本拒絕', async () => {
  const { registration:r } = client(async body => accepted(body));
  await r.register([dog]);
  const row = { key:dog.id, version:2, walkedDate:day, walker:'甲、乙', syncStatus:'retry', at:'2026-10-21T02:00:00Z' };
  r.receiveToday({ source:'d1', version:5, date:day, walks:[row] },[dog]);
  r.receiveToday({ source:'d1', version:4, date:day, walks:[{ ...row, walker:'甲', syncStatus:'synced' }] },[dog]);
  r.receiveNames({ [dog.id]:'舊名字' },[dog]);
  r.receiveToday({ date:day, walks:[{ ...row, walker:'舊消息' }] },[dog]);
  assert.equal(r.state(dog).walker,'甲、乙');
  assert.equal(r.state(dog).syncStatus,'retry');
  assert.equal(r.today([dog]).length,1);
});
