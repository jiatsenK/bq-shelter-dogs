// 照片上傳服務的測試（#47）：用假的 GitHub API，不會真的連 GitHub 或 Cloudflare
// 執行：node --test worker/test/worker.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const { resetState, allowUpload, isJpeg, MAX_BYTES } = worker.testing;

// 測試用另一個網址，用 ALLOWED_ORIGINS 放行（正式網站跟 Worker 同網址，不用設）
const ORIGIN = 'https://allowed.example';
let mainStatus = 200;
const DB = { prepare: () => ({ all: async () => { if (mainStatus !== 200) throw new Error('D1 read failed'); return { results: DOGS.dogs.filter(d => d.id).map(d => ({ number: d.id, name: d.name })) }; } }) };
const ENV = { GITHUB_TOKEN: 'test-token', ALLOWED_ORIGINS: ORIGIN, DB };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const DOGS = { dogs: [{ id: '2024032902', name: '測試狗' }, { id: '', name: '沒編號' }] };

// 假 GitHub：photos 內容放在 files（路徑 → sha）；回傳所有呼叫紀錄
function fakeGithub({ files = {}, putStatus = [], dogsStatus = 200 } = {}) {
  const calls = [];
  mainStatus = dogsStatus;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    calls.push({ path: u.pathname, method, headers: init.headers || {}, body: init.body && JSON.parse(init.body) });
    const m = u.pathname.match(/^\/repos\/jiatsenK\/bq-shelter-dogs\/contents\/(.+)$/);
    if (!m) return new Response('no', { status: 404 });
    const path = m[1];
    if (path === 'data/dogs.json') return new Response(JSON.stringify(DOGS), { status: dogsStatus });
    if (method === 'GET') {
      return files[path] ? new Response(JSON.stringify({ sha: files[path] })) : new Response('{}', { status: 404 });
    }
    const status = putStatus.length ? putStatus.shift() : 200;
    if (status !== 200) return new Response('{}', { status });
    files[path] = 'new-sha';
    return new Response(JSON.stringify({ commit: { sha: 'c0ffee' } }), { status: 200 });
  };
  return calls;
}

function post(id, { body = JPEG.slice(), origin = ORIGIN, type = 'image/jpeg', ip = '1.1.1.1' } = {}) {
  const headers = { 'Content-Type': type, 'CF-Connecting-IP': ip, 'X-Editor': encodeURIComponent('小明') };
  if (origin) headers.Origin = origin;
  return new Request(`https://bq-shelter-photos.example.workers.dev/photos/${id}`, { method: 'POST', headers, body });
}

async function send(req, env = ENV) {
  const res = await worker.fetch(req, env);
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

test.beforeEach(() => resetState());

test('新照片：寫到 photos/{編號}.jpg，不帶 sha，回傳成功與 CORS', async () => {
  const calls = fakeGithub();
  const r = await send(post('2024032902'));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, id: '2024032902', replaced: false, commit: 'c0ffee' });
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const put = calls.find(c => c.method === 'PUT');
  assert.equal(put.path, '/repos/jiatsenK/bq-shelter-dogs/contents/photos/2024032902.jpg');
  assert.equal(put.body.sha, undefined);
  assert.equal(put.body.branch, 'main');
  assert.equal(put.body.content, Buffer.from(JPEG).toString('base64'));
  assert.match(put.body.message, /^上傳照片：photos\/2024032902\.jpg（測試狗）/);
  assert.equal(put.headers.Authorization, 'Bearer test-token');
});

test('已有照片：帶舊 sha 更換', async () => {
  const calls = fakeGithub({ files: { 'photos/2024032902.jpg': 'old-sha' } });
  const r = await send(post('2024032902'));
  assert.equal(r.body.replaced, true);
  const put = calls.find(c => c.method === 'PUT');
  assert.equal(put.body.sha, 'old-sha');
  assert.match(put.body.message, /^更換照片/);
});

