// 照片上傳服務的測試（#47）：用假的 GitHub API，不會真的連 GitHub 或 Cloudflare
// 執行：node --test worker/test/worker.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const { resetState, allowUpload, isJpeg, MAX_BYTES } = worker.testing;

const ORIGIN = 'https://jiatsenk.github.io';
const ENV = { GITHUB_TOKEN: 'test-token' };
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
  const r = await send(post('2024032902'), {});
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

const NENV = { GITHUB_TOKEN: 'test-token', NOTES_PASSCODE: '對的通關碼' };
const NOTES_API = '/repos/jiatsenK/bq-shelter-dogs/contents/data/my-notes.json';

// 假 GitHub：data/my-notes.json 放在 store（text 是檔案內容，null 表示還沒有這個檔）
function fakeNotesGithub({ text = null, putStatus = [], getStatus = 200 } = {}) {
  const store = { text, sha: text === null ? null : 'sha-0', n: 0 };
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    calls.push({ path: u.pathname, method, body: init.body && JSON.parse(init.body) });
    if (u.pathname.endsWith('/contents/data/dogs.json')) return new Response(JSON.stringify(DOGS));
    if (u.pathname !== NOTES_API) return new Response('no', { status: 404 });
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

// ---- 相簿 ----

const GALLERY_API = '/repos/jiatsenK/bq-shelter-dogs/contents/data/gallery.json';
const PHOTO_API = '/repos/jiatsenK/bq-shelter-dogs/contents/photos/gallery/';

// 假 GitHub：data/gallery.json 放在 store.text（null 表示還沒有這個檔），照片檔放在 store.files（路徑 → sha）
function fakeGalleryGithub({ text = null, files = {}, photoStatus = [], listStatus = [], deleteStatus = 200 } = {}) {
  const store = { text, sha: text === null ? null : 'g-0', n: 0, files };
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    calls.push({ path: u.pathname, method, body: init.body && JSON.parse(init.body) });
    if (u.pathname.endsWith('/contents/data/dogs.json')) return new Response(JSON.stringify(DOGS));
    if (u.pathname === GALLERY_API) {
      if (method === 'GET') {
        if (store.text === null) return new Response('{}', { status: 404 });
        return new Response(JSON.stringify({ sha: store.sha, content: Buffer.from(store.text).toString('base64') }));
      }
      const status = listStatus.length ? listStatus.shift() : 200;
      if (status !== 200) return new Response('{}', { status });
      const body = JSON.parse(init.body);
      if ((body.sha || null) !== store.sha) return new Response('{}', { status: 409 });
      store.text = Buffer.from(body.content, 'base64').toString('utf8');
      store.sha = `g-${++store.n}`;
      return new Response(JSON.stringify({ commit: { sha: 'cafe' } }));
    }
    if (u.pathname.startsWith(PHOTO_API)) {
      const path = u.pathname.slice('/repos/jiatsenK/bq-shelter-dogs/contents/'.length);
      if (method === 'GET') return store.files[path] ? new Response(JSON.stringify({ sha: store.files[path] })) : new Response('{}', { status: 404 });
      if (method === 'DELETE') {
        if (deleteStatus !== 200) return new Response('{}', { status: deleteStatus });
        delete store.files[path];
        return new Response('{}');
      }
      const status = photoStatus.length ? photoStatus.shift() : 200;
      if (status !== 200) return new Response('{}', { status });
      store.files[path] = 'p-sha';
      return new Response(JSON.stringify({ commit: { sha: 'f00d' } }));
    }
    return new Response('no', { status: 404 });
  };
  return { store, calls };
}

function postGallery(id, { body = JPEG.slice(), origin = ORIGIN, ip = '1.1.1.1' } = {}) {
  const headers = { 'Content-Type': 'image/jpeg', 'CF-Connecting-IP': ip };
  if (origin) headers.Origin = origin;
  return new Request(`https://w.example/gallery/${id}`, { method: 'POST', headers, body });
}

function deleteGallery(id, file, { passcode = '對的通關碼', origin = ORIGIN, ip = '1.1.1.1' } = {}) {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip };
  if (origin) headers.Origin = origin;
  return new Request(`https://w.example/gallery/${id}/${file}`, { method: 'DELETE', headers, body: JSON.stringify(passcode ? { passcode } : {}) });
}

const F1 = '20260925-153012-ab12.jpg';
const F2 = '20260925-153020-cd34.jpg';

