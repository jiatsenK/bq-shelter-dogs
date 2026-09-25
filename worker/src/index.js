// 板收志工溜狗表：照片上傳＋我的備註服務（Cloudflare Worker，#47、#61）
//
// 網站（GitHub Pages）→ 這個 Worker → GitHub API → photos/{編號}.jpg、data/my-notes.json
// - GitHub 寫入權限（token）只放在 Worker 的 Secret「GITHUB_TOKEN」，不在網站、也不在 repo
// - 任何人都能上傳（不用登入），所以這裡做基本防護：只收網站來的要求、編號要在 data/dogs.json 裡、
//   只收 JPEG、限制大小、同一個人短時間內不能一直傳
// - 每次上傳都是 repo 裡的一筆提交，被亂傳可以從 git 歷史還原
// - 我的備註（#61）：GET /notes 讀最新內容（不用等網站重新部署）；PUT /notes/{編號} 寫入，
//   送 JSON { text, passcode }，通關碼放在 Worker 的 Secret「NOTES_PASSCODE」
//   （通關碼放在內容裡、不放標頭，這樣中文通關碼也能用）。
//   repo 是公開的，備註內容任何人都看得到；通關碼只是擋住路人改掉備註
// - 相簿：每隻狗除了主照片（photos/{編號}.jpg）還能多放幾張，存在 photos/gallery/{編號}/，
//   清單在 data/gallery.json。GET /gallery 讀清單；POST /gallery/{編號} 新增（跟上傳主照片一樣不用登入）；
//   DELETE /gallery/{編號}/{檔名} 刪除，要跟我的備註同一組通關碼（避免路人亂刪）
//
// 這個檔案可以整份貼到 Cloudflare 網頁上的程式編輯器（不需要其他檔案），設定步驟見 docs/PHOTO_UPLOAD_SETUP.md。

// 預設值；想改的話可以在 Cloudflare 的「變數」設定同名變數蓋過去
const DEFAULTS = {
  GITHUB_REPO: 'jiatsenK/bq-shelter-dogs',
  GITHUB_BRANCH: 'main',
  // 只接受這些網站送來的上傳（用逗號分隔）
  ALLOWED_ORIGINS: 'https://jiatsenk.github.io',
  // 只有本機測試會換成假的 GitHub
  GITHUB_API: 'https://api.github.com',
};

// 網站會先把照片壓成長邊約 1280px 的 JPEG（通常 100–400 KB），這裡留足空間
const MAX_BYTES = 2 * 1024 * 1024;
// 頻率限制（每個連線來源 IP）：1 分鐘最多 5 張、1 小時最多 30 張
const RATE_LIMITS = [
  { windowMs: 60 * 1000, max: 5 },
  { windowMs: 60 * 60 * 1000, max: 30 },
];
// 相簿可以一次選好幾張、網站一張一張依序傳，所以另外算：1 分鐘最多 12 張、1 小時最多 60 張
const GALLERY_RATE_LIMITS = [
  { windowMs: 60 * 1000, max: 12 },
  { windowMs: 60 * 60 * 1000, max: 60 },
];
// 讀過的 dogs.json 暫存 5 分鐘，不用每張照片都去 GitHub 讀一次
const DOGS_CACHE_MS = 5 * 60 * 1000;
// 我的備註：存放位置、長度上限（字數）、一次送來的資料上限
const NOTES_PATH = 'data/my-notes.json';
const NOTE_MAX_CHARS = 1000;
const NOTE_MAX_BYTES = 16 * 1024;
// 備註寫入：1 分鐘最多 10 次、1 小時最多 60 次；讀取：1 分鐘最多 60 次
const NOTE_WRITE_LIMITS = [
  { windowMs: 60 * 1000, max: 10 },
  { windowMs: 60 * 60 * 1000, max: 60 },
];
const NOTE_READ_LIMITS = [{ windowMs: 60 * 1000, max: 60 }];
// 通關碼打錯：1 小時最多 10 次，超過就先不給試（擋住一直猜）
const PASSCODE_FAIL_LIMITS = [{ windowMs: 60 * 60 * 1000, max: 10 }];
// 編號只接受英數字（目前都是 10 位數字），也順便擋掉 ../ 之類的路徑
const ID_PATTERN = /^[0-9A-Za-z]{1,32}$/;
// 相簿：清單位置、照片資料夾、每隻狗最多幾張；檔名是 Worker 自己取的「日期-時間-亂數.jpg」
const GALLERY_PATH = 'data/gallery.json';
const GALLERY_DIR = 'photos/gallery';
const GALLERY_MAX = 30;
const GALLERY_FILE_PATTERN = /^\d{8}-\d{6}-[0-9a-f]{4}\.jpg$/;

