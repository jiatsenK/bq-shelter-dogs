// 照片上傳服務的測試（#47）：用假的 GitHub API，不會真的連 GitHub 或 Cloudflare
// 執行：node --test worker/test/worker.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../src/index.js';

const { resetState, allowUpload, isJpeg, MAX_BYTES } = worker.testing;

// 測試用另一個網址，用 ALLOWED_ORIGINS 放行（正式網站跟 Worker 同網址，不用設）
const ORIGIN = 'https://allowed.example';
const ENV = { GITHUB_TOKEN: 'test-token', ALLOWED_ORIGINS: ORIGIN };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const DOGS = { dogs: [{ id: '2024032902', name: '測試狗' }, { id: '', name: '沒編號' }] };

// 假 GitHub：photos 內容放在 files（路徑 → sha）；回傳所有呼叫紀錄
function fakeGithub({ files = {}, putStatus = [], dogsStatus = 200 } = {}) {
  const calls = [];
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
  const headers = { 'Content-Type': type, 'CF-Connecting-IP': ip };
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

// ---- 我的備註（#61）----

const NENV = { GITHUB_TOKEN: 'test-token', ALLOWED_ORIGINS: ORIGIN, NOTES_PASSCODE: '對的通關碼' };
const NOTES_API = '/repos/jiatsenK/bq-shelter-dogs/contents/data/my-notes.json';

// 假 GitHub：data/my-notes.json 放在 store（text 是檔案內容，null 表示還沒有這個檔）
function fakeNotesGithub({ text = null, putStatus = [], getStatus = 200, api = NOTES_API } = {}) {
  const store = { text, sha: text === null ? null : 'sha-0', n: 0 };
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    calls.push({ path: u.pathname, method, body: init.body && JSON.parse(init.body) });
    if (u.pathname.endsWith('/contents/data/dogs.json')) return new Response(JSON.stringify(DOGS));
    if (u.pathname !== api) return new Response('no', { status: 404 });
    if (method === 'GET') {
      if (getStatus !== 200) return new Response('{}', { status: getStatus });
      if (store.text === null) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify({ sha: store.sha, content: Buffer.from(store.text).toString('base64') }));
    }
    const status = putStatus.length ? putStatus.shift() : 200;
    if (status !== 200) return new Response('{}', { status });
    const body = JSON.parse(init.body);
    if ((body.sha || null) !== store.sha) return new Response('{}', { status: 409 });
    store.text = Buffer.from(body.content, 'base64').toString('utf8');
    store.sha = `sha-${++store.n}`;
    return new Response(JSON.stringify({ commit: { sha: 'beef' } }));
  };
  return { store, calls };
}

function putNote(id, text, { passcode = '對的通關碼', origin = ORIGIN, ip = '1.1.1.1', raw } = {}) {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip };
  if (origin) headers.Origin = origin;
  const body = passcode ? { text, passcode } : { text };
  return new Request(`https://w.example/notes/${id}`, { method: 'PUT', headers, body: raw ?? JSON.stringify(body) });
}

const getNotes = (origin = ORIGIN) => new Request('https://w.example/notes', { headers: origin ? { Origin: origin } : {} });

// ---- 休養中（K 2026-10-09）：PUT /rest/{編號}，通關碼，寫 data/rest.json ----
const REST_API = '/repos/jiatsenK/bq-shelter-dogs/contents/data/rest.json';
function putRest(id, body, { origin = ORIGIN, ip = '1.1.1.1' } = {}) {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip };
  if (origin) headers.Origin = origin;
  return new Request(`https://w.example/rest/${id}`, { method: 'PUT', headers, body: JSON.stringify(body) });
}
// 台灣今天往後 n 天的 YYYY-MM-DD
const twDay = n => new Date(Date.now() + 8 * 3600 * 1000 + n * 86400000).toISOString().slice(0, 10);

