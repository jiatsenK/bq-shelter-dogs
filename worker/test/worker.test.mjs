import { currentEditRevision } from './edit-fixture.mjs';
import { importCompactDogs } from '../../scripts/import-compact-dogs.mjs';
// 照片上傳服務的測試（#47）：用假的 GitHub API，不會真的連 GitHub 或 Cloudflare
// 執行：node --test worker/test/worker.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { SETTING_KEYS } from '../src/feature-settings.js';
import { fakeD1, fakeR2 } from './fakes.mjs';
import { migrateCompactDatabase } from '../../scripts/migrate-compact-db.mjs';

const { resetState, allowUpload, isJpeg, MAX_BYTES } = worker.testing;

// 測試用另一個網址，用 ALLOWED_ORIGINS 放行（正式網站跟 Worker 同網址，不用設）
const ORIGIN = 'https://allowed.example';
let mainStatus = 200;
const DB = { prepare: sql => sql.includes('v3_feature_settings') ? { first: async () => ({ revision: 1, values_json: JSON.stringify(Object.fromEntries(SETTING_KEYS.map(key => [key,true]))) }) } : sql.includes('v3_walk_state') ? { bind() { return this; }, first: async () => null } : ({ all: async () => { if (mainStatus !== 200) throw new Error('D1 read failed'); return { results: DOGS.dogs.filter(d => d.id).map(d => ({ number: d.id, name: d.name })) }; } }) };
const ENV = { ALLOWED_ORIGINS: ORIGIN, DB };
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

