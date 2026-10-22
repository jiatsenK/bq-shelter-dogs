// Worker 呼叫寫試算表小程式（worker/src/sheet-write.js，ADR 0006）：所有寫試算表的路都經過 callSheet
// 執行：node --test worker/test/sheet-call.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { callSheet, SheetWriteError, SHEET_ACTIONS, scriptError } from '../src/sheet-write.js';

const ENV = { SHEET_WRITE_URL: 'https://script.example/exec', SHEET_WRITE_KEY: 'k' };
function withFetch(handler, fn) {
  const saved = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return handler(); };
  return Promise.resolve(fn(calls)).finally(() => { globalThis.fetch = saved; });
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('ADR 0006：只送小程式認得的動作，跟 apps-script/sheet-write.gs 對得上', async () => {
  await assert.rejects(callSheet(ENV, { action: 'deleteRow' }), /沒有這個動作/);
  const gs = await readFile(new URL('../../apps-script/sheet-write.gs', import.meta.url), 'utf8');
  for (const action of SHEET_ACTIONS) assert.match(gs, new RegExp(`req\\.action === '${action}'`), action);
});

test('帶上金鑰送出；成功回小程式的回應', () => withFetch(() => json({ ok: true, today: '2026-10-22' }), async calls => {
  const out = await callSheet(ENV, { action: 'walk', dogs: [] });
  assert.equal(out.today, '2026-10-22');
  assert.deepEqual(calls[0].body, { action: 'walk', dogs: [], key: 'k' });
  await callSheet({ SHEET_WRITE_URL: ENV.SHEET_WRITE_URL }, { action: 'walk', dogs: [] });
  assert.equal('key' in calls[1].body, false, '沒設金鑰就不帶');
}));

test('失敗都是 SheetWriteError，訊息可以直接給志工看', async () => {
  const fails = async (env, handler) => withFetch(handler, () => callSheet(env, { action: 'walk' }).then(() => assert.fail('應該失敗'), e => e));
  let e = await fails({}, () => json({ ok: true }));
  assert.ok(e instanceof SheetWriteError);
  assert.deepEqual([e.status, e.code], [503, 'off']);
  e = await fails(ENV, () => { throw new Error('ECONNRESET'); });
  assert.deepEqual([e.status, e.message], [502, '連不上試算表，請稍後再試']);
  e = await fails(ENV, () => new Response('<html>', { status: 500 }));
  assert.deepEqual([e.status, e.message], [502, '試算表沒有回應（500）']);
  e = await fails(ENV, () => json({ ok: false, code: 'key' }));
  assert.deepEqual([e.message, e.code], ['寫入試算表的金鑰不對，請 K 檢查設定', 'key']);
  e = await fails(ENV, () => json({ ok: false, error: 'Exception: Illegal spreadsheet id: 1AbCdEfGhIjKlMnOpQrStUvWxYz' }));
  assert.equal(e.message, '試算表 ID 不對，請 K 檢查小程式設定');
});

test('小程式錯誤不帶出試算表 ID', () => {
  assert.equal(scriptError(''), '試算表沒有寫進去');
  assert.equal(scriptError('別的錯 1AbCdEfGhIjKlMnOpQrStUvWxYz0123'), '別的錯 …');
});