test('休養中：有通關碼就寫進 data/rest.json（編號 → until、reason），不動別隻；結束休養就拿掉', async () => {
  const other = { '2024010101': { until: twDay(5), reason: '別隻', updatedAt: '2026-10-01T00:00:00.000Z' } };
  const { store, calls } = fakeNotesGithub({ text: JSON.stringify(other), api: REST_API });
  const until = twDay(11);
  const r = await send(putRest('2024032902', { passcode: '對的通關碼', until, reason: ' 術後休養\n ' }), NENV);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.rest.until, r.body.rest.reason], [until, '術後休養']);
  const saved = JSON.parse(store.text);
  assert.deepEqual(saved['2024010101'], other['2024010101']);
  assert.equal(saved['2024032902'].until, until);
  const put = calls.find(c => c.method === 'PUT');
  assert.match(put.body.message, new RegExp(`^休養中到 ${until}：2024032902（測試狗）`));

  const end = await send(putRest('2024032902', { passcode: '對的通關碼', end: true }), NENV);
  assert.deepEqual([end.status, end.body.rest], [200, null]);
  assert.equal('2024032902' in JSON.parse(store.text), false);
  assert.match(calls.filter(c => c.method === 'PUT').pop().body.message, /^結束休養：2024032902/);
});

test('休養中：通關碼錯、日期看不懂或已經過了、超過 180 天、原因太長、編號不對都擋；只能用 PUT；預覽版不能存', async () => {
  const { calls } = fakeNotesGithub({ text: '{}', api: REST_API });
  const bad = async (body, status, id = '2024032902') => {
    const r = await send(putRest(id, body), NENV);
    assert.equal(r.status, status, JSON.stringify(body));
    return r;
  };
  const wrong = await bad({ passcode: '錯的', until: twDay(3) }, 401);
  assert.equal(wrong.body.code, 'passcode');
  await bad({ passcode: '對的通關碼', until: '2026/10/20' }, 400);
  await bad({ passcode: '對的通關碼', until: '2026-02-30' }, 400);
  await bad({ passcode: '對的通關碼', until: twDay(-1) }, 400);
  await bad({ passcode: '對的通關碼', until: twDay(181) }, 400);
  await bad({ passcode: '對的通關碼', until: twDay(3), reason: '字'.repeat(41) }, 413);
  await bad({ passcode: '對的通關碼', until: twDay(3) }, 404, '1999999999');
  await bad({ passcode: '對的通關碼', until: twDay(3) }, 400, 'a%2Fb');
  assert.equal(calls.filter(c => c.method === 'PUT').length, 0);
  const get = await send(new Request('https://w.example/rest/2024032902', { headers: { Origin: ORIGIN } }), NENV);
  assert.equal(get.status, 405);
  const pre = await send(putRest('2024032902', { passcode: '對的通關碼', until: twDay(3) }), { ...NENV, PREVIEW: '1' });
  assert.equal(pre.status, 403);
});

// ---- 入所介紹（K 2026-10-10 電腦版補資料）：PUT /intro/{編號}，通關碼，改 dogs/{編號}.md 的內文 ----
const INTRO_API = '/repos/jiatsenK/bq-shelter-dogs/contents/dogs/2024032902.md';
function putIntro(id, body, { origin = ORIGIN, ip = '1.1.1.1' } = {}) {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip };
  if (origin) headers.Origin = origin;
  return new Request(`https://w.example/intro/${id}`, { method: 'PUT', headers, body: JSON.stringify(body) });
}

