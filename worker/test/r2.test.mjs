import { fakeD1 } from './fakes.mjs';
import { migrateCompactDatabase } from '../../scripts/migrate-compact-db.mjs';
import { importCompactDogs } from '../../scripts/import-compact-dogs.mjs';
import { currentEditRevision } from './edit-fixture.mjs';
// 照片放 R2（#130）的測試：用假的 R2、假的靜態檔（舊照片）、假的 GitHub，不會真的連 Cloudflare 或 GitHub
// 執行：node --test worker/test/r2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { SETTING_KEYS } from '../src/feature-settings.js';
import { fakeR2, fakeAssets, sha } from './fakes.mjs';

const { resetState, r2, maintenance } = worker.testing;

const SITE = 'https://bq-shelter-dogs.example.workers.dev';
const ID = '2024032902';
const DOGS = { dogs: [{ id: ID, name: '測試狗' }] };
const jpeg = (...rest) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...rest]);
const OLD = jpeg(1, 1, 1);
const NEW = jpeg(2, 2, 2);
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));

// 假 GitHub：只接 Action 的 dispatches；其他寫入都記下來（R2 模式下不該有）
function fakeGithub() {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    calls.push({ path: u.pathname, method });
    if (u.pathname.endsWith('/dispatches')) return new Response(null, { status: 204 });
    return new Response('{}', { status: 404 });
  };
  return calls;
}
const gitWrites = calls => calls.filter(c => c.method !== 'GET' && !c.path.endsWith('/dispatches'));
const dispatched = calls => calls.filter(c => c.path.endsWith('/actions/workflows/r2-thumbs.yml/dispatches')).length;

async function setup({ assets = {}, failPut, preview = false } = {}) {
  const PHOTOS = fakeR2({ failPut });
  const ASSETS = fakeAssets(assets);
  const DB=fakeD1();await migrateCompactDatabase(DB);await importCompactDogs(DB,DOGS);
  const calls = fakeGithub();
  const env = { GITHUB_TOKEN: 't', ADMIN_KEY: '通關碼', PHOTOS, ASSETS, DB, ...(preview ? { PREVIEW: '1' } : {}) };
  const pending = [];
  const ctx = { waitUntil: p => pending.push(p) };
  const call = async (path, init = {}) => {
    const headers = { 'X-Dog-Revision': String(await currentEditRevision(DB,'/photos/'+ID)), 'CF-Connecting-IP': '1.1.1.1', ...(init.headers || {}) };
    if (init.method && init.method !== 'GET' && !path.startsWith('/api/admin')) headers.Origin = SITE;
    if ((!init.method || init.method === 'GET') && path.startsWith('/api/')) headers['Sec-Fetch-Site'] = 'same-origin';
    const res = await worker.fetch(new Request(SITE + path, { ...init, headers }), env, ctx);
    await Promise.all(pending.splice(0));
    return res;
  };
  return { env, PHOTOS, ASSETS, calls, call };
}
const json = async res => ({ status: res.status, body: await res.json() });
const upload = (call, bytes) => call(`/api/photos/${ID}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-Editor': encodeURIComponent('小明') }, body: bytes.slice() });
const admin = (call, path, init = {}, pass = '通關碼') =>
  call(`/api/admin/${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(pass ? { 'X-Admin-Key': encodeURIComponent(pass) } : {}), ...(init.headers || {}) } });
const trashEntries = PHOTOS => [...PHOTOS.objects.keys()].filter(k => k.startsWith('trash/') && k.endsWith('/photo.jpg'));

// Cache API 是外部邊界：只存 GET 完整回應，每次讀取都有自己的 body。
function photoCache(t) {
  const entries = new Map();
  const cache = {
    async match(request) { return entries.get(request.url)?.clone(); },
    async put(request, response) {
      assert.equal(request.method, 'GET');
      assert.equal(response.status, 200);
      entries.set(request.url, new Response(await response.arrayBuffer(), response));
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { default: cache } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'caches', previous);
    else delete globalThis.caches;
  });
  return cache;
}