test('相簿新增：照片存到 photos/gallery/{編號}/，再加進 data/gallery.json，不動別隻狗', async () => {
  const other = { '2024010101': [{ file: F1, addedAt: 'x' }] };
  const { store, calls } = fakeGalleryGithub({ text: JSON.stringify(other) });
  const r = await send(postGallery('2024032902'), NENV);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.match(r.body.photo.file, /^\d{8}-\d{6}-[0-9a-f]{4}\.jpg$/);
  assert.ok(!Number.isNaN(Date.parse(r.body.photo.addedAt)));
  const puts = calls.filter(c => c.method === 'PUT');
  assert.equal(puts.length, 2);
  assert.equal(puts[0].path, `${PHOTO_API}2024032902/${r.body.photo.file}`);
  assert.equal(puts[0].body.sha, undefined, '新檔不帶 sha');
  assert.equal(puts[0].body.content, Buffer.from(JPEG).toString('base64'));
  assert.match(puts[0].body.message, /^新增相簿照片：photos\/gallery\/2024032902\/.+（測試狗）/);
  assert.equal(puts[1].path, GALLERY_API);
  assert.equal(puts[1].body.sha, 'g-0');
  const saved = JSON.parse(store.text);
  assert.deepEqual(saved['2024010101'], other['2024010101']);
  assert.deepEqual(saved['2024032902'], [r.body.photo]);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('相簿新增：還沒有清單檔時新建；檔名用台灣時間', async () => {
  const { store, calls } = fakeGalleryGithub();
  assert.equal((await send(postGallery('2024032902'), NENV)).status, 200);
  assert.equal(calls.filter(c => c.method === 'PUT')[1].body.sha, undefined);
  assert.equal(Object.keys(JSON.parse(store.text)).length, 1);
  const { galleryFileName } = worker.testing;
  assert.match(galleryFileName(Date.UTC(2026, 8, 25, 16, 30, 5)), /^20260926-003005-[0-9a-f]{4}\.jpg$/);
});

test('相簿新增：跟主照片一樣檢查 JPEG、編號、網站來源；滿 30 張不收', async () => {
  const { GALLERY_MAX } = worker.testing;
  const full = { '2024032902': Array.from({ length: GALLERY_MAX }, (_, i) => ({ file: `20260925-1530${String(i).padStart(2, '0')}-0000.jpg`, addedAt: '' })) };
  const { calls } = fakeGalleryGithub({ text: JSON.stringify(full) });
  assert.equal((await send(postGallery('9999999999'), NENV)).status, 404);
  assert.equal((await send(postGallery('..%2Fdata'), NENV)).status, 400);
  assert.equal((await send(postGallery('2024032902', { body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }), NENV)).status, 415);
  assert.equal((await send(postGallery('2024032902', { origin: 'https://evil.example' }), NENV)).status, 403);
  const r = await send(postGallery('2024032902'), NENV);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /最多 30 張/);
  assert.equal(calls.filter(c => c.method === 'PUT').length, 0);
});

test('相簿新增：照片存不進去回錯誤、不改清單；清單同時有人改會重讀再試', async () => {
  let g = fakeGalleryGithub({ text: '{}', photoStatus: [500] });
  const r = await send(postGallery('2024032902'), NENV);
  assert.equal(r.status, 502);
  assert.match(r.body.error, /相簿不受影響/);
  assert.equal(g.store.text, '{}');
  g = fakeGalleryGithub({ text: '{}' });
  const realFetch = globalThis.fetch;
  let raced = false;
  globalThis.fetch = async (url, init = {}) => {
    if ((init.method || 'GET') === 'PUT' && new URL(url).pathname === GALLERY_API && !raced) {
      raced = true;
      g.store.text = JSON.stringify({ '2024010101': [{ file: F1, addedAt: '' }] });
      g.store.sha = 'g-other';
    }
    return realFetch(url, init);
  };
  assert.equal((await send(postGallery('2024032902'), NENV)).status, 200);
  const saved = JSON.parse(g.store.text);
  assert.equal(saved['2024010101'][0].file, F1);
  assert.equal(saved['2024032902'].length, 1);
});

test('相簿頻率限制跟主照片分開：1 分鐘 12 張（網站一次最多選 10 張），1 小時 60 張', async () => {
  fakeGalleryGithub({ text: '{}' });
  for (let i = 0; i < 5; i++) assert.equal(allowUpload('1.1.1.1'), true, '先把主照片的 5 張用完');
  assert.equal(allowUpload('1.1.1.1'), false);
  for (let i = 0; i < 12; i++) assert.equal((await send(postGallery('2024032902'), NENV)).status, 200, `相簿第 ${i + 1} 張`);
  const r = await send(postGallery('2024032902'), NENV);
  assert.equal(r.status, 429);
  assert.match(r.body.error, /太頻繁/);
  assert.equal((await send(postGallery('2024032902', { ip: '2.2.2.2' }), NENV)).status, 200, '別的 IP 不受影響');
  const { allowGalleryUpload } = worker.testing;
  resetState();
  let t = 0;
  for (let i = 0; i < 60; i++, t += 6 * 1000) assert.equal(allowGalleryUpload('3.3.3.3', t), true);
  assert.equal(allowGalleryUpload('3.3.3.3', t), false);
});

test('相簿讀取：GET /gallery 回最新清單；格式不對的檔名濾掉；沒檔案回空的', async () => {
  const text = JSON.stringify({ '2024032902': [{ file: F1, addedAt: 'a' }, { file: '../../data/dogs.json' }, { file: F2 }], 'bad id': [{ file: F1 }] });
  fakeGalleryGithub({ text });
  const r = await send(new Request('https://w.example/gallery', { headers: { Origin: ORIGIN } }), NENV);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.gallery, { '2024032902': [{ file: F1, addedAt: 'a' }, { file: F2, addedAt: '' }] });
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  fakeGalleryGithub();
  assert.deepEqual((await send(new Request('https://w.example/gallery', { headers: { Origin: ORIGIN } }), NENV)).body.gallery, {});
});