test('入所介紹：有通關碼就改 dogs/{編號}.md 的內文，frontmatter 照留；沒有檔就新建', async () => {
  const old = '---\r\nname: 測試狗\r\nid: 2024032902\r\nsex: female\r\nformerIds: 2020010101\r\n---\r\n舊的介紹\r\n';
  const { store, calls } = fakeNotesGithub({ text: old, api: INTRO_API });
  const r = await send(putIntro('2024032902', { passcode: '對的通關碼', text: '  親人\r\n喜歡散步  ' }), NENV);
  assert.equal(r.status, 200);
  assert.equal(r.body.intro, '親人\n喜歡散步');
  assert.equal(store.text, '---\nname: 測試狗\nid: 2024032902\nsex: female\nformerIds: 2020010101\n---\n親人\n喜歡散步\n');
  const put = calls.find(c => c.method === 'PUT');
  assert.equal(put.body.sha, 'sha-0');
  assert.match(put.body.message, /^改入所介紹：2024032902（測試狗）/);
  // 一樣的內容不再提交
  const same = await send(putIntro('2024032902', { passcode: '對的通關碼', text: '親人\n喜歡散步' }), NENV);
  assert.deepEqual([same.status, same.body.commit], [200, null]);
  assert.equal(calls.filter(c => c.method === 'PUT').length, 1);

  resetState();
  const fresh = fakeNotesGithub({ text: null, api: INTRO_API });
  const n = await send(putIntro('2024032902', { passcode: '對的通關碼', text: '新來的' }), NENV);
  assert.equal(n.status, 200);
  assert.equal(fresh.store.text, '---\nname: 測試狗\nid: 2024032902\n---\n新來的\n');
  assert.equal(fresh.calls.find(c => c.method === 'PUT').body.sha, undefined);
});

test('入所介紹：通關碼錯、太長、編號不對、不是 PUT 都擋；預覽版不能存', async () => {
  const { calls } = fakeNotesGithub({ text: '---\nname: 測試狗\n---\n舊的', api: INTRO_API });
  const bad = async (body, status, id = '2024032902') => {
    const r = await send(putIntro(id, body), NENV);
    assert.equal(r.status, status, JSON.stringify(body).slice(0, 60));
    return r;
  };
  assert.equal((await bad({ passcode: '錯的', text: 'x' }, 401)).body.code, 'passcode');
  await bad({ passcode: '對的通關碼', text: '字'.repeat(1001) }, 413);
  await bad({ passcode: '對的通關碼', text: 3 }, 400);
  await bad({ passcode: '對的通關碼', text: 'x' }, 404, '1999999999');
  await bad({ passcode: '對的通關碼', text: 'x' }, 400, 'a%2Fb');
  assert.equal(calls.filter(c => c.method === 'PUT').length, 0);
  const get = await send(new Request('https://w.example/intro/2024032902', { headers: { Origin: ORIGIN } }), NENV);
  assert.equal(get.status, 405);
  const pre = await send(putIntro('2024032902', { passcode: '對的通關碼', text: 'x' }), { ...NENV, PREVIEW: '1' });
  assert.equal(pre.status, 403);
});