test('同時有人更換（sha 對不上）會重讀再試一次', async () => {
  const calls = fakeGithub({ files: { 'photos/2024032902.jpg': 'old-sha' }, putStatus: [409] });
  const r = await send(post('2024032902'));
  assert.equal(r.status, 200);
  assert.equal(calls.filter(c => c.method === 'PUT').length, 2);
});

test('GitHub 寫入失敗：回錯誤，說原本照片不受影響', async () => {
  fakeGithub({ putStatus: [500] });
  const r = await send(post('2024032902'));
  assert.equal(r.status, 502);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /原本的照片不受影響/);
});

test('編號不在 dogs.json、格式不對：不寫入', async () => {
  const calls = fakeGithub();
  assert.equal((await send(post('9999999999'))).status, 404);
  assert.equal((await send(post('..%2Fdata%2Fdogs'))).status, 400);
  assert.equal((await send(post('abc.jpg'))).status, 400);
  assert.equal(calls.filter(c => c.method === 'PUT').length, 0);
});

test('dogs.json 讀不到：不寫入', async () => {
  const calls = fakeGithub({ dogsStatus: 500 });
  const r = await send(post('2024032902'));
  assert.equal(r.status, 502);
  assert.equal(calls.filter(c => c.method === 'PUT').length, 0);
});

test('只收 JPEG：型別不對、檔頭不對、空檔、太大都擋', async () => {
  const calls = fakeGithub();
  assert.equal((await send(post('2024032902', { type: 'image/png' }))).status, 415);
  assert.equal((await send(post('2024032902', { body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }))).status, 415);
  assert.equal((await send(post('2024032902', { body: new Uint8Array(0) }))).status, 400);
  const big = new Uint8Array(MAX_BYTES + 1); big.set(JPEG);
  assert.equal((await send(post('2024032902', { body: big }))).status, 413);
  assert.equal(calls.filter(c => c.method === 'PUT').length, 0);
});

test('只接受 GitHub Pages 網站：其他網站、沒有 Origin 都擋；預檢回 CORS', async () => {
  const calls = fakeGithub();
  const other = await send(post('2024032902', { origin: 'https://evil.example' }));
  assert.equal(other.status, 403);
  assert.equal(other.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await send(post('2024032902', { origin: '' }))).status, 403);
  const pre = await worker.fetch(new Request('https://w.example/photos/2024032902', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), ENV);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(calls.length, 0);
});

test('沒設 GITHUB_TOKEN：回「還沒設定好」；首頁顯示 token 有沒有設、不顯示內容', async () => {
  fakeGithub();
  const r = await send(post('2024032902'), { ALLOWED_ORIGINS: ORIGIN });
  assert.equal(r.status, 500);
  assert.match(r.body.error, /GITHUB_TOKEN/);
  const home = await send(new Request('https://w.example/'), ENV);
  assert.equal(home.body.token, '已設定');
  assert.ok(!JSON.stringify(home.body).includes('test-token'));
});

test('頻率限制：同一個 IP 1 分鐘最多 5 張，換 IP 不受影響；1 小時最多 30 張', async () => {
  fakeGithub();
  for (let i = 0; i < 5; i++) assert.equal((await send(post('2024032902'))).status, 200);
  const r = await send(post('2024032902'));
  assert.equal(r.status, 429);
  assert.match(r.body.error, /太頻繁/);
  assert.equal((await send(post('2024032902', { ip: '2.2.2.2' }))).status, 200);
  resetState();
  let t = 0;
  for (let i = 0; i < 30; i++, t += 61 * 1000) assert.equal(allowUpload('3.3.3.3', t), true);
  assert.equal(allowUpload('3.3.3.3', t), false);
  assert.equal(allowUpload('3.3.3.3', 60 * 60 * 1000 + 61 * 1000), true, '一小時後恢復');
});

test('isJpeg 看檔頭', () => {
  assert.equal(isJpeg(JPEG), true);
  assert.equal(isJpeg(new Uint8Array([0xff, 0xd8])), false);
});

