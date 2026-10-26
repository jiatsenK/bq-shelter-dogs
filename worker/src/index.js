import { dogIdentity, readDogEdit, saveDogEdit, cleanDogValue, validFormer } from './dog-edit.js';
import { photoInput, saveDogPhoto } from './dog-photo.js';
import { readSettings, requireVolunteerEdit, settingForWrite } from './feature-settings.js';
import { resolveIdentity, renameIdentity, previewMerge, mergeIdentity, identitiesForCodes, IdentityError } from './identity.js';
import { cleanStays } from './stays.js';
import { callSheet, SheetWriteError } from './sheet-write.js';
import { splitNames } from './sheet-read.js';
import { readDepartedCards } from './departed.js';
import { ActivityError, activityLog, cleanActivity, createActivity, deleteActivity, readActivities, resolveDogs, updateActivity } from './activities.js';
import { acceptWalk, dispatchWalk, readAcceptedWalks, writebackTarget, confirmWalk, reconcileWalk } from './walk-accept.js';
import { reconcileEditedRows } from './walk-reconcile.js';
import { retryWalks, scanTick } from './walk-retry.js';
// 板收志工溜狗表：網站＋D1 API、R2 照片；我的備註 #252 退役。
// 網站上的編輯不用通關碼，改記編輯紀錄（ADR 0004）；管理 API 只給 GitHub Action，用 ADMIN_KEY。試算表只寫原有兩欄。
import * as r2 from './r2.js';
import { taiwanYmd } from './sync-plan.js';
import { applyDogListRows, scanDogList, DOG_LIST_ROWS_MAX } from './dog-list.js';
import { editorOf, editorHeader, logEdit, readEdits, walkerCode, walkerNameKey } from './editlog.js';
import { dogIdsFor, readFavorites, saveFavorite, openedBooks } from './compact.js';
import { readSmall, readDepartureIndex, readDepartureYear, readDogsPacked, readWalksPacked, readWalksYear, readMineWalks, packStatus, resetPackCache } from './packs.js';

// 排程要跟 wrangler.jsonc 的 triggers.crons 一致（#500，ADR 0018）：寫回重試每 10 分鐘（沒工作就只查一次 D1），
// 保險掃描台灣 09:43、13:53、23:53（UTC 01:43、05:53、15:53）
const RETRY_CRON = '5-59/10 * * * *';
const SCAN_CRONS = ['43 1 * * *', '53 5,15 * * *'];
// 照片垃圾桶每月 1 日台灣 10:17（#501，ADR 0018 第 7 點）；每 10 分鐘叫 GitHub 同步試算表的排程已移除，狗清單改由 GAS 編輯觸發送列（worker/src/dog-list.js）
const TRASH_CRON = '17 2 1 * *';
const DOG_LIST_SCAN_MAX_BYTES = 512 * 1024;
const EDIT_ROWS_MAX = 50;

// 預設值；想改的話可以在 Cloudflare 的「變數」設定同名變數蓋過去
const DEFAULTS = {
  // 除了同網址之外，另外接受哪些網站送來的要求（用逗號分隔）；網站和 Worker 同網址（#125）後不用設，舊網址 2026-10 拿掉
  ALLOWED_ORIGINS: '',
};

// 網站會先把照片壓成長邊約 1280px 的 JPEG（通常 100–400 KB），這裡留足空間
const MAX_BYTES = 2 * 1024 * 1024;
// 頻率限制（每個連線來源 IP）：1 分鐘最多 5 張、1 小時最多 30 張
const RATE_LIMITS = [
  { windowMs: 60 * 1000, max: 5 },
  { windowMs: 60 * 60 * 1000, max: 30 },
];
// 管理寫入頻率限制（介紹、休養共用）
const NOTE_WRITE_LIMITS = [
  { windowMs: 60 * 1000, max: 10 },
  { windowMs: 60 * 60 * 1000, max: 60 },
];
// 管理金鑰打錯：1 小時最多 10 次，超過就先不給試（擋住一直猜）
const ADMIN_FAIL_LIMITS = [{ windowMs: 60 * 60 * 1000, max: 10 }];
// 休養中：原因最多幾個字、最多設多久（天）
// 入所介紹（K 2026-10-10）：存 D1 的 v3_intros（#250），不寫試算表
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

