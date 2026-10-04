// 照片放 R2（#130）的測試：用假的 R2、假的靜態檔（舊照片）、假的 GitHub，不會真的連 Cloudflare 或 GitHub
// 執行：node --test worker/test/r2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { fakeR2, fakeAssets, sha } from './fakes.mjs';

const { resetState, r2, maintenance } = worker.testing;

const SITE = 'https://bq-shelter-dogs.example.workers.dev';
const ID = '2024032902';
const DOGS = { dogs: [{ id: ID, name: '測試狗' }] };
const jpeg = (...rest) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...rest]);
const OLD = jpeg(1, 1, 1);
const NEW = jpeg(2, 2, 2);
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));

// 假 GitHub：只回 dogs.json、gallery.json；其他寫入都記下來（R2 模式下不該有）
function fakeGithub({ gallery = {} } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    calls.push({ path: u.pathname, method });
    if (u.pathname.endsWith('/dispatches')) return new Response(null, { status: 204 });
    if (u.pathname.endsWith('/contents/data/gallery.json')) {
      return new Response(JSON.stringify({ sha: 'g1', content: Buffer.from(JSON.stringify(gallery)).toString('base64') }));
    }
    return new Response('{}', { status: 404 });
  };
  return calls;
}
const gitWrites = calls => calls.filter(c => c.method !== 'GET' && !c.path.endsWith('/dispatches'));
const dispatched = calls => calls.filter(c => c.path.endsWith('/actions/workflows/r2-thumbs.yml/dispatches')).length;

function setup({ assets = {}, gallery = {}, failPut, preview = false } = {}) {
  const PHOTOS = fakeR2({ failPut });
  const ASSETS = fakeAssets({ 'data/dogs.json': JSON.stringify(DOGS), ...assets });
  const calls = fakeGithub({ gallery });
  const env = { GITHUB_TOKEN: 't', NOTES_PASSCODE: '通關碼', PHOTOS, ASSETS, ...(preview ? { PREVIEW: '1' } : {}) };
  const pending = [];
  const ctx = { waitUntil: p => pending.push(p) };
  const call = async (path, init = {}) => {
    const headers = { 'CF-Connecting-IP': '1.1.1.1', ...(init.headers || {}) };
    if (init.method && init.method !== 'GET' && !path.startsWith('/api/admin')) headers.Origin = SITE;
    if ((!init.method || init.method === 'GET') && path.startsWith('/api/')) headers['Sec-Fetch-Site'] = 'same-origin';
    const res = await worker.fetch(new Request(SITE + path, { ...init, headers }), env, ctx);
    await Promise.all(pending.splice(0));
    return res;
  };
  return { env, PHOTOS, ASSETS, calls, call };
}
const json = async res => ({ status: res.status, body: await res.json() });
const upload = (call, bytes) => call(`/api/photos/${ID}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: bytes.slice() });
const admin = (call, path, init = {}, pass = '通關碼') =>
  call(`/api/admin/${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(pass ? { 'X-Admin-Passcode': encodeURIComponent(pass) } : {}), ...(init.headers || {}) } });
const trashEntries = PHOTOS => [...PHOTOS.objects.keys()].filter(k => k.startsWith('trash/') && k.endsWith('/photo.jpg'));

test.beforeEach(() => { resetState(); r2.resetR2State(); });

test('換主照片：只寫 R2、沒有 GitHub 提交；舊照片（還在 repo）先進 Trash，舊縮圖放刪除標記、叫縮圖 Action', async () => {
  const { PHOTOS, calls, call } = setup({ assets: { [`photos/${ID}.jpg`]: OLD, [`photos/thumbs/${ID}.jpg`]: jpeg(9) } });
  const r = await json(await upload(call, NEW));
  assert.equal(r.status, 200);
  assert.equal(r.body.replaced, true);
  assert.equal(r.body.commit, null);
  assert.ok(same(PHOTOS.objects.get(`photos/${ID}.jpg`).bytes, NEW));
  assert.ok(PHOTOS.objects.get(`photos/thumbs/${ID}.jpg`).customMetadata.deleted);
  assert.deepEqual(gitWrites(calls), []);
  assert.equal(dispatched(calls), 1);

  const [key] = trashEntries(PHOTOS);
  const t = PHOTOS.objects.get(key);
  assert.ok(same(t.bytes, OLD));
  assert.equal(t.customMetadata.path, `photos/${ID}.jpg`);
  assert.equal(t.customMetadata.dogId, ID);
  assert.equal(t.customMetadata.kind, 'main');
  assert.ok(t.customMetadata.deletedAt);
  assert.ok(PHOTOS.objects.has(key.replace('photo.jpg', 'thumb.jpg')), '縮圖也一起備份');
});