test('備註：有通關碼寫入，存成 data/my-notes.json（編號 → text、updatedAt），不動其他狗的備註', async () => {
  const other = { '2024010101': { text: '別隻狗的備註', updatedAt: '2026-09-01T00:00:00.000Z' } };
  const { store, calls } = fakeNotesGithub({ text: JSON.stringify(other) });
  const r = await send(putNote('2024032902', '  牽繩要短\r\n怕機車  '), NENV);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.note.text, '牽繩要短\n怕機車');
  assert.equal(r.body.commit, 'beef');
  const saved = JSON.parse(store.text);
  assert.deepEqual(saved['2024010101'], other['2024010101']);
  assert.equal(saved['2024032902'].text, '牽繩要短\n怕機車');
  assert.ok(!Number.isNaN(Date.parse(saved['2024032902'].updatedAt)));
  const put = calls.find(c => c.method === 'PUT');
  assert.equal(put.body.sha, 'sha-0');
  assert.equal(put.body.branch, 'main');
  assert.match(put.body.message, /^更新我的備註：2024032902（測試狗）/);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('備註：還沒有檔案時新建（不帶 sha）；送空白＝刪掉這隻的備註', async () => {
  const { store, calls } = fakeNotesGithub();
  assert.equal((await send(putNote('2024032902', '第一筆'), NENV)).status, 200);
  assert.equal(calls.find(c => c.method === 'PUT').body.sha, undefined);
  const r = await send(putNote('2024032902', '   '), NENV);
  assert.equal(r.status, 200);
  assert.equal(r.body.note, null);
  assert.deepEqual(JSON.parse(store.text), {});
  assert.match(calls.filter(c => c.method === 'PUT')[1].body.message, /^刪除我的備註/);
  // 本來就沒有備註又送空白：不產生提交
  const again = await send(putNote('2024032902', ''), NENV);
  assert.equal(again.status, 200);
  assert.equal(calls.filter(c => c.method === 'PUT').length, 2);
});

test('備註：沒通關碼或通關碼錯都被拒絕，不寫入；錯太多次暫停', async () => {
  const { calls } = fakeNotesGithub();
  const none = await send(putNote('2024032902', 'x', { passcode: '' }), NENV);
  assert.equal(none.status, 401);
  assert.equal(none.body.code, 'passcode');
  const wrong = await send(putNote('2024032902', 'x', { passcode: '猜猜看' }), NENV);
  assert.equal(wrong.status, 401);
  assert.match(wrong.body.error, /通關碼不對/);
  for (let i = 0; i < 8; i++) await send(putNote('2024032902', 'x', { passcode: `錯${i}` }), NENV);
  const locked = await send(putNote('2024032902', 'x'), NENV);
  assert.equal(locked.status, 429, '錯滿 10 次後連對的也先不給試');
  assert.equal((await send(putNote('2024032902', 'x', { ip: '2.2.2.2' }), NENV)).status, 200, '別的 IP 不受影響');
  assert.equal(calls.filter(c => c.method === 'PUT').length, 1);
});

test('備註：Worker 沒設 NOTES_PASSCODE 時一律不能寫', async () => {
  const { calls } = fakeNotesGithub();
  const r = await send(putNote('2024032902', 'x', { passcode: 'undefined' }), ENV);
  assert.equal(r.status, 500);
  assert.match(r.body.error, /NOTES_PASSCODE/);
  assert.equal(calls.length, 0);
  const home = await send(new Request('https://w.example/'), NENV);
  assert.equal(home.body.notesPasscode, '已設定');
  assert.ok(!JSON.stringify(home.body).includes('對的通關碼'));
});

test('備註：超過 1000 字、不是文字、格式不對、編號不對都擋', async () => {
  const { calls } = fakeNotesGithub();
  assert.equal((await send(putNote('2024032902', '字'.repeat(1000)), NENV)).status, 200);
  const long = await send(putNote('2024032902', '字'.repeat(1001)), NENV);
  assert.equal(long.status, 413);
  assert.match(long.body.error, /1000/);
  assert.equal((await send(putNote('2024032902', 123), NENV)).status, 400);
  assert.equal((await send(putNote('2024032902', null, { raw: '不是 JSON' }), NENV)).status, 400);
  assert.equal((await send(putNote('9999999999', 'x'), NENV)).status, 404);
  assert.equal((await send(putNote('..%2Fdogs', 'x'), NENV)).status, 400);
  assert.equal(calls.filter(c => c.method === 'PUT').length, 1);
});

test('備註：只存純文字，控制字元拿掉、換行保留', () => {
  const { cleanNote } = worker.testing;
  assert.equal(cleanNote('a\u0000b\u001bc\td\r\ne'), 'abc\td\ne');
  assert.equal(cleanNote('<b>粗體</b>'), '<b>粗體</b>', '原樣存成文字，前端用文字顯示');
  assert.equal(cleanNote(5), null);
});

test('備註：已離開收容所（不在 dogs.json）的狗，舊備註仍可修改', async () => {
  const { store } = fakeNotesGithub({ text: JSON.stringify({ '2023000001': { text: '舊的', updatedAt: 'x' } }) });
  assert.equal((await send(putNote('2023000001', '改過'), NENV)).status, 200);
  assert.equal(JSON.parse(store.text)['2023000001'].text, '改過');
});

test('備註：同時有人寫入（sha 對不上）會重讀最新版再試，不蓋掉對方', async () => {
  const { store, calls } = fakeNotesGithub({ text: '{}' });
  // 第一次讀完後，別人搶先寫了另一隻狗
  const realFetch = globalThis.fetch;
  let raced = false;
  globalThis.fetch = async (url, init = {}) => {
    if ((init.method || 'GET') === 'PUT' && !raced) {
      raced = true;
      store.text = JSON.stringify({ '2024010101': { text: '別人剛寫的', updatedAt: 'y' } });
      store.sha = 'sha-other';
    }
    return realFetch(url, init);
  };
  const r = await send(putNote('2024032902', '我的'), NENV);
  assert.equal(r.status, 200);
  const saved = JSON.parse(store.text);
  assert.equal(saved['2024010101'].text, '別人剛寫的');
  assert.equal(saved['2024032902'].text, '我的');
  assert.equal(calls.filter(c => c.method === 'PUT').length, 2);
});

test('備註：GitHub 寫入失敗回錯誤，說原本的備註不受影響', async () => {
  fakeNotesGithub({ text: '{}', putStatus: [500] });
  const r = await send(putNote('2024032902', 'x'), NENV);
  assert.equal(r.status, 502);
  assert.match(r.body.error, /原本的備註不受影響/);
});

test('備註讀取：GET /notes 直接回 GitHub 上的最新內容；沒檔案回空的；不用通關碼', async () => {
  fakeNotesGithub({ text: JSON.stringify({ '2024032902': { text: '最新', updatedAt: 'z' } }) });
  const r = await send(getNotes(), NENV);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.notes, { '2024032902': { text: '最新', updatedAt: 'z' } });
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  fakeNotesGithub();
  assert.deepEqual((await send(getNotes(), NENV)).body.notes, {});
  fakeNotesGithub({ getStatus: 500 });
  assert.equal((await send(getNotes(), NENV)).status, 502);
});

