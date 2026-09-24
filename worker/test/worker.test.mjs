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