// 注意：Cloudflare 會同時開好幾份 Worker，下面這兩個暫存各自獨立，
// 所以頻率限制是「盡量擋」，不是精確計數；目的是擋住一直狂傳，不是算帳
const hits = new Map(); // 種類:IP → 時間清單
let dogsCache = null; // { at, dogs: Map(編號 → 犬名) }

function resetState() {
  hits.clear();
  dogsCache = null;
}

function config(env) {
  const get = k => (env && env[k] ? String(env[k]) : DEFAULTS[k]);
  return {
    repo: get('GITHUB_REPO'),
    branch: get('GITHUB_BRANCH'),
    api: get('GITHUB_API').replace(/\/+$/, ''),
    origins: get('ALLOWED_ORIGINS').split(',').map(s => s.trim()).filter(Boolean),
    token: env && env.GITHUB_TOKEN,
    passcode: env && env.NOTES_PASSCODE ? String(env.NOTES_PASSCODE) : '',
  };
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function reply(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(origin ? corsHeaders(origin) : {}),
    },
  });
}

const fail = (status, error, origin, extra) => reply(status, { ok: false, error, ...(extra || {}) }, origin);

// 已經超過任一個限制了嗎（只看，不記）
function limited(key, limits, now) {
  const longest = Math.max(...limits.map(r => r.windowMs));
  const list = (hits.get(key) || []).filter(t => now - t < longest);
  hits.set(key, list);
  return limits.some(r => list.filter(t => now - t < r.windowMs).length >= r.max);
}

function record(key, now) {
  const list = hits.get(key) || [];
  list.push(now);
  hits.set(key, list);
  // 別讓暫存無限長大
  if (hits.size > 5000) hits.delete(hits.keys().next().value);
}

// 記一次；超過任一個限制就回 false（被擋下的不算次數）
function allow(key, limits, now) {
  if (limited(key, limits, now)) return false;
  record(key, now);
  return true;
}

const allowUpload = (ip, now = Date.now()) => allow(`photo:${ip}`, RATE_LIMITS, now);
const allowGalleryUpload = (ip, now = Date.now()) => allow(`gallery:${ip}`, GALLERY_RATE_LIMITS, now);