test.beforeEach(() => { resetState(); r2.resetR2State(); });

test('#279 不同訪客讀同一版本照片：第二次命中邊緣快取，不再讀 R2', async t => {
  photoCache(t);
  const { PHOTOS, call } = await setup();
  await PHOTOS.put(`photos/thumbs/${ID}.jpg`, NEW);
  const version = PHOTOS.objects.get(`photos/thumbs/${ID}.jpg`).etag.slice(0, 8);
  const path = `/photos/thumbs/${ID}.jpg?v=${version}`;
  const first = await call(path);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('CF-Cache-Status'), 'MISS');
  assert.ok(same(await first.arrayBuffer(), NEW));
  PHOTOS.get = async () => { throw new Error('命中快取不應再讀 R2'); };
  const second = await call(path);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('CF-Cache-Status'), 'HIT');
  assert.ok(same(await second.arrayBuffer(), NEW));
  assert.match(second.headers.get('Cache-Control'), /max-age=2592000/);
});

test('#279 快取命中仍保留 HEAD 無 body 與 ETag 304；HEAD 未命中不存空圖片', async t => {
  photoCache(t);
  const { PHOTOS, call } = await setup();
  await PHOTOS.put(`photos/${ID}.jpg`, NEW);
  const path = `/photos/${ID}.jpg?v=${PHOTOS.objects.get(`photos/${ID}.jpg`).etag.slice(0, 8)}`;
  assert.equal(await (await call(path, { method: 'HEAD' })).text(), '');
  const first = await call(path);
  assert.equal(first.headers.get('CF-Cache-Status'), 'MISS');
  const etag = first.headers.get('ETag');
  assert.ok(same(await first.arrayBuffer(), NEW));
  PHOTOS.get = PHOTOS.head = async () => { throw new Error('命中快取不應再讀 R2'); };
  const head = await call(path, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('ETag'), etag);
  assert.equal(head.headers.get('CF-Cache-Status'), 'HIT');
  assert.equal(await head.text(), '');
  const conditional = await call(path, { headers: { 'If-None-Match': etag } });
  assert.equal(conditional.status, 304);
  assert.equal(conditional.headers.get('CF-Cache-Status'), 'HIT');
  assert.equal(await conditional.text(), '');
  assert.ok(same(await (await call(path, { headers: { 'If-None-Match': '"other"' } })).arrayBuffer(), NEW));
});

test('#279 Cache API 讀取或寫入失敗仍給 R2 照片，不退回舊靜態照片', async t => {
  const cache = photoCache(t);
  const { PHOTOS, call } = await setup({ assets: { [`photos/${ID}.jpg`]: OLD } });
  await PHOTOS.put(`photos/${ID}.jpg`, NEW);
  const path = `/photos/${ID}.jpg?v=${PHOTOS.objects.get(`photos/${ID}.jpg`).etag.slice(0, 8)}`;
  cache.match = async () => { throw new Error('快取讀取失敗'); };
  assert.ok(same(await (await call(path)).arrayBuffer(), NEW));
  cache.match = async () => undefined;
  cache.put = async () => { throw new Error('快取寫入失敗'); };
  assert.ok(same(await (await call(path)).arrayBuffer(), NEW));
});

test('#279 換照片改版本網址；版本不符不把新照片長期存進舊版本的快取', async t => {
  photoCache(t);
  const { PHOTOS, call } = await setup();
  const key = `photos/${ID}.jpg`;
  await PHOTOS.put(key, OLD);
  const oldVersion = PHOTOS.objects.get(key).etag.slice(0, 8);
  await PHOTOS.put(key, NEW);
  const newVersion = PHOTOS.objects.get(key).etag.slice(0, 8);
  // 其他機器的版本清單可能還停在舊版；第一次看到舊網址也不能快取新版內容。
  await (await call(`/${key}?v=${oldVersion}`)).arrayBuffer();
  assert.ok(same(await (await call(`/${key}?v=${newVersion}`)).arrayBuffer(), NEW));
  await PHOTOS.put(key, OLD);
  assert.ok(same(await (await call(`/${key}?v=${oldVersion}`)).arrayBuffer(), OLD));
  PHOTOS.get = async () => { throw new Error('新版應有獨立快取'); };
  const hit = await call(`/${key}?v=${newVersion}`);
  assert.equal(hit.headers.get('CF-Cache-Status'), 'HIT');
  assert.ok(same(await hit.arrayBuffer(), NEW));
});