test('新照片（原本沒有）：不會產生 Trash', async () => {
  const { PHOTOS, call } = setup();
  const r = await json(await upload(call, NEW));
  assert.equal(r.body.replaced, false);
  assert.deepEqual(trashEntries(PHOTOS), []);
});

test('Trash 備份失敗：不換照片，原本的照片不受影響', async () => {
  const { PHOTOS, call } = setup({ assets: { [`photos/${ID}.jpg`]: OLD }, failPut: k => k.startsWith('trash/') });
  const r = await json(await upload(call, NEW));
  assert.equal(r.status, 502);
  assert.match(r.body.error, /原本的照片不受影響/);
  assert.equal(PHOTOS.objects.has(`photos/${ID}.jpg`), false);
});

test('讀照片：R2 優先、有版本號長快取＋ETag、304；刪除標記不會退回舊檔；R2 沒有才讀舊檔', async () => {
  const { PHOTOS, call } = setup({ assets: { [`photos/${ID}.jpg`]: OLD, 'photos/gallery/1/20260101-000000-abcd.jpg': OLD, 'photos/2000000000.jpg': OLD } });
  await PHOTOS.put(`photos/${ID}.jpg`, NEW);
  const res = await call(`/photos/${ID}.jpg?v=abc`);
  assert.equal(res.status, 200);
  assert.ok(same(new Uint8Array(await res.arrayBuffer()), NEW));
  assert.match(res.headers.get('Cache-Control'), /max-age=2592000/);
  const etag = res.headers.get('ETag');
  assert.ok(etag);
  assert.equal((await call(`/photos/${ID}.jpg?v=abc`, { headers: { 'If-None-Match': etag } })).status, 304);
  assert.equal((await call(`/photos/${ID}.jpg`, { method: 'HEAD' })).status, 200);

  await r2.removePhoto({ PHOTOS }, 'photos/gallery/1/20260101-000000-abcd.jpg');
  assert.equal((await call('/photos/gallery/1/20260101-000000-abcd.jpg')).status, 404);

  const old = await call('/photos/2000000000.jpg');
  assert.equal(old.status, 200);
  assert.ok(same(new Uint8Array(await old.arrayBuffer()), OLD));
  assert.match(old.headers.get('Cache-Control'), /max-age=60/);
  assert.equal((await call('/photos/3000000000.jpg')).status, 404);
});

test('dogs.json：版本號蓋上 R2 的，被刪掉的拿掉；R2 讀不到照原樣', async () => {
  const dogs = { dogs: DOGS.dogs, photoVersions: { [`photos/${ID}.jpg`]: 'gitver00', 'photos/thumbs/x.jpg': 'gitthumb', 'photos/keep.jpg': 'keep0000' } };
  const { env, PHOTOS, call } = setup({ assets: { 'data/dogs.json': JSON.stringify(dogs) } });
  await PHOTOS.put(`photos/${ID}.jpg`, NEW);
  await r2.removePhoto(env, 'photos/thumbs/x.jpg');
  const r = await json(await call('/data/dogs.json'));
  assert.equal(r.body.dogs.length, 1);
  assert.notEqual(r.body.photoVersions[`photos/${ID}.jpg`], 'gitver00');
  assert.equal(r.body.photoVersions[`photos/${ID}.jpg`].length, 8);
  assert.equal(r.body.photoVersions['photos/thumbs/x.jpg'], undefined);
  assert.equal(r.body.photoVersions['photos/keep.jpg'], 'keep0000');

  r2.resetR2State();
  PHOTOS.list = async () => { throw new Error('壞了'); };
  const fallback = await json(await call('/data/dogs.json'));
  assert.equal(fallback.body.photoVersions['photos/keep.jpg'], 'keep0000');
});

