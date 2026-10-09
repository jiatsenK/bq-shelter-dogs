// 板收志工溜狗表：照片上傳＋我的備註服務（Cloudflare Worker，#47、#61）
//
// 網站（GitHub Pages）→ 這個 Worker → GitHub API → photos/{編號}.jpg、data/my-notes.json
// #125 起網站也可以放在這個 Worker 裡（設定見 repo 根目錄的 wrangler.jsonc）：網頁是靜態檔案，API 在 /api 底下；
// 不帶 /api 前綴的路徑也還認得（舊的單獨照片 Worker 留下來的，2026-10 已刪）
// - GitHub 寫入權限（token）只放在 Worker 的 Secret「GITHUB_TOKEN」，不在網站、也不在 repo
// - 任何人都能上傳（不用登入），所以這裡做基本防護：只收網站來的要求、編號要在 data/dogs.json 裡、
//   只收 JPEG、限制大小、同一個人短時間內不能一直傳
// - 每次上傳都是 repo 裡的一筆提交，被亂傳可以從 git 歷史還原
// - 我的備註（#61）：GET /notes 讀最新內容（不用等網站重新部署）；PUT /notes/{編號} 寫入，
//   送 JSON { text, passcode }，通關碼放在 Worker 的 Secret「NOTES_PASSCODE」
//   （通關碼放在內容裡、不放標頭，這樣中文通關碼也能用）。
//   repo 是公開的，備註內容任何人都看得到；通關碼只是擋住路人改掉備註
// - 相簿 K 2026-10-09 拿掉（怕 Cloudflare 用量爆掉），只留主照片；/gallery 一律回 410
// - 休養中（K 2026-10-09）：PUT /rest/{編號} 送 { passcode, until: 'YYYY-MM-DD', reason } 設定、{ passcode, end: true } 結束，
//   寫進 repo 的 data/rest.json（跟我的備註同一組通關碼）。網站只讀這個檔；試算表一律不動
// - 誰遛的代號（#95）：POST /walker-code 送 { names: [...] }，回 { codes: [...] }。
//   用 Worker 的 Secret「WALKER_KEY」（跟 GitHub Actions 的同一組）算，網站拿不到密鑰；名字不存、不寫進任何紀錄
// - 定時叫同步：GitHub 自己的排程常被跳過（2026-09-27 一整天只跑一次），所以在 Cloudflare 設 Cron Trigger，
//   時間到就請 GitHub 跑「同步試算表」（.github/workflows/sync-sheet.yml）。token 要多開 Actions 寫入權限。
//   網站頁首的「更新」按鈕也可以叫：POST /sync（同一個人 2 分鐘 1 次）
//
// - 照片放 R2（#130）：Worker 有 R2（env.PHOTOS）時，照片、縮圖、Trash 都改存 R2，不再提交 GitHub（worker/src/r2.js）；
//   沒有 R2 時（例如單獨部署的舊照片 Worker）照舊寫 GitHub
//
// 設定步驟見 docs/CLOUDFLARE_SETUP.md。

import * as r2 from './r2.js';

