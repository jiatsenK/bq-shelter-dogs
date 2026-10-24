import test from 'node:test';
import assert from 'node:assert/strict';

test('Node 可直接匯入前端日期工具，且不建立全域名稱', async () => {
  const { BQDates } = await import('../public/js/dates.js');
  assert.equal(BQDates.parseYmd('2026-10-24').getDate(), 24);
  assert.equal(globalThis.BQDates, undefined);
});