// JPEG 檔頭是 FF D8 FF
function isJpeg(bytes) {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(String(b64 || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function github(cfg, path, init = {}) {
  return fetch(`${cfg.api}/repos/${cfg.repo}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'bq-shelter-dogs-photo-upload',
      ...(init.headers || {}),
    },
  });
}

// 從 repo 讀 data/dogs.json，回傳 編號 → 犬名
async function loadDogs(cfg, now) {
  if (dogsCache && now - dogsCache.at < DOGS_CACHE_MS) return dogsCache.dogs;
  const res = await github(cfg, `contents/data/dogs.json?ref=${encodeURIComponent(cfg.branch)}`, {
    headers: { Accept: 'application/vnd.github.raw+json' },
  });
  if (!res.ok) throw new Error(`讀 dogs.json 失敗（GitHub ${res.status}）`);
  const data = await res.json();
  const dogs = new Map();
  for (const d of (data && data.dogs) || []) {
    const id = d && d.id != null ? String(d.id).trim() : '';
    if (id) dogs.set(id, String(d.name || '').trim());
  }
  dogsCache = { at: now, dogs };
  return dogs;
}

// 讀目前這張照片的 sha；沒有這張照片回 null
async function currentSha(cfg, path) {
  const res = await github(cfg, `contents/${path}?ref=${encodeURIComponent(cfg.branch)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`讀舊照片失敗（GitHub ${res.status}）`);
  const info = await res.json();
  return info.sha || null;
}

// 主照片和相簿共用的檢查：編號、JPEG、大小、頻率（主照片、相簿各算各的）、編號在 dogs.json 裡。
// 過了回 { bytes, dogs }，沒過回 { error: 回應 }
async function checkPhoto(request, cfg, id, now, origin, allowFn = allowUpload) {
  if (!ID_PATTERN.test(id)) return { error: fail(400, '狗狗編號格式不對', origin) };

  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'image/jpeg') return { error: fail(415, '只接受 JPEG 照片', origin) };
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_BYTES) return { error: fail(413, '照片太大', origin) };
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return { error: fail(400, '沒有收到照片', origin) };
  if (bytes.length > MAX_BYTES) return { error: fail(413, '照片太大', origin) };
  if (!isJpeg(bytes)) return { error: fail(415, '檔案不是 JPEG 照片', origin) };

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!allowFn(ip, now)) return { error: fail(429, '上傳太頻繁，請稍等幾分鐘再試', origin) };

  let dogs;
  try {
    dogs = await loadDogs(cfg, now);
  } catch (e) {
    return { error: fail(502, '暫時無法確認狗狗編號，請稍後再試', origin) };
  }
  if (!dogs.has(id)) return { error: fail(404, '找不到這個編號的狗狗', origin) };
  return { bytes, dogs };
}

async function upload(request, env, origin) {
  const cfg = config(env);
  const now = Date.now();
  if (!cfg.token) return fail(500, '上傳服務還沒設定好（缺 GITHUB_TOKEN）', origin);

  const m = new URL(request.url).pathname.match(/^\/photos\/([^/]+)$/);
  const id = m ? decodeURIComponent(m[1]) : '';
  const checked = await checkPhoto(request, cfg, id, now, origin);
  if (checked.error) return checked.error;
  const { bytes, dogs } = checked;

  const path = `photos/${id}.jpg`;
  const content = toBase64(bytes);
  // 有人同時換同一張照片時 sha 會對不上，重讀一次再試
  for (let attempt = 0; attempt < 2; attempt++) {
    let sha;
    try {
      sha = await currentSha(cfg, path);
    } catch (e) {
      return fail(502, '暫時無法連到 GitHub，請稍後再試', origin);
    }
    const name = dogs.get(id);
    const body = {
      message: `${sha ? '更換' : '上傳'}照片：${path}${name ? `（${name}）` : ''}\n\n網站匿名上傳（照片上傳服務）`,
      content,
      branch: cfg.branch,
    };
    if (sha) body.sha = sha;
    const res = await github(cfg, `contents/${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const out = await res.json().catch(() => ({}));
      return reply(200, { ok: true, id, replaced: !!sha, commit: out.commit && out.commit.sha }, origin);
    }
    if ((res.status === 409 || res.status === 422) && attempt === 0) continue;
    return fail(502, `照片沒有存進去（GitHub ${res.status}），原本的照片不受影響`, origin);
  }
  return fail(502, '照片沒有存進去，原本的照片不受影響', origin);
}

// ---- 我的備註（#61）----

// 讀 repo 裡「編號 → 內容」的 JSON 檔（data/my-notes.json、data/gallery.json）的最新內容與 sha；
// 檔案還沒建立就回空的
async function readJsonMap(cfg, path) {
  const res = await github(cfg, `contents/${path}?ref=${encodeURIComponent(cfg.branch)}`);
  if (res.status === 404) return { data: {}, sha: null };
  if (!res.ok) throw new Error(`讀 ${path} 失敗（GitHub ${res.status}）`);
  const info = await res.json();
  const text = new TextDecoder().decode(fromBase64(info.content));
  const data = text.trim() ? JSON.parse(text) : {};
  return { data: data && typeof data === 'object' && !Array.isArray(data) ? data : {}, sha: info.sha || null };
}

async function readNotes(cfg) {
  const { data, sha } = await readJsonMap(cfg, NOTES_PATH);
  return { notes: data, sha };
}

// 整理成純文字：統一換行、拿掉看不見的控制字元、去頭尾空白；不是字串回 null
function cleanNote(text) {
  if (typeof text !== 'string') return null;
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .trim();
}

// 比對通關碼：先各自雜湊再逐位比，比較時間不會洩漏對了幾個字
async function samePasscode(given, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const passcodeLocked = (ip, now) => limited(`pass:${ip}`, PASSCODE_FAIL_LIMITS, now);

// 通關碼對了回 null；不對就記一次錯、回錯誤（我的備註和刪相簿照片共用）
async function checkPasscode(input, cfg, ip, now, origin, missing) {
  const given = input && typeof input.passcode === 'string' ? input.passcode : '';
  if (given && (await samePasscode(given, cfg.passcode))) return null;
  record(`pass:${ip}`, now);
  return fail(401, given ? '通關碼不對' : missing, origin, { code: 'passcode' });
}

// 編號排序後輸出，每次存檔的差異只有改到的那隻狗
function serializeNotes(notes) {
  const sorted = {};
  for (const k of Object.keys(notes).sort()) sorted[k] = notes[k];
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

async function getNotes(request, env, origin) {
  const cfg = config(env);
  if (!cfg.token) return fail(500, '備註服務還沒設定好（缺 GITHUB_TOKEN）', origin);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!allow(`read:${ip}`, NOTE_READ_LIMITS, Date.now())) return fail(429, '讀取太頻繁，請稍等一下再試', origin);
  try {
    const { notes } = await readNotes(cfg);
    return reply(200, { ok: true, notes }, origin);
  } catch (e) {
    return fail(502, '暫時讀不到備註，請稍後再試', origin);
  }
}

async function putNote(request, env, origin) {
  const cfg = config(env);
  const now = Date.now();
  if (!cfg.token) return fail(500, '備註服務還沒設定好（缺 GITHUB_TOKEN）', origin);
  if (!cfg.passcode) return fail(500, '備註服務還沒設定好（缺 NOTES_PASSCODE）', origin);

  const m = new URL(request.url).pathname.match(/^\/notes\/([^/]+)$/);
  const id = m ? decodeURIComponent(m[1]) : '';
  if (!ID_PATTERN.test(id)) return fail(400, '狗狗編號格式不對', origin);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (passcodeLocked(ip, now)) return fail(429, '通關碼錯太多次，請一小時後再試', origin, { code: 'passcode' });

  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return fail(415, '備註格式不對', origin);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > NOTE_MAX_BYTES) return fail(413, `備註最多 ${NOTE_MAX_CHARS} 字`, origin);
  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    return fail(400, '備註格式不對', origin);
  }

  const denied = await checkPasscode(input, cfg, ip, now, origin, '需要通關碼才能寫備註');
  if (denied) return denied;

  const text = cleanNote(input.text);
  if (text === null) return fail(400, '備註要是文字', origin);
  if ([...text].length > NOTE_MAX_CHARS) return fail(413, `備註最多 ${NOTE_MAX_CHARS} 字`, origin);

  if (!allow(`note:${ip}`, NOTE_WRITE_LIMITS, now)) return fail(429, '寫入太頻繁，請稍等幾分鐘再試', origin);

  let dogs;
  try {
    dogs = await loadDogs(cfg, now);
  } catch (e) {
    return fail(502, '暫時無法確認狗狗編號，請稍後再試', origin);
  }

  // 每次都先讀最新版本再改，不會蓋掉別隻狗的備註；同時有人寫入（sha 對不上）就重讀再試
  for (let attempt = 0; attempt < 3; attempt++) {
    let current;
    try {
      current = await readNotes(cfg);
    } catch (e) {
      return fail(502, '暫時讀不到備註，請稍後再試，原本的備註不受影響', origin);
    }
    const notes = { ...current.notes };
    // 已經離開收容所的狗，舊備註還是可以改或刪；新增只限 dogs.json 裡的狗
    if (!dogs.has(id) && !(id in notes)) return fail(404, '找不到這個編號的狗狗', origin);
    if (!text && !(id in notes)) return reply(200, { ok: true, id, note: null, commit: null }, origin);

    const note = text ? { text, updatedAt: new Date(now).toISOString() } : null;
    if (note) notes[id] = note;
    else delete notes[id];
    const name = dogs.get(id);
    const body = {
      message: `${note ? '更新' : '刪除'}我的備註：${id}${name ? `（${name}）` : ''}\n\n網站寫入（備註服務，通關碼驗證）`,
      content: toBase64(new TextEncoder().encode(serializeNotes(notes))),
      branch: cfg.branch,
    };
    if (current.sha) body.sha = current.sha;
    const res = await github(cfg, `contents/${NOTES_PATH}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const out = await res.json().catch(() => ({}));
      return reply(200, { ok: true, id, note, commit: out.commit && out.commit.sha }, origin);
    }
    if ((res.status === 409 || res.status === 422) && attempt < 2) continue;
    return fail(502, `備註沒有存進去（GitHub ${res.status}），原本的備註不受影響`, origin);
  }
  return fail(502, '備註沒有存進去，原本的備註不受影響', origin);
}

// ---- 相簿 ----

// 整理成 編號 → [{ file, addedAt }]，只留格式對的檔名（清單被手動改壞也不會指到別的路徑）
function cleanGallery(data) {
  const out = {};
  for (const [id, list] of Object.entries(data || {})) {
    if (!ID_PATTERN.test(id) || !Array.isArray(list)) continue;
    const photos = list
      .filter(p => p && typeof p.file === 'string' && GALLERY_FILE_PATTERN.test(p.file))
      .map(p => ({ file: p.file, addedAt: typeof p.addedAt === 'string' ? p.addedAt : '' }));
    if (photos.length) out[id] = photos;
  }
  return out;
}

async function readGallery(cfg) {
  const { data, sha } = await readJsonMap(cfg, GALLERY_PATH);
  return { gallery: cleanGallery(data), sha };
}

// 檔名用台灣時間，在 GitHub 上看得出是哪天傳的；後面加 4 碼亂數，同一秒傳兩張也不會撞名
function galleryFileName(now) {
  const t = new Date(now + 8 * 60 * 60 * 1000).toISOString(); // 2026-09-25T15:30:12.345Z（已換成台灣時間）
  const rand = [...crypto.getRandomValues(new Uint8Array(2))].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${t.slice(0, 10).replace(/-/g, '')}-${t.slice(11, 19).replace(/:/g, '')}-${rand}.jpg`;
}

// 改相簿清單：每次都讀最新版本再改，同時有人改（sha 對不上）就重讀再試；
// change(清單) 回 false 表示不用改。回傳 { ok, status, changed }
async function updateGallery(cfg, message, change) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { gallery, sha } = await readGallery(cfg);
    if (change(gallery) === false) return { ok: true, changed: false };
    const body = { message, content: toBase64(new TextEncoder().encode(serializeNotes(gallery))), branch: cfg.branch };
    if (sha) body.sha = sha;
    const res = await github(cfg, `contents/${GALLERY_PATH}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true, changed: true };
    if ((res.status === 409 || res.status === 422) && attempt < 2) continue;
    return { ok: false, status: res.status };
  }
  return { ok: false, status: 409 };
}