// 預設值；想改的話可以在 Cloudflare 的「變數」設定同名變數蓋過去
const DEFAULTS = {
  GITHUB_REPO: 'jiatsenK/bq-shelter-dogs',
  GITHUB_BRANCH: 'main',
  // 除了同網址之外，另外接受哪些網站送來的要求（用逗號分隔）；網站和 Worker 同網址（#125）後不用設，舊網址 2026-10 拿掉
  ALLOWED_ORIGINS: '',
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
// 休養中：存放位置、原因最多幾個字、最多設多久（天）
const REST_PATH = 'data/rest.json';
const REST_REASON_MAX = 40;
const REST_MAX_DAYS = 180;
// 編號只接受英數字（目前都是 10 位數字），也順便擋掉 ../ 之類的路徑
const ID_PATTERN = /^[0-9A-Za-z]{1,32}$/;
// 誰遛的代號：一次最多幾個名字、每個名字最多幾個字、送來的資料上限；1 分鐘最多 20 次
const WALKER_MAX_NAMES = 8;
const WALKER_NAME_MAX_CHARS = 20;
const WALKER_MAX_BYTES = 2 * 1024;
const WALKER_LIMITS = [{ windowMs: 60 * 1000, max: 20 }];
const WALKER_CODE_LENGTH = 12;
// 按「溜了」寫進試算表（#138）：一次最多幾隻、送來的資料上限；1 分鐘最多 30 次、1 小時最多 200 次
const WALK_MAX_DOGS = 10;
const WALK_MAX_BYTES = 8 * 1024;
const WALK_LIMITS = [
  { windowMs: 60 * 1000, max: 30 },
  { windowMs: 60 * 60 * 1000, max: 200 },
];
const WALK_TIMEOUT_MS = 20 * 1000;
// 網站「更新」按鈕：同一個人 2 分鐘 1 次；同步本身要跑約 1 分鐘，按再多次也沒用
const SYNC_LIMITS = [{ windowMs: 2 * 60 * 1000, max: 1 }];
// 跟 scripts/sync-sheet.mjs 的 NAME_SEP 一樣：一格寫好幾個名字時用這些符號或空白隔開
const WALKER_NAME_SEP = /[、,，\/／&＆+＋。｡．.;；:：|｜·・\s]+/;

// 注意：Cloudflare 會同時開好幾份 Worker，下面這兩個暫存各自獨立，
// 所以頻率限制是「盡量擋」，不是精確計數；目的是擋住一直狂傳，不是算帳
const hits = new Map(); // 種類:IP → 時間清單
let dogsCache = null; // { at, dogs: Map(編號 → 犬名) }

let walkersCache = null; // GET /walkers 的快取（#141）
function resetState() {
  walkersCache = null;
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
    walkerKey: env && env.WALKER_KEY ? String(env.WALKER_KEY) : '',
    sheetWriteUrl: env && env.SHEET_WRITE_URL ? String(env.SHEET_WRITE_URL) : '',
    sheetWriteKey: env && env.SHEET_WRITE_KEY ? String(env.SHEET_WRITE_KEY) : '',
    sheetId: env && env.SHEET_ID ? String(env.SHEET_ID).trim() : '',
    // 照片放 R2 時（#130）狗的編號改讀部署上去的 data/dogs.json（每次同步完都會重新部署），照片操作就完全不用 GitHub
    assets: r2.r2On(env) && env.ASSETS ? env.ASSETS : null,
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

// 定時叫 GitHub 跑同步試算表；成功時 GitHub 回 204
const SYNC_WORKFLOW = 'sync-sheet.yml';
async function triggerSync(env) {
  const cfg = config(env);
  if (!cfg.token) throw new Error('沒有設定 GITHUB_TOKEN，無法叫同步');
  const res = await github(cfg, `actions/workflows/${SYNC_WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: cfg.branch }),
  });
  // 403／404 多半是 token 沒開 Actions 寫入權限；丟錯誤讓 Cloudflare 的 Cron 紀錄顯示失敗
  if (res.status !== 204) throw new Error(`叫同步失敗（GitHub ${res.status}）`);
  return res.status;
}

// 從 repo 讀 data/dogs.json（照片放 R2 時讀部署上去的那份），回傳 編號 → 犬名
async function loadDogs(cfg, now) {
  if (dogsCache && now - dogsCache.at < DOGS_CACHE_MS) return dogsCache.dogs;
  const res = cfg.assets
    ? await cfg.assets.fetch(new Request('https://assets.invalid/data/dogs.json'))
    : await github(cfg, `contents/data/dogs.json?ref=${encodeURIComponent(cfg.branch)}`, {
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

// 主照片的檢查：編號、JPEG、大小、頻率、編號在 dogs.json 裡。
// 過了回 { bytes, dogs }，沒過回 { error: 回應 }
async function checkPhoto(request, cfg, id, now, origin) {
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
  if (!allowUpload(ip, now)) return { error: fail(429, '上傳太頻繁，請稍等幾分鐘再試', origin) };

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

// 讀 repo 裡「編號 → 內容」的 JSON 檔（data/my-notes.json）的最新內容與 sha；
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

// 通關碼對了回 null；不對就記一次錯、回錯誤（我的備註用）
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

// 台灣今天的日期 YYYY-MM-DD
function taiwanYmd(now) {
  return new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 休養中（K 2026-10-09）：管理者在網站上設定「到哪天前暫停帶出」。要通關碼；只寫 repo 的 data/rest.json
async function putRest(request, env, origin) {
  const cfg = config(env);
  const now = Date.now();
  if (!cfg.token) return fail(500, '休養設定還沒準備好（缺 GITHUB_TOKEN）', origin);
  if (!cfg.passcode) return fail(500, '休養設定還沒準備好（缺 NOTES_PASSCODE）', origin);

  const m = new URL(request.url).pathname.match(/^\/rest\/([^/]+)$/);
  const id = m ? decodeURIComponent(m[1]) : '';
  if (!ID_PATTERN.test(id)) return fail(400, '狗狗編號格式不對', origin);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (passcodeLocked(ip, now)) return fail(429, '通關碼錯太多次，請一小時後再試', origin, { code: 'passcode' });
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return fail(415, '格式不對', origin);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 2048) return fail(413, '資料太長', origin);
  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    return fail(400, '格式不對', origin);
  }
  const denied = await checkPasscode(input, cfg, ip, now, origin, '需要通關碼才能設定休養');
  if (denied) return denied;

  let rest = null;
  if (input.end !== true) {
    const until = typeof input.until === 'string' ? input.until : '';
    const day = /^\d{4}-\d{2}-\d{2}$/.test(until) ? new Date(`${until}T00:00:00Z`) : null;
    if (!day || isNaN(day) || day.toISOString().slice(0, 10) !== until) return fail(400, '日期看不懂', origin);
    const today = new Date(`${taiwanYmd(now)}T00:00:00Z`);
    const days = Math.round((day - today) / 86400000);
    if (days < 0) return fail(400, '日期已經過了', origin);
    if (days > REST_MAX_DAYS) return fail(400, `最多設 ${REST_MAX_DAYS} 天`, origin);
    const reason = cleanNote(typeof input.reason === 'string' ? input.reason : '') || '';
    if ([...reason].length > REST_REASON_MAX) return fail(413, `原因最多 ${REST_REASON_MAX} 字`, origin);
    rest = { until, reason: reason.replace(/\n/g, ' '), updatedAt: new Date(now).toISOString() };
  }

  if (!allow(`rest:${ip}`, NOTE_WRITE_LIMITS, now)) return fail(429, '設定太頻繁，請稍等幾分鐘再試', origin);
  let dogs;
  try {
    dogs = await loadDogs(cfg, now);
  } catch (e) {
    return fail(502, '暫時無法確認狗狗編號，請稍後再試', origin);
  }

  // 跟我的備註一樣：先讀最新再改，同時有人改（sha 對不上）就重讀再試
  for (let attempt = 0; attempt < 3; attempt++) {
    let current;
    try {
      current = await readJsonMap(cfg, REST_PATH);
    } catch (e) {
      return fail(502, '暫時讀不到休養設定，請稍後再試', origin);
    }
    const map = { ...current.data };
    if (!dogs.has(id) && !(id in map)) return fail(404, '找不到這個編號的狗狗', origin);
    if (!rest && !(id in map)) return reply(200, { ok: true, id, rest: null, commit: null }, origin);
    if (rest) map[id] = rest;
    else delete map[id];
    const name = dogs.get(id);
    const body = {
      message: `${rest ? `休養中到 ${rest.until}` : '結束休養'}：${id}${name ? `（${name}）` : ''}\n\n網站寫入（休養設定，通關碼驗證）`,
      content: toBase64(new TextEncoder().encode(serializeNotes(map))),
      branch: cfg.branch,
    };
    if (current.sha) body.sha = current.sha;
    const res = await github(cfg, `contents/${REST_PATH}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const out = await res.json().catch(() => ({}));
      return reply(200, { ok: true, id, rest, commit: out.commit && out.commit.sha }, origin);
    }
    if ((res.status === 409 || res.status === 422) && attempt < 2) continue;
    return fail(502, `休養設定沒有存進去（GitHub ${res.status}）`, origin);
  }
  return fail(502, '休養設定沒有存進去', origin);
}

// ── 照片放 R2（#130）──
// 檢查（編號、JPEG、大小、頻率、編號在 dogs.json）跟寫 GitHub 時一樣，只是存的地方換成 R2：
// 不產生提交、馬上生效。換掉、刪掉之前先備份到 Trash，備份成功才動原檔

const THUMBS_WORKFLOW = 'r2-thumbs.yml';
const THUMB_MAX_BYTES = 512 * 1024;
const MIGRATE_MAX_ITEMS = 10;

// 做完回應後才跑的事（叫縮圖 Action）；測試沒有 ctx 就直接跑、不等
function later(ctx, promise) {
  const p = Promise.resolve(promise).catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(p);
}

// 請 GitHub 跑「產生照片縮圖（R2）」：下載 R2 裡還沒有縮圖的照片、做好縮圖傳回來（.github/workflows/r2-thumbs.yml）。
// 縮圖還沒好之前網站會先顯示原圖
async function queueThumbs(env) {
  const cfg = config(env);
  if (!cfg.token) return;
  await github(cfg, `actions/workflows/${THUMBS_WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: cfg.branch }),
  });
}

// Cron 順便做：清掉超過 30 天的 Trash；有照片還沒縮圖（例如上次叫 Action 失敗）就再叫一次
async function maintenance(env, now = Date.now()) {
  const purged = await r2.purgeTrash(env, now);
  const pending = await r2.pendingThumbs(env);
  if (pending.length) await queueThumbs(env);
  return { purged, pending: pending.length };
}

const baseOf = request => new URL(request.url).origin;
const siteMeta = now => ({ from: 'site', at: new Date(now).toISOString() });

async function uploadR2(request, env, origin, ctx) {
  const cfg = config(env);
  const now = Date.now();
  const base = baseOf(request);
  const m = new URL(request.url).pathname.match(/^\/photos\/([^/]+)$/);
  const id = m ? decodeURIComponent(m[1]) : '';
  const checked = await checkPhoto(request, cfg, id, now, origin);
  if (checked.error) return checked.error;

  const key = `photos/${id}.jpg`;
  let trashId;
  try {
    trashId = await r2.toTrash(env, base, key, { dogId: id, kind: 'main' }, now);
  } catch (e) {
    return fail(502, '舊照片備份失敗，這次沒有換，原本的照片不受影響', origin);
  }
  try {
    await r2.putPhoto(env, key, checked.bytes, siteMeta(now));
  } catch (e) {
    return fail(502, '照片沒有存進去，原本的照片不受影響', origin);
  }
  // 舊縮圖不能再用（已經跟原圖一起備份了）；新縮圖由 Action 做，做好前網站顯示原圖
  await r2.removePhoto(env, r2.thumbKey(key), now).catch(() => {});
  later(ctx, queueThumbs(env));
  return reply(200, { ok: true, id, replaced: !!trashId, commit: null, trash: trashId || null }, origin);
}

// ── 管理用 API（/api/admin/...）：搬遷、縮圖、Trash ──
// 給 GitHub Action 和之後的管理後台用，不看網站來源，改看標頭 X-Admin-Passcode（跟我的備註同一組通關碼，
// 用 encodeURIComponent 包起來，中文通關碼也能放標頭）
async function checkAdmin(request, cfg, origin) {
  if (!cfg.passcode) return fail(500, '還沒設定 NOTES_PASSCODE', origin);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  if (passcodeLocked(ip, now)) return fail(429, '通關碼錯太多次，請一小時後再試', origin, { code: 'passcode' });
  let given = '';
  try { given = decodeURIComponent(request.headers.get('X-Admin-Passcode') || ''); } catch (e) { /* 當作沒給 */ }
  if (given && (await samePasscode(given, cfg.passcode))) return null;
  record(`pass:${ip}`, now);
  return fail(401, given ? '通關碼不對' : '需要通關碼', origin, { code: 'passcode' });
}

async function readJsonBody(request, maxBytes) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > maxBytes) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

const cleanItems = items => Array.isArray(items) && items.length <= MIGRATE_MAX_ITEMS &&
  items.every(i => i && r2.isPhotoKey(i.path) && /^[0-9a-f]{64}$/.test(i.sha256) && Number.isInteger(i.size) && i.size > 0)
  ? items : null;

// 一次性搬遷：Action 送 repo 裡照片的路徑、sha256、大小（一次最多 10 張），Worker 從部署上去的舊檔複製到 R2。
// R2 已經有（網站換過、刪過）的不蓋掉；R2 寫入時用 sha256 驗證內容，跟 repo 的不一樣就不存
async function migrate(request, env, origin) {
  const cfg = config(env);
  const base = baseOf(request);
  const input = await readJsonBody(request, 16 * 1024);
  const items = input && cleanItems(input.items || []);
  if (!items) return fail(400, `要送 items：[{ path, sha256, size }]，一次最多 ${MIGRATE_MAX_ITEMS} 張`, origin);
  const results = [];
  for (const it of items) {
    const head = await env.PHOTOS.head(it.path);
    if (head) { results.push({ path: it.path, status: r2.isTomb(head) ? 'deleted' : 'exists' }); continue; }
    const res = await env.ASSETS.fetch(new Request(`${base}/${it.path}`));
    if (!res.ok) { results.push({ path: it.path, status: 'missing' }); continue; }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length !== it.size) { results.push({ path: it.path, status: 'mismatch' }); continue; }
    try {
      await env.PHOTOS.put(it.path, bytes, { httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { sha256: it.sha256, from: 'github' }, sha256: it.sha256 });
      results.push({ path: it.path, status: 'copied' });
    } catch (e) {
      results.push({ path: it.path, status: 'mismatch' });
    }
  }
  r2.resetR2State();
  return reply(200, { ok: true, results }, origin);
}

// 搬完核對：R2 裡每張的大小、sha256 跟 repo 的一樣嗎（網站後來換過、刪過的分開算，不算錯）
async function verify(request, env, origin) {
  const input = await readJsonBody(request, 16 * 1024);
  const items = input && cleanItems(input.items || []);
  if (!items) return fail(400, `要送 items：[{ path, sha256, size }]，一次最多 ${MIGRATE_MAX_ITEMS} 張`, origin);
  const results = [];
  for (const it of items) {
    const head = await env.PHOTOS.head(it.path);
    const meta = (head && head.customMetadata) || {};
    let status = 'missing';
    if (r2.isTomb(head)) status = 'deleted';
    else if (head && head.size === it.size && meta.sha256 === it.sha256) status = 'ok';
    else if (head && meta.from === 'site') status = 'changed';
    else if (head) status = 'mismatch';
    results.push({ path: it.path, status });
  }
  return reply(200, { ok: true, results }, origin);
}

// 縮圖 Action 傳回來的縮圖：PUT /admin/thumbs/photos/...（原圖的路徑）
async function putThumb(request, env, origin, key) {
  if (!r2.isPhotoKey(key) || r2.isThumbKey(key)) return fail(400, '照片路徑不對', origin);
  const original = await env.PHOTOS.head(key);
  if (!original || r2.isTomb(original)) return fail(404, '原圖不在 R2（可能剛被刪掉）', origin);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > THUMB_MAX_BYTES || !isJpeg(bytes)) return fail(415, '縮圖要是 512 KB 以內的 JPEG', origin);
  await r2.putPhoto(env, r2.thumbKey(key), bytes, { from: 'thumbs' });
  return reply(200, { ok: true, path: r2.thumbKey(key) }, origin);
}

// 從 Trash 復原到原本的狗和位置：主照片換回來，現在的主照片先進 Trash（相簿 K 2026-10-09 拿掉，相簿照片不能復原）
async function restoreTrash(request, env, origin, trashId) {
  const cfg = config(env);
  const now = Date.now();
  const base = baseOf(request);
  const t = await r2.readTrash(env, trashId);
  if (!t) return fail(404, 'Trash 裡找不到這張（可能已超過 30 天被清掉）', origin);
  const { meta } = t;
  const dogId = meta.dogId || '';
  if (!ID_PATTERN.test(dogId)) return fail(400, 'Trash 資料不完整，不能自動復原', origin);
  const putWithThumb = async key => {
    await r2.putPhoto(env, key, t.bytes, { from: 'restore', at: new Date(now).toISOString() });
    if (t.thumb) await r2.putPhoto(env, r2.thumbKey(key), t.thumb, { from: 'restore' });
    else await r2.removePhoto(env, r2.thumbKey(key), now);
  };

  if (meta.kind === 'gallery') return fail(410, '相簿已拿掉，相簿照片不能復原', origin);

  const key = `photos/${dogId}.jpg`;
  const backup = await r2.toTrash(env, base, key, { dogId, kind: 'main' }, now);
  await putWithThumb(key);
  await r2.deleteTrash(env, trashId);
  if (!t.thumb) await queueThumbs(env).catch(() => {});
  return reply(200, { ok: true, kind: 'main', dogId, path: key, trash: backup || null }, origin);
}

async function admin(request, env, origin, path) {
  const cfg = config(env);
  if (!r2.r2On(env)) return fail(503, '還沒接上 R2（照片空間），請照 docs/CLOUDFLARE_SETUP.md 設定', origin, { code: 'off' });
  if (env.PREVIEW && request.method !== 'GET') return fail(403, '這是預覽版，不能存，正式資料不受影響。要改請到正式網址', origin);
  const denied = await checkAdmin(request, cfg, origin);
  if (denied) return denied;
  const m = request.method;
  if (m === 'POST' && path === '/admin/migrate') return migrate(request, env, origin);
  if (m === 'POST' && path === '/admin/verify') return verify(request, env, origin);
  if (m === 'GET' && path === '/admin/thumbs') return reply(200, { ok: true, pending: await r2.pendingThumbs(env) }, origin);
  if (m === 'PUT' && path.startsWith('/admin/thumbs/')) return putThumb(request, env, origin, decodeURIComponent(path.slice('/admin/thumbs/'.length)));
  if (m === 'GET' && path === '/admin/trash') return reply(200, { ok: true, days: r2.TRASH_DAYS, trash: await r2.listTrash(env) }, origin);
  const restore = path.match(/^\/admin\/trash\/([^/]+)\/restore$/);
  if (m === 'POST' && restore) return restoreTrash(request, env, origin, decodeURIComponent(restore[1]));
  return fail(404, '沒有這個管理功能', origin);
}

// ── 誰遛的代號（#95）──
// 算法要跟 scripts/sync-sheet.mjs 的 walkerCode 完全一樣：名字全形半形統一（NFKC）、去空白、轉小寫，
// HMAC-SHA256(WALKER_KEY, 名字) 取前 12 碼十六進位。兩邊用同一組測試向量（WALKER_VECTORS）確認。
function walkerNameKey(name) {
  return String(name || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}
async function walkerCode(name, key) {
  const k = walkerNameKey(name);
  if (!k || !key) return '';
  const enc = new TextEncoder();
  const hmacKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, enc.encode(k)));
  return [...sig].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, WALKER_CODE_LENGTH);
}

// 輸入的每個名字再照試算表的規則拆開（例：「小明 明明」算兩個），這樣跟同步時拆出來的代號對得上
async function walkerCodes(request, env, origin) {
  const cfg = config(env);
  if (!cfg.walkerKey) return fail(500, '代號服務還沒設定好（缺 WALKER_KEY）', origin);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!allow(`walker:${ip}`, WALKER_LIMITS, Date.now())) return fail(429, '太頻繁了，請稍等一下再試', origin);

  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return fail(415, '格式不對', origin);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > WALKER_MAX_BYTES) return fail(413, '名字太長了', origin);
  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    return fail(400, '格式不對', origin);
  }
  if (!input || !Array.isArray(input.names) || input.names.some(n => typeof n !== 'string')) return fail(400, '請送名字清單', origin);
  const names = [...new Set(input.names.flatMap(n => n.split(WALKER_NAME_SEP)).map(n => n.trim()).filter(Boolean))];
  if (!names.length) return fail(400, '請輸入名字', origin);
  if (names.length > WALKER_MAX_NAMES) return fail(400, `最多 ${WALKER_MAX_NAMES} 個名字`, origin);
  if (names.some(n => [...n].length > WALKER_NAME_MAX_CHARS)) return fail(400, `每個名字最多 ${WALKER_NAME_MAX_CHARS} 個字`, origin);

  const codes = [];
  for (const n of names) {
    const c = await walkerCode(n, cfg.walkerKey);
    if (c && !codes.includes(c)) codes.push(c);
  }
  return reply(200, { ok: true, codes }, origin);
}

// ── 按「溜了」寫進試算表（#138）──
// 網站送 { action: 'walk' | 'undo', walker, dogs: [{ id, name, prev?, wrote? }] }，這裡檢查完帶上通關碼轉給
// Google Apps Script 小程式（apps-script/sheet-write.gs，K 用自己的帳號部署）。小程式只改「遛狗日期」「誰遛的」兩欄。
// ── 溜狗人名字（#141）：GET /walkers ──
// 名字不進 repo（dogs.json 只有代號），網站打開時跟這裡拿：Worker 直接讀試算表主清單（跟同步一樣用 gviz，試算表要「知道連結的人可檢視」），
// 回 { walkers: { 狗的 key: 「誰遛的」原文 }, names: [表上出現過的名字，出現多的在前] }；狗的 key 跟網站 walkKey 一樣（有編號用編號，沒有用「名:犬名」）。
// 5 分鐘內重複讀用快取，免得每個人打開都去讀 Google。沒設 SHEET_ID 回 503 + code: 'off'
const WALKERS_CACHE_MS = 5 * 60 * 1000;
export function gvizTable(text) {
  const m = String(text).match(/setResponse\(([\s\S]*)\);?\s*$/);
  if (!m) throw new Error('試算表回應格式不對');
  const data = JSON.parse(m[1]);
  if (data.status === 'error') throw new Error('試算表回應錯誤');
  return data.table || {};
}
function gvizCell(c) {
  if (!c || c.v == null) return '';
  if (typeof c.v === 'string' && c.v.startsWith('Date(')) return c.f || '';
  return String(c.v).trim();
}
// 主清單跟同步（scripts/sync-sheet.mjs）一樣分兩次讀：gviz 會照多數決猜欄位型別，表頭文字在數字欄會變空的，
// 所以先 headers=0 找表頭在第幾列，再指定表頭列數重讀、用欄位標題對欄（標題缺的用第一次讀到的表頭文字補）
const WALKERS_COLUMNS = { cage: '籠位', id: '編號', name: '犬名', walker: '誰遛的' };
function walkersColumns(texts) {
  const norm = texts.map(t => String(t || '').replace(/\s+/g, ''));
  const map = {};
  for (const [key, label] of Object.entries(WALKERS_COLUMNS)) {
    let i = norm.indexOf(label);
    if (i === -1) i = norm.findIndex(t => t.endsWith(label));
    if (i === -1) i = norm.findIndex(t => t.includes(label));
    if (i !== -1) map[key] = i;
  }
  return map;
}
export function walkersHeaderRow(table) {
  return (table.rows || []).findIndex(r => walkersColumns((r.c || []).map(gvizCell)).name != null);
}
// table：指定表頭列數重讀的結果；headerTexts：第一次讀到的表頭列。回 { walkers: { 狗的 key: 原文 }, names }
export function parseWalkers(table, headerTexts = []) {
  const map = walkersColumns((table.cols || []).map(c => (c && c.label) || ''));
  const fallback = walkersColumns(headerTexts);
  for (const k of Object.keys(WALKERS_COLUMNS)) if (map[k] == null && fallback[k] != null) map[k] = fallback[k];
  if (map.name == null || map.walker == null) throw new Error('主清單找不到「犬名」或「誰遛的」欄');
  const walkers = {};
  const count = new Map();
  for (const r of table.rows || []) {
    const c = (r.c || []).map(gvizCell);
    const name = c[map.name] || '', id = map.id == null ? '' : (c[map.id] || ''), text = c[map.walker] || '';
    // 跟同步一樣：要有犬名和籠位才算狗（表尾的提示文字不算）
    if (!name || (map.cage != null && !c[map.cage]) || name === WALKERS_COLUMNS.name || !text) continue;
    walkers[id || `名:${name}`] = text;
    for (const n of new Set(text.split(WALKER_NAME_SEP).map(x => x.trim()).filter(Boolean))) count.set(n, (count.get(n) || 0) + 1);
  }
  // 名字（開頭畫面讓志工點選自己）：出現次數多的在前
  const names = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant')).map(([n]) => n);
  return { walkers, names };
}
async function readWalkers(sheetId, fetchImpl = fetch) {
  const id = (sheetId.match(/\/d\/([A-Za-z0-9_-]+)/) || [])[1] || sheetId;
  const read = async headers => {
    const res = await fetchImpl(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/gviz/tq?tqx=out:json&headers=${headers}&sheet=${encodeURIComponent('主清單')}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return gvizTable(await res.text());
  };
  const raw = await read(0);
  const h = walkersHeaderRow(raw);
  if (h === -1) throw new Error('主清單找不到「犬名」表頭');
  return parseWalkers(await read(h + 1), ((raw.rows[h] || {}).c || []).map(gvizCell));
}
async function getWalkers(env, allowed, now = Date.now()) {
  const cfg = config(env);
  if (!cfg.sheetId) return reply(503, { ok: false, code: 'off', error: '還沒設定試算表' }, allowed);
  if (!walkersCache || walkersCache.id !== cfg.sheetId || now - walkersCache.at > WALKERS_CACHE_MS) {
    walkersCache = { id: cfg.sheetId, at: now, data: await readWalkers(cfg.sheetId) };
  }
  return reply(200, { ok: true, ...walkersCache.data }, allowed);
}

// 沒設定 SHEET_WRITE_URL 時回 503（SHEET_WRITE_KEY 可不設） + code: 'off'，網站就照舊只記在手機上
const shortText = (v, max) => typeof v === 'string' && [...v.trim()].length <= max && !/[\u0000-\u001f]/.test(v);
const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
function cleanWalkDog(d, action) {
  if (!d || typeof d !== 'object') return null;
  const id = typeof d.id === 'string' ? d.id.trim() : '';
  if (id && !ID_PATTERN.test(id)) return null;
  if (!shortText(d.name, 30) || !d.name.trim()) return null;
  const out = { id, name: d.name.trim() };
  if (action === 'edit') {
    if (!shortText(d.expected, 200) || !d.expected.trim()) return null;
    out.expected = d.expected.trim();
  }
  if (action === 'undo') {
    const p = d.prev, w = d.wrote;
    if (!p || !w || typeof p !== 'object' || typeof w !== 'object') return null;
    const date = p.date || {};
    if (date.date !== undefined && !YMD_PATTERN.test(date.date)) return null;
    if (date.date === undefined && !shortText(date.text || '', 40)) return null;
    if (!shortText(p.walker || '', 200) || !shortText(w.walker || '', 200)) return null;
    out.prev = { date: date.date !== undefined ? { date: date.date } : { text: date.text || '' }, walker: p.walker || '' };
    out.wrote = { walker: w.walker || '' };
  }
  return out;
}

async function writeWalks(request, env, origin) {
  const cfg = config(env);
  if (!cfg.sheetWriteUrl) return fail(503, '還沒設定寫入試算表', origin, { code: 'off' });
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!allow(`walk:${ip}`, WALK_LIMITS, Date.now())) return fail(429, '太頻繁了，請稍等一下再試', origin);
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return fail(415, '格式不對', origin);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > WALK_MAX_BYTES) return fail(413, '資料太大', origin);
  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    return fail(400, '格式不對', origin);
  }
  const action = input && input.action;
  if (!['walk', 'undo', 'edit'].includes(action)) return fail(400, '要說是溜了、修改還是復原', origin);
  if (!Array.isArray(input.dogs) || !input.dogs.length || input.dogs.length > WALK_MAX_DOGS) return fail(400, `一次 1–${WALK_MAX_DOGS} 隻`, origin);
  const dogs = input.dogs.map(d => cleanWalkDog(d, action));
  if (dogs.some(d => !d)) return fail(400, '狗的資料不對', origin);
  const body = { action, dogs };
  if (cfg.sheetWriteKey) body.key = cfg.sheetWriteKey;
  if (action === 'walk' || action === 'edit') {
    if (!shortText(input.walker, action === 'edit' ? 200 : WALKER_NAME_MAX_CHARS) || !input.walker.trim()) return fail(400, `名字要 1–${action === 'edit' ? 200 : WALKER_NAME_MAX_CHARS} 個字`, origin);
    body.walker = input.walker.trim();
  }

  let res, out = null;
  try {
    // Apps Script 回應會先轉址到 googleusercontent.com，fetch 會自己跟過去
    res = await fetch(cfg.sheetWriteUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(WALK_TIMEOUT_MS),
    });
    out = await res.json().catch(() => null);
  } catch (e) {
    return fail(502, '連不上試算表，請稍後再試', origin);
  }
  if (!res.ok || !out) return fail(502, `試算表沒有回應（${res.status}）`, origin);
  if (!out.ok) return fail(502, out.code === 'key' ? '寫入試算表的通關碼不對，請 K 檢查設定' : scriptError(out.error), origin);
  walkersCache = null; // 寫入後重新讀取完整名單
  return reply(200, { ok: true, today: out.today, results: Array.isArray(out.results) ? out.results : [] }, origin);
}

// 小程式的錯誤訊息會顯示給志工看：Google 的原始錯誤可能帶試算表 ID，換成白話、不帶 ID
function scriptError(msg) {
  const text = typeof msg === 'string' ? msg : '';
  if (!text) return '試算表沒有寫進去';
  if (/spreadsheet id|Illegal spreadsheet|找不到.*檔案|not found/i.test(text)) return '試算表 ID 不對，請 K 檢查小程式設定';
  if (/permission|權限|access/i.test(text)) return '小程式沒有試算表的編輯權限，請 K 檢查設定';
  if (text.startsWith('小程式發生錯誤')) return '小程式發生錯誤，請 K 查看 Apps Script 的執行紀錄';
  return [...text.replace(/[A-Za-z0-9_-]{25,}/g, '…')].slice(0, 100).join('');
}

export default {
  // 自動測試用（worker/test/worker.test.mjs）；Cloudflare 只會用到下面的 fetch 和 scheduled
  testing: { r2, MAX_BYTES, NOTE_MAX_CHARS, resetState, allowUpload, isJpeg, cleanNote, walkerCode, triggerSync, maintenance },

  // Cloudflare Cron Trigger 時間到會呼叫這裡（時間在 wrangler.jsonc 的 triggers）
  async scheduled(event, env, ctx) {
    ctx.waitUntil(triggerSync(env));
    if (r2.r2On(env)) ctx.waitUntil(maintenance(env));
  },

  async fetch(request, env, ctx) {
    const cfg = config(env);
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    // 網站跟 Worker 同一個網址時（#125）：送資料的要求帶自己的 Origin；讀取（GET）瀏覽器不帶 Origin，
    // 改看 Sec-Fetch-Site。同網址不需要 CORS，回 CORS 標頭也無妨
    const sameSite = origin ? origin === url.origin : request.headers.get('Sec-Fetch-Site') === 'same-origin';
    const allowed = cfg.origins.includes(origin) || sameSite ? (origin || url.origin) : '';

    // 網站和 Worker 合在一起時（#125），API 都在 /api 底下，其他路徑是網站的檔案（Cloudflare 會先找檔案，
    // 找不到才進來這裡）；單獨的照片上傳 Worker 沒有 /api 前綴，兩種都認
    let path = url.pathname;
    if (path === '/api' || path.startsWith('/api/')) {
      path = path.slice(4) || '/';
      // 下面各功能自己會再讀網址裡的編號，所以整個要求換成沒有 /api 的網址
      const plain = new URL(url);
      plain.pathname = path;
      request = new Request(plain, request);
    } else if (env && env.ASSETS && (request.method === 'GET' || request.method === 'HEAD')) {
      // 照片放 R2（#130）：照片、dogs.json（照片版本號）先經過這裡（wrangler.jsonc 的 run_worker_first）
      if (r2.r2On(env)) {
        try {
          if (path.startsWith('/photos/')) return await r2.servePhoto(request, env);
          if (path === '/data/dogs.json') return await r2.serveDogs(request, env);
        } catch (e) { /* R2 出問題就照舊給靜態檔 */ }
      }
      return env.ASSETS.fetch(request);
    }

    // 打開 Worker 網址（合在一起時是 /api/）就能看到服務有沒有在跑、token 和通關碼設了沒（不會顯示內容）
    if (request.method === 'GET' && path === '/') {
      return reply(200, {
        ok: true,
        service: '板收志工溜狗表 照片上傳服務',
        token: cfg.token ? '已設定' : '未設定',
        notesPasscode: cfg.passcode ? '已設定' : '未設定',
        walkerKey: cfg.walkerKey ? '已設定' : '未設定',
        sheetWrite: cfg.sheetWriteUrl ? '已設定' : '未設定',
        walkerNames: cfg.sheetId ? '已設定' : '未設定',
        photos: r2.r2On(env) ? 'R2' : 'GitHub',
        ...(env && env.PREVIEW ? { preview: '預覽版，不能存' } : {}),
      });
    }
    // 管理用（#130）：GitHub Action 呼叫、沒有網站來源，用通關碼驗證
    if (path.startsWith('/admin/')) {
      try {
        return await admin(request, env, allowed, path);
      } catch (e) {
        return fail(500, '管理功能發生錯誤', allowed);
      }
    }
    // 其他網站送來的一律不收（瀏覽器會擋掉沒有 CORS 回應的要求）
    if (!allowed) return fail(403, '不接受這個網站的要求', '');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(allowed) });
    // PR 預覽版（#126，部署時帶 PREVIEW 變數）：可以看、可以讀，但不能改正式資料（上傳、設主照片、刪除、備註、更新）。
    // 換代號只是計算、不寫任何東西，照常可以用
    if (env && env.PREVIEW && request.method !== 'GET' && path !== '/walker-code') {
      return fail(403, '這是預覽版，不能存，正式資料不受影響。要改請到正式網址', allowed);
    }

    if (path === '/notes' || path.startsWith('/notes/')) {
      try {
        if (request.method === 'GET' && path === '/notes') return await getNotes(request, env, allowed);
        if (request.method === 'PUT' && path !== '/notes') return await putNote(request, env, allowed);
        return fail(405, '備註只能讀取（GET /notes）或寫入（PUT /notes/編號）', allowed);
      } catch (e) {
        return fail(500, '備註服務發生錯誤，原本的備註不受影響', allowed);
      }
    }

    if (path.startsWith('/rest/')) {
      if (request.method !== 'PUT') return fail(405, '休養設定只能用 PUT /rest/編號', allowed);
      try {
        return await putRest(request, env, allowed);
      } catch (e) {
        return fail(500, '休養設定發生錯誤，原本的設定不受影響', allowed);
      }
    }

    if (path === '/walker-code') {
      if (request.method !== 'POST') return fail(405, '代號只能用 POST /walker-code 換', allowed);
      try {
        return await walkerCodes(request, env, allowed);
      } catch (e) {
        return fail(500, '名字設定暫時失敗，請稍後再試', allowed);
      }
    }

    if (path === '/walkers') {
      if (request.method !== 'GET') return fail(405, '溜狗人名字只能用 GET /walkers 讀', allowed);
      try {
        return await getWalkers(env, allowed);
      } catch (e) {
        return fail(502, '暫時讀不到試算表的溜狗人', allowed);
      }
    }

    if (path === '/walk') {
      if (request.method !== 'POST') return fail(405, '寫入試算表只能用 POST /walk', allowed);
      try {
        return await writeWalks(request, env, allowed);
      } catch (e) {
        return fail(500, '寫入試算表發生錯誤', allowed);
      }
    }

    if (path === '/sync') {
      if (request.method !== 'POST') return fail(405, '更新只能用 POST /sync', allowed);
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      if (!allow(`sync:${ip}`, SYNC_LIMITS, Date.now())) return fail(429, '剛剛已經在更新了，請稍等一下', allowed);
      try {
        await triggerSync(env);
        return reply(200, { ok: true }, allowed);
      } catch (e) {
        return fail(502, e.message || '叫同步失敗', allowed);
      }
    }

    // 相簿 K 2026-10-09 拿掉：舊版網頁還開著時送來的要求，老實說已經沒有這個功能
    if (path === '/gallery' || path.startsWith('/gallery/')) return fail(410, '相簿已經拿掉了，請重新整理網頁', allowed);

    if (request.method !== 'POST') return fail(405, '只接受上傳', allowed);
    try {
      return await (r2.r2On(env) ? uploadR2(request, env, allowed, ctx) : upload(request, env, allowed));
    } catch (e) {
      return fail(500, '上傳服務發生錯誤，原本的照片不受影響', allowed);
    }
  },
};