test('#279 無版本不走邊緣快取；找不到、已刪除及舊靜態備援都不存快取', async t => {
  const cache = photoCache(t);
  const { PHOTOS, call } = await setup({ assets: { 'photos/2.jpg': OLD, 'photos/3.jpg': OLD } });
  await PHOTOS.put(`photos/${ID}.jpg`, OLD);
  let operations = 0;
  cache.match = cache.put = async () => { operations++; };
  for (const suffix of ['', '?v=']) {
    const response = await call(`/photos/${ID}.jpg${suffix}`);
    assert.equal(response.headers.get('CF-Cache-Status'), null);
    assert.ok(same(await response.arrayBuffer(), OLD));
  }
  assert.equal(operations, 0, '無版本不呼叫 Cache API');
  await PHOTOS.put(`photos/${ID}.jpg`, NEW);
  assert.ok(same(await (await call(`/photos/${ID}.jpg`)).arrayBuffer(), NEW));
  cache.match = async () => undefined;
  let writes = 0;
  cache.put = async () => { writes++; };
  await r2.removePhoto({ PHOTOS }, 'photos/2.jpg');
  for (const path of ['/photos/1.jpg?v=abcd1234', '/photos/2.jpg?v=abcd1234', '/photos/gallery/1/a.jpg?v=abcd1234']) {
    assert.equal((await call(path)).status, 404);
  }
  assert.ok(same(await (await call('/photos/3.jpg?v=abcd1234')).arrayBuffer(), OLD));
  assert.equal(writes, 0, '404 或靜態備援不可寫入邊緣快取');
});

test('#279 有條件讀取未命中回 304，不把空回應存入快取', async t => {
  photoCache(t);
  const { PHOTOS, call } = await setup();
  await PHOTOS.put(`photos/${ID}.jpg`, NEW);
  const obj = PHOTOS.objects.get(`photos/${ID}.jpg`);
  const path = `/photos/${ID}.jpg?v=${obj.etag.slice(0, 8)}`;
  const conditional = await call(path, { headers: { 'If-None-Match': `"${obj.etag}"` } });
  assert.equal(conditional.status, 304);
  assert.equal(await conditional.text(), '');
  const first = await call(path);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('CF-Cache-Status'), 'MISS');
  assert.ok(same(await first.arrayBuffer(), NEW));
});

test('#279 寫入邊緣快取由 waitUntil 保持生命週期，不擋住圖片回應', async t => {
  const cache = photoCache(t);
  const { env, PHOTOS } = await setup();
  await PHOTOS.put(`photos/${ID}.jpg`, NEW);
  let finish;
  const writing = new Promise(resolve => { finish = resolve; });
  cache.put = async (_key, response) => { await response.arrayBuffer(); await writing; };
  const waits = [];
  const ctx = { waitUntil(promise) { assert.equal(this, ctx); waits.push(promise); } };
  try {
    const res = await worker.fetch(new Request(`${SITE}/photos/${ID}.jpg?v=${PHOTOS.objects.get(`photos/${ID}.jpg`).etag.slice(0, 8)}`), env, ctx);
    assert.ok(same(await res.arrayBuffer(), NEW));
    assert.equal(waits.length, 1);
  } finally {
    finish();
    await Promise.all(waits);
  }
});