test('備註：只接受網站來的要求；預檢允許 PUT；其他方法擋', async () => {
  const { calls } = fakeNotesGithub({ text: '{}' });
  assert.equal((await send(getNotes('https://evil.example'), NENV)).status, 403);
  assert.equal((await send(putNote('2024032902', 'x', { origin: 'https://evil.example' }), NENV)).status, 403);
  const pre = await worker.fetch(new Request('https://w.example/notes/2024032902', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), NENV);
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('Access-Control-Allow-Methods'), /PUT/);
  const del = await worker.fetch(new Request('https://w.example/notes/2024032902', { method: 'DELETE', headers: { Origin: ORIGIN } }), NENV);
  assert.equal(del.status, 405);
  assert.equal(calls.length, 0);
});

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

test('#125 /api 前綴：/api/ 顯示服務狀態、/api/notes 跟 /notes 一樣；沒前綴的舊路徑照舊能用', async () => {
  fakeNotesGithub({ text: JSON.stringify({ '2024032902': { text: '最新', updatedAt: 'z' } }) });
  const home = await send(new Request(`${SITE}/api/`), NENV);
  assert.equal(home.body.ok, true);
  assert.equal(home.body.notesPasscode, '已設定');
  assert.equal((await send(new Request(`${SITE}/api`), NENV)).body.ok, true);
  const viaApi = await send(new Request(`${SITE}/api/notes`, { headers: { Origin: ORIGIN } }), NENV);
  assert.deepEqual(viaApi.body.notes, { '2024032902': { text: '最新', updatedAt: 'z' } });
  const old = await send(getNotes(), NENV);
  assert.deepEqual(old.body.notes, viaApi.body.notes);
});