// 注意：Cloudflare 會同時開好幾份 Worker，下面這些暫存各自獨立，
// 所以頻率限制是「盡量擋」，不是精確計數；目的是擋住一直狂傳，不是算帳
const hits = new Map(); // 種類:IP → 時間清單

let walkersCache = null; // GET /walkers 的快取（#141）
function resetState() {
  walkersCache = null;
  walkerNamesRemembered = null;
  hits.clear();
  resetPackCache();
}

function config(env) {
  const get = k => (env && env[k] ? String(env[k]) : DEFAULTS[k]);
  return {
    origins: get('ALLOWED_ORIGINS').split(',').map(s => s.trim()).filter(Boolean),
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
      data.photoVersions = {...versions};
      for(const dog of data.dogs||[]){if(dog.photoVersion){const key=dog.id||dog.dogId;data.photoVersions['photos/'+key+'.jpg']=dog.photoVersion;data.photoVersions['photos/thumbs/'+key+'.jpg']=dog.photoVersion;}}
    } catch (e) { /* 沒有版本號只是照片可能用到快取，狗的資料照給 */ }
  }
  return reply(200, { ok: true, ...data }, origin);
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
  if(!env?.DB)return fail(503,'資料庫暫時無法使用',origin,{code:'db'});
  const id=decodeURIComponent(new URL(request.url).pathname.split('/').at(-1));
  if(!ID_PATTERN.test(id))return fail(400,'狗狗編號格式不對',origin);
  const body=await jsonBody(request,origin,'資料太長',edit.maxBytes||SMALL_BODY_MAX_BYTES);
  if(body.error)return body.error;
  const input=body.input;
  const editor=await editorOf(input?.editor,config(env).walkerKey);
  if(!editor)return needEditor(origin);
  const allowed={rest:['until','reason','end'],intro:['text','events'],'fixed-care':['enabled'],former:['former'],stays:['before','stays']}[edit.kind];
  if(Object.keys(input).some(key=>!['editor','revision',...allowed].includes(key)))return fail(400,'此欄位不能修改',origin);
  try {
    const dogId=await dogIdentity(env.DB,id);
    if(!dogId)return fail(404,'找不到這個編號的狗狗',origin);
    const snapshot=await readDogEdit(env.DB,dogId),field=edit.field;
    const raw=edit.value(input);let value=raw;
    if(field==='stays') {
      const before=cleanStays(input.before,taiwanYmd(Date.now()));
      if(before.error||JSON.stringify(before.stays)!==JSON.stringify(snapshot.stays))return fail(409,'別人剛改過，請重新整理再改',origin);
    }
    if(field==='numbers') {
      if(!validFormer(raw))return fail(400,'舊編號要是 10 碼數字，前 8 碼是入所日期',origin);
      if(snapshot.currentNumbers.includes(raw))return fail(400,'這是目前編號，不能當舊編號修改',origin);
      if(request.method==='POST'&&snapshot.numbers.includes(raw))return fail(409,'這隻狗已經有這個編號',origin);
      if(request.method==='DELETE'&&!snapshot.numbers.includes(raw))return fail(404,'這隻狗沒有這個舊編號',origin);
      value=request.method==='POST'?[...snapshot.numbers,raw]:snapshot.numbers.filter(n=>n!==raw);
    }
    value=cleanDogValue(field,value,snapshot,Date.now());
    const ip=request.headers.get('CF-Connecting-IP')||'unknown';
    if(!allow(edit.kind+':'+ip,NOTE_WRITE_LIMITS,Date.now()))return fail(429,'改得太頻繁，請稍等幾分鐘再試',origin);
    const saved=await saveDogEdit(env.DB,dogId,{revision:input.revision,field,value},{editor,dogNumber:id===dogId?'':id,...(field==='intro'&&Object.hasOwn(input,'events')?{events:input.events}:{})});
    return reply(200,{ok:true,id,revision:saved.revision,...edit.respond(raw,saved)},origin);
  }catch(error){if(error.status)return fail(error.status,error.message,origin);throw error;}
}

