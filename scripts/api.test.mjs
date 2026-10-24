import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendModule } from './frontend-module-test-helper.mjs';

// 每個測試各自一份 BQApi，替換 fetch 與提前讀取的狗清單
async function load(fetch, extra = {}) {
  const calls = [];
  const ctx = { location: { origin: 'https://bq.test' }, fetch: (url, init) => { calls.push([url, init]); return fetch(url, init); }, ...extra };
  ctx.window = ctx;
  const api = (await loadFrontendModule('api.js', ctx)).BQApi;
  return { api, calls, ctx };
}
const json = (body, status = 200) => async () => new Response(JSON.stringify(body), { status });

test('成功回應：ok、狀態碼與 JSON 內容', async () => {
  const { api, calls } = (await load(json({ walks: [] })));
  const r = await api.walks();
  assert.deepEqual({ ...r }, { ok: true, status: 200, data: { walks: [] }, error: null, message: '' });
  assert.equal(calls[0][0], 'https://bq.test/api/walks');
  assert.equal(calls[0][1].cache, 'no-cache');
});

test('非 2xx 帶回伺服器說的原因；非 JSON 與斷線各自分類', async () => {
  let r = await (await load(json({ ok: false, error: '太頻繁了' }, 429))).api.walks();
  assert.equal(r.ok, false); assert.equal(r.error, 'http'); assert.equal(r.status, 429); assert.equal(r.data.error, '太頻繁了');
  r = await (await load(async () => new Response('<html>502</html>', { status: 502 }))).api.walks();
  assert.equal(r.error, 'http'); assert.equal(r.data, null); assert.equal(r.status, 502);
  r = await (await load(async () => new Response('{壞掉'))).api.walks();
  assert.equal(r.ok, false); assert.equal(r.error, 'format'); assert.equal(r.status, 200); assert.equal(r.data, null); assert.ok(r.message);
  r = await (await load(async () => { throw new TypeError('Failed to fetch'); })).api.walks();
  assert.deepEqual({ ...r }, { ok: false, status: 0, data: null, error: 'network', message: 'Failed to fetch' });
});

test('Safari 斷線的 Load failed 顯示成中文（K 2026-10-23）', async () => {
  const r = await (await load(async () => { throw new TypeError('Load failed'); })).api.walks();
  assert.equal(r.error, 'network');
  assert.equal(r.message, '網頁載入失敗');
});

test('寫入端點送 JSON 內容與方法；路徑參數有編碼', async () => {
  const { api, calls } = (await load(json({ ok: true })));
  await api.saveIntro('a/b', { editor: '甲', text: '親人' });
  assert.equal(calls[0][0], 'https://bq.test/api/intro/a%2Fb');
  assert.equal(calls[0][1].method, 'PUT');
  assert.equal(calls[0][1].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0][1].body), { editor: '甲', text: '親人' });
  await api.sync();
  assert.deepEqual([calls[1][0], calls[1][1].method, calls[1][1].body], ['https://bq.test/api/sync', 'POST', undefined]);
});

test('狗清單先用主頁提前讀的那份，只用一次', async () => {
  let early = 0;
  const { api, calls, ctx } = (await load(json({ dogs: [1] })));
  ctx.__dogsEarly = Promise.resolve().then(() => { early++; return new Response(JSON.stringify({ dogs: ['early'] })); });
  assert.deepEqual((await api.dogs()).data, { dogs: ['early'] });
  assert.equal(calls.length, 0);
  assert.equal(ctx.__dogsEarly, null);
  assert.deepEqual((await api.dogs()).data, { dogs: [1] });
  assert.equal(early, 1);
});

test('沒有網址（Node、file://）時 base 是空字串，呼叫端據此關掉寫入功能', async () => {
  assert.equal((await load(json({}), { location: undefined })).api.base(), '');
  assert.equal((await load(json({}), { location: { origin: 'null' } })).api.base(), '');
  assert.equal((await load(json({}))).api.base(), 'https://bq.test/api');
});

test('沒有網址時照舊送相對路徑 api/，跟著頁面的 base 走', async () => {
  const { api, calls } = (await load(json({ walks: [] }), { location: { origin: 'null' } }));
  await api.walks();
  await api.saveGroup({ names: [] });
  assert.deepEqual(calls.map(c => c[0]), ['api/walks', 'api/groups']);
});