test('#125 同網址：送資料帶自己的 Origin、讀取只帶 Sec-Fetch-Site 都接受；別的網站、什麼都沒帶照樣擋', async () => {
  fakeNotesGithub({ text: '{}' });
  const read = await send(new Request(`${SITE}/api/notes`, { headers: { 'Sec-Fetch-Site': 'same-origin' } }), NENV);
  assert.equal(read.status, 200);
  const write = await send(new Request(`${SITE}/api/notes/2024032902`, {
    method: 'PUT', headers: { Origin: SITE, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '同網址', passcode: '對的通關碼' }),
  }), NENV);
  assert.equal(write.status, 200);
  assert.equal((await send(new Request(`${SITE}/api/notes`), NENV)).status, 403);
  assert.equal((await send(new Request(`${SITE}/api/notes`, { headers: { 'Sec-Fetch-Site': 'cross-site' } }), NENV)).status, 403);
  assert.equal((await send(new Request(`${SITE}/api/notes`, { headers: { Origin: 'https://evil.example' } }), NENV)).status, 403);
  // 別的網站假裝 Sec-Fetch-Site 也沒用：有 Origin 就看 Origin
  assert.equal((await send(new Request(`${SITE}/api/notes`, { headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'same-origin' } }), NENV)).status, 403);
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
  const req = new Request(`${SITE}/api/photos/2024032902`, { method: 'POST', headers: { Origin: SITE, 'Content-Type': 'image/jpeg', 'CF-Connecting-IP': '9.9.9.9' }, body: JPEG.slice() });
  const r = await send(req);
  assert.equal(r.status, 200);
  assert.ok(calls.some(c => c.method === 'PUT' && c.path.endsWith('/contents/photos/2024032902.jpg')));
});

// ---- PR 預覽版（#126）：可以看、可以讀，不能改正式資料 ----