test('換主照片：只寫 R2、沒有 GitHub 提交；舊照片（還在 repo）先進 Trash，舊圖保留、無縮圖用原圖、不叫 Action', async () => {
  const { PHOTOS, calls, call } = await setup({ assets: { [`photos/${ID}.jpg`]: OLD, [`photos/thumbs/${ID}.jpg`]: jpeg(9) } });
  const r = await json(await upload(call, NEW));
  assert.equal(r.status, 200);
  assert.equal(r.body.replaced, true);
  assert.equal(r.body.commit, null);
  assert.ok(same(PHOTOS.objects.get(r.body.path).bytes, NEW));
  assert.equal(PHOTOS.objects.has(r2.thumbKey(r.body.path)),false);
  assert.deepEqual(gitWrites(calls), []);
  assert.equal(dispatched(calls), 0);

  const [key] = trashEntries(PHOTOS);
  const t = PHOTOS.objects.get(key);
  assert.ok(same(t.bytes, OLD));
  assert.equal(t.customMetadata.path, `photos/${ID}.jpg`);
  assert.match(t.customMetadata.dogId,/^[a-f0-9]{32}$/);
  assert.equal(t.customMetadata.kind, 'main');
  assert.ok(t.customMetadata.deletedAt);
  assert.ok(PHOTOS.objects.has(key.replace('photo.jpg', 'thumb.jpg')), '縮圖也一起備份');
});

test('新照片（原本沒有）：不會產生 Trash', async () => {
  const { PHOTOS, call } = await setup();
  const r = await json(await upload(call, NEW));
  assert.equal(r.body.replaced, false);
  assert.deepEqual(trashEntries(PHOTOS), []);
});

test('Trash 備份失敗：不換照片，原本的照片不受影響', async () => {
  const { PHOTOS, call } = await setup({ assets: { [`photos/${ID}.jpg`]: OLD }, failPut: k => k.startsWith('trash/') });
  const r = await json(await upload(call, NEW));
  assert.equal(r.status, 502);
  assert.match(r.body.error, /舊圖仍保留/);
  assert.equal(PHOTOS.objects.has(`photos/${ID}.jpg`), false);
});

test('讀照片：R2 優先、有版本號長快取＋ETag、304；刪除標記不會退回舊檔；R2 沒有才讀舊檔', async () => {
  const { PHOTOS, call } = await setup({ assets: { [`photos/${ID}.jpg`]: OLD, 'photos/1.jpg': OLD, 'photos/2000000000.jpg': OLD, 'photos/gallery/1/20260101-000000-abcd.jpg': OLD } });
  await PHOTOS.put(`photos/${ID}.jpg`, NEW);
  const res = await call(`/photos/${ID}.jpg?v=abc`);
  assert.equal(res.status, 200);
  assert.ok(same(new Uint8Array(await res.arrayBuffer()), NEW));
  assert.match(res.headers.get('Cache-Control'), /max-age=2592000/);
  const etag = res.headers.get('ETag');
  assert.ok(etag);
  assert.equal((await call(`/photos/${ID}.jpg?v=abc`, { headers: { 'If-None-Match': etag } })).status, 304);
  assert.equal((await call(`/photos/${ID}.jpg`, { method: 'HEAD' })).status, 200);

  await r2.removePhoto({ PHOTOS }, 'photos/1.jpg');
  assert.equal((await call('/photos/1.jpg')).status, 404);
  // 相簿 K 2026-10-09 拿掉：相簿照片就算還在也不給看
  assert.equal((await call('/photos/gallery/1/20260101-000000-abcd.jpg')).status, 404);

  const old = await call('/photos/2000000000.jpg');
  assert.equal(old.status, 200);
  assert.ok(same(new Uint8Array(await old.arrayBuffer()), OLD));
  assert.match(old.headers.get('Cache-Control'), /max-age=60/);
  assert.equal((await call('/photos/3000000000.jpg')).status, 404);
});

test('#252 舊資料網址退役，不讀靜態資料', async () => {
  const { ASSETS, call } = await setup();
  assert.equal((await call('/data/dogs.json')).status, 410);
  assert.equal((await call('/dogs/123.md')).status, 410);
  assert.equal(ASSETS.seen?.length || 0, 0);
});