test('相簿新增：從 repo 的清單接過來、存進 R2 的 meta/gallery.json，沒有 GitHub 提交；data/gallery.json 也回 R2 的', async () => {
  const old = { [ID]: [{ file: '20260101-000000-abcd.jpg', addedAt: '2026-01-01T00:00:00.000Z' }] };
  const { PHOTOS, calls, call } = setup({ gallery: old });
  const r = await json(await call(`/api/gallery/${ID}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: NEW.slice() }));
  assert.equal(r.status, 200);
  const file = r.body.photo.file;
  assert.ok(PHOTOS.objects.has(`photos/gallery/${ID}/${file}`));
  const meta = JSON.parse(new TextDecoder().decode(PHOTOS.objects.get('meta/gallery.json').bytes));
  assert.deepEqual(meta[ID].map(p => p.file), ['20260101-000000-abcd.jpg', file]);
  assert.deepEqual(gitWrites(calls), []);
  assert.equal(dispatched(calls), 1);

  const list = await json(await call('/api/gallery'));
  assert.equal(list.body.gallery[ID].length, 2);
  const file2 = await json(await call('/data/gallery.json'));
  assert.equal(file2.body[ID].length, 2);
});

test('相簿刪除：要通關碼；先進 Trash（記相簿資訊）、清單拿掉、放刪除標記；從 Trash 復原回原本的位置', async () => {
  const f = '20260101-000000-abcd.jpg';
  const key = `photos/gallery/${ID}/${f}`;
  const g = { [ID]: [{ file: f, addedAt: '2026-01-01T00:00:00.000Z' }] };
  const { PHOTOS, call } = setup({ gallery: g, assets: { [key]: OLD, [`photos/thumbs/gallery/${ID}/${f}`]: jpeg(7) } });
  const del = body => call(`/api/gallery/${ID}/${f}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  assert.equal((await del({ passcode: '錯的' })).status, 401);
  assert.equal(PHOTOS.objects.size, 0);

  const r = await json(await del({ passcode: '通關碼' }));
  assert.equal(r.status, 200);
  assert.equal(r.body.removed, true);
  assert.ok(r.body.trash);
  assert.equal((await call(`/${key}`)).status, 404, '舊檔不會因為備援又出現');
  assert.equal((await json(await call('/api/gallery'))).body.gallery[ID], undefined);
  const t = PHOTOS.objects.get(`trash/${r.body.trash}/photo.jpg`);
  assert.equal(t.customMetadata.kind, 'gallery');
  assert.equal(t.customMetadata.file, f);
  assert.equal(t.customMetadata.addedAt, '2026-01-01T00:00:00.000Z');

  const list = await json(await admin(call, 'trash'));
  assert.equal(list.body.trash.length, 1);
  assert.equal(list.body.days, 30);

  const back = await json(await admin(call, `trash/${r.body.trash}/restore`, { method: 'POST' }));
  assert.equal(back.status, 200);
  assert.equal(back.body.path, key);
  const photo = await call(`/${key}`);
  assert.equal(photo.status, 200);
  assert.ok(same(new Uint8Array(await photo.arrayBuffer()), OLD));
  assert.ok(same(PHOTOS.objects.get(`photos/thumbs/gallery/${ID}/${f}`).bytes, jpeg(7)), '縮圖一起復原');
  assert.deepEqual((await json(await call('/api/gallery'))).body.gallery[ID], g[ID]);
  assert.deepEqual(trashEntries(PHOTOS), []);
});

test('Trash 復原主照片：現在的主照片先進 Trash', async () => {
  const { PHOTOS, call } = setup({ assets: { [`photos/${ID}.jpg`]: OLD } });
  const r = await json(await upload(call, NEW));
  const back = await json(await admin(call, `trash/${r.body.trash}/restore`, { method: 'POST' }));
  assert.equal(back.status, 200);
  assert.ok(same(PHOTOS.objects.get(`photos/${ID}.jpg`).bytes, OLD));
  const [key] = trashEntries(PHOTOS);
  assert.ok(same(PHOTOS.objects.get(key).bytes, NEW));
});

test('相簿設為主照片：跟主照片互換，縮圖也換；清單不變', async () => {
  const f = '20260101-000000-abcd.jpg';
  const g = { [ID]: [{ file: f, addedAt: '2026-01-01T00:00:00.000Z' }] };
  const { PHOTOS, call } = setup({
    gallery: g,
    assets: { [`photos/${ID}.jpg`]: OLD, [`photos/thumbs/${ID}.jpg`]: jpeg(5), [`photos/gallery/${ID}/${f}`]: NEW, [`photos/thumbs/gallery/${ID}/${f}`]: jpeg(6) },
  });
  const r = await json(await call(`/api/gallery/${ID}/${f}/main`, { method: 'POST' }));
  assert.equal(r.status, 200);
  assert.equal(r.body.swapped, true);
  assert.equal(r.body.oldMainKept, true);
  assert.ok(same(PHOTOS.objects.get(`photos/${ID}.jpg`).bytes, NEW));
  assert.ok(same(PHOTOS.objects.get(`photos/gallery/${ID}/${f}`).bytes, OLD));
  assert.ok(same(PHOTOS.objects.get(`photos/thumbs/${ID}.jpg`).bytes, jpeg(6)));
  assert.ok(same(PHOTOS.objects.get(`photos/thumbs/gallery/${ID}/${f}`).bytes, jpeg(5)));
});

test('相簿設為主照片（原本沒有主照片）：搬過去，相簿少一張', async () => {
  const f = '20260101-000000-abcd.jpg';
  const g = { [ID]: [{ file: f, addedAt: '2026-01-01T00:00:00.000Z' }] };
  const { PHOTOS, call } = setup({ gallery: g, assets: { [`photos/gallery/${ID}/${f}`]: NEW } });
  const r = await json(await call(`/api/gallery/${ID}/${f}/main`, { method: 'POST' }));
  assert.equal(r.body.swapped, false);
  assert.ok(same(PHOTOS.objects.get(`photos/${ID}.jpg`).bytes, NEW));
  assert.equal((await json(await call('/api/gallery'))).body.gallery[ID], undefined);
  assert.equal((await call(`/photos/gallery/${ID}/${f}`)).status, 404);
});

test('管理 API：沒給或打錯通關碼擋下；預覽版不能搬遷；沒有 R2 回 off', async () => {
  const { call } = setup();
  assert.equal((await admin(call, 'trash', {}, '')).status, 401);
  assert.equal((await admin(call, 'trash', {}, '錯')).status, 401);
  assert.equal((await admin(call, 'trash')).status, 200);
  const p = setup({ preview: true });
  assert.equal((await admin(p.call, 'migrate', { method: 'POST', body: '{"items":[]}' })).status, 403);
  const res = await worker.fetch(new Request(`${SITE}/api/admin/trash`, { headers: { 'X-Admin-Passcode': encodeURIComponent('通關碼') } }), { GITHUB_TOKEN: 't', NOTES_PASSCODE: '通關碼' });
  assert.equal((await res.json()).code, 'off');
});

test('搬遷：從舊檔複製到 R2、用 sha256 驗證；已經有的（含刪除標記）不蓋掉；核對結果', async () => {
  const A = jpeg(1), B = jpeg(2), C = jpeg(3);
  const { env, PHOTOS, call } = setup({
    gallery: { [ID]: [{ file: '20260101-000000-abcd.jpg', addedAt: '' }] },
    assets: { 'photos/1.jpg': A, 'photos/2.jpg': B, 'photos/3.jpg': C, 'photos/thumbs/1.jpg': A },
  });
  await PHOTOS.put('photos/2.jpg', NEW, { customMetadata: { from: 'site' } });
  await r2.removePhoto(env, 'photos/3.jpg');
  const items = [
    { path: 'photos/1.jpg', sha256: sha(A), size: A.length },
    { path: 'photos/2.jpg', sha256: sha(B), size: B.length },
    { path: 'photos/3.jpg', sha256: sha(C), size: C.length },
    { path: 'photos/thumbs/1.jpg', sha256: sha(B), size: A.length }, // 內容跟 repo 對不上
    { path: 'photos/4.jpg', sha256: sha(A), size: A.length }, // 舊檔沒有
  ];
  const r = await json(await admin(call, 'migrate', { method: 'POST', body: JSON.stringify({ items, gallery: true }) }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.results.map(x => x.status), ['copied', 'exists', 'deleted', 'mismatch', 'missing']);
  assert.equal(r.body.gallery, 'copied');
  assert.ok(same(PHOTOS.objects.get('photos/1.jpg').bytes, A));
  assert.ok(same(PHOTOS.objects.get('photos/2.jpg').bytes, NEW), '網站換過的不被舊檔蓋掉');
  assert.equal(PHOTOS.objects.has('photos/thumbs/1.jpg'), false);
  assert.ok(PHOTOS.objects.has('meta/gallery.json'));

  const again = await json(await admin(call, 'migrate', { method: 'POST', body: JSON.stringify({ items: items.slice(0, 1), gallery: true }) }));
  assert.equal(again.body.results[0].status, 'exists');
  assert.equal(again.body.gallery, 'exists');

  const v = await json(await admin(call, 'verify', { method: 'POST', body: JSON.stringify({ items }) }));
  assert.deepEqual(v.body.results.map(x => x.status), ['ok', 'changed', 'deleted', 'missing', 'missing']);

  const tooMany = Array.from({ length: 11 }, () => items[0]);
  assert.equal((await admin(call, 'migrate', { method: 'POST', body: JSON.stringify({ items: tooMany }) })).status, 400);
  const bad = [{ path: '../data/dogs.json', sha256: sha(A), size: 1 }];
  assert.equal((await admin(call, 'migrate', { method: 'POST', body: JSON.stringify({ items: bad }) })).status, 400);
});

test('縮圖：列出還沒縮圖的、收 Action 傳回的縮圖；原圖不在就不收', async () => {
  const { PHOTOS, call } = setup();
  await PHOTOS.put('photos/1.jpg', OLD);
  await PHOTOS.put('photos/thumbs/1.jpg', OLD); // 比原圖新：不用做
  await PHOTOS.put('photos/thumbs/2.jpg', OLD);
  await PHOTOS.put('photos/2.jpg', NEW); // 縮圖比原圖舊：要重做
  await PHOTOS.put(`photos/gallery/${ID}/20260101-000000-abcd.jpg`, NEW); // 沒有縮圖
  const p = await json(await admin(call, 'thumbs'));
  assert.deepEqual(p.body.pending, ['photos/2.jpg', `photos/gallery/${ID}/20260101-000000-abcd.jpg`]);

  const put = path => admin(call, `thumbs/${path}`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: jpeg(4) });
  assert.equal((await put('photos/2.jpg')).status, 200);
  assert.ok(same(PHOTOS.objects.get('photos/thumbs/2.jpg').bytes, jpeg(4)));
  assert.equal((await put('photos/9.jpg')).status, 404);
  assert.equal((await put('photos/thumbs/1.jpg')).status, 400);
  assert.deepEqual((await json(await admin(call, 'thumbs'))).body.pending, [`photos/gallery/${ID}/20260101-000000-abcd.jpg`]);
});

test('Cron：清掉超過 30 天的 Trash，有還沒縮圖的就叫 Action', async () => {
  const { env, PHOTOS, calls } = setup({ assets: { 'photos/1.jpg': OLD } });
  const now = Date.now();
  const oldId = await r2.toTrash(env, SITE, 'photos/1.jpg', { dogId: '1', kind: 'main' }, now - 31 * 86400000);
  const newId = await r2.toTrash(env, SITE, 'photos/1.jpg', { dogId: '1', kind: 'main' }, now - 29 * 86400000);
  await PHOTOS.put('photos/5.jpg', OLD);
  const r = await maintenance(env, now);
  assert.deepEqual(r, { purged: 1, pending: 1 });
  assert.equal(PHOTOS.objects.has(`trash/${oldId}/photo.jpg`), false);
  assert.equal(PHOTOS.objects.has(`trash/${newId}/photo.jpg`), true);
  assert.equal(dispatched(calls), 1);
});

test('沒有 R2：照片、dogs.json 照舊給靜態檔', async () => {
  const ASSETS = fakeAssets({ [`photos/${ID}.jpg`]: OLD, 'data/dogs.json': '{"dogs":[]}' });
  const env = { ASSETS };
  const photo = await worker.fetch(new Request(`${SITE}/photos/${ID}.jpg`), env);
  assert.ok(same(new Uint8Array(await photo.arrayBuffer()), OLD));
  assert.deepEqual(await (await worker.fetch(new Request(`${SITE}/data/dogs.json`), env)).json(), { dogs: [] });
});