test('#126 預覽版：上傳、備註、更新都回 403 且不碰 GitHub；讀取和換代號照常', async () => {
  const PENV = { ...NENV, WALKER_KEY: 'k', PREVIEW: '1' };
  const { calls } = fakeNotesGithub({ text: '{}' });
  const h = { Origin: SITE, 'Content-Type': 'application/json' };
  const writes = [
    new Request(`${SITE}/api/photos/2024032902`, { method: 'POST', headers: { Origin: SITE, 'Content-Type': 'image/jpeg' }, body: JPEG.slice() }),
    new Request(`${SITE}/api/notes/2024032902`, { method: 'PUT', headers: h, body: JSON.stringify({ text: 'x', passcode: '對的通關碼' }) }),
    new Request(`${SITE}/api/sync`, { method: 'POST', headers: h }),
  ];
  for (const req of writes) {
    const r = await send(req, PENV);
    assert.equal(r.status, 403, req.url);
    assert.match(r.body.error, /預覽版/);
  }
  assert.equal(calls.length, 0);
  assert.equal((await send(new Request(`${SITE}/api/notes`, { headers: { Origin: SITE } }), PENV)).status, 200);
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

test('#138 POST /walk：帶通關碼轉給小程式，回傳每隻狗的結果；不碰 GitHub', async () => {
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

test('#138 POST /walk 擋掉：沒設定、格式不對、名字太長、太多隻、別的網站、預覽版；小程式說通關碼不對', async () => {
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
  fakeScript(() => ({ ok: false, code: 'key', error: '通關碼不對' }));
  const bad = await send(postWalk(ok), SHEET_ENV);
  assert.equal(bad.status, 502);
  assert.match(bad.body.error, /通關碼/);
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

test('K 2026-10-12 GET /walkers：看過的名字記進資料庫，以前看過、現在表上沒有的放 older；資料庫壞了照舊', async t => {
  let sqlite;
  try { sqlite = await import('node:sqlite'); } catch (e) { t.skip('這個 Node 沒有 node:sqlite'); return; }
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(await readFile(new URL('../../db/schema.sql', import.meta.url), 'utf8'));
  db.prepare('INSERT INTO walker_names (name, last_seen) VALUES (?, ?)').run('老K', '2026-10-01T00:00:00.000Z');
  db.prepare('INSERT INTO walker_names (name, last_seen) VALUES (?, ?)').run('阿德', '2026-09-01T00:00:00.000Z');
  // 只做到 Worker 用到的 D1 介面：prepare → bind → run／all，和 batch
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => db.prepare(sql).run(...args),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
  });
  const DB = { prepare: sql => stmt(sql), batch: async list => Promise.all(list.map(x => x.run())) };
  fakeSheet();
  const { body } = await getWalkers({ SHEET_ID: 'abc', DB });
  assert.equal(body.names[0], '嘉文');
  assert.deepEqual(body.older, ['老K', '阿德'], '最近看到的在前，表上現在有的不重複');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM walker_names').get().n, 7, '表上的 5 個名字記進去');
  resetState();
  fakeSheet();
  const broken = { prepare: () => { throw new Error('no such table: walker_names'); } };
  const res = await getWalkers({ SHEET_ID: 'abc', DB: broken });
  assert.deepEqual([res.status, res.body.older, res.body.names.length], [200, [], 5]);
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
  fakeNotesGithub({ text: '{}' });
  const env = { GITHUB_TOKEN: 'test-token', NOTES_PASSCODE: '對的通關碼' };
  assert.equal((await send(new Request(`${SITE}/api/notes`, { headers: { Origin: 'https://jiatsenk.github.io' } }), env)).status, 403);
  assert.equal((await send(new Request(`${SITE}/api/notes`, { headers: { Origin: SITE } }), env)).status, 200);
});

// ---- 資料庫（D1，第 2 步）：目前只在狀態頁報告，網站還不讀它 ----
test('狀態頁：沒接資料庫寫「未設定」；接上了寫各表幾筆；還沒建表不會壞', async () => {
  fakeGithub();
  assert.equal((await send(new Request('https://x.workers.dev/'), ENV)).body.database, '未設定');
  const counts = { dogs: 125, walks: 732, changes: 53 };
  const DB = { prepare: sql => ({ first: async () => ({ n: counts[sql.match(/FROM (\w+)/)[1]] }) }) };
  assert.equal((await send(new Request('https://x.workers.dev/'), { ...ENV, DB })).body.database, 'D1（狗 125、溜狗紀錄 732、異動紀錄 53）');
  const broken = { prepare: () => ({ first: async () => { throw new Error('no such table: dogs'); } }) };
  assert.equal((await send(new Request('https://x.workers.dev/'), { ...ENV, DB: broken })).body.database, 'D1（還沒建表）');
});

test('圖鑑 D1：同人跨裝置合併、重送不重複、不同人隔離、預覽不可寫', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec(await readFile(new URL('../../db/schema.sql', import.meta.url), 'utf8'));
  const original = globalThis.fetch;
  const calls = fakeGithub();
  const DB = {
    prepare(sql) { return { bind(...args) { return { sql, args }; } }; },
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const result = statements.map(({ sql, args }) => ({ success: true, results: sql.startsWith('SELECT') ? db.prepare(sql).all(...args) : (db.prepare(sql).run(...args), []) }));
        db.exec('COMMIT'); return result;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
  const code = 'abcdef123456', other = '123456abcdef';
  const req = (method, data, env = {}) => worker.fetch(new Request(`https://worker.example/api/cards/opened${method === 'GET' ? '?codes=' + data.join(',') : ''}`, {
    method, headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(data) }),
  }), { ...ENV, DB, ...env });
  try {
    resetState();
    assert.equal((await req('PUT', { codes: [code], ids: ['2024032902'] })).status, 200);
    assert.equal((await req('PUT', { codes: [code], ids: ['2024032902'] })).status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM card_opened').get().n, 1);
    const out = await (await req('GET', [code])).json();
    assert.match(out.opened.codes[code]['2024032902'], /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual((await (await req('GET', [other])).json()).opened.codes[other], {});
    assert.equal((await req('PUT', { codes: [other], ids: ['2024032902'] })).status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM card_opened').get().n, 2);
    assert.equal((await req('PUT', { codes: [code], ids: ['unknown'] })).status, 400);
    assert.equal((await req('GET', ["bad' OR 1=1"])).status, 400);
    assert.equal((await req('PUT', { codes: [code], ids: [] })).status, 400);
    assert.equal((await req('PUT', { codes: [code], ids: ['2024032902'] }, { PREVIEW: '1' })).status, 403);
    assert.equal((await req('GET', [code], { DB: null })).status, 503);
    assert.equal((await req('GET', [code], { DB: { batch() { throw new Error('unavailable'); }, prepare: DB.prepare } })).status, 503);
    assert.equal(calls.filter(c => c.method !== 'GET').length, 0, '不寫 GitHub 或試算表');
  } finally { globalThis.fetch = original; db.close(); resetState(); }
});