test('相簿刪除：要通關碼；先從清單拿掉再刪照片檔', async () => {
  const path = `photos/gallery/2024032902/${F1}`;
  const { store, calls } = fakeGalleryGithub({
    text: JSON.stringify({ '2024032902': [{ file: F1, addedAt: '' }, { file: F2, addedAt: '' }] }),
    files: { [path]: 'old' },
  });
  const none = await send(deleteGallery('2024032902', F1, { passcode: '' }), NENV);
  assert.equal([none.status, none.body.code].join(), '401,passcode');
  const wrong = await send(deleteGallery('2024032902', F1, { passcode: '猜' }), NENV);
  assert.match(wrong.body.error, /通關碼不對/);
  assert.equal(calls.filter(c => c.method !== 'GET').length, 0, '通關碼不對不動任何東西');

  const r = await send(deleteGallery('2024032902', F1), NENV);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.removed, r.body.fileDeleted], [true, true]);
  assert.deepEqual(JSON.parse(store.text), { '2024032902': [{ file: F2, addedAt: '' }] });
  assert.equal(store.files[path], undefined);
  const del = calls.find(c => c.method === 'DELETE');
  assert.equal(del.body.sha, 'old');
  assert.match(del.body.message, /^刪除相簿照片：photos\/gallery\/2024032902\//);
  // 最後一張刪掉，這隻狗就從清單消失
  await send(deleteGallery('2024032902', F2), NENV);
  assert.deepEqual(JSON.parse(store.text), {});
});

test('相簿刪除：檔名格式不對擋；已經不在清單回成功但不產生提交；照片檔刪不掉仍算刪除成功', async () => {
  const { calls } = fakeGalleryGithub({ text: JSON.stringify({ '2024032902': [{ file: F1, addedAt: '' }] }), deleteStatus: 500, files: { [`photos/gallery/2024032902/${F1}`]: 's' } });
  assert.equal((await send(deleteGallery('2024032902', '..%2F..%2Fdata%2Fdogs.json'), NENV)).status, 400);
  assert.equal((await send(deleteGallery('2024032902', 'x.jpg'), NENV)).status, 400);
  const gone = await send(deleteGallery('2024032902', F2), NENV);
  assert.deepEqual([gone.status, gone.body.removed], [200, false]);
  assert.equal(calls.filter(c => c.method === 'PUT').length, 0);
  const r = await send(deleteGallery('2024032902', F1), NENV);
  assert.deepEqual([r.status, r.body.removed, r.body.fileDeleted], [200, true, false]);
});

test('相簿刪除：Worker 沒設 NOTES_PASSCODE 一律不能刪；預檢允許 DELETE；其他方法擋', async () => {
  const { calls } = fakeGalleryGithub({ text: '{}' });
  const r = await send(deleteGallery('2024032902', F1, { passcode: 'undefined' }), ENV);
  assert.equal(r.status, 500);
  assert.match(r.body.error, /NOTES_PASSCODE/);
  const pre = await worker.fetch(new Request(`https://w.example/gallery/2024032902/${F1}`, { method: 'OPTIONS', headers: { Origin: ORIGIN } }), NENV);
  assert.match(pre.headers.get('Access-Control-Allow-Methods'), /DELETE/);
  assert.equal((await worker.fetch(new Request('https://w.example/gallery/2024032902', { method: 'PUT', headers: { Origin: ORIGIN } }), NENV)).status, 405);
  assert.equal((await worker.fetch(new Request('https://w.example/gallery/%E0%A4%A', { method: 'POST', headers: { Origin: ORIGIN } }), NENV)).status, 500);
  assert.equal(calls.length, 0);
});
