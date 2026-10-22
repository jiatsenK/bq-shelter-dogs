import { resolveIdentity, renameIdentity, previewMerge, mergeIdentity, identitiesForCodes, IdentityError } from './identity.js';
import { cleanIntakeEvents } from './intake.js';
import { cleanStays } from './stays.js';
import { saveFixedCare, mainNameMatcher, replaceGroup } from './compact.js';
import { callSheet, SheetWriteError } from './sheet-write.js';
import { gvizTable, cellText, findHeaderRow, columnMap, MAIN_COLUMNS, NAME_SEP, splitNames } from './sheet-read.js';
import { readDepartedCards } from './departed.js';
import { ActivityError, activityLog, cleanActivity, createActivity, deleteActivity, readActivities, resolveDogs, updateActivity } from './activities.js';
import { acceptWalk, dispatchWalk, readAcceptedWalks, writebackTarget, confirmWalk } from './walk-accept.js';
import { retryWalks } from './walk-retry.js';
// 板收志工溜狗表：網站＋D1 API、R2 照片；我的備註 #252 退役。
// 網站上的編輯不用通關碼，改記編輯紀錄（ADR 0004）；管理 API 只給 GitHub Action，用 ADMIN_KEY。試算表只寫原有兩欄。
import * as r2 from './r2.js';
import { markChanged, planTick, refreshPlan, rememberSignature, sheetSignature, taiwanYmd } from './sync-plan.js';
import { todayRows, saveTodayWalks, readTodayWalks, resetTodayCache, previousWalk } from './today.js';
import { editorOf, editorHeader, logEdit, readEdits, walkerCode, walkerNameKey } from './editlog.js';
import { dogIdsFor, readFavorites, saveFavorite, openedBooks, saveRest, saveIntro, addFormerNumber, removeFormerNumber, saveStays, readMainNames } from './compact.js';
import { readSmall, readDepartureIndex, readDepartureYear, readDogsPacked, readWalksPacked, readWalksYear, readMineWalks, packStatus, resetPackCache } from './packs.js';

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
// 管理寫入頻率限制（介紹、休養共用）
const NOTE_WRITE_LIMITS = [
  { windowMs: 60 * 1000, max: 10 },
  { windowMs: 60 * 60 * 1000, max: 60 },
];
// 管理金鑰打錯：1 小時最多 10 次，超過就先不給試（擋住一直猜）
const ADMIN_FAIL_LIMITS = [{ windowMs: 60 * 60 * 1000, max: 10 }];
// 休養中：原因最多幾個字、最多設多久（天）
// 入所介紹（K 2026-10-10 電腦版補資料）：存 D1 的 v3_intros（#250），不寫試算表
const INTRO_MAX_CHARS = 1000;
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
// 網站「更新」按鈕：同一個人 2 分鐘 1 次；同步本身要跑約 1 分鐘，按再多次也沒用
const SYNC_LIMITS = [{ windowMs: 2 * 60 * 1000, max: 1 }];

// 注意：Cloudflare 會同時開好幾份 Worker，下面這兩個暫存各自獨立，
// 所以頻率限制是「盡量擋」，不是精確計數；目的是擋住一直狂傳，不是算帳
const hits = new Map(); // 種類:IP → 時間清單
let dogsCache = null; // { at, dogs: Map(編號 → 犬名) }

let walkersCache = null; // GET /walkers 的快取（#141）
function resetState() {
  walkersCache = null;
  walkerNamesRemembered = null;
  hits.clear();
  dogsCache = null;
  resetTodayCache();
  resetPackCache();
}