const NENV = { ...ENV, ADMIN_KEY: '管理金鑰' };

// ── #95 誰遛的代號 ──
const WALKER_ENV = { ...ENV, WALKER_KEY: 'test-walker-key' };
// 跟 scripts/sync-sheet.test.mjs 的 WALKER_VECTORS 同一組：兩邊算出來要一樣
const WALKER_VECTORS = [
  ['測試志工我', 'ecdf46de08b4'],
  ['志工 B', '2569554f699b'],
  ['Ａｌｉｃｅ Chen', '0511a0a064fb'],
  ['alicechen', '0511a0a064fb'],
];
function postCode(body, { origin = ORIGIN, ip = '3.3.3.3', type = 'application/json' } = {}) {
  const headers = { 'Content-Type': type, 'CF-Connecting-IP': ip };
  if (origin) headers.Origin = origin;
  return new Request('https://bq-shelter-photos.example.workers.dev/walker-code', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

test('#95 代號算法跟同步腳本一樣（測試向量）', async () => {
  for (const [name, code] of WALKER_VECTORS) assert.equal(await worker.testing.walkerCode(name, 'test-walker-key'), code, name);
});

test('#95 POST /walker-code：多個名字換代號、去重、照試算表規則拆名字；不碰 GitHub', async () => {
  const calls = fakeGithub();
  const r = await send(postCode({ names: ['測試志工我', 'alicechen', 'ＡＬＩＣＥＣｈｅｎ', '志工 B'] }), WALKER_ENV);
  assert.equal(r.status, 200);
  const code = async n => worker.testing.walkerCode(n, 'test-walker-key');
  assert.deepEqual(r.body, { ok: true, codes: ['ecdf46de08b4', '0511a0a064fb', await code('志工'), await code('B')] });
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(calls.length, 0);
});

test('#95 POST /walker-code 擋掉：沒設定密鑰、空名字、太多、太長、格式不對、別的網站、太頻繁', async () => {
  fakeGithub();
  assert.equal((await send(postCode({ names: ['甲'] }), ENV)).status, 500);
  assert.equal((await send(postCode({ names: ['  '] }), WALKER_ENV)).status, 400);
  assert.equal((await send(postCode({ names: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h i'] }), WALKER_ENV)).status, 400);
  assert.equal((await send(postCode({ names: ['名'.repeat(21)] }), WALKER_ENV)).status, 400);
  assert.equal((await send(postCode({ names: '甲' }), WALKER_ENV)).status, 400);
  assert.equal((await send(postCode('not json'), WALKER_ENV)).status, 400);
  assert.equal((await send(postCode({ names: ['甲'] }, { type: 'text/plain' }), WALKER_ENV)).status, 415);
  assert.equal((await send(postCode({ names: ['甲'] }, { origin: 'https://evil.example' }), WALKER_ENV)).status, 403);
  const get = new Request('https://x.workers.dev/walker-code', { headers: { Origin: ORIGIN } });
  assert.equal((await send(get, WALKER_ENV)).status, 405);
  resetState();
  let last;
  for (let i = 0; i < 21; i++) last = await send(postCode({ names: ['甲'] }, { ip: '4.4.4.4' }), WALKER_ENV);
  assert.equal(last.status, 429);
});

test('#95 首頁狀態顯示代號密鑰設了沒', async () => {
  const r = await send(new Request('https://x.workers.dev/'), WALKER_ENV);
  assert.equal(r.body.walkerKey, '已設定');
  assert.equal((await send(new Request('https://x.workers.dev/'), ENV)).body.walkerKey, '未設定');
});

test('定時叫同步：POST workflow dispatch（main），GitHub 不是 204 或沒 token 就丟錯', async () => {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ path: new URL(url).pathname, method: init.method, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  };
  const waits = [];
  await worker.scheduled({}, ENV, { waitUntil: p => waits.push(p) });
  assert.equal(await waits[0], 204);
  assert.deepEqual(calls.map(c => [c.method, c.path]), [['POST', '/repos/jiatsenK/bq-shelter-dogs/actions/workflows/sync-sheet.yml/dispatches']]);
  assert.deepEqual(calls[0].body, { ref: 'main' });
  assert.equal(calls[0].headers.Authorization, 'Bearer test-token');

  globalThis.fetch = async () => new Response('{}', { status: 403 });
  await assert.rejects(worker.testing.triggerSync(ENV), /GitHub 403/);
  await assert.rejects(worker.testing.triggerSync({}), /GITHUB_TOKEN/);
});

test('POST /sync：網站按「更新」叫同步；同一個人 2 分鐘 1 次；GitHub 失敗回 502；別的網站、GET 擋掉', async () => {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => { calls.push([init.method, new URL(url).pathname]); return new Response(null, { status: 204 }); };
  const req = (ip = '5.5.5.5', method = 'POST', origin = ORIGIN) => new Request('https://x.workers.dev/sync', { method, headers: { Origin: origin, 'CF-Connecting-IP': ip } });
  let r = await send(req());
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.deepEqual(calls, [['POST', '/repos/jiatsenK/bq-shelter-dogs/actions/workflows/sync-sheet.yml/dispatches']]);
  assert.equal((await send(req())).status, 429);
  assert.equal(calls.length, 1, '太頻繁不叫 GitHub');
  assert.equal((await send(req('6.6.6.6', 'GET'))).status, 405);
  assert.equal((await send(req('6.6.6.6', 'POST', 'https://evil.example'))).status, 403);
  globalThis.fetch = async () => new Response('{}', { status: 403 });
  r = await send(req('7.7.7.7'));
  assert.equal(r.status, 502);
  assert.match(r.body.error || r.body.message || JSON.stringify(r.body), /GitHub 403/);
});

// ---- 網站和 Worker 合在一起（#125）：API 在 /api 底下，其他路徑交給網站檔案 ----

const SITE = 'https://bq-shelter-dogs.example.workers.dev';
const fakeAssets = () => {
  const seen = [];
  return { seen, fetch: async req => { seen.push(new URL(req.url).pathname); return new Response('檔案', { status: 200 }); } };
};

test('#125 /api 前綴：/api/ 顯示服務狀態、/api/ 顯示狀態，管理金鑰仍保留', async () => {
  fakeGithub();
  const home = await send(new Request(`${SITE}/api/`), NENV);
  assert.equal(home.body.ok, true);
  assert.equal(home.body.adminKey, '已設定');
  assert.equal((await send(new Request(`${SITE}/api`), NENV)).body.ok, true);

});

test('#125 同網址：送資料帶自己的 Origin、讀取只帶 Sec-Fetch-Site 都接受；別的網站、什麼都沒帶照樣擋', async () => {
  fakeGithub();
  const read = await send(new Request(`${SITE}/api/rest`, { headers: { 'Sec-Fetch-Site': 'same-origin' } }), NENV);
  assert.equal(read.status, 200);
  const write = await send(new Request(`${SITE}/api/walker-code`, {
    method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json' }, body: JSON.stringify({ names: ['測試'] }),
  }), NENV);
  assert.equal(write.status, 500); // 未設 WALKER_KEY，來源驗證已通過
  assert.equal((await send(new Request(`${SITE}/api/rest`), NENV)).status, 403);
  assert.equal((await send(new Request(`${SITE}/api/rest`, { headers: { 'Sec-Fetch-Site': 'cross-site' } }), NENV)).status, 403);
  assert.equal((await send(new Request(`${SITE}/api/rest`, { headers: { Origin: 'https://evil.example' } }), NENV)).status, 403);
  // 別的網站假裝 Sec-Fetch-Site 也沒用：有 Origin 就看 Origin
  assert.equal((await send(new Request(`${SITE}/api/rest`, { headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'same-origin' } }), NENV)).status, 403);
});

test('#125 合在一起時：不是 /api 的 GET 交給網站檔案（找不到的 404 也由網站處理），不當成 API', async () => {
  const assets = fakeAssets();
  const env = { ...NENV, ASSETS: assets };
  const res = await worker.fetch(new Request(`${SITE}/nope.html`), env);
  assert.equal(await res.text(), '檔案');
  assert.deepEqual(assets.seen, ['/nope.html']);
  // /api 底下照樣是 API
  const home = await send(new Request(`${SITE}/api/`), env);
  assert.equal(home.body.ok, true);
  assert.deepEqual(assets.seen, ['/nope.html']);
});

test('#125 /api/photos/{編號}：跟舊路徑一樣寫到 photos/{編號}.jpg', async () => {
  const calls = fakeGithub();
  const req = new Request(`${SITE}/api/photos/2024032902`, { method: 'POST', headers: { Origin: SITE, 'Content-Type': 'image/jpeg', 'CF-Connecting-IP': '9.9.9.9', 'X-Editor': encodeURIComponent('小明') }, body: JPEG.slice() });
  const r = await send(req);
  assert.equal(r.status, 200);
  assert.ok(calls.some(c => c.method === 'PUT' && c.path.endsWith('/contents/photos/2024032902.jpg')));
});

// ---- PR 預覽版（#126）：可以看、可以讀，不能改正式資料 ----

test('#126 預覽版：上傳、備註、更新都回 403 且不碰 GitHub；讀取和換代號照常', async () => {
  const PENV = { ...NENV, WALKER_KEY: 'k', PREVIEW: '1' };
  const calls = fakeGithub();
  const h = { Origin: SITE, 'Content-Type': 'application/json' };
  const writes = [
    new Request(`${SITE}/api/photos/2024032902`, { method: 'POST', headers: { Origin: SITE, 'Content-Type': 'image/jpeg' }, body: JPEG.slice() }),
    new Request(`${SITE}/api/rest/2024032902`, { method: 'PUT', headers: h, body: JSON.stringify({ text: 'x', editor: '小明' }) }),
    new Request(`${SITE}/api/sync`, { method: 'POST', headers: h }),
  ];
  for (const req of writes) {
    const r = await send(req, PENV);
    assert.equal(r.status, 403, req.url);
    assert.match(r.body.error, /預覽版/);
  }
  assert.equal(calls.length, 0);
  assert.equal((await send(new Request(`${SITE}/api/rest`, { headers: { Origin: SITE } }), PENV)).status, 200);
  const codes = await send(new Request(`${SITE}/api/walker-code`, { method: 'POST', headers: h, body: JSON.stringify({ names: ['測試'] }) }), PENV);
  assert.equal(codes.status, 200);
  assert.equal((await send(new Request(`${SITE}/api/`), PENV)).body.preview, '預覽版，不能存');
  assert.equal((await send(new Request(`${SITE}/api/`), NENV)).body.preview, undefined);
});

// ── #138 按「溜了」寫進試算表 ──
const SHEET_ENV = { ...ENV, SHEET_WRITE_URL: 'https://script.example/exec', SHEET_WRITE_KEY: 'sheet-key' };
function postWalk(body, { origin = ORIGIN, ip = '4.4.4.4', type = 'application/json' } = {}) {
  const headers = { 'Content-Type': type, 'CF-Connecting-IP': ip };
  if (origin) headers.Origin = origin;
  return new Request('https://bq-shelter-photos.example.workers.dev/walk', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
}
function fakeScript(reply = req => ({ ok: true, today: '2026-10-04', results: req.dogs.map(d => ({ ...d, status: 'written' })) }), status = 200) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), method: init.method, body });
    return new Response(JSON.stringify(reply(body)), { status });
  };
  return calls;
}

test('#138 POST /walk：帶金鑰轉給小程式，回傳每隻狗的結果；不碰 GitHub', async () => {
  const calls = fakeScript();
  const r = await send(postWalk({ action: 'walk', walker: ' 志工我 ', dogs: [{ id: '9001', name: '測試甲' }, { id: '', name: '測試丙' }] }), SHEET_ENV);
  assert.equal(r.status, 200);
  assert.deepEqual(calls.map(c => [c.url, c.method]), [['https://script.example/exec', 'POST']]);
  assert.deepEqual(calls[0].body, { key: 'sheet-key', action: 'walk', dogs: [{ id: '9001', name: '測試甲' }, { id: '', name: '測試丙' }], walker: '志工我' });
  assert.deepEqual(r.body.results.map(x => x.status), ['written', 'written']);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('#138 POST /walk 復原：只帶 prev／wrote 過去，不用名字', async () => {
  const calls = fakeScript();
  const dog = { id: '9001', name: '測試甲', prev: { date: { date: '2026-10-01' }, walker: '志工乙' }, wrote: { walker: '志工我' }, extra: 'x' };
  const r = await send(postWalk({ action: 'undo', dogs: [dog] }), SHEET_ENV);
  assert.equal(r.status, 200);
  assert.deepEqual(calls[0].body, { key: 'sheet-key', action: 'undo', dogs: [{ id: '9001', name: '測試甲', prev: { date: { date: '2026-10-01' }, walker: '志工乙' }, wrote: { walker: '志工我' } }] });
});

test('#138 POST /walk 擋掉：沒設定、格式不對、名字太長、太多隻、別的網站、預覽版；小程式說金鑰不對', async () => {
  const calls = fakeScript();
  const ok = { action: 'walk', walker: '我', dogs: [{ id: '1', name: '甲' }] };
  const off = await send(postWalk(ok), ENV);
  assert.deepEqual([off.status, off.body.code], [503, 'off']);
  assert.equal((await send(postWalk({ ...ok, action: 'x' }), SHEET_ENV)).status, 400);
  assert.equal((await send(postWalk({ ...ok, walker: '名'.repeat(21) }), SHEET_ENV)).status, 400);
  assert.equal((await send(postWalk({ ...ok, walker: '' }), SHEET_ENV)).status, 400);
  assert.equal((await send(postWalk({ ...ok, dogs: Array.from({ length: 11 }, (_, i) => ({ id: String(i), name: '甲' })) }), SHEET_ENV)).status, 400);
  assert.equal((await send(postWalk({ ...ok, dogs: [{ id: '../x', name: '甲' }] }), SHEET_ENV)).status, 400);
  assert.equal((await send(postWalk({ action: 'undo', dogs: [{ id: '1', name: '甲' }] }), SHEET_ENV)).status, 400);
  assert.equal((await send(postWalk('nope'), SHEET_ENV)).status, 400);
  assert.equal((await send(postWalk(ok, { type: 'text/plain' }), SHEET_ENV)).status, 415);
  assert.equal((await send(postWalk(ok, { origin: 'https://evil.example' }), SHEET_ENV)).status, 403);
  assert.equal((await send(postWalk(ok), { ...SHEET_ENV, PREVIEW: '1' })).status, 403);
  assert.equal(calls.length, 0);
  fakeScript(() => ({ ok: false, code: 'key', error: '金鑰不對' }));
  const bad = await send(postWalk(ok), SHEET_ENV);
  assert.equal(bad.status, 502);
  assert.match(bad.body.error, /金鑰/);
  globalThis.fetch = async () => { throw new TypeError('down'); };
  assert.equal((await send(postWalk(ok), SHEET_ENV)).status, 502);
});

test('#138 POST /walk 沒設通關碼也能用，不帶 key 過去', async () => {
  const calls = fakeScript();
  const env = { ...ENV, SHEET_WRITE_URL: 'https://script.example/exec' };
  const r = await send(postWalk({ action: 'walk', walker: '我', dogs: [{ id: '1', name: '甲' }] }, { ip: '6.6.6.6' }), env);
  assert.equal(r.status, 200);
  assert.equal('key' in calls[0].body, false);
  assert.equal((await send(new Request('https://bq-shelter-photos.example.workers.dev/'), env)).body.sheetWrite, '已設定');
});

test('#138 POST /walk 太頻繁就擋', async () => {
  fakeScript();
  const ok = { action: 'walk', walker: '我', dogs: [{ id: '1', name: '甲' }] };
  for (let i = 0; i < 30; i++) assert.equal((await send(postWalk(ok, { ip: '5.5.5.5' }), SHEET_ENV)).status, 200);
  assert.equal((await send(postWalk(ok, { ip: '5.5.5.5' }), SHEET_ENV)).status, 429);
});

test('#138 POST /walk：小程式的原始錯誤不把試算表 ID 顯示給志工', async () => {
  const ok = { action: 'walk', walker: '我', dogs: [{ id: '1', name: '甲' }] };
  const id = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';
  const cases = [
    ['小程式發生錯誤：Illegal spreadsheet id or key: ' + id, /試算表 ID 不對/],
    ['小程式發生錯誤：You do not have permission to access ' + id, /權限/],
    ['小程式發生錯誤：Something odd ' + id, /執行紀錄/],
    ['主清單找不到「誰遛的」欄', /主清單找不到「誰遛的」欄/],
  ];
  for (const [i, [error, want]] of cases.entries()) {
    fakeScript(() => ({ ok: false, error }));
    const r = await send(postWalk(ok, { ip: `7.7.7.${i}` }), SHEET_ENV);
    assert.equal(r.status, 502);
    assert.match(r.body.error, want);
    assert.doesNotMatch(r.body.error, /AbCdEf/);
  }
});

// ── #141 GET /walkers：Worker 讀試算表主清單的「誰遛的」，名字不進 repo ──
// gviz 回應：第一次 headers=0（表頭在第 2 列、編號欄是數字型，表頭文字讀成空的），第二次 headers=2 有欄位標題
function gviz(table) { return `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table })});`; }
const cell = v => (v == null ? null : { v });
function fakeSheet() {
  const calls = [];
  globalThis.fetch = async url => {
    const u = new URL(url);
    calls.push(u.searchParams.get('headers'));
    if (u.searchParams.get('headers') === '0') {
      return new Response(gviz({ cols: [{}, {}, {}, {}], rows: [
        { c: [cell('板收溜狗表'), null, null, null] },
        { c: [cell('籠位'), null, cell('犬名'), cell('誰遛的')] },
        { c: [cell('舊A20'), cell(2025072001), cell('天狼星'), cell('嘉文+俐葶+岑')] },
      ] }));
    }
    return new Response(gviz({ cols: [{ label: '籠位' }, { label: '編號' }, { label: '犬名' }, { label: '誰遛的' }], rows: [
      { c: [cell('舊A20'), cell(2025072001), cell('天狼星'), cell('嘉文+俐葶+岑')] },
      { c: [cell('舊B03'), cell(2026060101), cell('甜甜'), cell('維芬。嘉文')] },
      { c: [cell('C區1'), null, cell('新來的'), cell('喬筠')] },
      { c: [cell('舊B04'), cell(2026042902), cell('方吉'), null] },
      { c: [null, null, cell('今天週六'), cell('備註')] },
    ] }));
  };
  return calls;
}
const getWalkers = (env, origin = 'https://bq-shelter-dogs.jiatsen-k.workers.dev') =>
  send(new Request('https://bq-shelter-dogs.jiatsen-k.workers.dev/api/walkers', { headers: { Origin: origin } }), env);

test('#141 GET /walkers：分兩次讀主清單，回每隻狗的誰遛的（key 跟網站 walkKey 一樣）和名字清單；5 分鐘內用快取', async () => {
  const calls = fakeSheet();
  const { status, body } = await getWalkers({ SHEET_ID: 'abc' });
  assert.equal(status, 200);
  assert.deepEqual(body.walkers, { 2025072001: '嘉文+俐葶+岑', 2026060101: '維芬。嘉文', '名:新來的': '喬筠' });
  assert.deepEqual(body.names, ['嘉文', '俐葶', '岑', '喬筠', '維芬'].sort((a, b) => (a === '嘉文' ? -1 : b === '嘉文' ? 1 : a.localeCompare(b, 'zh-Hant'))));
  assert.deepEqual(calls, ['0', '2']);
  await getWalkers({ SHEET_ID: 'abc' });
  assert.equal(calls.length, 2, '第二次用快取');
});

test('K 2026-10-12 GET /walkers：有 WALKER_KEY 時多回 codes（代號 → 名字），電腦版最近 30 天寫每天誰遛的；沒密鑰回空的', async () => {
  fakeSheet();
  const { body } = await getWalkers({ SHEET_ID: 'abc', WALKER_KEY: 'test-walker-key' });
  for (const n of body.names) assert.equal(body.codes[await worker.testing.walkerCode(n, 'test-walker-key')], n, n);
  assert.equal(Object.keys(body.codes).length, body.names.length);
  resetState();
  fakeSheet();
  assert.deepEqual((await getWalkers({ SHEET_ID: 'abc' })).body.codes, {});
});

test('#141 GET /walkers：沒設 SHEET_ID 回 off；讀不到回 502；只收 GET', async () => {
  assert.deepEqual((await getWalkers({})).body, { ok: false, code: 'off', error: '還沒設定試算表' });
  globalThis.fetch = async () => new Response('', { status: 500 });
  assert.equal((await getWalkers({ SHEET_ID: 'abc' })).status, 502);
  const res = await send(new Request('https://bq-shelter-dogs.jiatsen-k.workers.dev/api/walkers', { method: 'POST', headers: { Origin: 'https://bq-shelter-dogs.jiatsen-k.workers.dev' } }), { SHEET_ID: 'abc' });
  assert.equal(res.status, 405);
});


test('#141 POST /walk 修改：必須帶原始名單快照；通過既有來源與預覽限制', async () => {
  const calls = fakeScript();
  const body = { action: 'edit', walker: '志工我、志工乙', dogs: [{ id: '9001', name: '測試甲', expected: '志工我' }] };
  assert.equal((await send(postWalk(body), SHEET_ENV)).status, 200);
  assert.equal(calls[0].body.action, 'edit');
  assert.equal(calls[0].body.dogs[0].expected, '志工我');
  assert.equal((await send(postWalk({ ...body, dogs: [{ id: '9001', name: '測試甲' }] }), SHEET_ENV)).status, 400);
  assert.equal((await send(postWalk(body, { origin: 'https://evil.example' }), SHEET_ENV)).status, 403);
  const req = new Request(`${SITE}/api/walk`, { method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await send(req, { ...SHEET_ENV, PREVIEW: '1' })).status, 403);
  assert.equal(calls.length, 1);
});

test('舊網址拿掉後：沒設 ALLOWED_ORIGINS 時，舊網址 github.io 送來的要求一律擋，同網址照常', async () => {
  fakeGithub();
  const env = { GITHUB_TOKEN: 'test-token' };
  assert.equal((await send(new Request(`${SITE}/api/rest`, { headers: { Origin: 'https://jiatsenk.github.io' } }), env)).status, 403);
  assert.equal((await send(new Request(`${SITE}/api/rest`, { headers: { Origin: SITE } }), env)).status, 503);
});
// 資料庫（狀態頁、開卡、名字推薦、GET /api/dogs）的測試在 worker/test/d1-read.test.mjs（#247）

test('#252 備註已退役：新舊路徑都不讀寫 GitHub，即使有帶名字', async () => {
  const calls = fakeGithub();
  for (const path of ['/notes', '/notes/2024032902', '/api/notes', '/api/notes/2024032902']) {
    for (const method of ['GET','PUT']) {
      const r = await send(new Request(`https://w.example${path}`, { method, headers: { Origin: ORIGIN }, ...(method === 'PUT' ? { body: JSON.stringify({ text: 'x', editor: '小明' }) } : {}) }), ENV);
      assert.equal(r.status, 410);
    }
  }
  assert.equal(calls.length, 0);
});
