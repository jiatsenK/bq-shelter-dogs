// 板收志工溜狗表：照片上傳服務（Cloudflare Worker，#47）
//
// 網站（GitHub Pages）→ 這個 Worker → GitHub API → photos/{編號}.jpg
// - GitHub 寫入權限（token）只放在 Worker 的 Secret「GITHUB_TOKEN」，不在網站、也不在 repo
// - 任何人都能上傳（不用登入），所以這裡做基本防護：只收網站來的要求、編號要在 data/dogs.json 裡、
//   只收 JPEG、限制大小、同一個人短時間內不能一直傳
// - 每次上傳都是 repo 裡的一筆提交，被亂傳可以從 git 歷史還原
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
// 編號只接受英數字（目前都是 10 位數字），也順便擋掉 ../ 之類的路徑
const ID_PATTERN = /^[0-9A-Za-z]{1,32}$/;

// 注意：Cloudflare 會同時開好幾份 Worker，下面這兩個暫存各自獨立，
// 所以頻率限制是「盡量擋」，不是精確計數；目的是擋住一直狂傳，不是算帳
const hits = new Map(); // IP → 上傳時間清單
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
  };
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function reply(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(origin ? corsHeaders(origin) : {}) },
  });
}

const fail = (status, error, origin) => reply(status, { ok: false, error }, origin);

// 記一次上傳；超過任一個限制就回 false（被擋下的不算次數）
function allowUpload(ip, now = Date.now()) {
  const longest = Math.max(...RATE_LIMITS.map(r => r.windowMs));
  const list = (hits.get(ip) || []).filter(t => now - t < longest);
  if (RATE_LIMITS.some(r => list.filter(t => now - t < r.windowMs).length >= r.max)) {
    hits.set(ip, list);
    return false;
  }
  list.push(now);
  hits.set(ip, list);
  // 別讓暫存無限長大
  if (hits.size > 5000) hits.delete(hits.keys().next().value);
  return true;
}

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

  const m = new URL(request.url).pathname.match(/^\/photos\/([^/]+)$/);
  const id = m ? decodeURIComponent(m[1]) : '';
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

export default {
  // 自動測試用（worker/test/worker.test.mjs）；Cloudflare 只會用到下面的 fetch
  testing: { MAX_BYTES, resetState, allowUpload, isJpeg },

  async fetch(request, env) {
    const cfg = config(env);
    const origin = request.headers.get('Origin') || '';
    const allowed = cfg.origins.includes(origin) ? origin : '';

    // 打開 Worker 網址就能看到服務有沒有在跑、token 設了沒（不會顯示 token 內容）
    if (request.method === 'GET' && new URL(request.url).pathname === '/') {
      return reply(200, { ok: true, service: '板收志工溜狗表 照片上傳服務', token: cfg.token ? '已設定' : '未設定' });
    }
    // 其他網站送來的一律不收（瀏覽器會擋掉沒有 CORS 回應的上傳）
    if (!allowed) return fail(403, '不接受這個網站的上傳', '');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(allowed) });
    if (request.method !== 'POST') return fail(405, '只接受上傳', allowed);
    try {
      return await upload(request, env, allowed);
    } catch (e) {
      return fail(500, '上傳服務發生錯誤，原本的照片不受影響', allowed);
    }
  },
};