function config(env) {
  const get = k => (env && env[k] ? String(env[k]) : DEFAULTS[k]);
  return {
    repo: get('GITHUB_REPO'),
    branch: get('GITHUB_BRANCH'),
    api: get('GITHUB_API').replace(/\/+$/, ''),
    origins: get('ALLOWED_ORIGINS').split(',').map(s => s.trim()).filter(Boolean),
    token: env && env.GITHUB_TOKEN,
    adminKey: env && env.ADMIN_KEY ? String(env.ADMIN_KEY) : '',
    walkerKey: env && env.WALKER_KEY ? String(env.WALKER_KEY) : '',
    sheetWriteUrl: env && env.SHEET_WRITE_URL ? String(env.SHEET_WRITE_URL) : '',
    sheetWriteKey: env && env.SHEET_WRITE_KEY ? String(env.SHEET_WRITE_KEY) : '',
    sheetId: env && env.SHEET_ID ? String(env.SHEET_ID).trim() : '',
    // 編號驗證一律讀 D1，不讀 GitHub／靜態舊檔。
    db: env && env.DB ? env.DB : null,
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

// 資料庫（D1）：#247 起網站讀精簡新表（v3_，worker/src/compact.js），狀態頁報告新表有沒有接上、各幾筆。
// #315 起從資料包數（worker/src/packs.js），不整表 COUNT(*)，讀不到也不退回整表數
async function databaseStatus(env) {
  if (!env || !env.DB) return '未設定';
  try {
    const s = await packStatus(env.DB, taiwanYmd(Date.now()));
    return `D1 新表（主清單 ${s.dogs} 隻、溜狗紀錄 ${s.walks} 筆）`;
  } catch (e) {
    console.error('status', e);
    // 預覽版附上原因：預覽看不到 Cloudflare 紀錄，測試庫缺什麼要從這裡看（正式版不外露）
    return env.PREVIEW ? `D1（讀不到資料包版本號：${e.message}）` : 'D1（讀不到資料包版本號）';
  }
}

// 網站要的狗清單（#247）：形狀跟原本的 data/dogs.json 一樣，另外帶 R2 的照片版本號。
// 讀不到（沒接 D1、D1 出錯、還沒有狗）一律回 503，網站顯示錯誤，不會當成「沒有狗」
async function getDogs(env, origin) {
  const off = () => fail(503, '資料庫暫時讀不到狗的資料，請稍後再試', origin, { code: 'db' });
  if (!env || !env.DB) return off();
  let data;
  try {
    data = await readDogsPacked(env.DB);
  } catch (e) {
    console.error('dogs', e);
    return off();
  }
  if (r2.r2On(env)) {
    try {
      const { versions } = await r2.r2Versions(env);
      data.photoVersions = versions;
    } catch (e) { /* 沒有版本號只是照片可能用到快取，狗的資料照給 */ }
  }
  return reply(200, { ok: true, ...data }, origin);
}

// 定時叫 GitHub 跑同步試算表；成功時 GitHub 回 204
const SYNC_WORKFLOW = 'sync-sheet.yml';
// daily：台灣 6:30 的保險同步，同步會再核對每隻狗最後一次溜狗（ADR 0010）
async function triggerSync(env, { daily = false } = {}) {
  const cfg = config(env);
  if (!cfg.token) throw new Error('沒有設定 GITHUB_TOKEN，無法叫同步');
  const res = await github(cfg, `actions/workflows/${SYNC_WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: cfg.branch, ...(daily ? { inputs: { daily: 'true' } } : {}) }),
  });
  // 403／404 多半是 token 沒開 Actions 寫入權限；丟錯誤讓 Cloudflare 的 Cron 紀錄顯示失敗
  if (res.status !== 204) throw new Error(`叫同步失敗（GitHub ${res.status}）`);
  return res.status;
}

// 編號 → 犬名：只讀 D1 主清單；未接 D1 時停止照片寫入。
async function loadDogs(cfg, now) {
  if (!cfg.db) throw new Error('沒有接 D1，無法確認狗狗編號');
  if (dogsCache && dogsCache.db === cfg.db && now - dogsCache.at < DOGS_CACHE_MS) return dogsCache.dogs;
  const dogs = await readMainNames(cfg.db);
  dogsCache = { at: now, db: cfg.db, dogs };
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

// 介紹、休養共用的純文字整理
// 整理成純文字：統一換行、拿掉看不見的控制字元、去頭尾空白；不是字串回 null
function cleanNote(text) {
  if (typeof text !== 'string') return null;
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .trim();
}

// 比對金鑰：先各自雜湊再逐位比，比較時間不會洩漏對了幾個字
async function sameSecret(given, expected) {
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

const adminLocked = (ip, now) => limited(`admin:${ip}`, ADMIN_FAIL_LIMITS, now);
const needEditor = origin => fail(400, '請先選好你的名字再編輯', origin, { code: 'editor' });

// ── 網站上改一隻狗的資料（ADR 0004）：誰都能改、不用通關碼，先選好名字，記編輯紀錄 ──
// 共同步驟都在 editDog，照順序：有接 D1 → 網址編號 → JSON 本文（型別、大小） → 編輯者 → 欄位檢查 → 頻率 → 存 → 編輯紀錄 → 回應。
// 每種編輯（DOG_EDITS）只寫自己的部分：
// - check(input, ctx) → { value } 或 { error: [狀態, 訊息] }；ctx = { id, now, method }
// - save(db, id, value, ctx) → 找不到狗回 null；擋下回 { status, error }；否則 { dogId, before, ... }
// - log(value, saved, ctx) → 編輯紀錄的 { before, after }（可蓋掉 dogNumber）；回 null 不記
// - respond(value, saved, ctx) → 回給網站的內容（ok、id 自動加上）
// 介紹、出入所紀錄的 JSON 請求本文上限（位元組）；其他編輯的本文都很小
const EDIT_BODY_MAX_BYTES = 16000;
const SMALL_BODY_MAX_BYTES = 2048;

// 讀 JSON 本文：不是 JSON、太大都回 { error }，否則回 { input }
async function jsonBody(request, origin, tooLong, maxBytes = EDIT_BODY_MAX_BYTES) {
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return { error: fail(415, '格式不對', origin) };
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > maxBytes) return { error: fail(413, tooLong, origin) };
  try { return { input: JSON.parse(raw) }; } catch (e) { return { error: fail(400, '格式不對', origin) }; }
}

async function editDog(request, env, origin, edit) {
  if (!env || !env.DB) return fail(503, `${edit.label}還沒準備好（沒有接資料庫）`, origin, { code: 'db' });
  const m = new URL(request.url).pathname.match(/^\/[^/]+\/([^/]+)$/);
  const id = m ? decodeURIComponent(m[1]) : '';
  if (!ID_PATTERN.test(id)) return fail(400, '狗狗編號格式不對', origin);
  const body = await jsonBody(request, origin, edit.tooLong || '資料太長', edit.maxBytes || SMALL_BODY_MAX_BYTES);
  if (body.error) return body.error;
  const input = body.input && typeof body.input === 'object' ? body.input : {};
  const editor = await editorOf(input.editor, config(env).walkerKey);
  if (!editor) return needEditor(origin);
  const now = Date.now();
  const ctx = { id, now, method: request.method };
  const checked = edit.check(input, ctx);
  if (checked.error) return fail(checked.error[0], checked.error[1], origin);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!allow(`${edit.kind}:${ip}`, NOTE_WRITE_LIMITS, now)) return fail(429, edit.tooOften || '改得太頻繁，請稍等幾分鐘再試', origin);
  const saved = await edit.save(env.DB, id, checked.value, ctx);
  if (!saved) return fail(404, '找不到這個編號的狗狗', origin);
  if (saved.error) return fail(saved.status, saved.error, origin);
  const entry = edit.log(checked.value, saved, ctx);
  if (entry) await logEdit(env.DB, { editor, kind: edit.kind, dogId: saved.dogId, dogNumber: id, ...entry }, now);
  return reply(200, { ok: true, id, ...edit.respond(checked.value, saved, ctx) }, origin);
}

// 舊編號要是 10 碼、前 8 碼是看得懂的日期，而且不晚於現在的編號
const FORMER_PATTERN = /^(\d{4})(\d{2})(\d{2})\d{2}$/;
function formerDateOk(former) {
  const m = former.match(FORMER_PATTERN);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && d <= new Date();
}

// 網址第一段 → 編輯；methods：接受哪些方法；crash：存檔時出錯給網站看的話
const DOG_EDITS = {
  // 休養中（K 2026-10-09）：PUT /rest/{編號}，設定「到哪天前暫停帶出」，body { editor, until, reason } 或 { editor, end: true }；存 D1 的 v3_rest（#250）
  rest: {
    kind: 'rest', label: '休養設定', methods: ['PUT'], tooOften: '設定太頻繁，請稍等幾分鐘再試', crash: '休養設定發生錯誤，原本的設定不受影響',
    check(input, { now }) {
      if (input.end === true) return { value: null };
      const until = typeof input.until === 'string' ? input.until : '';
      const day = /^\d{4}-\d{2}-\d{2}$/.test(until) ? new Date(`${until}T00:00:00Z`) : null;
      if (!day || isNaN(day) || day.toISOString().slice(0, 10) !== until) return { error: [400, '日期看不懂'] };
      const days = Math.round((day - new Date(`${taiwanYmd(now)}T00:00:00Z`)) / 86400000);
      if (days < 0) return { error: [400, '日期已經過了'] };
      if (days > REST_MAX_DAYS) return { error: [400, `最多設 ${REST_MAX_DAYS} 天`] };
      const reason = cleanNote(typeof input.reason === 'string' ? input.reason : '') || '';
      if ([...reason].length > REST_REASON_MAX) return { error: [413, `原因最多 ${REST_REASON_MAX} 字`] };
      return { value: { until, reason: reason.replace(/\n/g, ' '), updatedAt: new Date(now).toISOString() } };
    },
    save: (db, id, rest) => saveRest(db, id, rest),
    log: (rest, saved) => ({ before: saved.before, after: rest && { until: rest.until, reason: rest.reason } }),
    respond: rest => ({ rest, commit: null }),
  },
  // 有人固定照顧（#399）：PUT /fixed-care/{編號}，body { editor, enabled }；沒變不記編輯紀錄
  'fixed-care': {
    kind: 'fixed-care', label: '固定照顧設定', methods: ['PUT'], tooOften: '設定太頻繁，請稍等幾分鐘再試', crash: '固定照顧設定未完成，請重新讀取後再試', maxBytes: EDIT_BODY_MAX_BYTES,
    check: input => (typeof input.enabled === 'boolean' ? { value: input.enabled } : { error: [400, '請指定開啟或關閉'] }),
    save: (db, id, enabled) => saveFixedCare(db, id, enabled),
    log: (enabled, saved, { id }) => (saved.before === enabled ? null : { dogNumber: id === saved.dogId ? '' : id, before: saved.before, after: enabled }),
    respond: enabled => ({ enabled }),
  },
  // 入所介紹（K 2026-10-10）：PUT /intro/{編號}，body { editor, text, events? }；#250 起存 D1 的 v3_intros，/api/dogs 馬上讀得到
  intro: {
    kind: 'intro', label: '介紹', methods: ['PUT'], crash: '介紹存檔發生錯誤，原本的介紹不受影響',
    maxBytes: EDIT_BODY_MAX_BYTES, tooLong: '介紹太長',
    check(input) {
      const text = cleanNote(input.text);
      if (text === null) return { error: [400, '格式不對'] };
      if ([...text].length > INTRO_MAX_CHARS) return { error: [413, `介紹最多 ${INTRO_MAX_CHARS} 字`] };
      const hasEvents = Object.prototype.hasOwnProperty.call(input, 'events');
      const events = hasEvents ? cleanIntakeEvents(input.events) : undefined;
      if (hasEvents && !events) return { error: [400, '事件格式不對：最多 30 列、事件合計最多 1000 字，日期請用 YYYY-MM-DD 或留空'] };
      return { value: { text, hasEvents, events } };
    },
    async save(db, id, { text, events }) {
      const saved = await saveIntro(db, id, text, events);
      return saved && saved.invalid ? { status: 400, error: saved.invalid } : saved;
    },
    log: ({ text, hasEvents, events }, saved) => ({ before: saved.before, after: hasEvents ? { text, events } : text }),
    respond: ({ text, hasEvents, events }) => ({ intro: text, ...(hasEvents ? { intakeEvents: events } : {}), commit: null }),
  },
  // 舊編號（#289，ADR 0005）：POST／DELETE /former/{編號}，body { editor, former }
  former: {
    kind: 'former', label: '舊編號', methods: ['POST', 'DELETE'], crash: '舊編號存檔發生錯誤，原本的資料不受影響',
    check(input, { id, method }) {
      const former = String(input.former || '').replace(/\s+/g, '');
      if (!formerDateOk(former)) return { error: [400, '舊編號要是 10 碼數字，前 8 碼是入所日期'] };
      if (former === id) return { error: [400, '這是現在的編號，不是舊編號'] };
      if (method === 'POST' && FORMER_PATTERN.test(id) && former > id) return { error: [400, '舊編號的日期不能比現在的編號晚'] };
      return { value: former };
    },
    save: (db, id, former, { method }) => (method === 'POST' ? addFormerNumber(db, id, former) : removeFormerNumber(db, id, former)),
    log: (former, saved, { method }) => (method === 'POST' ? { before: null, after: former } : { before: former, after: null }),
    respond: former => ({ former }),
  },
  // 出入所紀錄（#333，ADR 0011）：PUT /stays/{編號}，body { editor, before, stays }，整隻狗的陣列一次覆蓋（空陣列＝刪掉）；
  // before 是改之前看到的內容，別人剛改過就回 409
  stays: {
    kind: 'stays', label: '出入所紀錄', methods: ['PUT'], crash: '出入所紀錄存檔發生錯誤，原本的資料不受影響',
    maxBytes: EDIT_BODY_MAX_BYTES, tooLong: '出入所紀錄太長',
    check(input, { now }) {
      const today = taiwanYmd(now);
      const next = cleanStays(input.stays, today);
      if (next.error) return { error: [400, next.error] };
      // 沒帶或帶錯改之前的內容，一律當成別人剛改過
      const before = cleanStays(input.before, today);
      if (before.error) return { error: [409, '別人剛改過，請重新整理再改'] };
      return { value: { before: before.stays, stays: next.stays } };
    },
    save: (db, id, { before, stays }) => saveStays(db, id, before, stays),
    log: ({ stays }, saved) => ({ before: saved.before, after: stays.length ? stays : null }),
    respond: ({ stays }) => ({ stays }),
  },
};

// ---- 活動紀錄（#270，ADR 0002）：GET /activities；POST 新增、PUT／DELETE /activities/{id}，誰都能改（先選名字），記編輯紀錄 ----
// 改、刪要帶打開時看到的 revision，別人剛改過會被擋下來
const ACTIVITY_ID = /^[a-f0-9]{32}$/;
async function activities(request, env, origin) {
  if (!env || !env.DB) return fail(503, '活動紀錄還沒準備好（沒有接資料庫）', origin, { code: 'db' });
  const m = new URL(request.url).pathname.match(/^\/activities(?:\/([^/]+))?$/);
  const id = m && m[1] ? decodeURIComponent(m[1]) : '';
  if (!m || (m[1] && !ACTIVITY_ID.test(id))) return fail(404, '找不到這場活動', origin);
  const method = request.method;
  if (method === 'GET' && !id) return reply(200, { ok: true, activities: await readActivities(env.DB) }, origin);
  if (!(id ? ['PUT', 'DELETE'] : ['POST']).includes(method)) return fail(405, '活動紀錄只能用 GET／POST /activities、PUT／DELETE /activities/{id}', origin);

  const body = await jsonBody(request, origin, '資料太長');
  if (body.error) return body.error;
  const input = body.input || {};
  const editor = await editorOf(input.editor, config(env).walkerKey);
  if (!editor) return needEditor(origin);
  const now = Date.now();
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  try {
    const revision = Number.isInteger(input.revision) ? input.revision : null;
    if (id && revision === null) throw new ActivityError(400, '請重新整理後再改');
    const act = method === 'DELETE' ? null : cleanActivity(input, taiwanYmd(now));
    if (!allow(`activity:${ip}`, NOTE_WRITE_LIMITS, now)) return fail(429, '改得太頻繁，請稍等幾分鐘再試', origin);
    if (act) act.dogs = await resolveDogs(env.DB, act.dogs);
    let before = null, after = null;
    if (method === 'POST') after = await createActivity(env.DB, act);
    else if (method === 'PUT') ({ before, after } = await updateActivity(env.DB, id, revision, act));
    else ({ before } = await deleteActivity(env.DB, id, revision));
    await logEdit(env.DB, { editor, kind: 'activity', before: activityLog(before), after: activityLog(after) }, now);
    return reply(200, { ok: true, activity: after, ...(method === 'DELETE' ? { deleted: id } : {}) }, origin);
  } catch (e) {
    if (e instanceof ActivityError) return fail(e.status, e.message, origin);
    throw e;
  }
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

// 每天保險同步時順便做：清掉超過 30 天的 Trash。縮圖只在上傳時叫一次（#305），沒縮圖的網站顯示原圖
async function maintenance(env, now = Date.now()) {
  return { purged: await r2.purgeTrash(env, now) };
}

// Cron 每 10 分鐘一次（ADR 0012）：有改才叫同步，台灣 6:30 保險同步；叫完記下試算表指紋，之後按「更新」沒變就不用再叫
async function syncTick(env, now) {
  if (!env || !env.DB) return 'none';
  const plan = await planTick(env.DB, now);
  if (plan !== 'daily' && plan !== 'changed') return plan;
  try {
    await triggerSync(env, { daily: plan === 'daily' });
  } catch (e) {
    // 沒叫成就把「有改」放回去，下一格再試，不要等到隔天
    await markChanged(env.DB, now).catch(() => {});
    throw e;
  }
  const cfg = config(env);
  if (cfg.sheetId) await sheetSignature(cfg.sheetId).then(sig => rememberSignature(env.DB, sig)).catch(() => {});
  return plan;
}

// Apps Script 通知「試算表有人手動改了」（ADR 0012）：只記下有改，下一次 Cron 再同步。用專用密碼 SHEET_NOTIFY_KEY，不用 WALKER_KEY
async function sheetChanged(request, env) {
  const key = env && env.SHEET_NOTIFY_KEY ? String(env.SHEET_NOTIFY_KEY) : '';
  if (!key || !env.DB) return fail(503, '還沒設定試算表通知', '');
  if (env.PREVIEW) return fail(403, '這是預覽版，不收試算表通知', '');
  if (request.method !== 'POST') return fail(405, '試算表通知只能用 POST', '');
  if (request.headers.get('X-Notify-Key') !== key) return fail(403, '通知密碼不對', '');
  await markChanged(env.DB);
  return reply(200, { ok: true }, '');
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
// 只給 GitHub Action 用（ADR 0004，不做管理後台）：不看網站來源，改看標頭 X-Admin-Key（GitHub Secret ADMIN_KEY）
async function checkAdmin(request, cfg, origin) {
  if (!cfg.adminKey) return fail(500, '還沒設定 ADMIN_KEY', origin);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  if (adminLocked(ip, now)) return fail(429, '金鑰錯太多次，請一小時後再試', origin, { code: 'admin' });
  // encodeURIComponent 包起來，沿用舊的中文通關碼當金鑰也能放標頭
  let given = '';
  try { given = decodeURIComponent(request.headers.get('X-Admin-Key') || ''); } catch (e) { /* 當作沒給 */ }
  if (given && (await sameSecret(given, cfg.adminKey))) return null;
  record(`admin:${ip}`, now);
  return fail(401, given ? '金鑰不對' : '需要金鑰', origin, { code: 'admin' });
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
  if (!r2.r2On(env)) return fail(503, '還沒接上 R2（照片空間），請照 docs/setup/CLOUDFLARE_SETUP.md 設定', origin, { code: 'off' });
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
// walkerNameKey、walkerCode 在 editlog.js（編輯者也用同一套代號）

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
  const names = [...new Set(input.names.flatMap(n => n.split(NAME_SEP)).map(n => n.trim()).filter(Boolean))];
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
// 網站送 { action: 'walk' | 'undo', walker, dogs: [{ id, name, prev?, wrote? }] }；undo 沒帶 prev 時 Worker 從溜狗紀錄找（ADR 0016），這裡檢查完帶上金鑰（SHEET_WRITE_KEY）轉給
// Google Apps Script 小程式（apps-script/sheet-write.gs，K 用自己的帳號部署）。小程式只改「遛狗日期」「誰遛的」兩欄。
// ── 溜狗人名字（#141）：GET /walkers ──
// 名字不進 repo（dogs.json 只有代號），網站打開時跟這裡拿：Worker 直接讀試算表主清單（跟同步一樣用 gviz，試算表要「知道連結的人可檢視」），
// 回 { walkers: { 狗的 key: 「誰遛的」原文 }, names: [表上出現過的名字，出現多的在前], older: [以前看過、現在表上沒有的名字] }；狗的 key 跟網站 walkKey 一樣（有編號用編號，沒有用「名:犬名」）。
// 1 分鐘內重複讀用快取，免得每個人都去讀 Google。沒設 SHEET_ID 回 503 + code: 'off'
// K 2026-10-20：不管在網站按還是直接改試算表，其他手機 1 分鐘內要看到（原本 5 分鐘）。手機每分鐘跟著今日紀錄一起抓
const WALKERS_CACHE_MS = 60 * 1000;
// 看過的名字寫資料庫很花寫入額度（每個名字一列），快取改 1 分鐘後另外限制：名單沒變就 30 分鐘才記一次
const WALKER_NAMES_REMEMBER_MS = 30 * 60 * 1000;
let walkerNamesRemembered = null; // { at, names: 'a,b', older }
// 主清單跟同步一樣分兩次讀、用欄位標題對欄（worker/src/sheet-read.js）
// 「遛狗日期」：日期格式（gviz 的 Date(年,月-1,日)）或文字（2026/10/20、10/20）→ 'YYYY-MM-DD'；讀不懂回 ''
export function walkersDate(c, now = new Date()) {
  if (!c || c.v == null) return '';
  const ymd = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '');
  const g = typeof c.v === 'string' && c.v.match(/^Date\((\d+),(\d+),(\d+)/);
  if (g) return ymd(+g[1], +g[2] + 1, +g[3]);
  const t = String(c.f || c.v).trim();
  const full = t.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
  if (full) return ymd(+full[1], +full[2], +full[3]);
  const short = t.match(/^(\d{1,2})[/.-](\d{1,2})$/);
  if (short) return ymd(now.getFullYear(), +short[1], +short[2]);
  return '';
}
// table：指定表頭列數重讀的結果；headerTexts：第一次讀到的表頭列。回 { walkers: { 狗的 key: 原文 }, dates: { 狗的 key: 'YYYY-MM-DD' }, names }
export function parseWalkers(table, headerTexts = []) {
  const map = columnMap(table, headerTexts);
  if (map.name == null || map.walker == null) throw new Error('主清單找不到「犬名」或「誰遛的」欄');
  const walkers = {};
  const dates = {};
  const count = new Map();
  for (const r of table.rows || []) {
    const raw = r.c || [];
    const c = raw.map(cellText);
    const name = c[map.name] || '', id = map.id == null ? '' : (c[map.id] || ''), text = c[map.walker] || '';
    // 跟同步一樣：要有犬名和籠位才算狗（表尾的提示文字不算）
    if (!name || (map.cage != null && !c[map.cage]) || name === MAIN_COLUMNS.name) continue;
    // 試算表是正本（K 2026-10-20）：手機用這裡的日期蓋掉 dogs.json，直接改試算表也 1 分鐘內看到
    // 清空的格子也要回（空字串），手機才知道被清掉；日期讀不懂就不回，手機沿用上次同步的
    const key = id || `名:${name}`;
    const cell = map.walkedDate == null ? null : raw[map.walkedDate];
    const date = cell && cell.v != null && String(cell.f ?? cell.v).trim() ? walkersDate(cell) : '';
    if (date || (map.walkedDate != null && !(cell && cell.v != null && String(cell.f ?? cell.v).trim()))) dates[key] = date;
    walkers[key] = text;
    if (!text) continue;
    for (const n of new Set(splitNames(text))) count.set(n, (count.get(n) || 0) + 1);
  }
  // 名字（開頭畫面讓志工點選自己）：出現次數多的在前
  const names = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant')).map(([n]) => n);
  return { walkers, dates, names };
}
async function readWalkers(sheetId, fetchImpl = fetch) {
  const id = (sheetId.match(/\/d\/([A-Za-z0-9_-]+)/) || [])[1] || sheetId;
  const read = async headers => {
    const res = await fetchImpl(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/gviz/tq?tqx=out:json&headers=${headers}&sheet=${encodeURIComponent('主清單')}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return gvizTable(await res.text());
  };
  const raw = await read(0);
  const h = findHeaderRow(raw);
  if (h === -1) throw new Error('主清單找不到「犬名」表頭');
  return parseWalkers(await read(h + 1), ((raw.rows[h] || {}).c || []).map(cellText));
}
// 看過的名字記進資料庫（K 2026-10-12）：回「以前看過、現在表上沒有」的名字，最近看到的在前（older）。
// 沒接資料庫或資料庫出錯就回空的，名字清單照舊只有表上現在的
const WALKER_NAMES_MAX = 300;
export async function rememberWalkerNames(env, names, now = Date.now()) {
  if (!env || !env.DB) return [];
  try {
    const at = new Date(now).toISOString();
    // 只寫有變的（#407、ADR 0008）：新名字才新增；舊名字一天最多更新一次 last_seen，同一天再讀寫 0 列
    const upsert = env.DB.prepare('INSERT INTO v3_volunteers (name, last_seen) SELECT ?, ? WHERE NOT EXISTS(SELECT 1 FROM v3_identity_names WHERE name_key=?) ON CONFLICT(name) DO UPDATE SET last_seen = excluded.last_seen WHERE last_seen < ?');
    const day = at.slice(0, 10);
    if (names.length) await env.DB.batch(names.map(n => upsert.bind(n, at, walkerNameKey(n), day)));
    const { results = [] } = await env.DB.prepare('SELECT name FROM v3_volunteers WHERE volunteer_id NOT IN (SELECT volunteer_id FROM v3_identity_redirects) ORDER BY last_seen DESC, name LIMIT ?').bind(WALKER_NAMES_MAX).all();
    const now_ = new Set(names);
    return results.map(r => r.name).filter(n => typeof n === 'string' && n && !now_.has(n));
  } catch (e) {
    console.error('v3_volunteers', e);
    return [];
  }
}
// 電腦版「最近 30 天」要寫每天是誰遛的（K 2026-10-12）：walks.json 只有代號，這裡把名單上每個名字換成代號回給網站
// （{ 代號: 名字 }）。名單本來就公開在 /walkers、每個名字也能自己拿去 /walker-code 換，所以沒有多給什麼；沒設 WALKER_KEY 回空的
export async function walkerCodeMap(names, key) {
  const out = {};
  if (!key) return out;
  for (const n of new Set(names)) {
    const c = await walkerCode(n, key);
    if (c && !out[c]) out[c] = n;
  }
  return out;
}
async function getWalkers(env, allowed, now = Date.now()) {
  const cfg = config(env);
  if (!cfg.sheetId) return reply(503, { ok: false, code: 'off', error: '還沒設定試算表' }, allowed);
  if (!walkersCache || walkersCache.id !== cfg.sheetId || now - walkersCache.at > WALKERS_CACHE_MS) {
    const data = await readWalkers(cfg.sheetId);
    const key = data.names.join(',');
    const r = walkerNamesRemembered;
    const older = r && r.names === key && now - r.at < WALKER_NAMES_REMEMBER_MS ? r.older : await rememberWalkerNames(env, data.names, now);
    if (!r || r.names !== key || now - r.at >= WALKER_NAMES_REMEMBER_MS) walkerNamesRemembered = { at: now, names: key, older };
    // readAt：這份名單是什麼時候讀的。手機用它判斷今日溜狗紀錄是不是比試算表新（比它舊的以試算表為準）
    walkersCache = { id: cfg.sheetId, at: now, data: { ...data, older, readAt: new Date(now).toISOString(), codes: await walkerCodeMap([...data.names, ...older], cfg.walkerKey) } };
  }
  return reply(200, { ok: true, ...walkersCache.data }, allowed);
}

// 沒設定 SHEET_WRITE_URL 時回 503（SHEET_WRITE_KEY 可不設） + code: 'off'，網站就照舊只記在手機上
const shortText = (v, max) => typeof v === 'string' && [...v.trim()].length <= max && !/[\u0000-\u001f]/.test(v);
const NOTE_MAX_CHARS = 200;
const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
function cleanWalkDog(d, action, accepted = false) {
  if (!d || typeof d !== 'object') return null;
  const id = typeof d.id === 'string' ? d.id.trim() : '';
  if (id && !ID_PATTERN.test(id)) return null;
  if (!shortText(d.name, 30) || !d.name.trim()) return null;
  const out = { id, name: d.name.trim() };
  if (accepted && ['edit', 'undo'].includes(action)) {
    if (!Number.isSafeInteger(d.expectedVersion) || d.expectedVersion < 0) return null;
    out.expectedVersion = d.expectedVersion;
    return out;
  }
  if (action === 'edit') {
    if (!shortText(d.expected, 200) || !d.expected.trim()) return null;
    out.expected = d.expected.trim();
  }
  if (action === 'undo') {
    const p = d.prev, w = d.wrote;
    if (!w || typeof w !== 'object' || !shortText(w.walker || '', 200)) return null;
    // 沒有 prev：手機沒有復原證據，Worker 從溜狗紀錄找上一次（ADR 0016）；只撤銷只剩一個名字的登記
    if (p === undefined) {
      if (w.walker.split(NAME_SEP).filter(Boolean).length !== 1) return null;
      out.wrote = { walker: w.walker.trim() };
      out.lookup = true;
      return out;
    }
    if (!p || typeof p !== 'object') return null;
    const date = p.date || {};
    if (date.date !== undefined && !YMD_PATTERN.test(date.date)) return null;
    if (date.date === undefined && !shortText(date.text || '', 40)) return null;
    if (!shortText(p.walker || '', 200) || !shortText(w.walker || '', 200)) return null;
    out.prev = { date: date.date !== undefined ? { date: date.date } : { text: date.text || '' }, walker: p.walker || '' };
    out.wrote = { walker: w.walker || '' };
  }
  return out;
}

async function writeWalks(request, env, origin, ctx) {
  const cfg = config(env);
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
  if (!['walk', 'undo', 'edit', 'note', 'log'].includes(action)) return fail(400, '要說是溜了、修改、復原還是加備註', origin);
  // #239、#281：note 追加一隻狗的備註、log 新增一筆異動紀錄；都要有名字和內容
  const maxDogs = action === 'note' ? 1 : action === 'log' ? 0 : WALK_MAX_DOGS;
  const rawDogs = action === 'log' ? [] : input.dogs;
  if (maxDogs && (!Array.isArray(rawDogs) || !rawDogs.length || rawDogs.length > maxDogs)) return fail(400, `一次 1–${maxDogs} 隻`, origin);
  const dogs = rawDogs.map(d => cleanWalkDog(d, action, input.requestId !== undefined));
  if (dogs.some(d => !d)) return fail(400, '狗的資料不對', origin);
  if (input.requestId !== undefined) {
    if (!shortText(input.walker, action === 'edit' ? 200 : WALKER_NAME_MAX_CHARS) || !input.walker.trim()) return fail(400, '要先選好身分', origin);
    try {
      const result = await acceptWalk(env?.DB, { ...input, dogs }, env);
      // 沒有執行背景工作的 context 時仍保留 pending，不能等待 Google 才回接受。
      if (ctx?.waitUntil) ctx.waitUntil(dispatchWalk(env.DB, dogs[0], env).catch(e => console.error('walk-dispatch', e.message)));
      return reply(200, { ok: true, source: 'd1', today: input.operationDate, results: [result], snapshot: await readAcceptedWalks(env.DB, taiwanYmd(Date.now())) }, origin);
    } catch (e) {
      if (e.current) return reply(409, { ok: false, source: 'd1', error: e.message,
        results: [{ ...dogs[0], status: 'changed', version: e.version, current: e.current }],
        snapshot: await readAcceptedWalks(env.DB, taiwanYmd(Date.now())) }, origin);
      return fail(e.status || 503, e.status ? e.message : '登記尚未接受，請用原請求再試', origin);
    }
  }
  // 已接管的狗不再允許舊手機從另一入口覆蓋試算表。
  if (env?.DB && ['walk','edit','undo'].includes(action)) {
    for (const d of dogs) {
      if (await env.DB.prepare('SELECT dog_key FROM v3_walk_state WHERE dog_key=?').bind(d.id || `名:${d.name}`).first()) return fail(409, '此狗已使用新登記流程，請重新整理', origin);
    }
  }
  if (!cfg.sheetWriteUrl) return fail(503, '還沒設定寫入試算表', origin, { code: 'off' });
  const body = { action, dogs };
  if (action === 'note' || action === 'log') {
    if (!shortText(input.walker, WALKER_NAME_MAX_CHARS) || !input.walker.trim()) return fail(400, '要先選好身分', origin);
    if (!shortText(input.text, NOTE_MAX_CHARS) || !input.text.trim()) return fail(400, `內容要 1–${NOTE_MAX_CHARS} 個字，不能換行`, origin);
    body.walker = input.walker.trim();
    body.text = input.text.trim();
  }
  const lookups = action === 'undo' ? dogs.filter(d => d.lookup) : [];
  let editor = null;
  if (action === 'undo') {
    // 撤銷記進編輯紀錄（ADR 0016）；用伺服器找上一次時一定要先選好身分
    editor = await editorOf(input.walker, cfg.walkerKey);
    if (lookups.length && (!editor || !env?.DB)) return !editor ? fail(400, '要先選好身分', origin) : fail(503, '暫時無法撤銷，請稍後再試', origin);
  }
  const skipped = [];
  if (lookups.length) {
    const today = taiwanYmd(Date.now());
    for (const d of lookups) {
      delete d.lookup;
      const prev = await previousWalk(env.DB, d, today);
      if (prev) d.prev = prev; else skipped.push(d);
    }
    body.dogs = dogs.filter(d => !skipped.includes(d));
  }
  if (action === 'undo' && !body.dogs.length) return reply(200, { ok: true, today: taiwanYmd(Date.now()), results: skipped.map(d => ({ id: d.id, name: d.name, status: 'notFound' })) }, origin);
  if (action === 'walk' || action === 'edit') {
    if (!shortText(input.walker, action === 'edit' ? 200 : WALKER_NAME_MAX_CHARS) || !input.walker.trim()) return fail(400, `名字要 1–${action === 'edit' ? 200 : WALKER_NAME_MAX_CHARS} 個字`, origin);
    body.walker = input.walker.trim();
  }

  let out;
  try {
    out = await callSheet(env, body);
  } catch (e) {
    return sheetFail(e, origin);
  }
  walkersCache = null; // 寫入後重新讀取完整名單
  // 今日溜狗紀錄（ADR 0007）：其他手機不用等同步；寫失敗只記日誌，按的人照常成功
  if (['walk', 'edit', 'undo'].includes(action) && env && env.DB) {
    const today = YMD_PATTERN.test(out.today || '') ? out.today : taiwanYmd(Date.now());
    try {
      await saveTodayWalks(env.DB, today, todayRows(action, dogs, out.results, today));
    } catch (e) {
      console.error('today-walks', e);
    }
  }
  const results = Array.isArray(out.results) ? out.results : [];
  if (action === 'undo') {
    const today = YMD_PATTERN.test(out.today || '') ? out.today : taiwanYmd(Date.now());
    for (const r of results) {
      const d = r && r.status === 'restored' && body.dogs.find(x => x.id === (r.id || '') && x.name === r.name);
      if (!d) continue;
      r.prev = d.prev; // 網站照這個顯示撤銷後的上次溜
      const p = d.prev.date || {};
      await logEdit(env && env.DB, { editor, kind: 'walkundo', dogNumber: d.id, before: { date: today, walker: d.wrote.walker }, after: { date: p.date || p.text || '', walker: d.prev.walker } });
    }
    results.push(...skipped.map(d => ({ id: d.id, name: d.name, status: 'notFound' })));
  }
  // 備註、異動紀錄是只追加的編輯，記進編輯紀錄（ADR 0004）；名字用送來的 walker
  if (action === 'note' || action === 'log') {
    const editor = await editorOf(body.walker, cfg.walkerKey);
    await logEdit(env && env.DB, { editor, kind: action === 'note' ? 'note' : 'sheetlog', dogNumber: action === 'note' ? dogs[0].id || '' : '', before: null, after: body.text });
  }
  return reply(200, { ok: true, today: out.today, results }, origin);
}

// 編輯常遛狗群（K 2026-10-16 開放）：轉給小程式改「常遛狗群」分頁，成功後 D1 那一欄馬上換成小程式回的名單，
// 狗群頁不用等下一次同步。狗名一定要是主清單上的狗（照 D1 主清單複本）
const GROUP_LABEL_MAX_CHARS = 20;
async function writeGroup(request, env, origin) {
  const cfg = config(env);
  if (!cfg.sheetWriteUrl) return fail(503, '還沒設定寫入試算表', origin, { code: 'off' });
  if (!env?.DB) return fail(503, '狗群暫時無法編輯，請稍後再試', origin);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!allow(`walk:${ip}`, WALK_LIMITS, Date.now())) return fail(429, '太頻繁了，請稍等一下再試', origin);
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return fail(415, '格式不對', origin);
  const input = await readJsonBody(request, 4 * 1024);
  if (!input || !['add', 'remove', 'create'].includes(input.op)) return fail(400, '要說是加狗、移出還是開新群', origin);
  const editor = await editorOf(input.editor, cfg.walkerKey);
  if (!editor) return needEditor(origin);
  if (!shortText(input.name, 30) || !input.name.trim()) return fail(400, '要選一隻狗', origin);
  const body = { action: 'group', op: input.op, name: input.name.trim() };
  if (input.op === 'create') {
    if (!shortText(input.label, GROUP_LABEL_MAX_CHARS) || !input.label.trim()) return fail(400, `群名要 1–${GROUP_LABEL_MAX_CHARS} 個字`, origin);
    body.label = input.label.trim();
  } else {
    if (!Number.isInteger(input.column) || input.column < 0 || input.column > 200) return fail(400, '找不到這一群', origin);
    body.column = input.column;
  }
  const mainName = await mainNameMatcher(env.DB);
  if (!mainName(body.name)) return fail(400, '主清單上沒有這隻狗', origin);
  body.name = mainName(body.name);

  let out;
  try {
    out = await callSheet(env, body);
  } catch (e) {
    return sheetFail(e, origin);
  }
  const r = out.result || {};
  if (!Number.isInteger(r.column) || !Array.isArray(r.names)) return fail(502, '試算表回的資料不對', origin);
  const names = [...new Set(r.names.map(mainName).filter(Boolean))];
  const label = typeof r.label === 'string' ? r.label.trim() : '';
  const prevNames = await replaceGroup(env.DB, r.column, names, label);
  // 編輯紀錄（ADR 0004）：改前、改後都記這一群的名單；沒變（已經在、已經不在）不記
  if (r.status === 'written') {
    await logEdit(env.DB, { editor, kind: 'group', before: input.op === 'create' ? null : { label, names: prevNames }, after: { label, names } });
  }
  return reply(200, { ok: true, status: r.status || 'written', group: { column: r.column, label, names } }, origin);
}

// 小程式失敗（worker/src/sheet-write.js）換成給網站的回應；其他錯誤照常往外丟
function sheetFail(e, origin) {
  if (!(e instanceof SheetWriteError)) throw e;
  return fail(e.status, e.message, origin, e.code === 'off' ? { code: 'off' } : undefined);
}

// 圖鑑開卡：只加不刪，複合主鍵讓重送／多裝置不重複建立紀錄。
async function favorites(request, env, origin) {
  if (!env?.DB) return fail(503, '常溜暫時無法儲存', origin);
  if (!['GET', 'PUT'].includes(request.method)) return fail(405, '常溜只接受 GET 或 PUT', origin);
  const input = request.method === 'GET'
    ? { codes: (new URL(request.url).searchParams.get('codes') || '').split(',') }
    : await readJsonBody(request, 8 * 1024);
  if (!input || !Array.isArray(input.codes) || !input.codes.length || input.codes.length > 8 || !input.codes.every(c => typeof c === 'string' && /^[0-9a-f]{12}$/.test(c))) return fail(400, '個人代號格式不對', origin);
  const codes = [...new Set(input.codes)];
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!allow(`favorites:${request.method}:${ip}`, [{ windowMs: 60000, max: 120 }], Date.now())) return fail(429, '操作太頻繁，請稍後再試', origin);
  if (request.method === 'PUT') {
    if (typeof input.on !== 'boolean' || typeof input.dogId !== 'string' || !/^[a-f0-9]{32}$/.test(input.dogId)) return fail(400, '常溜資料不對', origin);
    if (!await saveFavorite(env.DB, codes, input.dogId, input.on, taiwanYmd(Date.now()))) return fail(400, '找不到這隻狗', origin);
    return reply(200, { ok: true }, origin);
  }
  // 手機只在還有舊格式常溜時才帶 key（#406）
  const keys = [...new Set(new URL(request.url).searchParams.getAll('key'))].filter(k => k.length <= 64).slice(0, 200);
  return reply(200, { ok: true, ...await readFavorites(env.DB, codes, keys) }, origin);
}

async function openedCards(request, env, origin) {
  if (!env?.DB) return fail(503, '開卡紀錄暫時無法儲存，請稍後再試', origin);
  if (!['GET', 'PUT'].includes(request.method)) return fail(405, '開卡紀錄只接受 GET 或 PUT', origin);
  const input = request.method === 'GET'
    ? { codes: (new URL(request.url).searchParams.get('codes') || '').split(',') }
    : await readJsonBody(request, 8 * 1024);
  if (!input || !Array.isArray(input.codes) || !input.codes.length || input.codes.length > 8 || !input.codes.every(c => typeof c === 'string' && /^[0-9a-f]{12}$/.test(c))) return fail(400, '個人代號格式不對', origin);
  const codes = [...new Set(input.codes)];
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!allow(`cards:${request.method}:${ip}`, [{ windowMs: 60000, max: 60 }], Date.now())) return fail(429, '操作太頻繁，請稍後再試', origin);
  if (request.method === 'PUT') {
    if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 50 || !input.ids.every(id => typeof id === 'string' && ID_PATTERN.test(id))) return fail(400, '每次最多記錄 50 張卡', origin);
    const ids = [...new Set(input.ids)];
    // #247：存永久狗 ID（v3_card_opened），再入所換了編號也還是同一張卡
    const dogIds = await dogIdsFor(env.DB, ids); // 舊編號和新編號會對到同一隻狗，所以下面依狗 ID 去重
    if (ids.some(id => !dogIds.has(id))) return fail(400, '找不到這隻狗', origin);
    const date = taiwanYmd(Date.now());
    const people = await identitiesForCodes(env.DB, codes);
    await env.DB.batch(people.flatMap(p => [...new Set(dogIds.values())].map(dogId => env.DB.prepare('INSERT OR IGNORE INTO v3_volunteer_cards (volunteer_id, dog_id, opened_on) VALUES ((SELECT volunteer_id FROM v3_identity_names WHERE code=?), ?, ?)').bind(p.codes[0], dogId, date))));
    return reply(200, { ok: true }, origin);
  }
  const books = await openedBooks(env.DB, codes);
  return reply(200, { ok: true, opened: { v: 1, codes: books } }, origin);
}

// ── 網站的 API（/api/路徑）：路徑 → { method, wrongMethod, crash, run } ──
// fetch 先做完共同的事（同網址或允許的來源、OPTIONS、預覽版不能寫），再查這張表：
// 方法不對回 405 wrongMethod；run 丟錯回 crash（[狀態, 訊息, 額外欄位]），寫進日誌。
// method 是 null 的，方法由 run 自己分（GET 讀、POST 寫）。改一隻狗的資料另外查 DOG_EDITS。
// run(c)：c = { request, env, origin, path, url, cfg, ctx }（path 已拿掉 /api）
const DB_DOWN = { code: 'db' };
const needDb = env => { if (!env || !env.DB) throw new Error('沒有 D1'); return env.DB; };
const yearParam = (url, pattern, message) => {
  const year = url.searchParams.get('year');
  return pattern.test(year) ? { year } : { error: message };
};
// ?year=YYYY&v=版本號（#346）：那一年的紀錄。版本號對得上才讓瀏覽器永久快取，版本號一變網址就變
function versioned(body, url, origin) {
  const res = reply(200, { ok: true, ...body }, origin);
  if (body.ver && url.searchParams.get('v') === body.ver) res.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return res;
}

async function identityRoute({ request, env, origin, path, cfg }) {
  if (!env?.DB || !cfg.walkerKey) return fail(503, '身分服務尚未準備好', origin);
  if (!allow('identity:' + (request.headers.get('CF-Connecting-IP') || 'unknown'), [{ windowMs: 60000, max: 120 }], Date.now())) return fail(429, '操作太頻繁，請稍後再試', origin);
  const input = await readJsonBody(request, 2048);
  if (!input || (!path.includes('merge') && (typeof input.name !== 'string' || !input.name.trim() || [...input.name.trim()].length > 20))) return fail(400, '名字要 1–20 個字', origin);
  if (path.endsWith('/rename') && (!/^[a-f0-9]{12}$/.test(input.code || '') || !/^[a-zA-Z0-9-]{1,80}$/.test(input.operationId || ''))) return fail(400, '操作格式不對', origin);
  try {
    if (path.includes('merge')) {
      if (!/^[a-f0-9]{12}$/.test(input.code || '') || !/^[a-f0-9]{12}$/.test(input.targetCode || '')) return fail(400, '身分格式不對', origin);
      if (path.endsWith('merge-preview')) return reply(200, { ok: true, ...await previewMerge(env.DB, input, cfg.walkerKey) }, origin);
      if (!/^[a-zA-Z0-9-]{1,80}$/.test(input.operationId || '')) return fail(400, '操作格式不對', origin);
      return reply(200, { ok: true, identity: await mergeIdentity(env.DB, input, cfg.walkerKey) }, origin);
    }
    const identity = path.endsWith('/rename') ? await renameIdentity(env.DB, { ...input, name: input.name.trim() }, cfg.walkerKey) : await resolveIdentity(env.DB, input.name.trim(), cfg.walkerKey);
    return reply(200, { ok: true, identity }, origin);
  } catch (e) {
    if (e instanceof IdentityError) return reply(e.status, { ok: false, error: e.message, ...e.details }, origin);
    console.error('identity', e); return fail(409, '身分資料已變動，請重新檢視', origin);
  }
}
const IDENTITY = { method: 'POST', wrongMethod: '請用 POST 設定身分', crash: [409, '身分資料已變動，請重新檢視'], run: identityRoute };

const SITE_ROUTES = {
  // 網站要的狗清單（#247）
  '/dogs': { method: 'GET', wrongMethod: '狗的資料只能用 GET /dogs 讀', crash: [503, '資料庫暫時讀不到狗的資料，請稍後再試', DB_DOWN],
    run: ({ env, origin }) => getDogs(env, origin) },
  // 志工身分、更名、合併（ADR 0005）
  '/identity': IDENTITY, '/identity/rename': IDENTITY, '/identity/merge-preview': IDENTITY, '/identity/merge': IDENTITY,
  '/cards/opened': { method: null, crash: [503, '開卡紀錄暫時讀寫失敗，請稍後再試'], run: ({ request, env, origin }) => openedCards(request, env, origin) },
  '/favorites': { method: null, crash: [503, '常溜暫時讀寫失敗，請稍後再試'], run: ({ request, env, origin }) => favorites(request, env, origin) },
  // 我溜過的狗（ADR 0013，#344）：代號放在請求內容，不放網址
  '/walks/mine': { method: 'POST', wrongMethod: '只能用 POST /walks/mine', crash: [503, '暫時讀不到溜狗紀錄', DB_DOWN],
    async run({ request, env, origin }) {
      const input = await readJsonBody(request, 4096);
      const codes = input && input.codes;
      if (!Array.isArray(codes) || codes.length > 100 || !codes.every(c => typeof c === 'string' && /^[a-f0-9]{12}$/.test(c))) return fail(400, '代號格式不對', origin);
      return reply(200, { ok: true, dogs: await readMineWalks(needDb(env), taiwanYmd(Date.now()), codes) }, origin);
    } },
  // 溜狗紀錄（#260）：形狀跟原本的 data/walks.json 一樣；?year= 拿那一年
  '/walks': { method: 'GET', wrongMethod: '只能用 GET 讀', crash: [503, '暫時讀不到溜狗紀錄', DB_DOWN],
    async run({ env, origin, url }) {
      const db = needDb(env);
      if (!url.searchParams.has('year')) return reply(200, { ok: true, ...await readWalksPacked(db, taiwanYmd(Date.now())) }, origin);
      const { year, error } = yearParam(url, /^\d{4}$/, 'year 要是四位數年份');
      return error ? fail(400, error, origin) : versioned(await readWalksYear(db, taiwanYmd(Date.now()), year), url, origin);
    } },
  // 離所紀錄（#260）；?year=YYYY|none&v=版本號 拿那一年
  '/departures': { method: 'GET', wrongMethod: '只能用 GET 讀', crash: [503, '暫時讀不到離所紀錄', DB_DOWN],
    async run({ env, origin, url }) {
      const db = needDb(env);
      if (!url.searchParams.has('year')) return reply(200, { ok: true, version: 1, departures: await readSmall(db, 'departures') }, origin);
      const { year, error } = yearParam(url, /^(\d{4}|none)$/, 'year 要是四位數年份或 none');
      return error ? fail(400, error, origin) : versioned(await readDepartureYear(db, year), url, origin);
    } },
  // 離所名冊索引（#363）：分析頁的每年長條圖、名冊搜尋用
  '/departures/index': { method: 'GET', wrongMethod: '只能用 GET 讀', crash: [503, '暫時讀不到離所紀錄', DB_DOWN],
    run: async ({ env, origin }) => reply(200, { ok: true, ...await readDepartureIndex(needDb(env)) }, origin) },
  // 已出所狗卡（#271）：圖鑑的「已出所」名單，誰都看得到
  '/departed-cards': { method: 'GET', wrongMethod: '只能用 GET /departed-cards 讀', crash: [503, '暫時讀不到已出所的狗', DB_DOWN],
    run: async ({ env, origin }) => reply(200, { ok: true, dogs: await readDepartedCards(needDb(env), taiwanYmd(Date.now())) }, origin) },
  // 今日溜狗紀錄（ADR 0007）：網站每分鐘來讀今天的清單；讀不到網站就照舊不顯示錯誤
  '/today': { method: 'GET', wrongMethod: '只能用 GET /today 讀', crash: [503, '暫時讀不到今日溜狗紀錄', DB_DOWN],
    async run({ env, origin, url }) {
      const today = taiwanYmd(Date.now());
      if (url.searchParams.get('source') === 'd1') return reply(200, { ok: true, ...await readAcceptedWalks(env.DB, today) }, origin);
      return reply(200, { ok: true, date: today, walks: await readTodayWalks(needDb(env), today) }, origin);
    } },
  '/rest': { method: 'GET', wrongMethod: '休養設定只能用 GET /rest 讀', crash: [503, '暫時讀不到休養設定', DB_DOWN],
    run: async ({ env, origin }) => reply(200, { ok: true, rest: await readSmall(env.DB, 'rest') }, origin) },
  // 編輯紀錄（ADR 0004）：GET /edits?limit=
  '/edits': { method: 'GET', wrongMethod: '編輯紀錄只能用 GET /edits 讀', crash: [503, '暫時讀不到編輯紀錄', DB_DOWN],
    run: async ({ env, origin, url }) => reply(200, { ok: true, edits: await readEdits(env.DB, Number(url.searchParams.get('limit') || '') || undefined) }, origin) },
  '/walker-code': { method: 'POST', wrongMethod: '代號只能用 POST /walker-code 換', crash: [500, '名字設定暫時失敗，請稍後再試'],
    run: ({ request, env, origin }) => walkerCodes(request, env, origin) },
  '/walkers': { method: 'GET', wrongMethod: '溜狗人名字只能用 GET /walkers 讀', crash: [502, '暫時讀不到試算表的溜狗人'],
    run: ({ env, origin }) => getWalkers(env, origin) },
  '/walk': { method: 'POST', wrongMethod: '寫入試算表只能用 POST /walk', crash: [500, '寫入試算表發生錯誤'],
    run: ({ request, env, origin, ctx }) => writeWalks(request, env, origin, ctx) },
  '/walk/result': { method: 'GET', wrongMethod: '只能讀取登記結果', crash: [503, '暫時讀不到登記結果'],
    async run({ env, origin, url }) {
      if (!env?.DB) return fail(405, '只能讀取登記結果', origin);
      const id = url.searchParams.get('requestId') || '';
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(id)) return fail(400, '請求識別不對', origin);
      const found = await env.DB.prepare('SELECT result_json FROM v3_walk_requests WHERE request_id=?').bind(id).first();
      if (!found) return fail(404, '尚未找到接受結果', origin);
      const result = JSON.parse(found.result_json);
      return reply(200, { ok: true, source: 'd1', today: result.operationDate, results: [result], snapshot: await readAcceptedWalks(env.DB, taiwanYmd(Date.now())) }, origin);
    } },
  '/groups': { method: 'POST', wrongMethod: '編輯狗群只能用 POST /groups', crash: [500, '編輯狗群發生錯誤'],
    run: ({ request, env, origin }) => writeGroup(request, env, origin) },
  // 網站「更新」按鈕
  '/sync': { method: 'POST', wrongMethod: '更新只能用 POST /sync', crash: [502, '叫同步失敗'],
    async run({ request, env, origin, cfg }) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      if (!allow(`sync:${ip}`, SYNC_LIMITS, Date.now())) return fail(429, '剛剛已經在更新了，請稍等一下', origin);
      // ADR 0012：先比對試算表指紋，沒變就不叫 GitHub；沒接 D1 或沒設試算表 ID 就照舊直接叫
      if (env && env.DB && cfg.sheetId) {
        if (await refreshPlan(env.DB, () => sheetSignature(cfg.sheetId)).catch(() => 'sync') === 'same') return reply(200, { ok: true, unchanged: true }, origin);
      }
      try {
        await triggerSync(env);
        return reply(200, { ok: true }, origin);
      } catch (e) {
        // 這次沒叫成，忘掉剛記的指紋，下次按「更新」才會再叫
        if (env && env.DB && cfg.sheetId) await rememberSignature(env.DB, '').catch(() => {});
        return fail(502, e.message || '叫同步失敗', origin);
      }
    } },
};

async function siteRoute(route, c) {
  if (route.method && c.request.method !== route.method) return fail(405, route.wrongMethod, c.origin);
  try {
    return await route.run(c);
  } catch (e) {
    console.error(c.path, e);
    const [status, message, extra] = route.crash;
    return fail(status, message, c.origin, extra);
  }
}

export default {
  // 自動測試用（worker/test/worker.test.mjs）；Cloudflare 只會用到下面的 fetch 和 scheduled
  testing: { r2, MAX_BYTES, resetState, allowUpload, isJpeg, cleanNote, walkerCode, walkersDate, triggerSync, maintenance },

  // Cloudflare Cron Trigger 時間到會呼叫這裡（時間在 wrangler.jsonc 的 triggers）
  async scheduled(event, env, ctx) {
    const now = event && event.scheduledTime ? event.scheduledTime : Date.now();
    ctx.waitUntil(retryWalks(env, now));
    ctx.waitUntil(syncTick(env, now).then(plan => {
      if (plan === 'daily' && r2.r2On(env)) return maintenance(env, now);
    }));
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
    if (/^\/(?:api\/)?notes(?:\/|$)/.test(path)) return fail(410, '我的備註已退役', allowed);
    if (/^\/(?:data|dogs)(?:\/|$)/.test(path)) return fail(410, '舊資料網址已退役，請使用 /api', allowed);
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
          if (path.startsWith('/photos/')) return await r2.servePhoto(request, env, ctx);
        } catch (e) { /* R2 出問題就照舊給靜態檔 */ }
      }
      return env.ASSETS.fetch(request);
    }

    // 打開 Worker 網址（合在一起時是 /api/）就能看到服務有沒有在跑、token 和金鑰設了沒（不會顯示內容）
    if (request.method === 'GET' && path === '/') {
      return reply(200, {
        ok: true,
        service: '板收志工溜狗表 照片上傳服務',
        token: cfg.token ? '已設定' : '未設定',
        adminKey: cfg.adminKey ? '已設定' : '未設定',
        walkerKey: cfg.walkerKey ? '已設定' : '未設定',
        sheetWrite: cfg.sheetWriteUrl ? '已設定' : '未設定',
        walkerNames: cfg.sheetId ? '已設定' : '未設定',
        photos: r2.r2On(env) ? 'R2' : 'GitHub',
        database: await databaseStatus(env),
        ...(env && env.PREVIEW ? { preview: '預覽版，不能存' } : {}),
      });
    }
    // 管理用（#130）：GitHub Action 呼叫、沒有網站來源，用 ADMIN_KEY 驗證
    if (path.startsWith('/admin/')) {
      try {
        return await admin(request, env, allowed, path);
      } catch (e) {
        return fail(500, '管理功能發生錯誤', allowed);
      }
    }
    // Apps Script 通知試算表有改（ADR 0012）：沒有網站來源，用專用密碼驗證
    if (path === '/sheet-changed') {
      try {
        return await sheetChanged(request, env);
      } catch (e) {
        return fail(500, '記錄試算表通知發生錯誤', '');
      }
    }
    if (['/walk-writeback/target', '/walk-writeback/receipt', '/walk-writeback/legacy-check'].includes(path)) {
      if (request.method !== 'POST' || env?.PREVIEW || !env?.DB || !cfg.sheetWriteKey) return fail(403, '不接受寫回要求', '');
      const supplied = request.headers.get('X-Sheet-Write-Key') || '';
      const digest = text => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const a = new Uint8Array(await digest(supplied)), b = new Uint8Array(await digest(cfg.sheetWriteKey));
      let different = 0;
      for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
      if (different) return fail(403, '寫回驗證失敗', '');
      try {
        const raw = await request.text();
        if (raw.length > WALK_MAX_BYTES) return fail(413, '資料太大', '');
        const input = JSON.parse(raw);
        if (path.endsWith('/legacy-check')) {
          if (!Array.isArray(input.dogs) || input.dogs.length > WALK_MAX_DOGS) return fail(400, '狗的資料不對', '');
          for (const dog of input.dogs) {
            if (await env.DB.prepare('SELECT dog_key FROM v3_walk_state WHERE dog_key=?').bind(dog.id || `名:${dog.name}`).first()) return reply(200, { ok: true, allowed: false }, '');
          }
          return reply(200, { ok: true, allowed: true }, '');
        }
        const result = path.endsWith('/target') ? await writebackTarget(env.DB, input, env) : await confirmWalk(env.DB, input, env);
        return reply(200, { ok: true, ...result }, '');
      } catch (e) { return fail(e.status || 503, e.status ? e.message : '寫回尚未確認', ''); }
    }
    // 其他網站送來的一律不收（瀏覽器會擋掉沒有 CORS 回應的要求）
    if (!allowed) return fail(403, '不接受這個網站的要求', '');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(allowed) });
    // PR 預覽版（#126，部署時帶 PREVIEW 變數）：可以看、可以讀，但不能改正式資料（上傳、設主照片、刪除、備註、更新）。
    // 換代號只是計算、不寫任何東西，照常可以用
    if (env && env.PREVIEW && request.method !== 'GET' && path !== '/walker-code') {
      return fail(403, '這是預覽版，不能存，正式資料不受影響。要改請到正式網址', allowed);
    }

    const route = Object.hasOwn(SITE_ROUTES, path) ? SITE_ROUTES[path] : null;
    if (route) return siteRoute(route, { request, env, origin: allowed, path, url, cfg, ctx });
    // 改一隻狗的資料（DOG_EDITS）：/rest/編號、/fixed-care/編號、/intro/編號、/former/編號、/stays/編號
    const editName = (path.match(/^\/([^/]+)\/[^/]+$/) || [])[1];
    const dogEdit = editName && Object.hasOwn(DOG_EDITS, editName) ? DOG_EDITS[editName] : null;
    if (dogEdit) {
      if (!dogEdit.methods.includes(request.method)) return fail(405, `${dogEdit.label}只能用 ${dogEdit.methods.join('／')} ${path.split('/').slice(0, 2).join('/')}/編號`, allowed);
      try {
        return await editDog(request, env, allowed, dogEdit);
      } catch (e) {
        console.error(dogEdit.kind, e);
        return fail(500, dogEdit.crash, allowed);
      }
    }
    // 活動紀錄（#270）
    if (path === '/activities' || path.startsWith('/activities/')) {
      try {
        return await activities(request, env, allowed);
      } catch (e) {
        console.error('activities', e);
        return request.method === 'GET' ? fail(503, '暫時讀不到活動紀錄', allowed, { code: 'db' }) : fail(500, '活動紀錄存檔發生錯誤，原本的資料不受影響', allowed);
      }
    }

    // 相簿 K 2026-10-09 拿掉：舊版網頁還開著時送來的要求，老實說已經沒有這個功能
    if (path === '/gallery' || path.startsWith('/gallery/')) return fail(410, '相簿已經拿掉了，請重新整理網頁', allowed);

    if (request.method !== 'POST') return fail(405, '只接受上傳', allowed);
    try {
      const editor = await editorOf(editorHeader(request), cfg.walkerKey);
      if (!editor) return needEditor(allowed);
      const res = await (r2.r2On(env) ? uploadR2(request, env, allowed, ctx) : upload(request, env, allowed));
      if (res.ok) {
        const out = await res.clone().json().catch(() => ({}));
        // 換掉的舊照片在垃圾桶（30 天內可還原），記垃圾桶編號
        await logEdit(env && env.DB, { editor, kind: 'photo', dogId: null, dogNumber: out.id || '', before: out.trash ? { trash: out.trash } : null, after: { path: out.path || `photos/${out.id}.jpg` } });
      }
      return res;
    } catch (e) {
      return fail(500, '上傳服務發生錯誤，原本的照片不受影響', allowed);
    }
  },
};