test('相簿拿掉（K 2026-10-09）：/api/gallery 一律回 410；Trash 裡的相簿照片不能復原', async () => {
  const { PHOTOS, call } = await setup();
  for (const [path, method] of [['/api/gallery', 'GET'], [`/api/gallery/${ID}`, 'POST'], [`/api/gallery/${ID}/20260101-000000-abcd.jpg`, 'DELETE']]) {
    assert.equal((await call(path, { method })).status, 410, `${method} ${path}`);
  }
  await PHOTOS.put('trash/1700000000000-abcd/photo.jpg', OLD, { customMetadata: { dogId: ID, kind: 'gallery', from: `photos/gallery/${ID}/20260101-000000-abcd.jpg` } });
  const back = await json(await admin(call, 'trash/1700000000000-abcd/restore', { method: 'POST' }));
  assert.equal(back.status, 410);
  assert.equal(PHOTOS.objects.has('trash/1700000000000-abcd/photo.jpg'), true, 'Trash 裡的照片還在');
});

test('Trash 復原主照片：現在的主照片先進 Trash', async () => {
  const { PHOTOS, call } = await setup({ assets: { [`photos/${ID}.jpg`]: OLD } });
  const r = await json(await upload(call, NEW));
  const back = await json(await admin(call, `trash/${r.body.trash}/restore`, { method: 'POST' }));
  assert.equal(back.status, 200);
  assert.ok(same(PHOTOS.objects.get(back.body.path).bytes, OLD));
  assert.ok(trashEntries(PHOTOS).some(key=>same(PHOTOS.objects.get(key).bytes,NEW)));
  assert.ok(PHOTOS.objects.has('trash/'+r.body.trash+'/photo.jpg'),'復原不消耗備份');
});

test('管理 API：沒給或打錯金鑰擋下；預覽版不能搬遷；沒有 R2 回 off', async () => {
  const { call } = await setup();
  assert.equal((await admin(call, 'trash', {}, '')).status, 401);
  assert.equal((await admin(call, 'trash', {}, '錯')).status, 401);
  assert.equal((await admin(call, 'trash')).status, 200);
  const p = await setup({ preview: true });
  assert.equal((await admin(p.call, 'migrate', { method: 'POST', body: '{"items":[]}' })).status, 403);
  const res = await worker.fetch(new Request(`${SITE}/api/admin/trash`, { headers: { 'X-Admin-Key': encodeURIComponent('通關碼') } }), { GITHUB_TOKEN: 't', ADMIN_KEY: '通關碼' });
  assert.equal((await res.json()).code, 'off');
});