async function getGallery(request, env, origin) {
  const cfg = config(env);
  if (!cfg.token) return fail(500, '相簿服務還沒設定好（缺 GITHUB_TOKEN）', origin);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!allow(`gread:${ip}`, NOTE_READ_LIMITS, Date.now())) return fail(429, '讀取太頻繁，請稍等一下再試', origin);
  try {
    const { gallery } = await readGallery(cfg);
    return reply(200, { ok: true, gallery }, origin);
  } catch (e) {
    return fail(502, '暫時讀不到相簿，請稍後再試', origin);
  }
}

// 新增一張：先存照片檔，再把它加進清單（兩筆提交）。清單沒更新成功時照片檔留在 repo 但網站不會顯示
async function addGalleryPhoto(request, env, origin, id) {
  const cfg = config(env);
  const now = Date.now();
  if (!cfg.token) return fail(500, '上傳服務還沒設定好（缺 GITHUB_TOKEN）', origin);
  const checked = await checkPhoto(request, cfg, id, now, origin, allowGalleryUpload);
  if (checked.error) return checked.error;
  const name = checked.dogs.get(id);
  const label = name ? `（${name}）` : '';

  try {
    const { gallery } = await readGallery(cfg);
    if ((gallery[id] || []).length >= GALLERY_MAX) return fail(409, `相簿最多 ${GALLERY_MAX} 張，請先刪掉幾張`, origin);
  } catch (e) {
    return fail(502, '暫時讀不到相簿，請稍後再試', origin);
  }

  const file = galleryFileName(now);
  const path = `${GALLERY_DIR}/${id}/${file}`;
  const res = await github(cfg, `contents/${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `新增相簿照片：${path}${label}\n\n網站匿名上傳（照片上傳服務）`,
      content: toBase64(checked.bytes),
      branch: cfg.branch,
    }),
  });
  if (!res.ok) return fail(502, `照片沒有存進去（GitHub ${res.status}），相簿不受影響`, origin);

  const photo = { file, addedAt: new Date(now).toISOString() };
  let saved;
  try {
    saved = await updateGallery(cfg, `相簿清單加入：${id}/${file}${label}\n\n網站匿名上傳（照片上傳服務）`, gallery => {
      gallery[id] = [...(gallery[id] || []), photo];
    });
  } catch (e) {
    saved = { ok: false, status: 502 };
  }
  if (!saved.ok) return fail(502, `照片存了但相簿清單沒有更新（GitHub ${saved.status}），請再傳一次`, origin);
  return reply(200, { ok: true, id, photo }, origin);
}

// 刪除一張：先從清單拿掉（網站馬上不顯示），再刪照片檔；檔案沒刪成功也算刪除成功（git 歷史本來就留著）
async function deleteGalleryPhoto(request, env, origin, id, file) {
  const cfg = config(env);
  const now = Date.now();
  if (!cfg.token) return fail(500, '相簿服務還沒設定好（缺 GITHUB_TOKEN）', origin);
  if (!cfg.passcode) return fail(500, '相簿服務還沒設定好（缺 NOTES_PASSCODE）', origin);
  if (!ID_PATTERN.test(id) || !GALLERY_FILE_PATTERN.test(file)) return fail(400, '照片名稱不對', origin);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (passcodeLocked(ip, now)) return fail(429, '通關碼錯太多次，請一小時後再試', origin, { code: 'passcode' });
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return fail(415, '格式不對', origin);
  const raw = await request.text();
  if (raw.length > NOTE_MAX_BYTES) return fail(413, '格式不對', origin);
  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    return fail(400, '格式不對', origin);
  }
  const denied = await checkPasscode(input, cfg, ip, now, origin, '需要通關碼才能刪照片');
  if (denied) return denied;
  if (!allow(`gdel:${ip}`, NOTE_WRITE_LIMITS, now)) return fail(429, '刪除太頻繁，請稍等幾分鐘再試', origin);

  let saved;
  try {
    saved = await updateGallery(cfg, `相簿清單移除：${id}/${file}\n\n網站刪除（相簿，通關碼驗證）`, gallery => {
      const list = gallery[id] || [];
      if (!list.some(p => p.file === file)) return false;
      const rest = list.filter(p => p.file !== file);
      if (rest.length) gallery[id] = rest;
      else delete gallery[id];
    });
  } catch (e) {
    saved = { ok: false, status: 502 };
  }
  if (!saved.ok) return fail(502, `照片沒有刪掉（GitHub ${saved.status}），請稍後再試`, origin);

  const path = `${GALLERY_DIR}/${id}/${file}`;
  let fileDeleted = false;
  try {
    const sha = await currentSha(cfg, path);
    if (sha) {
      const res = await github(cfg, `contents/${path}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `刪除相簿照片：${path}\n\n網站刪除（相簿，通關碼驗證）`, sha, branch: cfg.branch }),
      });
      fileDeleted = res.ok;
    }
  } catch (e) { /* 清單已拿掉，網站不會再顯示 */ }
  return reply(200, { ok: true, id, file, removed: saved.changed, fileDeleted }, origin);
}

