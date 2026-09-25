// 板收志工溜狗表：照片上傳＋我的備註服務（Cloudflare Worker，#47、#61）
//
// 網站（GitHub Pages）→ 這個 Worker → GitHub API → photos/{編號}.jpg、cards/{編號}.jpg、data/my-notes.json
// - POST /photos/{編號}：狗狗照片；POST /cards/{編號}：入所時的原始狗卡圖（#66），檢查方式相同
// - GitHub 寫入權限（token）只放在 Worker 的 Secret「GITHUB_TOKEN」，不在網站、也不在 repo
// - 任何人都能上傳（不用登入），所以這裡做基本防護：只收網站來的要求、編號要在 data/dogs.json 裡、
//   只收 JPEG、限制大小、同一個人短時間內不能一直傳
// - 每次上傳都是 repo 裡的一筆提交，被亂傳可以從 git 歷史還原
// - 我的備註（#61）：GET /notes 讀最新內容（不用等網站重新部署）；PUT /notes/{編號} 寫入，
//   送 JSON { text, passcode }，通關碼放在 Worker 的 Secret「NOTES_PASSCODE」
//   （通關碼放在內容裡、不放標頭，這樣中文通關碼也能用）。
//   repo 是公開的，備註內容任何人都看得到；通關碼只是擋住路人改掉備註
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
// 可以上傳的圖片種類：網址第一段 → repo 裡的資料夾與提交說明用的名稱
const UPLOAD_KINDS = {
  photos: { dir: 'photos', label: '照片' },
  cards: { dir: 'cards', label: '狗卡圖' },
};
// 編號只接受英數字（目前都是 10 位數字），也順便擋掉 ../ 之類的路徑
const ID_PATTERN = /^[0-9A-Za-z]{1,32}$/;

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
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
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

async function upload(request, env, origin) {
  const cfg = config(env);
  const now = Date.now();
  if (!cfg.token) return fail(500, '上傳服務還沒設定好（缺 GITHUB_TOKEN）', origin);

  const m = new URL(request.url).pathname.match(/^\/([a-z]+)\/([^/]+)$/);
  const kind = m && Object.prototype.hasOwnProperty.call(UPLOAD_KINDS, m[1]) ? UPLOAD_KINDS[m[1]] : null;
  const id = m && kind ? decodeURIComponent(m[2]) : '';
  if (!ID_PATTERN.test(id)) return fail(400, '狗狗編號格式不對', origin);

  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'image/jpeg') return fail(415, '只接受 JPEG 照片', origin);
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_BYTES) return fail(413, '照片太大', origin);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return fail(400, '沒有收到照片', origin);
  if (bytes.length > MAX_BYTES) return fail(413, '照片太大', origin);
  if (!isJpeg(bytes)) return fail(415, '檔案不是 JPEG 照片', origin);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!allowUpload(ip, now)) return fail(429, '上傳太頻繁，請稍等幾分鐘再試', origin);

  let dogs;
  try {
    dogs = await loadDogs(cfg, now);
  } catch (e) {
    return fail(502, '暫時無法確認狗狗編號，請稍後再試', origin);
  }
  if (!dogs.has(id)) return fail(404, '找不到這個編號的狗狗', origin);

  const path = `${kind.dir}/${id}.jpg`;
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
      message: `${sha ? '更換' : '上傳'}${kind.label}：${path}${name ? `（${name}）` : ''}\n\n網站匿名上傳（照片上傳服務）`,
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

// 讀 data/my-notes.json 的最新內容與 sha；檔案還沒建立就回空的
async function readNotes(cfg) {
  const res = await github(cfg, `contents/${NOTES_PATH}?ref=${encodeURIComponent(cfg.branch)}`);
  if (res.status === 404) return { notes: {}, sha: null };
  if (!res.ok) throw new Error(`讀備註失敗（GitHub ${res.status}）`);
  const info = await res.json();
  const text = new TextDecoder().decode(fromBase64(info.content));
  const data = text.trim() ? JSON.parse(text) : {};
  const notes = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  return { notes, sha: info.sha || null };
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
  if (limited(`pass:${ip}`, PASSCODE_FAIL_LIMITS, now)) {
    return fail(429, '通關碼錯太多次，請一小時後再試', origin, { code: 'passcode' });
  }

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

  const given = input && typeof input.passcode === 'string' ? input.passcode : '';
  if (!given || !(await samePasscode(given, cfg.passcode))) {
    record(`pass:${ip}`, now);
    return fail(401, given ? '通關碼不對' : '需要通關碼才能寫備註', origin, { code: 'passcode' });
  }

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

export default {
  // 自動測試用（worker/test/worker.test.mjs）；Cloudflare 只會用到下面的 fetch
  testing: { MAX_BYTES, NOTE_MAX_CHARS, resetState, allowUpload, isJpeg, cleanNote },

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

    if (request.method !== 'POST') return fail(405, '只接受上傳', allowed);
    try {
      return await upload(request, env, allowed);
    } catch (e) {
      return fail(500, '上傳服務發生錯誤，原本的照片不受影響', allowed);
    }
  },
};