test('搬遷：從舊檔複製到 R2、用 sha256 驗證；已經有的（含刪除標記）不蓋掉；核對結果', async () => {
  const A = jpeg(1), B = jpeg(2), C = jpeg(3);
  const { env, PHOTOS, call } = await setup({
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
  const r = await json(await admin(call, 'migrate', { method: 'POST', body: JSON.stringify({ items }) }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.results.map(x => x.status), ['copied', 'exists', 'deleted', 'mismatch', 'missing']);
  assert.ok(same(PHOTOS.objects.get('photos/1.jpg').bytes, A));
  assert.ok(same(PHOTOS.objects.get('photos/2.jpg').bytes, NEW), '網站換過的不被舊檔蓋掉');
  assert.equal(PHOTOS.objects.has('photos/thumbs/1.jpg'), false);

  const again = await json(await admin(call, 'migrate', { method: 'POST', body: JSON.stringify({ items: items.slice(0, 1) }) }));
  assert.equal(again.body.results[0].status, 'exists');

  const v = await json(await admin(call, 'verify', { method: 'POST', body: JSON.stringify({ items }) }));
  assert.deepEqual(v.body.results.map(x => x.status), ['ok', 'changed', 'deleted', 'missing', 'missing']);

  const tooMany = Array.from({ length: 11 }, () => items[0]);
  assert.equal((await admin(call, 'migrate', { method: 'POST', body: JSON.stringify({ items: tooMany }) })).status, 400);
  const bad = [{ path: '../data/dogs.json', sha256: sha(A), size: 1 }];
  assert.equal((await admin(call, 'migrate', { method: 'POST', body: JSON.stringify({ items: bad }) })).status, 400);
});

test('縮圖：列出還沒縮圖的、收 Action 傳回的縮圖；原圖不在就不收', async () => {
  const { PHOTOS, call } = await setup();
  await PHOTOS.put('photos/1.jpg', OLD);
  await PHOTOS.put('photos/thumbs/1.jpg', OLD); // 比原圖新：不用做
  await PHOTOS.put('photos/thumbs/2.jpg', OLD);
  await PHOTOS.put('photos/2.jpg', NEW); // 縮圖比原圖舊：要重做
  await PHOTOS.put('photos/3.jpg', NEW); // 沒有縮圖
  await PHOTOS.put(`photos/gallery/${ID}/20260101-000000-abcd.jpg`, NEW); // 相簿 K 2026-10-09 拿掉：不做縮圖
  const p = await json(await admin(call, 'thumbs'));
  assert.deepEqual(p.body.pending, ['photos/2.jpg', 'photos/3.jpg']);

  const put = path => admin(call, `thumbs/${path}`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: jpeg(4) });
  assert.equal((await put('photos/2.jpg')).status, 200);
  assert.ok(same(PHOTOS.objects.get('photos/thumbs/2.jpg').bytes, jpeg(4)));
  assert.equal((await put('photos/9.jpg')).status, 404);
  assert.equal((await put('photos/thumbs/1.jpg')).status, 400);
  assert.deepEqual((await json(await admin(call, 'thumbs'))).body.pending, ['photos/3.jpg']);
});

test('每月排程清掉超過 30 天的 Trash（#501）；不叫縮圖 Action（縮圖改由網站產生，#566）', async () => {
  const { env, PHOTOS, calls } = await setup({ assets: { 'photos/1.jpg': OLD } });
  const now = Date.now();
  const oldId = await r2.toTrash(env, SITE, 'photos/1.jpg', { dogId: '1', kind: 'main' }, now - 31 * 86400000);
  const newId = await r2.toTrash(env, SITE, 'photos/1.jpg', { dogId: '1', kind: 'main' }, now - 29 * 86400000);
  await PHOTOS.put('photos/5.jpg', OLD);
  const r = await maintenance(env, now);
  assert.deepEqual(r, { at: new Date(now).toISOString(), purged: 1 });
  assert.equal(PHOTOS.objects.has(`trash/${oldId}/photo.jpg`), false);
  assert.equal(PHOTOS.objects.has(`trash/${newId}/photo.jpg`), true);
  assert.equal(dispatched(calls), 0);
});

test('沒有 R2：照片、dogs.json 照舊給靜態檔', async () => {
  const ASSETS = fakeAssets({ [`photos/${ID}.jpg`]: OLD, 'data/dogs.json': '{"dogs":[]}' });
  const env = { ASSETS };
  const photo = await worker.fetch(new Request(`${SITE}/photos/${ID}.jpg`), env);
  assert.ok(same(new Uint8Array(await photo.arrayBuffer()), OLD));
  assert.equal((await worker.fetch(new Request(`${SITE}/data/dogs.json`), env)).status, 410);
});

test('編輯紀錄（ADR 0004）：換照片記一筆，帶垃圾桶編號；沒選名字不能傳', async () => {
  const { env, call } = await setup({ assets: { [`photos/${ID}.jpg`]: OLD } });
  const noName = await call(`/api/photos/${ID}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: jpeg(1) });
  assert.equal(noName.status, 400);
  assert.equal((await upload(call, jpeg(2))).status, 200);
  const logged=(await env.DB.prepare('SELECT * FROM v3_edit_log').all()).results;
  assert.equal(logged.length,1);
  const {editor_name:name,kind,dog_number:number,before_json:before}=logged[0];
  assert.deepEqual([name, kind, number], ['小明', 'photo', ID]);
  assert.match(JSON.parse(before).trash, /./);
});
