// 照片放在 Cloudflare R2（#130）：主照片、縮圖、Trash（誤刪可復原）；相簿 K 2026-10-09 拿掉
//
// - R2 是 Cloudflare 的檔案空間（bucket 名稱 bq-shelter-photos，Worker 裡叫 env.PHOTOS，設定在 wrangler.jsonc）。
//   照片路徑跟以前 repo 裡一樣（photos/{編號}.jpg、photos/thumbs/...），網址不用改
// - 有 R2 時，換照片只寫 R2，不再產生 GitHub 提交，馬上生效
// - 過渡期：R2 裡沒有的照片改讀 repo 裡的舊檔（部署上去的靜態檔）。刪掉或換掉的照片在 R2 留一個「刪除標記」
//   （0 位元組、customMetadata.deleted），這樣舊檔不會因為備援又跑出來
// - 換掉、刪掉之前先把原檔（含縮圖）複製到 trash/{代號}/，備份成功才動原檔；30 天後由 Cron 自動清掉

export const TRASH_DAYS = 30;
const VERSIONS_CACHE_MS = 30 * 1000;
const JPEG_META = { contentType: 'image/jpeg' };
// 只認得主照片和它的縮圖，其他一律不碰（也擋掉 ../ 之類的）；相簿照片（photos/gallery/）拿掉後不再給看、不做縮圖
const PHOTO_KEY = /^photos\/(?:thumbs\/)?[0-9A-Za-z]{1,32}\.jpg$/;
const TRASH_ID = /^\d{13}-[0-9a-f]{4}$/;