async function photoStorage() {
  const DB=fakeD1();await migrateCompactDatabase(DB);await importCompactDogs(DB,DOGS);
  return {...ENV,DB,PHOTOS:fakeR2()};
}
async function send(req, env = ENV) {
  if(env.PHOTOS&&req.method==='POST'&&new URL(req.url).pathname.includes('/photos/')) {
    const headers=new Headers(req.headers);headers.set('X-Dog-Revision',String(await currentEditRevision(env.DB,new URL(req.url).pathname)));
    req=new Request(req,{headers});
  }
  const res = await worker.fetch(req, env);
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

test.beforeEach(() => resetState());

test('#566 照片只能透過 R2／D1 可靠流程，缺 R2 不退回 GitHub 寫入',async()=>{
  const calls=fakeGithub();const result=await send(post('2024032902'));
  assert.equal(result.status,503);assert.equal(result.body.code,'off');assert.deepEqual(calls,[]);
});
test('#566 原圖-only 舊用戶端、JPEG 驗證與狗身分仍強制執行',async()=>{
  const calls=fakeGithub(),env=await photoStorage();
  try {
    const r=await send(post('2024032902'),env);assert.equal(r.status,200);assert.match(r.body.path,/^photos\/[a-f0-9]{32}\.jpg$/);assert.deepEqual(calls,[]);
    assert.equal((await send(post('9999999999'),env)).status,404);
    assert.equal((await send(post('abc.jpg'),env)).status,400);
    assert.equal((await send(post('2024032902',{type:'image/png'}),env)).status,415);
    assert.equal((await send(post('2024032902',{body:new Uint8Array([0x89,0x50])}),env)).status,415);
    assert.equal((await send(post('2024032902',{body:new Uint8Array(0)}),env)).status,400);
    resetState();const big=new Uint8Array(MAX_BYTES+1);big.set(JPEG);
    assert.equal((await send(post('2024032902',{body:big}),env)).status,413);
  }finally{env.DB.close();}
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

test('缺 R2 不寫；首頁顯示金鑰有沒有設、不顯示內容，也不再有 GitHub token 欄（#547）', async () => {
  fakeGithub();
  const r = await send(post('2024032902'), { ALLOWED_ORIGINS: ORIGIN, DB });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'off');
  const home = await send(new Request('https://w.example/'), { ...ENV, ADMIN_KEY: 'admin-secret' });
  assert.equal(home.body.adminKey, '已設定');
  assert.equal('token' in home.body, false);
  assert.ok(!JSON.stringify(home.body).includes('admin-secret'));
});

test('頻率限制：同一個 IP 1 分鐘最多 5 張，換 IP 不受影響；1 小時最多 30 張', async () => {
  fakeGithub();
  const photoEnv=await photoStorage();
  for (let i = 0; i < 5; i++) assert.equal((await send(post('2024032902'),photoEnv)).status, 200);
  const r = await send(post('2024032902'),photoEnv);
  assert.equal(r.status, 429);
  assert.match(r.body.error, /太頻繁/);
  assert.equal((await send(post('2024032902', { ip: '2.2.2.2' }),photoEnv)).status, 200);
  photoEnv.DB.close();
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
// 讀資料包要有版本號表（ADR 0009，讀不到不退回整表讀取）
const withTables = async env => { const DB = fakeD1(); await migrateCompactDatabase(DB); return { ...env, DB }; };

// ── #95 誰遛的代號 ──
const WALKER_ENV = { ...ENV, WALKER_KEY: 'test-walker-key' };
// 固定的測試向量：D1 裡舊的代號都是這樣算的，算法改了就對不上
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

// #595：志工名字建議讀 D1（#519），首頁不再顯示試算表 ID；照片沒有 GitHub 退路（#547）
test('#595 首頁狀態不顯示 SHEET_ID，照片沒接 R2 顯示未設定', async () => {
  const body = (await send(new Request('https://x.workers.dev/'), { ...ENV, SHEET_ID: 'sheet' })).body;
  assert.equal(Object.hasOwn(body, 'walkerNames'), false);
  assert.equal(body.photos, '未設定');
});

// #512：狗清單由 GAS 編輯觸發送列，舊的「試算表有改」通知與「更新」空殼都移除了
test('#512 /sync、/sheet-changed 已移除；排程不叫 GitHub、不讀試算表', async () => {
  const env = await withTables({ ...ENV, SHEET_ID: 'sheet' });
  const calls = [];
  globalThis.fetch = async url => { calls.push(String(url)); return new Response(null, { status: 204 }); };
  // 舊 Apps Script 沒帶網站來源，跟其他不認得的要求一樣擋掉
  const notify = await send(new Request('https://x.workers.dev/api/sheet-changed', { method: 'POST' }), env);
  assert.equal(notify.status, 403);
  // 舊版網頁還開著時按「更新」：請它重新整理
  const press = await send(new Request('https://x.workers.dev/sync', { method: 'POST', headers: { Origin: ORIGIN, 'CF-Connecting-IP': '5.5.5.5' } }), env);
  assert.deepEqual([press.status, press.body.error], [410, '更新方式改了，請重新整理網頁']);
  assert.deepEqual(calls, []);
  for (const iso of ['2026-10-16T02:00:00Z', '2026-10-16T22:30:00Z']) {
    const waits = [];
    await worker.scheduled({ scheduledTime: new Date(iso).getTime() }, env, { waitUntil: p => waits.push(p) });
    await Promise.all(waits);
  }
  assert.deepEqual(calls, []);
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
  const read = await send(new Request(`${SITE}/api/rest`, { headers: { 'Sec-Fetch-Site': 'same-origin' } }), await withTables(NENV));
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

test('#125 /api/photos/{編號}：共用可靠 R2 流程', async () => {
  const calls = fakeGithub();
  const req = new Request(`${SITE}/api/photos/2024032902`, { method: 'POST', headers: { Origin: SITE, 'Content-Type': 'image/jpeg', 'CF-Connecting-IP': '9.9.9.9', 'X-Editor': encodeURIComponent('小明') }, body: JPEG.slice() });
  const env=await photoStorage();
  try{const r=await send(req,env);assert.equal(r.status,200);assert.ok(env.PHOTOS.objects.has(r.body.path));assert.deepEqual(calls,[]);}finally{env.DB.close();}
});

// ---- PR 預覽版（#126）：可以看、可以讀，不能改正式資料 ----

test('#126 預覽版：上傳、備註、更新都回 403 且不碰 GitHub；讀取和換代號照常', async () => {
  const PENV = { ...NENV, WALKER_KEY: 'k', PREVIEW: '1' };
  const calls = fakeGithub();
  const h = { Origin: SITE, 'Content-Type': 'application/json' };
  const writes = [
    new Request(`${SITE}/api/photos/2024032902`, { method: 'POST', headers: { Origin: SITE, 'Content-Type': 'image/jpeg' }, body: JPEG.slice() }),
    new Request(`${SITE}/api/rest/2024032902`, { method: 'PUT', headers: h, body: JSON.stringify({ text: 'x', editor: '小明' }) }),
  ];
  for (const req of writes) {
    const r = await send(req, PENV);
    assert.equal(r.status, 403, req.url);
    assert.match(r.body.error, /預覽版/);
  }
  assert.equal(calls.length, 0);
  assert.equal((await send(new Request(`${SITE}/api/rest`, { headers: { Origin: SITE } }), await withTables(PENV))).status, 200);
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

// #558：溜了／修改／復原只走 D1 接受流程（帶 requestId，見 walk-accept.test.mjs）；沒帶的舊版回 410，細節在 today.test.mjs。
// 這裡留下備註、異動紀錄（仍轉給小程式）共用的擋法與錯誤處理
test('#138 POST /walk 備註：帶金鑰轉給小程式，回傳結果；不碰 GitHub', async () => {
  const calls = fakeScript();
  const r = await send(postWalk({ action: 'note', walker: ' 志工我 ', text: '很乖', dogs: [{ id: '9001', name: '測試甲' }] }), SHEET_ENV);
  assert.equal(r.status, 200);
  assert.deepEqual(calls.map(c => [c.url, c.method]), [['https://script.example/exec', 'POST']]);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('#138 POST /walk 擋掉：沒設定、格式不對、名字太長、太多隻、別的網站、預覽版；小程式說金鑰不對', async () => {
  const calls = fakeScript();
  const ok = { action: 'note', walker: '我', text: '乖', dogs: [{ id: '1', name: '甲' }] };
  const off = await send(postWalk(ok), ENV);
  assert.deepEqual([off.status, off.body.code], [503, 'off']);
  assert.equal((await send(postWalk({ ...ok, action: 'x' }), SHEET_ENV)).status, 400);
  assert.equal((await send(postWalk({ ...ok, walker: '名'.repeat(21) }), SHEET_ENV)).status, 400);
  assert.equal((await send(postWalk({ ...ok, dogs: [{ id: '1', name: '甲' }, { id: '2', name: '乙' }] }), SHEET_ENV)).status, 400);
  assert.equal((await send(postWalk({ ...ok, dogs: [{ id: '../x', name: '甲' }] }), SHEET_ENV)).status, 400);
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
  const r = await send(postWalk({ action: 'note', walker: '我', text: '乖', dogs: [{ id: '1', name: '甲' }] }, { ip: '6.6.6.6' }), env);
  assert.equal(r.status, 200);
  assert.equal('key' in calls[0].body, false);
  assert.equal((await send(new Request('https://bq-shelter-photos.example.workers.dev/'), env)).body.sheetWrite, '已設定');
});

test('#138 POST /walk 太頻繁就擋（舊版溜了的 410 也算次數）', async () => {
  fakeScript();
  const ok = { action: 'note', walker: '我', text: '乖', dogs: [{ id: '1', name: '甲' }] };
  for (let i = 0; i < 29; i++) assert.equal((await send(postWalk(ok, { ip: '5.5.5.5' }), SHEET_ENV)).status, 200);
  assert.equal((await send(postWalk({ action: 'walk', walker: '我', dogs: [{ id: '1', name: '甲' }] }, { ip: '5.5.5.5' }), SHEET_ENV)).status, 410);
  assert.equal((await send(postWalk(ok, { ip: '5.5.5.5' }), SHEET_ENV)).status, 429);
});

test('#138 POST /walk：小程式的原始錯誤不把試算表 ID 顯示給志工', async () => {
  const ok = { action: 'note', walker: '我', text: '乖', dogs: [{ id: '1', name: '甲' }] };
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

// #141 GET /walkers 的測試在 walkers-d1.test.mjs（#519 起從 D1 讀）

test('舊網址拿掉後：沒設 ALLOWED_ORIGINS 時，舊網址 github.io 送來的要求一律擋，同網址照常', async () => {
  fakeGithub();
  const env = {};
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

test('#281 POST /walk 加備註、新增異動紀錄：轉給小程式；沒名字、沒內容、換行、多隻狗都擋', async () => {
  const calls = fakeScript();
  const note = await send(postWalk({ action: 'note', walker: ' 志工我 ', text: ' 很乖 ', dogs: [{ id: '9001', name: '測試甲' }] }), SHEET_ENV);
  assert.equal(note.status, 200);
  assert.deepEqual(calls[0].body, { key: 'sheet-key', action: 'note', dogs: [{ id: '9001', name: '測試甲' }], walker: '志工我', text: '很乖' });
  const log = await send(postWalk({ action: 'log', walker: '志工我', text: '移籠', dogs: [{ id: '1', name: '甲' }] }), SHEET_ENV);
  assert.equal(log.status, 200);
  assert.deepEqual(calls[1].body, { key: 'sheet-key', action: 'log', dogs: [], walker: '志工我', text: '移籠' });
  const ok = { action: 'note', walker: '我', text: '乖', dogs: [{ id: '1', name: '甲' }] };
  for (const bad of [{ walker: '' }, { text: ' ' }, { text: 'a\nb' }, { text: 'x'.repeat(201) }, { dogs: [{ id: '1', name: '甲' }, { id: '2', name: '乙' }] }]) {
    assert.equal((await send(postWalk({ ...ok, ...bad }, { ip: '7.7.7.' + calls.length }), SHEET_ENV)).status, 400, JSON.stringify(bad));
  }
  assert.equal(calls.length, 2);
});

// #333 出入所紀錄 PUT /stays/{編號}：路由層的擋法（方法、格式、大小、沒接 D1、限流、D1 出錯）
test('出入所紀錄路由：405、415、413、壞 JSON、沒接 D1、限流 429、D1 出錯回 500', async () => {
  const { migrateCompactDatabase } = await import('../../scripts/migrate-compact-db.mjs');
  const { importCompactDogs } = await import('../../scripts/import-compact-dogs.mjs');
  resetState();
  const db = fakeD1();
  await migrateCompactDatabase(db);
  await importCompactDogs(db, { syncedAt: '2026-10-15T12:00:00+08:00', dogs: [{ id: '2024032902', name: '測試狗' }] });
  const env = { ALLOWED_ORIGINS: ORIGIN, DB: db, WALKER_KEY: 'k' };
  const put = ({ method = 'PUT', type = 'application/json', body = JSON.stringify({ editor: '小明', before: [], stays: [] }), ip = '9.9.9.1' } = {}) =>
    new Request('https://w.example/stays/2024032902', { method, headers: { Origin: ORIGIN, 'Content-Type': type, 'CF-Connecting-IP': ip }, body: method === 'GET' ? undefined : body });
  const status = async (r, e = env) => (await worker.fetch(r, e)).status;
  assert.equal(await status(put({ method: 'POST' })), 405);
  assert.equal(await status(put({ method: 'GET' })), 405);
  assert.equal(await status(put({ type: 'text/plain' })), 415);
  assert.equal(await status(put({ body: 'x'.repeat(16001) })), 413);
  assert.equal(await status(put({ body: '{' })), 400);
  assert.equal(await status(put(), { ALLOWED_ORIGINS: ORIGIN, WALKER_KEY: 'k' }), 503);
  let last;
  for (let i = 0; i < 11; i++) last = await status(put({ ip: '9.9.9.2' }));
  assert.equal(last, 429);
  const broken = { ...env, DB: { prepare() { throw new Error('D1 壞了'); } } };
  assert.equal(await status(put({ ip: '9.9.9.3' }), broken), 503);
});