// Request adapters only; validation, CAS and audit live in dog-edit.js.
const DOG_EDITS = {
  rest: {kind:'rest',field:'rest',label:'休養設定',methods:['PUT'],value:input=>input.end===true?null:{until:input.until,reason:typeof input.reason==='string'?input.reason:''},respond:(_,saved)=>({rest:saved.rest,commit:null})},
  'fixed-care': {kind:'fixed-care',field:'fixedCare',label:'固定照顧設定',methods:['PUT'],value:input=>input.enabled,respond:(_,saved)=>({enabled:saved.fixedCare})},
  intro: {kind:'intro',field:'intro',label:'介紹',methods:['PUT'],maxBytes:EDIT_BODY_MAX_BYTES,value:input=>input.text,respond:(_,saved)=>({intro:saved.intro,commit:null,...(saved.intakeEvents?{intakeEvents:saved.intakeEvents}:{})})},
  former: {kind:'former',field:'numbers',label:'舊編號',methods:['POST','DELETE'],value:input=>String(input.former||'').replace(/\s+/g,''),respond:value=>({former:value})},
  stays: {kind:'stays',field:'stays',label:'出入所紀錄',methods:['PUT'],maxBytes:EDIT_BODY_MAX_BYTES,value:input=>input.stays,respond:(_,saved)=>({stays:saved.stays})},
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

const THUMB_MAX_BYTES = 512 * 1024;

// 照片垃圾桶每月 1 日清一次（#501，ADR 0018 第 7 點），不再綁在同步上：清掉超過 30 天的，結果記在 v3_sync_state 的 trash_purged（GET /admin/trash 的 lastPurge）
async function maintenance(env, now = Date.now()) {
  const result = { at: new Date(now).toISOString(), purged: await r2.purgeTrash(env, now) };
  // 記不進去不影響已清掉的照片，只是查不到這次結果
  try { if (env && env.DB) await env.DB.prepare("INSERT INTO v3_sync_state(key,value) VALUES('trash_purged',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(result)).run(); }
  catch (e) { console.warn('trash_purged:', e.message); }
  return result;
}

const baseOf = request => new URL(request.url).origin;
const siteMeta = now => ({ from: 'site', at: new Date(now).toISOString() });

async function uploadR2(request, env, origin, ctx) {
  const id=decodeURIComponent(new URL(request.url).pathname.split('/').at(-1));
  if(!ID_PATTERN.test(id))return fail(400,'狗狗編號格式不對',origin);
  if(!allowUpload(request.headers.get('CF-Connecting-IP')||'unknown'))return fail(429,'上傳太頻繁，請稍後再試',origin);
  const editor=await editorOf(editorHeader(request),config(env).walkerKey);
  if(!editor)return needEditor(origin);
  try {
    const dogId=await dogIdentity(env.DB,id);
    if(!dogId||!await env.DB.prepare('SELECT 1 FROM v3_sheet_main WHERE number=?').bind(id).first())return fail(404,'找不到主清單上的這隻狗',origin);
    const saved=await saveDogPhoto(env,dogId,Number(request.headers.get('X-Dog-Revision')),await photoInput(request),{editor},baseOf(request));
    return reply(200,{ok:true,id,revision:saved.revision,path:saved.photo.key,trash:saved.trash,replaced:!!saved.trash,commit:null},origin);
  }catch(error){return fail(error.status||502,error.status?error.message:'照片未完成，請重新讀取後重試；舊圖仍保留',origin);}
}

// ── 管理用 API（/api/admin/...）：縮圖、Trash（#593 拿掉 #130 的搬遷）──
// 只給 GitHub Action 用：不看網站來源，改看標頭 X-Admin-Key（GitHub Secret ADMIN_KEY）。人用的管理網站是另一個 Worker（admin/、ADR 0020），不用這把金鑰
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
  const t=await r2.readTrash(env,trashId);
  if(!t)return fail(404,'垃圾桶找不到照片',origin);
  if(t.meta.kind==='gallery')return fail(410,'相簿已拿掉',origin);
  const dogId=await dogIdentity(env.DB,t.meta.dogId||'');
  if(!dogId)return fail(404,'找不到這隻狗',origin);
  const snapshot=await readDogEdit(env.DB,dogId);
  const saved=await saveDogPhoto(env,dogId,snapshot.revision,{original:t.bytes,thumb:t.thumb},{editor:{name:'機器復原',code:''}},baseOf(request));
  return reply(200,{ok:true,kind:'main',dogId,path:saved.photo.key,trash:saved.trash},origin);
}

async function admin(request, env, origin, path) {
  const cfg = config(env);
  if (!r2.r2On(env)) return fail(503, '還沒接上 R2（照片空間），請照 docs/setup/CLOUDFLARE_SETUP.md 設定', origin, { code: 'off' });
  if (env.PREVIEW && request.method !== 'GET') return fail(403, '這是預覽版，不能存，正式資料不受影響。要改請到正式網址', origin);
  const denied = await checkAdmin(request, cfg, origin);
  if (denied) return denied;
  const m = request.method;
  if (m === 'GET' && path === '/admin/thumbs') return reply(200, { ok: true, pending: await r2.pendingThumbs(env) }, origin);
  if (m === 'PUT' && path.startsWith('/admin/thumbs/')) return putThumb(request, env, origin, decodeURIComponent(path.slice('/admin/thumbs/'.length)));
  if (m === 'GET' && path === '/admin/trash') {
    let lastPurge = null;
    try { lastPurge = JSON.parse(await env.DB.prepare("SELECT value FROM v3_sync_state WHERE key='trash_purged'").first('value') || 'null'); } catch { /* 沒接 D1 或還沒清過 */ }
    return reply(200, { ok: true, days: r2.TRASH_DAYS, trash: await r2.listTrash(env), lastPurge }, origin);
  }
  const restore = path.match(/^\/admin\/trash\/([^/]+)\/restore$/);
  if (m === 'POST' && restore) return restoreTrash(request, env, origin, decodeURIComponent(restore[1]));
  return fail(404, '沒有這個管理功能', origin);
}

// ── 誰遛的代號（#95）──
// walkerNameKey、walkerCode 在 editlog.js（算法說明在那裡，編輯者也用同一套代號）

// 輸入的每個名字再照試算表的規則拆開（例：「小明 明明」算兩個），這樣跟 Worker 收狗清單時拆出來的代號對得上
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
  const names = [...new Set(input.names.flatMap(splitNames))];
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
// 名字不進 repo（dogs.json 只有代號），網站打開時跟這裡拿：#519 起從 D1 讀（readWalkersD1），不連 Google，
// 回 { walkers: { 狗的 key: 誰遛的 }, names: [主清單上的名字，最近出現的在前], older: [以前看過、現在表上沒有的名字] }；狗的 key 跟網站 walkKey 一樣（有編號用編號，沒有用「名:犬名」）。
// 1 分鐘內重複讀用快取。沒接 DB 回 503 + code: 'off'
// K 2026-10-20：不管在網站按還是直接改試算表，其他手機 1 分鐘內要看到（原本 5 分鐘）。手機每分鐘跟著今日紀錄一起抓
const WALKERS_CACHE_MS = 60 * 1000;
// 看過的名字寫資料庫很花寫入額度（每個名字一列），快取改 1 分鐘後另外限制：名單沒變就 30 分鐘才記一次
const WALKER_NAMES_REMEMBER_MS = 30 * 60 * 1000;
let walkerNamesRemembered = null; // { at, names: 'a,b', older }
// 主清單每隻狗：有今日溜狗狀態（v3_walk_state）用它，沒有用主清單的遛狗日期與「誰遛的」原文（沒補填的用名單代號換回名字，跟 walk-accept 的 seedState 一樣）。
// 回 { walkers: { 狗的 key: 名單 }, dates: { 狗的 key: 'YYYY-MM-DD' 或 '' }, names: [最近出現的在前，同一天照名單順序] }
export async function readWalkersD1(db) {
  const [main, states] = await db.batch([
    db.prepare('SELECT row_index, number, name, walked_date, walker FROM v3_sheet_main ORDER BY row_index'),
    db.prepare('SELECT dog_key, effective_date, walker FROM v3_walk_state'),
  ]);
  // 代號換名字只給還沒補填原文（walker 是 NULL）的狗；正式庫已經沒有 NULL，平常不讀這段 JOIN（#554，原本一次白讀 772 列）
  const people = (main.results || []).some(r => r.walker == null)
    ? await db.prepare('SELECT m.row_index, n.name FROM v3_sheet_main m, json_each(m.walker_codes) w LEFT JOIN v3_identity_names n ON n.code=w.value WHERE m.walker IS NULL ORDER BY m.row_index, w.key').all()
    : { results: [] };
  const namesOf = new Map();
  for (const p of people.results || []) {
    if (!p.name) continue;
    if (!namesOf.has(p.row_index)) namesOf.set(p.row_index, []);
    namesOf.get(p.row_index).push(p.name);
  }
  const stateOf = new Map((states.results || []).map(s => [s.dog_key, s]));
  const walkers = {}, dates = {}, lastSeen = new Map(); // 名字 → 最近一次 { date, i: 名單裡第幾位 }
  for (const r of main.results || []) {
    const key = r.number || `名:${r.name}`;
    const s = stateOf.get(key);
    // 主清單存了「誰遛的」原文就用原文（#519）；還沒補填（NULL）才用代號換名字
    const text = s ? s.walker || '' : r.walker ?? (namesOf.get(r.row_index) || []).join('、');
    const date = (s ? s.effective_date : r.walked_date) || '';
    walkers[key] = text;
    dates[key] = date;
    splitNames(text).forEach((n, i) => { const prev = lastSeen.get(n); if (!prev || date > prev.date || (date === prev.date && i < prev.i)) lastSeen.set(n, { date, i }); });
  }
  const names = [...lastSeen].sort((x, y) => y[1].date.localeCompare(x[1].date) || x[1].i - y[1].i || x[0].localeCompare(y[0], 'zh-Hant')).map(([n]) => n);
  return { walkers, dates, names };
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
  if (!env || !env.DB) return reply(503, { ok: false, code: 'off', error: '還沒接資料庫' }, allowed);
  if (!walkersCache || now - walkersCache.at > WALKERS_CACHE_MS) {
    const data = await readWalkersD1(env.DB);
    const key = data.names.join(',');
    const r = walkerNamesRemembered;
    const older = r && r.names === key && now - r.at < WALKER_NAMES_REMEMBER_MS ? r.older : await rememberWalkerNames(env, data.names, now);
    if (!r || r.names !== key || now - r.at >= WALKER_NAMES_REMEMBER_MS) walkerNamesRemembered = { at: now, names: key, older };
    // readAt：這份名單是什麼時候讀的。手機用它判斷今日溜狗紀錄是不是比這份名單新（比它舊的以這份為準）
    walkersCache = { at: now, data: { ...data, older, readAt: new Date(now).toISOString(), codes: await walkerCodeMap([...data.names, ...older], cfg.walkerKey) } };
  }
  return reply(200, { ok: true, ...walkersCache.data }, allowed);
}

// 沒設定 SHEET_WRITE_URL 時回 503（SHEET_WRITE_KEY 可不設） + code: 'off'，網站就照舊只記在手機上
const shortText = (v, max) => typeof v === 'string' && [...v.trim()].length <= max && !/[\u0000-\u001f]/.test(v);
const NOTE_MAX_CHARS = 200;
function cleanWalkDog(d, action) {
  if (!d || typeof d !== 'object') return null;
  const id = typeof d.id === 'string' ? d.id.trim() : '';
  if (id && !ID_PATTERN.test(id)) return null;
  if (!shortText(d.name, 30) || !d.name.trim()) return null;
  const out = { id, name: d.name.trim() };
  if (['edit', 'undo'].includes(action)) {
    if (!Number.isSafeInteger(d.expectedVersion) || d.expectedVersion < 0) return null;
    out.expectedVersion = d.expectedVersion;
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
  // #558：溜了／修改／復原只走 D1 接受流程（ADR 0018）。沒帶 requestId 的是還沒重新整理的舊網頁：
  // 不再寫試算表、v3_today_walks，回 410 讓它顯示「請重新整理」，志工更新網頁後再按一次，登記不會默默消失
  const accepted = input.requestId !== undefined;
  if (!accepted && ['walk', 'edit', 'undo'].includes(action)) return fail(410, '網頁版本太舊，這次沒有登記。請重新整理更新網頁後再按一次', origin);
  // #239、#281：note 追加一隻狗的備註、log 新增一筆異動紀錄；都要有名字和內容
  const maxDogs = action === 'note' ? 1 : action === 'log' ? 0 : WALK_MAX_DOGS;
  const rawDogs = action === 'log' ? [] : input.dogs;
  if (maxDogs && (!Array.isArray(rawDogs) || !rawDogs.length || rawDogs.length > maxDogs)) return fail(400, `一次 1–${maxDogs} 隻`, origin);
  const dogs = rawDogs.map(d => cleanWalkDog(d, action));
  if (dogs.some(d => !d)) return fail(400, '狗的資料不對', origin);
  if (accepted) {
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
  if (!cfg.sheetWriteUrl) return fail(503, '還沒設定寫入試算表', origin, { code: 'off' });
  if (!shortText(input.walker, WALKER_NAME_MAX_CHARS) || !input.walker.trim()) return fail(400, '要先選好身分', origin);
  if (!shortText(input.text, NOTE_MAX_CHARS) || !input.text.trim()) return fail(400, `內容要 1–${NOTE_MAX_CHARS} 個字，不能換行`, origin);
  const body = { action, dogs, walker: input.walker.trim(), text: input.text.trim() };

  let out;
  try {
    out = await callSheet(env, body);
  } catch (e) {
    return sheetFail(e, origin);
  }
  walkersCache = null; // 寫入後重新讀取完整名單
  const results = Array.isArray(out.results) ? out.results : [];
  // 備註、異動紀錄是只追加的編輯，記進編輯紀錄（ADR 0004）；名字用送來的 walker
  const editor = await editorOf(body.walker, cfg.walkerKey);
  await logEdit(env && env.DB, { editor, kind: action === 'note' ? 'note' : 'sheetlog', dogNumber: action === 'note' ? dogs[0].id || '' : '', before: null, after: body.text });
  return reply(200, { ok: true, today: out.today, results }, origin);
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
  // 今日溜狗紀錄（ADR 0018）：網站每分鐘來讀 D1 接受的狀態；讀不到網站就照舊不顯示錯誤。
  // 不帶 source=d1 的是舊網頁（#558）：不再讀 v3_today_walks，回 410；舊網頁讀不到會維持現況
  '/today': { method: 'GET', wrongMethod: '只能用 GET /today 讀', crash: [503, '暫時讀不到今日溜狗紀錄', DB_DOWN],
    async run({ env, origin, url }) {
      if (url.searchParams.get('source') !== 'd1') return fail(410, '網頁版本太舊，請重新整理更新網頁', origin);
      return reply(200, { ok: true, ...await readAcceptedWalks(env.DB, taiwanYmd(Date.now())) }, origin);
    } },
  '/rest': { method: 'GET', wrongMethod: '休養設定只能用 GET /rest 讀', crash: [503, '暫時讀不到休養設定', DB_DOWN],
    run: async ({ env, origin }) => reply(200, { ok: true, rest: await readSmall(env.DB, 'rest') }, origin) },
  // 編輯紀錄（ADR 0004）：GET /edits?limit=
  '/edits': { method: 'GET', wrongMethod: '編輯紀錄只能用 GET /edits 讀', crash: [503, '暫時讀不到編輯紀錄', DB_DOWN],
    run: async ({ env, origin, url }) => reply(200, { ok: true, edits: await readEdits(env.DB, Number(url.searchParams.get('limit') || '') || undefined) }, origin) },
  '/walker-code': { method: 'POST', wrongMethod: '代號只能用 POST /walker-code 換', crash: [500, '名字設定暫時失敗，請稍後再試'],
    run: ({ request, env, origin }) => walkerCodes(request, env, origin) },
  '/walkers': { method: 'GET', wrongMethod: '溜狗人名字只能用 GET /walkers 讀', crash: [502, '暫時讀不到溜狗人'],
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
  testing: { r2, MAX_BYTES, resetState, allowUpload, isJpeg, cleanNote, walkerCode, maintenance },

  // Cloudflare Cron Trigger 時間到會呼叫這裡（時間在 wrangler.jsonc 的 triggers）
  // 每個排程只跑一件（#500、#501）：RETRY_CRON 寫回重試、SCAN_CRONS 保險掃描、TRASH_CRON 照片垃圾桶；沒帶 cron（測試）跑溜狗兩件
  async scheduled(event, env, ctx) {
    const now = event && event.scheduledTime ? event.scheduledTime : Date.now();
    const cron = event && event.cron;
    if (cron === TRASH_CRON) { if (r2.r2On(env)) ctx.waitUntil(maintenance(env, now)); return; }
    if (!cron || SCAN_CRONS.includes(cron)) ctx.waitUntil(cron ? scanTick(env, now) : scanTick(env, now).then(() => retryWalks(env, now)));
    else if (cron === RETRY_CRON) ctx.waitUntil(retryWalks(env, now));
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

    // 打開 Worker 網址（合在一起時是 /api/）就能看到服務有沒有在跑、金鑰設了沒（不會顯示內容）
    if (request.method === 'GET' && path === '/') {
      return reply(200, {
        ok: true,
        service: '板收志工溜狗表 照片上傳服務',
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
    if (['/walk-writeback/target', '/walk-writeback/receipt', '/walk-writeback/legacy-check', '/walk-writeback/observe', '/walk-writeback/rows', '/walk-writeback/dog-list', '/walk-writeback/dog-list-scan'].includes(path)) {
      if (request.method !== 'POST' || env?.PREVIEW || !env?.DB || !cfg.sheetWriteKey) return fail(403, '不接受寫回要求', '');
      const supplied = request.headers.get('X-Sheet-Write-Key') || '';
      const digest = text => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const a = new Uint8Array(await digest(supplied)), b = new Uint8Array(await digest(cfg.sheetWriteKey));
      let different = 0;
      for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
      if (different) return fail(403, '寫回驗證失敗', '');
      try {
        const raw = await request.text();
        if (raw.length > (path.includes('/dog-list') ? DOG_LIST_SCAN_MAX_BYTES : WALK_MAX_BYTES)) return fail(413, '資料太大', '');
        const input = JSON.parse(raw);
        // 狗清單（#501）：GAS 只送受影響的列；保險掃描只送指紋
        if (path.endsWith('/dog-list')) {
          if (!Array.isArray(input.rows) || input.rows.length > DOG_LIST_ROWS_MAX) return fail(400, `每批最多 ${DOG_LIST_ROWS_MAX} 列`, '');
          return reply(200, { ok: true, results: await applyDogListRows(env.DB, input.rows, env) }, '');
        }
        if (path.endsWith('/dog-list-scan')) {
          const fp = input.fingerprints;
          if (!fp || typeof fp !== 'object' || Array.isArray(fp) || Object.values(fp).some(v => typeof v !== 'string')) return fail(400, '指紋格式不對', '');
          return reply(200, { ok: true, ...await scanDogList(env.DB, fp) }, '');
        }
        if (path.endsWith('/rows')) {
          if (!Array.isArray(input.rows) || input.rows.length > EDIT_ROWS_MAX) return fail(400,`每批最多 ${EDIT_ROWS_MAX} 列`,'');
          return reply(200,{ ok:true, results:await reconcileEditedRows(env.DB,input.rows,env) },'');
        }
        if (path.endsWith('/observe')) {
          if (!Array.isArray(input.observations) || input.observations.length > 10) return fail(400,'每批最多比對十隻狗','');
          const results = [];
          for (const observation of input.observations) {
            try { results.push({ ok:true, ...await reconcileWalk(env.DB,observation.dog,observation.current,env) }); }
            catch (error) { results.push({ ok:false, error:error.status ? error.message : '比較失敗，保留待處理' }); }
          }
          return reply(200,{ ok:true, results },'');
        }
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
    // PR 預覽版（#126，部署時帶 PREVIEW 變數）：可以看、可以讀，但不能改正式資料（上傳、設主照片、刪除、備註）。
    // 換代號只是計算、不寫任何東西，照常可以用
    if (env && env.PREVIEW && request.method !== 'GET' && path !== '/walker-code') {
      return fail(403, '這是預覽版，不能存，正式資料不受影響。要改請到正式網址', allowed);
    }

    if (path === '/feature-settings' && request.method === 'GET') {
      try {
        const settings = await readSettings(env.DB);
        const etag = '"settings-' + settings.revision + '"';
        const headers = { ...corsHeaders(allowed), ETag: etag, 'Cache-Control': 'private, no-cache' };
        return request.headers.get('If-None-Match') === etag
          ? new Response(null, { status: 304, headers })
          : new Response(JSON.stringify({ ok: true, ...settings }), { headers: { ...headers, 'Content-Type': 'application/json' } });
      }
      catch (error) { return fail(503, error.message, allowed); }
    }
    const settingKey = settingForWrite(path, request.method);
    if (settingKey) {
      try { await requireVolunteerEdit(env.DB, settingKey); }
      catch (error) { return fail(error.status || 503, error.message, allowed, { code: 'feature-setting' }); }
    }

    const route = Object.hasOwn(SITE_ROUTES, path) ? SITE_ROUTES[path] : null;
    if (route) return siteRoute(route, { request, env, origin: allowed, path, url, cfg, ctx });
    // 改一隻狗的資料（DOG_EDITS）：/rest/編號、/fixed-care/編號、/intro/編號、/former/編號、/stays/編號
    const editName = (path.match(/^\/([^/]+)\/[^/]*$/) || [])[1]; // 編號空白也接住，回「狗狗編號格式不對」
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
    // #512 「更新」改成只重讀 D1：舊版網頁還會 POST /sync
    if (path === '/sync') return fail(410, '更新方式改了，請重新整理網頁', allowed);
    // #474：狗群寫入路由已刪；擋住舊頁面，避免落入相片上傳的預設處理。
    if (path === '/groups') return fail(404, '找不到這個功能', allowed);

    if (!/^\/photos\/[^/]+$/.test(path)) return fail(404,'找不到這個功能',allowed);
    if (request.method !== 'POST') return fail(405, '只接受上傳', allowed);
    try {
      const editor = await editorOf(editorHeader(request), cfg.walkerKey);
      if (!editor) return needEditor(allowed);
      if(!r2.r2On(env))return fail(503,'照片儲存尚未接上 R2，這次沒有寫入',allowed,{code:'off'});
      return uploadR2(request,env,allowed,ctx);
    } catch (e) {
      return fail(500, '上傳服務發生錯誤，原本的照片不受影響', allowed);
    }
  },
};
