// 執行：node --test worker/test/d1-usage.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { todayRowsWritten } from '../src/d1-usage.js';

test('#302 查今天的 D1 寫入量：加總帳號所有資料庫，查不到回 null', async () => {
  let body;
  const ok = async (url, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [{ sum: { rowsWritten: 40 } }, { sum: { rowsWritten: 2 } }] }] } } }) }; };
  assert.equal(await todayRowsWritten({ token: 't', accountId: 'a', now: new Date('2026-10-17T01:00:00+08:00'), fetchImpl: ok }), 42);
  assert.equal(body.variables.d, '2026-10-16', '額度照 UTC 日期算（台灣早上 8:00 重置）');
  const denied = async () => ({ ok: true, json: async () => ({ data: null, errors: [{ message: 'not authorized' }] }) });
  assert.equal(await todayRowsWritten({ token: 't', accountId: 'a', fetchImpl: denied }), null);
  assert.equal(await todayRowsWritten({ token: 't', accountId: 'a', fetchImpl: async () => { throw new Error('網路斷了'); } }), null);
});