export const r2On = env => !!(env && env.PHOTOS);
export const isPhotoKey = key => PHOTO_KEY.test(key);
export const isThumbKey = key => key.startsWith('photos/thumbs/');
export const isTrashId = id => TRASH_ID.test(id);
export const thumbKey = key => key.replace(/^photos\//, 'photos/thumbs/');
export const isTomb = obj => !!(obj && obj.customMetadata && obj.customMetadata.deleted);

// 照片網址的版本號快取（同一份 Worker 內 30 秒）；寫入時清掉
let versionsCache = null;
export function resetR2State() {
  versionsCache = null;
}

function rand4() {
  return [...crypto.getRandomValues(new Uint8Array(2))].map(b => b.toString(16).padStart(2, '0')).join('');
}

// 讀一張照片：R2 有就用 R2（刪除標記算沒有）；R2 沒有就讀 repo 裡的舊檔。都沒有回 null
export async function readPhoto(env, base, key) {
  const obj = await env.PHOTOS.get(key);
  if (obj) return isTomb(obj) ? null : { bytes: new Uint8Array(await obj.arrayBuffer()), from: 'r2' };
  if (!env.ASSETS) return null;
  const res = await env.ASSETS.fetch(new Request(`${base}/${key}`));
  return res.ok ? { bytes: new Uint8Array(await res.arrayBuffer()), from: 'assets' } : null;
}

export async function putPhoto(env, key, bytes, meta = {}) {
  await env.PHOTOS.put(key, bytes, { httpMetadata: JPEG_META, customMetadata: meta });
  versionsCache = null;
}

// 刪除＝放刪除標記（不是真的刪），舊檔備援才不會又冒出來
export async function removePhoto(env, key, now = Date.now()) {
  await env.PHOTOS.put(key, new Uint8Array(0), { customMetadata: { deleted: new Date(now).toISOString() } });
  versionsCache = null;
}

// ── 網站讀照片：GET／HEAD /photos/... ──
// 網址有 ?v=（版本號）就讓手機快取 30 天，換照片版本號會變；沒有版本號只快取 1 分鐘
export async function servePhoto(request, env, ctx) {
  const url = new URL(request.url);
  let key = '';
  try { key = decodeURIComponent(url.pathname.slice(1)); } catch (e) { /* 亂碼網址當作找不到 */ }
  const cache = url.searchParams.has('v') ? 'public, max-age=2592000, immutable' : 'public, max-age=60';
  // 不認得的路徑（含拿掉的相簿照片 photos/gallery/）直接找不到，不退回舊檔
  if (!isPhotoKey(key)) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  // #279：完整網址含版本號；只快取 GET 的完整照片，不把 HEAD／304 存成圖片。
  const edge = url.searchParams.get('v') ? globalThis.caches?.default : null;
  const cacheKey = new Request(url, { method: 'GET' });
  if (edge) {
    let hit;
    try { hit = await edge.match(cacheKey); }
    catch (e) { console.warn('photo cache match', e); }
    if (hit) {
      const unchanged = request.headers.get('If-None-Match') === hit.headers.get('ETag');
      const out = new Response(unchanged || request.method === 'HEAD' ? null : hit.body,
        { status: unchanged ? 304 : hit.status, headers: hit.headers });
      out.headers.set('CF-Cache-Status', 'HIT');
      return out;
    }
  }
  const obj = await (request.method === 'HEAD' ? env.PHOTOS.head(key) : env.PHOTOS.get(key));
  if (isTomb(obj)) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (!obj) {
    const res = await env.ASSETS.fetch(request);
    if (!res.ok) return res;
    const out = new Response(res.body, res);
    out.headers.set('Cache-Control', cache);
    return out;
  }
  const headers = { 'Content-Type': 'image/jpeg', ETag: obj.httpEtag, 'Cache-Control': cache };
  if (request.headers.get('If-None-Match') === obj.httpEtag) return new Response(null, { status: 304, headers });
  const out = new Response(request.method === 'HEAD' ? null : obj.body, { headers });
  // 舊清單可能還帶舊版本號；不能把現在的照片存進不相符版本的邊緣快取。
  if (edge && request.method === 'GET' && url.searchParams.get('v') === String(obj.etag || '').replace(/"/g, '').slice(0, 8)) {
    out.headers.set('CF-Cache-Status', 'MISS');
    const pending = (async () => {
      try { await edge.put(cacheKey, out.clone()); }
      catch (e) { console.warn('photo cache put', e); }
    })();
    if (ctx?.waitUntil) ctx.waitUntil(pending);
    else await pending;
  }
  return out;
}

// R2 裡每張照片的版本號（etag 前 8 碼）和被刪掉的路徑
export async function r2Versions(env, now = Date.now()) {
  if (versionsCache && now - versionsCache.at < VERSIONS_CACHE_MS) return versionsCache;
  const objects = await listAll(env, 'photos/');
  const versions = {};
  const deleted = new Set();
  for (const o of objects) {
    if (isTomb(o)) deleted.add(o.key);
    else if (isPhotoKey(o.key)) versions[o.key] = String(o.etag || '').replace(/"/g, '').slice(0, 8); // 相簿照片拿掉了，不給版本號
  }
  versionsCache = { at: now, versions, deleted };
  return versionsCache;
}

async function listAll(env, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await env.PHOTOS.list({ prefix, cursor, include: ['customMetadata'] });
    out.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

// ── Trash ──
// trash/{代號}/photo.jpg（原圖，customMetadata 記原位置、狗、刪除時間）＋ thumb.jpg（有縮圖才有）。
// 原檔讀不到回 null（沒東西要備份）；寫 R2 失敗會丟錯，呼叫的地方就不要動原檔
export async function toTrash(env, base, key, info, now = Date.now()) {
  const photo = await readPhoto(env, base, key);
  if (!photo) return null;
  const thumb = await readPhoto(env, base, thumbKey(key));
  const id = `${now}-${rand4()}`;
  if (thumb) await env.PHOTOS.put(`trash/${id}/thumb.jpg`, thumb.bytes, { httpMetadata: JPEG_META });
  const meta = { path: key, deletedAt: new Date(now).toISOString(), thumb: thumb ? '1' : '' };
  for (const [k, v] of Object.entries(info || {})) if (v != null && v !== '') meta[k] = String(v);
  await env.PHOTOS.put(`trash/${id}/photo.jpg`, photo.bytes, { httpMetadata: JPEG_META, customMetadata: meta });
  return id;
}

export async function listTrash(env) {
  return (await listAll(env, 'trash/'))
    .filter(o => o.key.endsWith('/photo.jpg'))
    .map(o => ({ id: o.key.split('/')[1], size: o.size, ...(o.customMetadata || {}) }))
    .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
}

export async function readTrash(env, id) {
  if (!isTrashId(id)) return null;
  const obj = await env.PHOTOS.get(`trash/${id}/photo.jpg`);
  if (!obj) return null;
  const meta = obj.customMetadata || {};
  const thumb = meta.thumb ? await env.PHOTOS.get(`trash/${id}/thumb.jpg`) : null;
  return {
    meta,
    bytes: new Uint8Array(await obj.arrayBuffer()),
    thumb: thumb ? new Uint8Array(await thumb.arrayBuffer()) : null,
  };
}

export async function deleteTrash(env, id) {
  await env.PHOTOS.delete([`trash/${id}/photo.jpg`, `trash/${id}/thumb.jpg`]);
}

// 超過 30 天的清掉（Cron 呼叫）；回傳清掉幾筆
export async function purgeTrash(env, now = Date.now()) {
  const limit = now - TRASH_DAYS * 24 * 60 * 60 * 1000;
  let n = 0;
  for (const t of await listTrash(env)) {
    const at = Date.parse(t.deletedAt);
    if (!isNaN(at) && at < limit) {
      await deleteTrash(env, t.id);
      n++;
    }
  }
  return n;
}

// ── 縮圖 ──
// 還要做縮圖的原圖：R2 裡的主照片，縮圖不存在、被刪掉，或比原圖舊
export async function pendingThumbs(env) {
  const all = new Map((await listAll(env, 'photos/')).map(o => [o.key, o]));
  const time = o => (o.uploaded instanceof Date ? o.uploaded.getTime() : Date.parse(o.uploaded) || 0);
  const out = [];
  for (const [key, o] of all) {
    if (isThumbKey(key) || isTomb(o) || !isPhotoKey(key)) continue;
    const t = all.get(thumbKey(key));
    if (!t || isTomb(t) || time(t) < time(o)) out.push(key);
  }
  return out.sort();
}