export default {
  // 自動測試用（worker/test/worker.test.mjs）；Cloudflare 只會用到下面的 fetch
  testing: { MAX_BYTES, NOTE_MAX_CHARS, GALLERY_MAX, resetState, allowUpload, allowGalleryUpload, isJpeg, cleanNote, cleanGallery, galleryFileName },

  async fetch(request, env) {
    const cfg = config(env);
    const origin = request.headers.get('Origin') || '';
    const allowed = cfg.origins.includes(origin) ? origin : '';

    const path = new URL(request.url).pathname;

    // 打開 Worker 網址就能看到服務有沒有在跑、token 和通關碼設了沒（不會顯示內容）
    if (request.method === 'GET' && path === '/') {
      return reply(200, {
        ok: true,
        service: '板收志工溜狗表 照片上傳服務',
        token: cfg.token ? '已設定' : '未設定',
        notesPasscode: cfg.passcode ? '已設定' : '未設定',
      });
    }
    // 其他網站送來的一律不收（瀏覽器會擋掉沒有 CORS 回應的要求）
    if (!allowed) return fail(403, '不接受這個網站的要求', '');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(allowed) });

    if (path === '/notes' || path.startsWith('/notes/')) {
      try {
        if (request.method === 'GET' && path === '/notes') return await getNotes(request, env, allowed);
        if (request.method === 'PUT' && path !== '/notes') return await putNote(request, env, allowed);
        return fail(405, '備註只能讀取（GET /notes）或寫入（PUT /notes/編號）', allowed);
      } catch (e) {
        return fail(500, '備註服務發生錯誤，原本的備註不受影響', allowed);
      }
    }

    if (path === '/gallery' || path.startsWith('/gallery/')) {
      try {
        const [, id = '', file = '', extra] = path.split('/').slice(1).map(p => decodeURIComponent(p));
        if (request.method === 'GET' && path === '/gallery') return await getGallery(request, env, allowed);
        if (request.method === 'POST' && id && !file && extra === undefined) return await addGalleryPhoto(request, env, allowed, id);
        if (request.method === 'DELETE' && id && file && extra === undefined) return await deleteGalleryPhoto(request, env, allowed, id, file);
        return fail(405, '相簿只能讀取（GET /gallery）、新增（POST /gallery/編號）或刪除（DELETE /gallery/編號/檔名）', allowed);
      } catch (e) {
        return fail(500, '相簿服務發生錯誤，原本的照片不受影響', allowed);
      }
    }

    if (request.method !== 'POST') return fail(405, '只接受上傳', allowed);
    try {
      return await upload(request, env, allowed);
    } catch (e) {
      return fail(500, '上傳服務發生錯誤，原本的照片不受影響', allowed);
    }
  },
};
