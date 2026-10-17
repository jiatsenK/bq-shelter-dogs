// 狗狗資料：試算表同步進 D1（#245），網站從 Worker 的 /api/dogs 讀；前端不直接連試算表（#32）
const DATA_URL = 'api/dogs'; // #247 起從 Worker 讀 D1，形狀跟原本的 data/dogs.json 一樣
// 照片上傳服務（Cloudflare Worker，#47／#48）的網址。這裡只放網址，GitHub 寫入權限只在 Worker 裡，網站碰不到
// - 網站和 Worker 是同一個 Cloudflare Worker（#125）：API 就在同一個網址的 /api 底下（本機用 wrangler dev 也一樣）
// - 舊的單獨照片上傳 Worker 和舊網址的判斷 2026-10 拿掉了（舊網址只剩轉址，#129）
// 留空的話詳細資訊不顯示上傳按鈕（用 let 是讓 tests/index.html 能換成測試網址）
function uploadUrlFor(loc) {
  return loc && loc.origin && loc.origin !== 'null' ? `${loc.origin}/api` : '';
}
let UPLOAD_URL = uploadUrlFor(globalThis.location); // 同步腳本的測試在 Node 裡讀這個檔，沒有 location
// 上傳前先在手機上壓成 JPEG：長邊最多 1280px，避免 repo 堆滿手機原圖；上限要跟 Worker 的 MAX_BYTES 一致
const PHOTO_MAX_EDGE = 1280;
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
// 手機第一屏大約看得到幾張狗卡：這幾張的照片不延後載入、優先下載（#91）
const FIRST_SCREEN_CARDS = 8;
// 我最近溜過（#58）：同步時累積的遛狗紀錄（#56）。#96 起每個志工看自己的：
// 紀錄裡的 walkers 是遛的人的代號，志工在「我溜過」輸入名字、經 Worker 換成代號後記在這支手機
const WALKS_URL = 'api/walks'; // #260 起從 Worker 讀 D1，形狀跟原本的 data/walks.json 一樣
// 休養中（K 2026-10-09）：在網站上設定「到哪天前暫停帶出」，經 Worker 存 D1、記編輯紀錄，不碰試算表
const REST_URL = 'api/rest'; // #250 起休養設定存 D1，從 Worker 讀
const WALKER_CODES_KEY = 'bq-walker-codes';
const WALKER_CODE_PATTERN = /^[0-9a-f]{12}$/; // 跟 Worker 的 WALKER_CODE_LENGTH 一致
// 這間收容所的設定在 js/site-config.js（K 2026-10-10：以後其他收容所要用，只改那個檔）
// 警示關鍵字（#28）：備註含任一個，就把備註原文直接顯示在卡片第一層，字眼標紅；
// 只用來判斷要不要顯示，不改寫原文、不另外產生標籤。狗照樣留在待巡房，由志工自己判斷。
const SPECIAL_KEYWORDS = SITE.warnKeywords;
// 天數色標：0～AMBER_DAYS-1 天綠、AMBER_DAYS 天起黃、RED_DAYS 天起紅
const AMBER_DAYS = SITE.days.amber;
const RED_DAYS = SITE.days.red;

let allDogs = [];
let groupMap = {};
// 圖鑑（cards.html）的「去設定」連到 index.html#mine，直接打開我溜過
let activeTab = typeof location !== 'undefined' && ['#mine', '#find', '#groups'].includes(location.hash) ? location.hash.slice(1) : 'walk';
let groupsReturnTab = 'walk';
let detailDog = null; // 詳細資訊正在看的狗
let detailOpener = null;
let detailTrail = []; // 在詳細資訊裡點「可以一起溜」換過的狗（#99）：可以按「回到 ○○」一隻一隻回去
let photoUpload = null; // 詳細資訊正在上傳的主照片：{ dog, blob, url, phase: 'preview'|'uploading'|'error', error }
let restMap = {}; // 休養中：編號 → { until: 'YYYY-MM-DD', reason }
let detailWalksOpen = false; // 詳細資訊的溜狗紀錄有沒有展開每一天（K 2026-10-10 減法：預設只有一行字）
let formerEdit = null; // 詳細資訊正在補的舊編號（#289）：{ dog, text, phase: 'edit'|'saving'|'error', error }
let staysEdit = null; // 詳細資訊正在改的出入所紀錄（#333）：{ dog, before, rows, phase: 'edit'|'saving'|'error', error }
let introEdit = null; // 詳細資訊正在改的入所介紹（K 2026-10-10 補資料）：{ dog, text, phase: 'edit'|'saving'|'error', error }
const introOverrides = {}; // 編號 → 剛存好的介紹：這台電腦不用重新讀就看到（#250 起存 D1，其他人重新整理就看得到）
let restEdit = null; // 詳細資訊正在改的休養設定：{ dog, until, reason, phase: 'edit'|'saving'|'error', error }
let pickedBuddies = new Set(); // 詳細資訊「可以一起溜」勾選的狗（walkKey）
let searchQuery = '';
let loadWarning = '';
let analysisOpen = false; // 分析頁（#59）開著嗎
let myWalks = []; // 我遛過的紀錄（#58）：[{ id, name, date: Date, ymd }]，新到舊
let sheetNotes = []; // 試算表狗清單下面的異動紀錄（K 2026-10-10），dogs.json 的 sheetNotes；電腦版右欄用（js/desk.js）
let walksData = null; // api/walks 讀回來的原始內容；換「我是誰」時不用重讀
let walkerSetup = null; // 正在設定我是誰（#96）：{ text, phase: 'edit'|'saving'|'error', error }
let myWalksState = 'loading'; // loading／ready／error
let loadState = 'loading'; // loading：還在讀 dogs.json；error：讀取失敗；ready：資料好了

// 把年月日組成日期；不合理的日期（例：2/30）回傳 null
function makeDate(y, m, d) {
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

// dogs.json 的日期是本地日期 YYYY-MM-DD（見 scripts/sync-sheet.mjs 的 formatDate）；空的或不合理的回 null
function parseYmd(text) {
  const m = String(text || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? makeDate(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)) : null;
}

// 把 dogs.json 整理成畫面用的資料。狗清單不對就丟錯（整個內容區顯示失敗）；
// 可以一起溜（groups）缺了只回 null，跟以前「常遛狗群」讀不到一樣只少這一塊
function parseDogsData(data) {
  if (!data || !Array.isArray(data.dogs)) throw new Error('dogs.json 格式不對');
  const text = v => (v == null ? '' : String(v).trim());
  const dogs = data.dogs.filter(d => d && text(d.name)).map(d => ({
    cage: text(d.cage),
    id: text(d.id),
    name: text(d.name),
    walkedDate: parseYmd(d.walkedDate),
    // 同步只寫有沒有人固定照顧（covered）；舊版 dogs.json 是志工名字（walker），也當作有
    covered: d.covered === true || text(d.walker) !== '',
    note: text(d.note),
    // 狗卡資訊與性別由同步腳本從 dogs/{編號}.md 整理好（scripts/sync-sheet.mjs 的 attachDogCards）
    sex: d.sex === 'male' ? '♂' : d.sex === 'female' ? '♀' : '',
    intro: text(d.intro),
    // 再次入所的舊編號（#75，狗卡 frontmatter 的 formerIds）
    formerIds: Array.isArray(d.formerIds) ? d.formerIds.map(text).filter(Boolean) : [],
    // 出入所紀錄（#333，ADR 0011）：每次在所一筆，out 還在所就是空字串
    ...(Array.isArray(d.stays) ? { stays: d.stays.filter(r => r && typeof r === 'object').map(r => ({ in: text(r.in), out: text(r.out), reason: text(r.reason) })) } : {}),
    ...(Array.isArray(d.intakeEvents) ? { intakeEvents: d.intakeEvents.map(e => ({ number: text(e.number), date: text(e.date), event: text(e.event) })) } : {}),
  }));
  let groups = null;
  if (data.groups && typeof data.groups === 'object' && !Array.isArray(data.groups)) {
    groups = {};
    for (const [name, list] of Object.entries(data.groups)) {
      if (Array.isArray(list)) groups[name] = new Set(list.map(text).filter(n => n && n !== name));
    }
  }
  const synced = data.syncedAt ? new Date(data.syncedAt) : null;
  // 照片版本（#127）：Worker 的 /api/dogs 回傳時帶上，照片路徑 → 內容雜湊；repo 裡的 dogs.json 沒有
  const versions = {};
  if (data.photoVersions && typeof data.photoVersions === 'object' && !Array.isArray(data.photoVersions)) {
    for (const [path, v] of Object.entries(data.photoVersions)) {
      if (typeof v === 'string' && /^[0-9a-f]{1,16}$/.test(v)) versions[path] = v;
    }
  }
  // 異動紀錄（K 2026-10-10）：試算表狗清單下面那段，電腦版右欄（js/desk.js）；沒有或格式不對就是空的
  const sheetNotes = Array.isArray(data.sheetNotes) ? data.sheetNotes.filter(n => n && text(n.text)).map(n => ({ label: text(n.label), text: text(n.text) })) : [];
  return { dogs, groups, syncedAt: synced && !isNaN(synced) ? synced : null, photoVersions: versions, sheetNotes };
}

// 暫住（K 2026-10-09 阿拉丁）：試算表裡「(阿拉丁)」這種名字加括號、沒有編號的列，是同名那隻狗暫時住的籠子。
// 合成一隻：籠位換成暫住的那籠（在哪、找狗都指過去），原本的籠位記在 homeCage；括號那列不另外算一隻。
// 溜了照舊用編號＋名字寫試算表那隻狗本來的列，不受籠位影響。找不到同名的就照原樣留著
function mergeTempCages(dogs) {
  const marked = d => !d.id && /^[(（].+[)）]$/.test(d.name);
  for (const m of dogs.filter(marked)) {
    const name = m.name.slice(1, -1).trim();
    const real = dogs.find(d => !marked(d) && d.name === name);
    if (!real || !m.cage || real.homeCage) continue;
    real.homeCage = real.cage;
    real.cage = m.cage;
    dogs.splice(dogs.indexOf(m), 1);
  }
  return dogs;
}

// 瀏覽器可能拿快取的舊檔；no-cache 讓它每次都先問 GitHub Pages 有沒有新版（沒變只回 304，很省）
// 開網頁的第一次改用 index.html 頁首提早開始抓的那一份（手機開啟加速），之後（重新讀取、更新）照常抓
async function loadDogsData() {
  const early = window.__dogsEarly;
  window.__dogsEarly = null;
  let res;
  try {
    res = await (early || fetch(DATA_URL, { cache: 'no-cache' }));
  } catch (e) {
    throw new Error('連不到網站，可能是網路中斷。');
  }
  if (!res.ok) throw new Error(`讀取狗的資料失敗（HTTP ${res.status}）。`);
  let data;
  try { data = await res.json(); } catch (e) { throw new Error('狗的資料格式壞掉了。'); }
  return parseDogsData(data);
}

// ── 我最近溜過（#58）──

// 溜狗紀錄只取 walkers 有我的代號的紀錄（#96；舊紀錄只有 mine 沒有 walkers 的不算），日期不合理的丟掉；
// 同一隻狗同一天只留一筆；新到舊（同一天後記的在前）
function parseMyWalks(data, codes = loadMyCodes()) {
  if (!data || !Array.isArray(data.walks)) throw new Error('溜狗紀錄格式不對');
  const text = v => (v == null ? '' : String(v).trim());
  // 同一隻狗同一天以最後一筆為準：先記了我、後來把我拿掉（按錯、×），就不算我溜的（K 2026-10-05 阿湯）
  const lastOf = new Map();
  data.walks.forEach((w, i) => { if (w && Array.isArray(w.walkers)) lastOf.set(`${text(w.id) || text(w.name)}|${w.date}`, i); });
  const seen = new Set();
  const list = [];
  data.walks.forEach((w, i) => {
    if (!w || !Array.isArray(w.walkers) || !w.walkers.some(c => codes.includes(c))) return;
    if (!data.walks[lastOf.get(`${text(w.id) || text(w.name)}|${w.date}`)].walkers.some(c => codes.includes(c))) return;
    const date = parseYmd(w.date);
    const id = text(w.id), name = text(w.name);
    if (!date || (!id && !name)) return;
    const key = `${id || name}|${w.date}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ id, name, date, ymd: text(w.date), i });
  });
  return list.sort((a, b) => b.date - a.date || b.i - a.i).map(({ i, ...w }) => w);
}

async function fetchWalks() {
  const res = await fetch(WALKS_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
// 按年拿舊紀錄（ADR 0013，#346）：api/walks 的 years 是每年的版本號，網址帶版本號，瀏覽器快取過就不再下載。
// 只有我溜過月曆翻到上個月 1 號以前、那一年還沒拿過才拿
const walkYears = {}; // 年 → 'loading'／'ready'／'error'
function recentStartMonth(today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
// 還沒拿、有紀錄、在近期範圍以前的年份
function missingWalkYears(today = new Date()) {
  const recent = recentStartMonth(today);
  return Object.keys((walksData && walksData.years) || {}).filter(y => `${y}-01` < recent && walkYears[y] !== 'ready').sort();
}
async function loadWalkYear(month, today = new Date()) {
  const year = month.slice(0, 4);
  const ver = walksData && walksData.years && walksData.years[year];
  if (!ver || month >= recentStartMonth(today) || walkYears[year] === 'ready' || walkYears[year] === 'loading') return;
  walkYears[year] = 'loading';
  try {
    const res = await fetch(`${WALKS_URL}?year=${year}&v=${encodeURIComponent(ver)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    // 近期範圍以內以 api/walks 為準；那一年更早的換成拿回來的
    const cut = `${recentStartMonth(today)}-01`;
    const old = y => w => !(String(w.date || '').startsWith(y) && String(w.date || '') < cut);
    walksData = { ...walksData, walks: [...walksData.walks.filter(old(year)), ...(body.walks || []).filter(w => String(w.date || '') < cut)] };
    myWalks = parseMyWalks(walksData);
    walkYears[year] = 'ready';
  } catch (e) {
    console.error(e);
    walkYears[year] = 'error';
  }
  render();
}

async function loadMyWalks() {
  myWalksState = 'loading';
  try {
    walksData = await fetchWalks();
    for (const y of Object.keys(walkYears)) delete walkYears[y];
    myWalks = parseMyWalks(walksData);
    myWalksState = 'ready';
  } catch (e) {
    console.error(e);
    myWalksState = 'error';
  }
  // 不在「我溜過」就只更新分類上的數字（#91）：整頁重畫會把第一屏正在載入的照片換掉
  const n = document.querySelector('#tabs [data-tab="mine"] .n');
  if (activeTab !== 'mine' && !analysisOpen && n) {
    const count = myWalksCount('');
    n.textContent = count == null ? '' : count;
  } else {
    render();
  }
}

// 分類上的數字；還沒讀好或還沒設定我是誰時不顯示（null）
function currentMyWalks(today = new Date()) {
  const list = [...myWalks];
  const date = localDateKey(today);
  // 今日溜狗紀錄比同步新：按了復原的狗不能再出現在我溜過（ADR 0007）
  const me = canonicalWalker(loadWalkerName());
  for (const w of liveTodayWalks(today)) {
    const dog = allDogs.find(d => walkKey(d) === w.key);
    if (!dog) continue;
    const at = list.findIndex(x => (dog.id ? x.id === dog.id : !x.id && x.name === dog.name) && x.ymd === date);
    if (at !== -1) list.splice(at, 1);
    if (w.walked && me && splitWalkers(w.walker).map(canonicalWalker).includes(me)) list.unshift({ id: dog.id || '', name: dog.name, date: parseYmd(date), ymd: date });
  }
  for (const item of Object.values(loadSheetWrites(today))) {
    if (!item.current) continue;
    const at = list.findIndex(w => (item.id ? w.id === item.id : !w.id && w.name === item.name) && w.ymd === date);
    if (at !== -1) list.splice(at, 1);
    if (item.current.date === date && splitWalkers(item.current.walker).map(canonicalWalker).includes(canonicalWalker(loadWalkerName()))) list.unshift({ id: item.id, name: item.name, date: parseYmd(date), ymd: date });
  }
  return list.sort((a, b) => b.date - a.date);
}

function myWalksCount(query) {
  if (!loadMyCodes().length || (myWalksState !== 'ready' && !Object.values(loadSheetWrites()).some(item => item.mine))) return null;
  return myWalkGroups(currentMyWalks(), query).reduce((k, g) => k + g.walks.length, 0);
}

// ── 我是誰（#96）──
// 代號記在這支手機（跟今天已溜同一個 localStorage）；讀寫不了（無痕模式）就這次開著網頁的期間記在記憶體。
// #138 起名字（第一個寫法）也記在這支手機，按「溜了」時寫進試算表「誰遛的」用；不會送到 repo 或網站其他地方
let walkerCodesMemory = null;
function loadMyCodes() {
  let list = walkerCodesMemory;
  try {
    const raw = walkedStorage && walkedStorage.getItem(WALKER_CODES_KEY);
    if (raw) list = JSON.parse(raw);
  } catch (e) { /* 讀不到就用記憶體裡的 */ }
  return Array.isArray(list) ? list.filter(c => WALKER_CODE_PATTERN.test(c)) : [];
}
function saveMyCodes(codes) {
  walkerCodesMemory = codes.length ? [...codes] : null;
  try {
    if (walkedStorage && codes.length) walkedStorage.setItem(WALKER_CODES_KEY, JSON.stringify(codes));
    else if (walkedStorage) walkedStorage.removeItem(WALKER_CODES_KEY);
  } catch (e) { /* 存不了就只記在記憶體 */ }
  try { myWalks = walksData ? parseMyWalks(walksData, codes) : []; } catch (e) { myWalks = []; }
  syncFavs();
}

async function identityRequest(action, body) {
  const res = await fetch(UPLOAD_URL + '/identity' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json();
  if (!res.ok || !out.ok) { const e = new Error(out.error || '身分設定失敗，請稍後再試'); e.targetCode = out.targetCode; throw e; }
  return out;
}
async function renameWalker() {
  const edit = walkerSetup;
  if (!edit || edit.phase === 'saving') return;
  const originalCodes = loadMyCodes().join(',');
  edit.phase = 'saving'; render();
  try {
    const out = await identityRequest('/rename', { code: loadMyCodes()[0], name: edit.text.trim(), operationId: edit.operationId || (edit.operationId = crypto.randomUUID()) });
    if (walkerSetup !== edit || loadMyCodes().join(',') !== originalCodes) return;
    saveWalkerName(out.identity.name); saveMyCodes(out.identity.codes); walkerSetup = null;
  } catch (e) {
    edit.phase = 'error'; edit.error = e.message;
    if (e.targetCode) {
      try { edit.merge = await identityRequest('/merge-preview', { code: loadMyCodes()[0], targetCode: e.targetCode }); edit.targetCode = e.targetCode; }
      catch (previewError) { edit.error = previewError.message; }
    }
  }
  render();
}
async function confirmWalkerMerge() {
  const edit = walkerSetup;
  if (!edit?.merge || edit.phase === 'saving') return;
  const originalCodes = loadMyCodes().join(',');
  edit.phase = 'saving'; render();
  try {
    const out = await identityRequest('/merge', { code: loadMyCodes()[0], targetCode: edit.targetCode, token: edit.merge.token, confirm: true, operationId: edit.mergeOperationId || (edit.mergeOperationId = crypto.randomUUID()) });
    if (walkerSetup !== edit || loadMyCodes().join(',') !== originalCodes) return;
    saveWalkerName(out.identity.name); saveMyCodes(out.identity.codes); walkerSetup = null;
  } catch (e) { edit.phase = 'error'; edit.error = e.message; edit.merge = null; }
  render();
}

function walkerSetupHtml() {
  const edit = walkerSetup || { text: '', phase: 'edit', error: '' };
  const busy = edit.phase === 'saving';
  const has = loadMyCodes().length > 0;
  if (edit.merge) {
    const summary = p => esc(p.name) + '：常溜 ' + p.favorites + '、開卡 ' + p.cards + '、溜狗來源紀錄 ' + p.walkRows;
    return '<div class="who-box"><h3>確認身分合併</h3><p role="alert">' + esc(edit.error || '') + '</p><p>' + summary(edit.merge.source) + '</p><p>' + summary(edit.merge.target) + '</p><p>合併後顯示「' + esc(edit.merge.target.name) + '」，兩邊資料都保留。</p><div class="my-note-actions"><button type="button" class="my-note-save" id="whoMerge"' + (busy ? ' disabled' : '') + '>這兩個身分都是我</button><button type="button" class="photo-cancel" id="whoCancel">取消</button></div></div>';
  }
  // 清除前確認一次（2026-10-08 介面評估第二輪：一按就清掉名字和代號，按錯就不能按溜了）
  if (edit.confirmClear) {
    return `<div class="who-box">
      <h3>${icon('alert')}確定清除？</h3>
      <p>清除後要重新輸入名字，才能按「溜了」寫進試算表。</p>
      <div class="my-note-actions">
        <button type="button" class="who-clear-ok" id="whoClearOk">清除</button>
        <button type="button" class="photo-cancel" id="whoClearNo">不要清除</button>
      </div>
    </div>`;
  }
  return `<form class="who-box" id="whoForm" autocomplete="off">
    <h3>${icon('paw')}你是誰？</h3>
    <p>輸入你在試算表上登記的名字，打一個字就會出現推薦。</p>
    <input type="text" id="whoInput" maxlength="60" placeholder="例：小明" aria-label="你在試算表登記的名字" value="${esc(edit.text)}"${busy ? ' disabled' : ''}>
    ${obNamesHtml(edit, busy, 'who')}
    <p class="who-note">按「溜了」時會把這個名字寫進試算表「誰遛的」。名字設定存在這支手機，換手機或換瀏覽器要重新設定。</p>
    ${nameConfirmHtml(edit)}
    ${edit.phase === 'error' ? `<div class="photo-error" role="alert">${icon('alert')}<span>${esc(edit.error)}</span></div>` : ''}
    <div class="my-note-actions">
      <button type="submit" class="my-note-save" id="whoSave"${busy ? ' disabled' : ''}>${busy ? '設定中…' : edit.phase === 'confirm' ? '確定用這個名字' : '設定'}</button>
      ${has && !busy ? `<button type="button" class="photo-cancel" id="whoRename">更改登記名字</button><button type="button" class="photo-cancel" id="whoCancel">取消</button>` : ''}
    </div>
    ${has && !busy ? `<button type="button" class="who-clear" id="whoClear">清除這支手機的設定</button>` : ''}
    ${has ? '' : '<button type="button" class="who-clear guide-link" data-open-guide>看使用說明</button>'}
  </form>`;
}

// 送名字到 Worker 換代號；成功就記住代號、顯示我溜過，失敗保留輸入的名字並顯示原因
async function saveWalkerSetup() {
  const edit = walkerSetup;
  if (!edit || edit.phase === 'saving') return;
  const failWith = msg => { edit.phase = 'error'; edit.error = msg; render(); };
  const confirmed = edit.phase === 'confirm';
  edit.phase = 'saving';
  render();
  if (!confirmed) {
    const unknown = await namesToConfirm(edit.text);
    if (walkerSetup !== edit) return;
    if (unknown.length) { edit.phase = 'confirm'; edit.unknown = unknown; render(); return; }
  }
  const error = await setWalkerName(edit.text);
  if (walkerSetup !== edit) return;
  if (error) return failWith(error);
  setNameLater(false);
  if (walkerSetup === edit) walkerSetup = null;
  render();
}

// 名字送 Worker 換代號，成功就記在這支手機；失敗回傳原因（開頭畫面和我溜過的「修改」共用）
async function setWalkerName(raw) {
  const text = String(raw || '').trim();
  if (!text) return '請輸入你在試算表上寫的名字';
  if (!UPLOAD_URL) return '暫時不能設定，網站這邊還沒準備好';
  const oldName = loadWalkerName(), oldCodes = loadMyCodes().join(',');
  try {
    const out = await identityRequest('', { name: text });
    if (loadWalkerName() !== oldName || loadMyCodes().join(',') !== oldCodes) return '身分設定已變動，請重新設定';
    saveWalkerName(out.identity.name);
    saveMyCodes(out.identity.codes);
  } catch (e) { return e.message; }
  return '';
}
// 名字送 Worker 換代號：回 { codes } 或 { codes: [], error: 原因 }
async function walkerCodesFor(names) {
  let out = null;
  try {
    const res = await fetch(`${UPLOAD_URL}/walker-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: [...new Set(names)] }),
    });
    out = await res.json().catch(() => null);
    if (!res.ok) throw new Error((out && out.error) || `HTTP ${res.status}`);
  } catch (e) {
    console.error(e);
    return { codes: [], error: out && out.error ? out.error : '連不上網路，請稍後再試' };
  }
  return { codes: out && Array.isArray(out.codes) ? out.codes.filter(c => WALKER_CODE_PATTERN.test(c)) : [] };
}
// 自己打的名字要不要再確認一次（K 2026-10-12）：名字清單只有最近溜過的人，清單上沒有的再去查遛狗紀錄
// （溜狗紀錄只有代號，所以先跟 Worker 換代號再對），紀錄裡有就是本人、不用問；查不到或連不上才問
async function namesToConfirm(text) {
  const unknown = unknownWalkerNames(text);
  if (!unknown.length || !UPLOAD_URL) return unknown;
  if (!walksData) {
    try { walksData = await fetchWalks(); } catch (e) { console.error(e); }
  }
  const walks = walksData && Array.isArray(walksData.walks) ? walksData.walks : null;
  if (!walks) return unknown;
  const left = [];
  for (const n of unknown) {
    const { codes } = await walkerCodesFor([n]);
    if (!codes.some(c => walks.some(w => w && Array.isArray(w.walkers) && w.walkers.includes(c)))) left.push(n);
  }
  return left;
}

// 紀錄對到目前清單上的狗：有編號用編號，沒有才用犬名；對不到（例：已離所）回 null
function dogOfWalk(w) {
  if (w.id) return allDogs.find(d => d.id === w.id) || null;
  const key = searchKey(w.name);
  return allDogs.find(d => !d.id && searchKey(d.name) === key) || null;
}

// 2026/09/24（四）
function walkDateLabel(date) {
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}（${'日一二三四五六'[date.getDay()]}）`;
}

// 依日期分組：[{ ymd, date, walks }]；query 用犬名篩選
function myWalkGroups(walks, query) {
  const groups = [];
  for (const w of walks) {
    if (!matchesSearch(w, query)) continue;
    let g = groups[groups.length - 1];
    if (!g || g.ymd !== w.ymd) groups.push(g = { ymd: w.ymd, date: w.date, walks: [] });
    g.walks.push(w);
  }
  return groups;
}

// 每次到所一張卡（K 2026-09-25 看原型後，預設照 A）：K 一個月去約四次、每次遛好幾隻，
// 所以一個日期就是一次到所，卡片裡把那天遛的狗用照片排成一排；那天是第一次遛的狗標「第一次」
// （紀錄最早那天不標：那天之前沒有紀錄，不知道是不是第一次）。
// 點照片開原本的詳細資訊；不在目前清單上的狗只列名字、不能點
// V9（#141 第 10 項）：不標「第一次」，資深志工早就溜過，只是網站剛上線
function myVisitCard(g) {
  const tiles = g.walks.map(w => {
    const dog = dogOfWalk(w);
    const inner = `${photoThumb(dog || { name: w.name, id: '' }, 56)}<span class="bname">${esc(w.name)}</span>`;
    return dog
      ? `<button type="button" class="mine-dog" data-mine-dog="${allDogs.indexOf(dog)}" aria-label="${esc(w.name)}：看詳細資訊">${inner}</button>`
      : `<div class="mine-dog gone" title="已不在目前的溜狗表">${inner}</div>`;
  }).join('');
  return `<section class="visit">
    <h3 class="walk-date">${esc(walkDateLabel(g.date))}<span class="n">${g.walks.length} 隻</span></h3>
    <div class="visit-dogs">${tiles}</div>
  </section>`;
}

// 上方小計：這個月到所幾次、遛過幾隻、總共幾趟，並跟上個月比到所次數
function myMonthStats(walks, today) {
  const ym = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  const thisMonth = ym(today);
  const lastMonth = ym(new Date(today.getFullYear(), today.getMonth() - 1, 1));
  const of = m => walks.filter(w => w.ymd.startsWith(m));
  const now = of(thisMonth);
  const visits = list => new Set(list.map(w => w.ymd)).size;
  return `<div class="mine-stats">
    <div class="mine-month"><b>${today.getFullYear()} 年 ${today.getMonth() + 1} 月</b><span>上個月到所 ${visits(of(lastMonth))} 次</span></div>
    <div class="mine-tiles">
      <div><b>${visits(now)}</b><span>到所次數</span></div>
      <div><b>${new Set(now.map(w => w.id || w.name)).size}</b><span>溜過幾隻</span></div>
      <div><b>${now.length}</b><span>總共幾趟</span></div>
    </div>
  </div>`;
}

// V7（#114）我溜過最上面：目前在所的狗裡，你溜過幾隻（已離所的不算）
function myProgressHtml(walks) {
  const seen = new Set(walks.map(dogOfWalk).filter(Boolean));
  const total = allDogs.length;
  const pct = total ? Math.round(seen.size / total * 100) : 0;
  return `<div class="mine-progress">
    <div class="row"><span>在所的狗，你溜過</span><b>${seen.size}<small> / ${total} 隻</small></b></div>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${seen.size}" aria-label="在所的狗，你溜過 ${seen.size} 隻，共 ${total} 隻"><i style="width:${pct}%"></i></div>
  </div>`;
}

let mineStatsOpen = false;
let mineMonth = ''; // 我溜過月曆正在看的月份（YYYY-MM）；空的＝最近有紀錄的那個月
let mineDay = ''; // 月曆上選的那一天（YYYY-MM-DD）；空的＝那個月最近一次到所
// 誤觸復原的入口放最上面，名字還沒設定、紀錄讀取中也看得到
function myWalksHtml(today, query) {
  return (query ? '' : todayUndoHtml()) + myWalksBodyHtml(today, query);
}
function myWalksBodyHtml(today, query) {
  const visibleWalks = currentMyWalks(today);
  const confirmedToday = Object.values(loadSheetWrites(today)).some(item => item.current?.date === localDateKey(today) && splitWalkers(item.current.walker).map(canonicalWalker).includes(canonicalWalker(loadWalkerName())));
  if (myWalksState === 'loading' && !confirmedToday) return `<div class="status-msg">讀取溜狗紀錄中…</div>`;
  if (myWalksState === 'error' && !confirmedToday) {
    return `<div class="status-msg">溜狗紀錄讀不到，請確認網路後按「重新讀取」。<br><button class="retry-btn" id="mineRetry">重新讀取</button></div>`;
  }
  if (walkerSetup || !loadMyCodes().length) return walkerSetupHtml();
  // #138 之前設定的只有代號、沒記名字：請他再輸入一次，按溜了才能寫進試算表
  const named = !!loadWalkerName();
  // V9（#141 第 11 項）：小計收進「統計」按鈕，按了才展開
  const statsBtn = visibleWalks.length ? `<button type="button" class="who-edit${mineStatsOpen ? ' on' : ''}" id="mineStats" aria-expanded="${mineStatsOpen}">${icon('chart')}統計</button>` : '';
  const who = query ? '' : `<div class="section-hint who-hint">${icon('paw')}<span class="who-name">${named ? esc(loadWalkerName()) : '再按「修改」輸入一次名字'}</span>${statsBtn}<button type="button" class="who-edit" id="whoEdit">修改</button><button type="button" class="who-edit" data-open-guide>說明</button></div>`;
  if (!visibleWalks.length) return who + `<div class="status-msg">還沒有你的溜狗紀錄。<br>試算表「誰遛的」寫上你設定的名字，同步後就會出現在這裡。</div>`;
  // 所有到所紀錄新到舊一路往下排（K 2026-09-25：不要選日期）；搜尋時不顯示小計
  const groups = myWalkGroups(currentMyWalks(), query);
  if (!groups.length) return `<div class="status-msg">找不到「${esc(query)}」</div>`;
  const stats = !query && mineStatsOpen ? `<div class="mine-stats-box">${myProgressHtml(visibleWalks)}${myMonthStats(visibleWalks, today)}</div>` : '';
  // 標題層級（critique 2026-10-09）：頁首 h1 下面先有 h2，每次到所的 h3 才不會跳號
  // 搜尋時照舊一路往下列；平常是一個月一張月曆、點哪天看那天溜的狗（K 2026-10-10：常來的志工頁面太長）
  if (query) return '<h2 class="sr-only">我溜過的紀錄</h2>' + groups.map(g => myVisitCard(g)).join('');
  return '<h2 class="sr-only">我溜過的紀錄</h2>' + who + stats + myCalendarHtml(groups, today);
}

// 我溜過的月曆：有來的那幾天塗檔案綠、寫溜幾隻；點了下面換成那天溜的狗。可以往前翻到最早有紀錄的那個月
function myCalendarState(groups, today) {
  const months = [...new Set(groups.map(g => g.ymd.slice(0, 7)))].sort();
  const nowMonth = localDateKey(today).slice(0, 7);
  // 還有沒拿的年份：可以翻到那年 1 月，翻到了再拿（#346）
  const missing = missingWalkYears(today)[0];
  const first = [months[0] || nowMonth, ...(missing ? [`${missing}-01`] : [])].sort()[0];
  // 拿回來那年比翻到的月份晚開始：停在最早有紀錄的那個月，不跳回最近
  let month = mineMonth && mineMonth <= nowMonth ? (mineMonth >= first ? mineMonth : first) : (months[months.length - 1] || nowMonth);
  const inMonth = groups.filter(g => g.ymd.slice(0, 7) === month); // 新到舊
  const day = inMonth.some(g => g.ymd === mineDay) ? mineDay : (inMonth[0] ? inMonth[0].ymd : '');
  return { month, first, nowMonth, inMonth, day };
}
function myCalendarHtml(groups, today) {
  const { month, first, nowMonth, inMonth, day } = myCalendarState(groups, today);
  const y = +month.slice(0, 4), m = +month.slice(5, 7);
  const byDay = new Map(inMonth.map(g => [g.ymd, g]));
  const lead = new Date(y, m - 1, 1).getDay(), total = new Date(y, m, 0).getDate();
  const todayKey = localDateKey(today);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="mc-cell blank"></span>');
  for (let d = 1; d <= total; d++) {
    const key = `${month}-${pad2(d)}`;
    const g = byDay.get(key);
    const isToday = key === todayKey;
    const cls = `mc-cell${g ? ' on' : ''}${key === day ? ' sel' : ''}${isToday ? ' today' : ''}`;
    cells.push(g
      ? `<button type="button" class="${cls}" data-mine-day="${key}" aria-pressed="${key === day}"${isToday ? ' aria-current="date"' : ''} aria-label="${isToday ? '今天，' : ''}${m}月${d}日，溜 ${g.walks.length} 隻"><b>${d}</b><small>${g.walks.length} 隻</small></button>`
      : `<span class="${cls}"${isToday ? ' aria-current="date"' : ''}><b>${d}</b>${isToday ? '<span class="sr-only">今天</span>' : ''}</span>`);
  }
  const dogs = inMonth.reduce((n, g) => n + g.walks.length, 0);
  const shift = n => { const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };
  const sel = day && byDay.get(day);
  return `<section class="mine-cal" aria-label="${y} 年 ${m} 月的溜狗月曆">
    <div class="mc-head">
      <button type="button" class="mc-nav" data-mine-month="${shift(-1)}" aria-label="上個月"${month <= first ? ' disabled' : ''}>${icon('back')}</button>
      <h3 class="mc-title">${y} 年 ${m} 月<span>${walkYears[y] === 'loading' ? '讀取中…' : walkYears[y] === 'error' ? '這一年的紀錄讀不到' : inMonth.length ? `來 <b>${inMonth.length}</b> 天・溜 <b>${dogs}</b> 隻次` : '這個月還沒有紀錄'}</span></h3>
      <button type="button" class="mc-nav next" data-mine-month="${shift(1)}" aria-label="下個月"${month >= nowMonth ? ' disabled' : ''}>${icon('back')}</button>
    </div>
    <div class="mc-week" aria-hidden="true">${[...'日一二三四五六'].map(w => `<span>${w}</span>`).join('')}</div>
    <div class="mc-grid">${cells.join('')}</div>
  </section>${sel ? myVisitCard(sel) : ''}`;
}

// 回傳備註命中的關鍵字（顯示用）與實際出現的寫法（標示用）；沒命中回 null
function specialFlag(note) {
  const keywords = [], terms = [];
  for (const [label, ...variants] of SPECIAL_KEYWORDS) {
    const hit = [label, ...variants].filter(t => (note || '').includes(t));
    if (!hit.length) continue;
    keywords.push(label);
    terms.push(...hit);
  }
  return keywords.length ? { keywords, terms } : null;
}

// 把備註原文裡所有命中的字眼標成紅色粗體；其餘文字照樣跳脫
function highlightNote(note, terms) {
  if (!terms || !terms.length) return esc(note);
  const sorted = [...new Set(terms)].sort((a, b) => b.length - a.length);
  const re = new RegExp(sorted.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  let html = '', last = 0;
  for (const m of note.matchAll(re)) {
    html += esc(note.slice(last, m.index)) + `<mark>${esc(m[0])}</mark>`;
    last = m.index + m[0].length;
  }
  return html + esc(note.slice(last));
}

function effectiveWalkDate(dog, today = new Date()) {
  const item = loadSheetWrites(today)[walkKey(dog)];
  return item && item.current ? parseYmd(item.current.date) : dog.walkedDate;
}

function computeStatus(dog, today) {
  const rest = restOf(dog, today);
  if (rest) return { kind: 'rest', ...rest };
  // V9（#141）拿掉今天已溜分類：這支手機今天按過溜了的狗（也寫進試算表了）直接當作今天溜的
  if (walkedNow(dog, today)) return { kind: 'dated', days: 0, level: 'sage', mine: true };
  const date = effectiveWalkDate(dog, today);
  if (date) {
    const days = Math.floor((today - date) / 86400000);
    let level = 'sage';
    if (days >= RED_DAYS) level = 'red';
    else if (days >= AMBER_DAYS) level = 'amber';
    return { kind: 'dated', days, level };
  }
  if (dog.covered) return { kind: 'covered' };
  return { kind: 'unknown' };
}

// 休養中：今天還在設定的日期以內（含那一天）才算；過了自動恢復
function restOf(dog, today = new Date()) {
  const r = dog && dog.id && restMap[dog.id];
  const until = r && parseYmd(r.until);
  if (!until) return null;
  const day = makeDate(today.getFullYear(), today.getMonth() + 1, today.getDate());
  return day <= until ? { until, reason: r.reason || '' } : null;
}
const monthDay = d => `${d.getMonth() + 1}/${d.getDate()}`;

function esc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function icon(id) {
  return `<svg class="icon"><use href="#i-${id}"/></svg>`;
}

// 照片網址加版本號（#127）：Cloudflare 讓照片在手機上快取 30 天（_headers），換了照片內容雜湊就變、網址跟著變，
// 手機就會抓新的。沒有版本（舊網址 GitHub Pages、剛上傳還沒部署）就不加，照舊用原本的短快取
let photoVersions = {}; // 照片路徑（photos/...）→ 內容雜湊，來自 /api/dogs 的 photoVersions
function versioned(path) {
  const v = photoVersions[path];
  return v ? `${path}?v=${v}` : path;
}

// 前端剛上傳成功的照片（編號 → 本機圖片網址）：網站要一兩分鐘才會更新，這段期間先顯示剛傳的那張（#48）
const photoOverrides = {};
function photoSrc(dog) {
  return photoOverrides[dog.id] || versioned(`photos/${encodeURIComponent(dog.id)}.jpg`);
}

// 縮圖（#83）：清單只載 photos/thumbs/ 的小圖，燈箱才看原圖；縮圖由 Action 產生（scripts/make-thumbs.py）
// 剛上傳的照片先用本機圖片；縮圖還沒產生就在 img 的 onerror 改讀 data-full 的原圖（thumbFallback）
function photoThumbSrc(dog) {
  return photoOverrides[dog.id] || versioned(`photos/thumbs/${encodeURIComponent(dog.id)}.jpg`);
}
// 放在 img 的 onerror 最前面：還有原圖可試就換原圖、這次不算讀取失敗。
// 縮圖只在上傳時產生一次（#305），沒產生的框標 thumb-full 顯示小圖示，正式畫面看得到要補哪張
const thumbFallback = "if (this.dataset.full) { this.src = this.dataset.full; this.removeAttribute('data-full'); this.parentNode.classList.add('thumb-full'); return; }";
function thumbAttrs(thumb, full) {
  return thumb === full ? `src="${esc(full)}"` : `src="${esc(thumb)}" data-full="${esc(full)}"`;
}

// zoom：詳細資訊上方的照片做成按鈕，點了用燈箱放大（#46）；照片讀不到就標 no-photo，按了不放大
// big：詳細資訊的大照片（#112）直接用原圖，縮圖放大會糊
function photoThumb(dog, size = 56, zoom = false, eager = false, big = false) {
  // 沒有編號就直接顯示腳掌圖示，不去抓 photos/.jpg
  if (!dog.id) {
    return `<div class="thumb"><div class="thumb-fallback" style="display:flex">${icon('paw')}</div></div>`;
  }
  const tag = zoom ? 'button' : 'div';
  const attrs = zoom ? ` type="button" class="thumb zoom" data-zoom aria-label="放大 ${esc(dog.name)} 的照片"` : ' class="thumb"';
  return `
    <${tag}${attrs}>
      <img ${thumbAttrs(big ? photoSrc(dog) : photoThumbSrc(dog), photoSrc(dog))} alt="" width="${size}" height="${size}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"
           onload="this.classList.add('loaded')"
           onerror="${thumbFallback} this.style.display='none'; this.nextElementSibling.style.display='flex'; this.parentNode.classList.add('no-photo'); this.parentNode.disabled = true;">
      <div class="thumb-fallback">${icon('paw')}</div>
    </${tag}>
  `;
}

// 燈箱（#46）：大圖不裁切、盡量用滿畫面；點關閉、點背景、Esc、手機返回都能關。
// 只放主照片（相簿 K 2026-10-09 拿掉）
let lightboxOpener = null;
let lightboxView = null; // { dog, src }
function lightboxOpen() {
  const el = document.getElementById('lightbox');
  return !!el && !el.hidden;
}

// 燈箱的 img 撐滿整個畫面、照片等比縮放置中，所以要算出照片實際畫在哪裡，點在照片上才不關
function insidePhoto(e) {
  const img = e.target.closest && e.target.closest('.lightbox img');
  if (!img || !img.naturalWidth) return false;
  const box = img.getBoundingClientRect();
  const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
  const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
  const left = box.left + (box.width - w) / 2, top = box.top + (box.height - h) / 2;
  return e.clientX >= left && e.clientX <= left + w && e.clientY >= top && e.clientY <= top + h;
}

// opener：關掉後焦點回到哪裡（詳細資訊的照片或狗卡）
function openLightbox(dog, opener) {
  if (!dog || !dog.id) return;
  let el = document.getElementById('lightbox');
  if (!el) {
    el = document.createElement('div');
    el.id = 'lightbox';
    el.className = 'lightbox';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<img alt="">
      <button type="button" class="lightbox-close" aria-label="關閉照片">${icon('close')}</button>
      <div class="lightbox-bar"></div>`;
    el.addEventListener('click', e => {
      if (e.target.closest('.lightbox-close')) { closeLightbox(); return; }
      // 裁切在下方列，點了不關
      if (!e.target.isConnected || e.target.closest('.lightbox-bar')) return;
      if (!insidePhoto(e)) closeLightbox(); // 點背景（含照片旁的留白）
    });
    document.body.appendChild(el);
  }
  lightboxView = { dog, src: photoSrc(dog) };
  el.setAttribute('aria-label', `${dog.name} 的照片`);
  showLightboxPhoto();
  lightboxOpener = opener || document.activeElement;
  el.hidden = false;
  document.documentElement.classList.add('lightbox-open');
  // 手機按「返回」時只關掉燈箱
  history.pushState({ bqPhoto: true }, '');
  el.querySelector('.lightbox-close').focus({ preventScroll: true });
}

// 畫出照片，和下方列（裁切）
function showLightboxPhoto() {
  const el = document.getElementById('lightbox');
  const v = lightboxView;
  if (!el || !v) return;
  const img = el.querySelector('img');
  img.src = v.src;
  img.alt = `${v.dog.name} 的照片`;
  const bar = el.querySelector('.lightbox-bar');
  bar.innerHTML = UPLOAD_URL && detailDog === v.dog && !v.dog.departure ? `<button type="button" class="lightbox-delete" id="mainCropBtn">${icon('crop')}裁切</button>` : '';
  bar.hidden = !bar.querySelector('button');
  const cropBtn = bar.querySelector('#mainCropBtn');
  if (cropBtn) cropBtn.addEventListener('click', () => cropMainPhoto(v.dog));
}

function hideLightbox() {
  const el = document.getElementById('lightbox');
  if (!el || el.hidden) return;
  el.hidden = true;
  el.querySelector('img').removeAttribute('src');
  lightboxView = null;
  document.documentElement.classList.remove('lightbox-open');
  const opener = lightboxOpener;
  lightboxOpener = null;
  if (opener && opener.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
}

function closeLightbox() {
  if (history.state && history.state.bqPhoto) history.back(); // popstate 會接著 hideLightbox
  else hideLightbox();
}

function statusBadge(dog, today) {
  const s = computeStatus(dog, today);
  if (s.kind === 'dated') {
    if (s.days < 0) return `<span class="badge muted">日期看不懂</span>`;
    const label = s.days === 0 ? '今天' : `${s.days} 天前`;
    return `<span class="badge ${s.level}">${label}</span>`;
  }
  if (s.kind === 'covered') return `<span class="badge sage">有人固定照顧</span>`;
  if (s.kind === 'rest') return `<span class="badge rest">休養中・到 ${monthDay(s.until)}</span>`;
  return `<span class="badge muted">沒有紀錄</span>`;
}

// 卡片上的「上次遛狗」：天數用 #3 的綠／黃／紅文字色
function lastWalk(dog, today) {
  const s = computeStatus(dog, today);
  let text = '沒有紀錄', level = 'muted', small = false;
  if (s.kind === 'dated') {
    if (s.days < 0) text = '日期看不懂';
    else {
      text = `<b>${s.days === 0 ? '今天' : s.days === 1 ? '昨天' : s.days}</b>${s.days >= 2 ? '<span class="last-unit"> 天前</span>' : ''}`;
      level = s.level;
    }
  } else if (s.kind === 'rest') {
    text = `<span class="nowrap">休養中</span><span class="nowrap rest-until">到 ${monthDay(s.until)}</span>`; level = 'rest'; small = true;
  } else if (s.kind === 'covered') {
    // 窄螢幕放不下一行時只在「有人固定｜照顧」之間換行，不會剩一個「顧」字
    text = '<span class="nowrap">有人固定</span><span class="nowrap">照顧</span>'; level = 'sage'; small = true;
  }
  return `<div class="last"${s.kind === 'dated' && s.days >= 0 ? ` data-days="${s.days}"` : ''}>${s.kind === 'covered' || s.kind === 'rest' ? '' : '<span class="lbl">上次遛</span>'}<span class="val ${level}${small ? ' small' : ''}">${text}</span></div>`;
}

// 卡片用「編號｜籠位」（照 K 的參考圖）；詳細資訊沿用 metaLine
// V7（#111）：平面圖上找得到的籠位做成橘色膠囊，點了跳「在哪」面板（js/find.js 的 whereOpen）
function cardMeta(dog) {
  if (typeof whereKnown === 'function' && whereKnown(dog)) {
    // 籠位膠囊放前面（最常點），編號放後面、放不下就換行
    return `<div class="meta has-pill"><button type="button" class="cage-pill" data-where aria-label="${esc(dog.name)} 在哪：${esc(dog.cage)}${dog.homeCage ? '（暫住）' : ''}">${icon('pin')}${esc(dog.cage)}</button>${tempCageText(dog)}${dog.id ? `<span class="id">${esc(dog.id)}</span>` : ''}</div>`;
  }
  return `<div class="meta">${dog.id ? `${esc(dog.id)}<span class="sep">|</span>` : ''}${esc(dog.cage)}${tempCageText(dog)}</div>`;
}
// 暫住的狗在籠位旁邊寫「暫住，原本 新B04」
function tempCageText(dog) {
  return dog.homeCage ? `<span class="temp-cage">暫住，原本 ${esc(dog.homeCage)}</span>` : '';
}

// 詳細資訊：籠位已經在標籤上（#112），這裡只寫編號和再入所
function metaLine(dog) {
  return `${dog.id ? `<div class="meta">編號 ${esc(dog.id)}</div>` : ''}${reentryLine(dog)}`;
}

// 編號前 8 碼是入所日期（例：2024032902 → 2024/03/29）；看不出來回 null
function idDate(id) {
  const m = String(id || '').match(/^(\d{4})(\d{2})(\d{2})\d{2}$/);
  return m ? makeDate(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)) : null;
}

// 入所日（ADR 0011）：現在的編號、舊編號的前 8 碼、出入所紀錄的入所日，三者裡最早的那天；看不出來回 null。
// 詳細資訊、分析頁都用這個，圖鑑（cards.js 的 bqIntake）照同一個規則
function firstIntake(dog) {
  const dates = [...[dog.id, ...(dog.formerIds || [])].map(idDate), ...(dog.stays || []).map(r => parseYmd(r.in))].filter(Boolean);
  return dates.length ? dates.reduce((a, b) => (b < a ? b : a)) : null;
}
const ymdOf = d => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;

// 舊編號（#75、#289）：編號下面一行「舊編號 …・最早入所 YYYY/M/D」，每個舊編號旁邊一個 ✕ 可以刪；
// 換新編號就是再入所（GLOSSARY），但畫面不標第幾次入所（K 2026-10-16）。
// 最後一個「補舊編號」，點了原地變輸入框。誰都能補、都能刪（ADR 0005），要先選好名字（ADR 0004），離所的狗只看不改
function reentryLine(dog) {
  const former = dog.formerIds || [];
  const can = !!(dog.id && UPLOAD_URL) && !dog.departure;
  const first = firstIntake(dog);
  const list = former.map(f => `<span class="former-num">${esc(f)}${can ? `<button type="button" class="former-del" data-former-del="${esc(f)}" aria-label="刪掉舊編號 ${esc(f)}">✕</button>` : ''}</span>`).join('');
  const e = formerEdit && formerEdit.dog === dog ? formerEdit : null;
  if (e) {
    const busy = e.phase === 'saving';
    return `<div class="reentry">${former.length ? `<span>舊編號</span>${list}` : ''}
      <form class="former-form" id="formerForm" autocomplete="off">
        <label for="formerText">補舊編號</label>
        <input id="formerText" inputmode="numeric" maxlength="12" placeholder="例：2015081801" value="${esc(e.text)}"${busy ? ' disabled' : ''}>
        <button type="submit" class="former-save"${busy ? ' disabled' : ''}>${busy ? '儲存中…' : '儲存'}</button>
        ${busy ? '' : '<button type="button" class="former-cancel" id="formerCancel">取消</button>'}
        <small class="former-hint">轉所、退回或換號前的編號，前 8 碼是入所日期。誰都能補，補錯了按 ✕ 刪掉。</small>
        ${e.error ? `<div class="photo-error" role="alert">${esc(e.error)}</div>` : ''}
      </form></div>`;
  }
  if (!former.length && !can) return '';
  return `<div class="reentry">${former.length ? `<span>舊編號</span>${list}${first ? `<span>・最早入所 ${ymdOf(first)}</span>` : ''}` : ''}${can ? `<button type="button" class="former-add" id="formerAdd">＋補舊編號</button>` : ''}</div>`;
}

function openFormerEdit(dog) {
  if (!dog || !dog.id || !UPLOAD_URL) return;
  formerEdit = { dog, text: '', phase: 'edit', error: '' };
  renderDetail();
  const box = document.getElementById('formerText');
  if (box) box.focus({ preventScroll: true });
}

// 補或刪舊編號（method 由呼叫的人給）；回空字串是成功，不然是要給人看的原因
async function sendFormer(dog, former, method) {
  try {
    const res = await fetch(`${UPLOAD_URL}/former/${encodeURIComponent(dog.id)}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ editor: editorName(), former }),
    });
    const out = await res.json().catch(() => null);
    if (!res.ok || !out || !out.ok) return (out && out.error) || `沒有存進去（${res.status}），請稍後再試`;
    return '';
  } catch (err) {
    return '沒有存進去，請確認網路後再試';
  }
}

// 存好就改這台的狗資料，天數、排序馬上重算
async function saveFormer() {
  const e = formerEdit;
  if (!e || e.phase === 'saving') return;
  const former = e.text.replace(/\s+/g, '');
  if (!/^\d{10}$/.test(former) || !idDate(former)) { e.phase = 'error'; e.error = '舊編號要是 10 碼數字，前 8 碼是入所日期'; renderDetail(); return; }
  if (!editorName()) { e.phase = 'error'; e.error = NEED_EDITOR; renderDetail(); return; }
  e.phase = 'saving'; e.error = ''; renderDetail();
  const error = await sendFormer(e.dog, former, 'POST');
  if (formerEdit !== e) return;
  if (error) {
    e.phase = 'error'; e.error = error; renderDetail();
    const b = document.getElementById('formerText');
    if (b) b.focus({ preventScroll: true });
    return;
  }
  e.dog.formerIds = [...(e.dog.formerIds || []), former].sort();
  formerEdit = null;
  render(); renderDetail();
  showToast(`${e.dog.name} 補上舊編號 ${former}，入所日改從 ${ymdOf(firstIntake(e.dog))} 算`);
}

async function removeFormer(dog, former) {
  if (!editorName()) { showToast(NEED_EDITOR); return; }
  if (!confirm(`刪掉 ${dog.name} 的舊編號 ${former}？`)) return;
  const error = await sendFormer(dog, former, 'DELETE');
  if (error) { showToast(error); return; }
  dog.formerIds = (dog.formerIds || []).filter(f => f !== former);
  render(); if (detailDog === dog) renderDetail();
  showToast(`已刪掉 ${dog.name} 的舊編號 ${former}`);
}

// 性別：狗卡 frontmatter 有寫 sex 才顯示 ♂／♀，沒寫就留空位；♂ 藍色、♀ 紅色
// 用內嵌 SVG 不用文字符號：iPhone 內建字型沒有 ♂♀，會換成基線不同的字型而下沉（#93）
function sexMark(dog) {
  const kind = dog.sex === '♂' ? 'male' : dog.sex === '♀' ? 'female' : '';
  if (!kind) return '<span class="sex"></span>';
  const label = kind === 'male' ? '公' : '母';
  return `<span class="sex ${kind}" role="img" aria-label="${label}" title="${label}">${icon(kind)}</span>`;
}

// 備註命中警示關鍵字時的原文顯示；同一筆備註命中幾個關鍵字都只顯示一次
function warnNote(note, flag) {
  return `<div class="warn-note">${icon('warn')}<span class="text">${highlightNote(note, flag.terms)}</span></div>`;
}

// ── 今天已溜（V3 第 4 節，#35）──
// 只記「這支手機、這個瀏覽器的人」今天自己溜過哪些狗，不是所有志工的紀錄。
// 只存在瀏覽器 localStorage，不寫 GitHub、不用登入；#138 起另外寫進試算表（見 sheetWrite）。
// 存成 { date: '2026-09-24', ids: [編號…] }（本地日期＋狗狗編號）：日期不是今天就當作沒有紀錄，
// 所以隔天自動全部未勾選；前一天的紀錄不用刪，下次記錄時直接蓋掉。
const WALKED_KEY = 'bq-walked-today';
// 無痕模式等讀寫不了 localStorage 時，至少這次開著網頁的期間還記得
let walkedStorage = (() => { try { return window.localStorage; } catch (e) { return null; } })();
let walkedMemory = null;

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadWalkedIds(today = new Date()) {
  let data = walkedMemory;
  try {
    const raw = walkedStorage && walkedStorage.getItem(WALKED_KEY);
    if (raw) data = JSON.parse(raw);
  } catch (e) { /* 讀不到就用這次開網頁期間的紀錄 */ }
  if (!data || data.date !== localDateKey(today) || !Array.isArray(data.ids)) return [];
  return data.ids.map(String);
}

function saveWalkedIds(ids, today = new Date()) {
  walkedCache = null;
  walkedMemory = { date: localDateKey(today), ids: [...ids] };
  try {
    if (walkedStorage) walkedStorage.setItem(WALKED_KEY, JSON.stringify(walkedMemory));
  } catch (e) {
    // 仍可讀取的舊資料不能蓋掉剛寫入記憶體的紀錄。
    walkedStorage = null;
  }
}

// 今天已溜用編號記；新來還沒有編號的狗改用犬名記（K 說不會有同名的狗）
function walkKey(dog) {
  if (dog.id) return dog.id;
  return dog.name ? `名:${dog.name}` : '';
}

// 這支手機今天溜了沒；computeStatus 每隻狗都會問，所以讀一次 localStorage 記著，記錄有變（saveWalkedIds）或換日才重讀
let walkedCache = null;
function walkedNow(dog, today = new Date()) {
  const date = localDateKey(today);
  if (!walkedCache || walkedCache.date !== date) walkedCache = { date, ids: new Set(loadWalkedIds(today)) };
  const key = walkKey(dog);
  return !!key && walkedCache.ids.has(key);
}

// 今天已溜的查詢入口（#85）：讀一次這支手機今天的紀錄，之後問「這隻溜了沒」、排今天已溜清單都用它，
// 不用再把編號陣列傳來傳去
function walkedToday(today = new Date()) {
  const ids = loadWalkedIds(today);
  const has = dog => { const key = walkKey(dog); return !!key && ids.includes(key); };
  return {
    has,
    // 今天已溜清單：最近記的排最上面
    dogs: list => list.filter(has).sort((a, b) => ids.indexOf(walkKey(a)) - ids.indexOf(walkKey(b))),
  };
}

// 加入（on=true）或移回（on=false）今天已溜；連犬名都沒有的狗記不了，直接略過，新加入的排在最上面。
// 回傳真的有變的狗和 undo（回到記之前的樣子）；都沒變就不寫入
function recordWalked(dogs, on, today = new Date()) {
  const before = loadWalkedIds(today);
  const ids = [...before];
  const changed = [];
  for (const dog of dogs) {
    const key = dog && walkKey(dog);
    if (!key || ids.includes(key) === on || changed.includes(dog)) continue;
    if (on) ids.unshift(key);
    else ids.splice(ids.indexOf(key), 1);
    changed.push(dog);
  }
  if (changed.length) saveWalkedIds(ids, today);
  return { changed, undo: () => saveWalkedIds(before, today) };
}

// 按「溜了」、一起記、移回：記下後重畫，底部跳提示條，可以按「復原」。
// #138：溜了同時寫進試算表；復原、放回就把試算表改回原本的樣子
// K 2026-10-17：會寫試算表時，按了溜了立刻變「已溜」，背景寫試算表（取代 2026-10-08 先等回應的做法，Apps Script 要好幾秒）；
// 沒寫進去就退回未溜，提示條給「再試一次」。不寫試算表（還沒設定名字、Worker 沒設定）照舊直接記在手機
function setWalked(dogs, on) {
  if (on && needNameToWalk()) return askNameThenWalk(dogs); // 還沒設定名字（先看看）：先問名字，設好再登記
  if (on && sheetWillWrite()) walkThenRecord(dogs);
  else setWalkedLocal(dogs, on);
}
function sheetWillWrite() {
  return !!UPLOAD_URL && sheetWriteState !== 'off' && !!loadWalkerName();
}
const walkPending = new Set(); // 按了溜了、還在等試算表回應的狗（walkKey）
function walkPendingNow(dog) {
  const key = walkKey(dog);
  return !!key && walkPending.has(key);
}
function walkThenRecord(dogs) {
  const todo = dogs.filter((d, i) => d && walkKey(d) && !walkedNow(d) && dogs.indexOf(d) === i);
  if (!todo.length) return;
  recordWalked(todo, true);
  pickedBuddies.clear();
  render();
  renderDetail();
  const text = `${todo.map(d => d.name).join('、')} 今天溜了`;
  // 復原要等試算表改回來才算（#383）；還在寫就先等寫完再改回
  let written = false, write = null;
  const undoFn = () => written ? undoSheetWalks(todo) : write.then(() => undoSheetWalks(todo));
  showToast(text, undoFn, { label: '＋一起溜的人', fn: () => openWithSheet(todo) });
  write = sheetQueue = queueSheetWrite(todo, true, text, undoFn).then(ok => {
    written = true;
    if (ok === null) return; // 試算表那邊沒設定，照舊只記在手機
    // 沒寫進試算表的退回：試算表沒有這支手機寫的今天紀錄
    const items = loadSheetWrites();
    const failed = todo.filter(d => walkedNow(d) && !(items[walkKey(d)] && items[walkKey(d)].mine));
    if (!failed.length) return;
    recordWalked(failed, false);
    render();
    renderDetail();
    // 網路不通、試算表回錯誤：給「再試一次」；試算表找不到的狗再試也一樣，sheetWrite 的提示已說是哪幾隻
    if (ok === false && sheetWriteFail !== 'missed') showToast(`${sheetWriteFailText}，已退回未溜`, null, { label: '再試一次', fn: () => setWalked(failed, true) });
  }).catch(e => console.error(e));
}
function setWalkedLocal(dogs, on) {
  const { changed, undo } = recordWalked(dogs, on);
  if (!changed.length) return;
  pickedBuddies.clear();
  render();
  renderDetail();
  const names = changed.map(d => d.name).join('、');
  const text = on ? `${names} 今天溜了` : `${names} 取消今天溜了`;
  const undoFn = () => {
    undo();
    if (on) clearWalkWith(changed);
    render();
    renderDetail();
    queueSheetWrite(changed, !on);
  };
  const extra = on && loadWalkerName() ? { label: '＋一起溜的人', fn: () => openWithSheet(changed) } : null;
  showToast(text, undoFn, extra);
  queueSheetWrite(changed, on, text, undoFn);
}

// ── 誤觸復原：這支手機今天寫進試算表的溜了，事後也能從狗群頁、我溜過撤銷 ──
// 只認這支手機記下的 prev／wrote（sheetWrite 存的）；試算表那格已被別人改過（current 不是我們寫的）就不提供，
// 撤銷時 Apps Script 也會再核對一次，不蓋掉別人後來改的
function sheetUndoable(dog, today = new Date()) {
  const it = loadSheetWrites(today)[walkKey(dog)];
  return !!(it && it.prev && it.wrote && (!it.current || it.current.walker === it.wrote.walker));
}
let sheetUndoBusy = false;
// 回傳要顯示的結果文字；只有試算表回「restored」的才算復原
async function undoSheetWalks(dogs) {
  const todo = dogs.filter((d, i) => d && sheetUndoable(d) && dogs.indexOf(d) === i);
  if (sheetUndoBusy || !todo.length) return '';
  sheetUndoBusy = true;
  hideToast();
  render();
  let ok = false;
  try { ok = await queueSheetWrite(todo, false); } catch (e) { console.error(e); }
  sheetUndoBusy = false;
  const items = loadSheetWrites();
  const restored = todo.filter(d => { const it = items[walkKey(d)]; return it && !it.wrote; });
  const changed = todo.filter(d => !restored.includes(d) && !sheetUndoable(d));
  const left = todo.filter(d => !restored.includes(d) && !changed.includes(d));
  const names = list => list.map(d => d.name).join('、');
  const parts = [];
  if (restored.length) parts.push(`已從試算表復原 ${restored.length} 隻`);
  if (changed.length) parts.push(`${names(changed)} 在試算表已被改過，沒有蓋掉別人的紀錄`);
  if (left.length) parts.push(ok === null ? `${names(left)} 目前連不到試算表，尚未復原` : `${names(left)} ${sheetWriteFailText || '試算表沒改回來'}，尚未復原`);
  const text = parts.join('；');
  render();
  renderDetail();
  showToast(text, null, left.length ? { label: '再試一次', fn: () => undoSheetWalks(left) } : null);
  return text;
}
// 我溜過最上面：今天這支手機登記、還能撤銷的狗
function todayUndoHtml() {
  const dogs = allDogs.filter(d => sheetUndoable(d));
  if (!dogs.length) return '';
  return `<section class="mine-undo" aria-label="今天登記的">
    <p>今天在這支手機登記 ${dogs.length} 隻，按錯可以取消（會把試算表改回原本的）。</p>
    <ul>${dogs.map(d => `<li><span>${esc(d.name)}</span><button type="button" class="who-edit" data-undo-walk="${esc(walkKey(d))}" aria-label="取消 ${esc(d.name)} 今天溜了"${sheetUndoBusy ? ' disabled' : ''}>取消</button></li>`).join('')}</ul>
  </section>`;
}
document.getElementById('main').addEventListener('click', e => {
  const btn = e.target.closest('[data-undo-walk]');
  if (!btn) return;
  const dog = allDogs.find(d => walkKey(d) === btn.dataset.undoWalk);
  if (dog) undoSheetWalks([dog]);
});

// ── 我的常溜（#267）：逐隻增刪，絕不把手機上的舊整份清單蓋到 D1 ──
const FAVS_KEY = 'bq-favs';
const FAV_SYNC_KEY = 'bq-favs-sync';
let favSyncMemory = null;
let favSyncQueue = Promise.resolve();
function favState() {
  if (!favSyncMemory) {
    const saved = readJsonKey(FAV_SYNC_KEY);
    favSyncMemory = saved && saved.v === 1 ? saved : { v: 1, aliases: {}, books: {}, pending: [] };
  }
  return favSyncMemory;
}
function saveFavState() { writeJsonKey(FAV_SYNC_KEY, favState()); }
function localFavs() { const v = readJsonKey(FAVS_KEY); return Array.isArray(v) ? v.map(String) : []; }
function favoriteIds() {
  const state = favState(), codes = loadMyCodes();
  const ids = new Set(state.books[codes.join(',')] || []);
  for (const op of state.pending) {
    if (!op.codes.some(c => codes.includes(c))) continue;
    if (op.on) ids.add(op.dogId); else ids.delete(op.dogId);
  }
  return ids;
}
function loadFavs() {
  const ids = favoriteIds(), aliases = favState().aliases;
  return [...new Set([...localFavs(), ...allDogs.filter(d => ids.has(aliases[walkKey(d)])).map(walkKey)])];
}
function isFav(dog) { const k = walkKey(dog); return !!k && loadFavs().includes(k); }
function toggleFav(dog) {
  const k = walkKey(dog);
  if (!k) return;
  const on = !isFav(dog), codes = loadMyCodes(), state = favState();
  state.localVersions ||= {};
  state.localVersions[k] = (state.localVersions[k] || 0) + 1;
  saveFavState();
  const dogId = state.aliases[k];
  if (codes.length && dogId) {
    // 讀取合併所有名字；取消時也要取消各個名字底下的這隻狗。
    state.pending.push({ codes: [codes[0]], dogId, on });
    writeJsonKey(FAVS_KEY, localFavs().filter(x => state.aliases[x] !== dogId && x !== k));
    saveFavState();
  } else {
    writeJsonKey(FAVS_KEY, on ? [k, ...localFavs()] : localFavs().filter(x => x !== k));
  }
  syncFavs();
}

// 核心只操作收藏狀態；儲存、傳輸由呼叫者提供，不依賴畫面或瀏覽器。
async function reconcileFavorites(state, codes, io) {
  const out = await io.read(codes);
  if (io.codes().join(',') !== codes.join(',')) return;
  state.aliases = out.aliases;
  const bookKey = codes.join(',');
  state.books[bookKey] = out.ids;
  for (const key of io.local()) {
    const dogId = state.aliases[key];
    if (!dogId) continue;
    let op = state.pending.slice().reverse().find(op => op.dogId === dogId && op.codes.includes(codes[0]));
    if (!op || !op.on) {
      op = { codes: [codes[0]], dogId, on: true };
      state.pending.push(op);
    }
    op.legacy ||= {};
    op.legacy[key] = state.localVersions?.[key] || 0;
  }
  io.save();
  while (state.pending.length) {
    const op = state.pending[0];
    await io.write({ codes: op.codes, dogId: op.dogId, on: op.on });
    // 只清除此筆搬移的原始收藏；等待期間新按的訪客收藏保留。
    io.removeLegacy(key => Object.hasOwn(op.legacy || {}, key)
      && (state.localVersions?.[key] || 0) === op.legacy[key]);
    state.pending.shift();
    if (op.codes.some(c => codes.includes(c))) {
      const ids = new Set(state.books[bookKey]);
      if (op.on) ids.add(op.dogId); else ids.delete(op.dogId);
      state.books[bookKey] = [...ids];
    }
    io.save();
  }
}

async function favoriteRequest(codes, op) {
  const base = UPLOAD_URL + '/favorites';
  const res = await fetch(op ? base : base + '?codes=' + encodeURIComponent(codes[0]), op ? {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...op, codes: op.codes.slice(0, 1) }),
  } : { cache: 'no-store' });
  const out = await res.json();
  if (!res.ok || !out.ok || (!op && (!Array.isArray(out.ids) || !out.aliases))) throw new Error('常溜同步失敗');
  return out;
}

function syncFavs() {
  // 串行保留點擊順序；失敗的操作下次打開或恢復連線再試。
  favSyncQueue = favSyncQueue.then(async () => {
    let codes = loadMyCodes();
    if (!codes.length || !UPLOAD_URL) return;
    const original = codes.join(','), name = loadWalkerName();
    if (name) {
      const out = await identityRequest('', { name });
      if (loadMyCodes().join(',') !== original || loadWalkerName() !== name) return;
      saveWalkerName(out.identity.name);
      walkerCodesMemory = out.identity.codes;
      try { walkedStorage?.setItem(WALKER_CODES_KEY, JSON.stringify(out.identity.codes)); } catch (e) { /* 本次仍可使用 */ }
      codes = out.identity.codes;
      myWalks = walksData ? parseMyWalks(walksData, codes) : [];
    }
    await reconcileFavorites(favState(), codes, {
      codes: loadMyCodes, local: localFavs, save: saveFavState,
      read: codes => favoriteRequest(codes), write: op => favoriteRequest(null, op),
      removeLegacy: matches => writeJsonKey(FAVS_KEY, localFavs().filter(key => !matches(key))),
    });
    if (loadMyCodes().join(',') === codes.join(',')) { render(); renderDetail(); }
  }).catch(() => {
    if (loadMyCodes().length) showToast('常溜暫存在這支手機，連線恢復後會再同步');
  });
  return favSyncQueue;
}

// ── 按「溜了」寫進試算表（#138）──
// 經過 Worker 的 /walk 轉給 K 部署的 Google Apps Script，只改主清單的「遛狗日期」「誰遛的」。
// 寫成功的記下試算表原本的內容（只記今天的），復原或放回時帶回去改回來；小程式只在格子還是我們寫的樣子時才改回。
// Worker 還沒設定（回 code: 'off'）就照舊只記在手機上，不打擾
const WALKER_NAME_KEY = 'bq-walker-name';
const SHEET_WRITES_KEY = 'bq-sheet-writes';
// 跟 scripts/sync-sheet.mjs 的 NAME_SEP 一樣
const WALKER_NAME_SEP = /[、,，\/／&＆+＋。｡．.;；:：|｜·・\s]+/;
let walkerNameMemory = '';
let sheetWritesMemory = null;
let sheetWriteState = 'unknown'; // unknown／on／off
let sheetQueue = Promise.resolve();
// 這次打開網頁後寫過（收到試算表回應）的狗：拿試算表現況核對時不動它們，免得被較早送出的 /walkers 回應蓋掉
const sheetWritesThisPage = new Set();

// ── 誰遛的名字（#141 第 9 項）──
// 名字不放進公開的 repo（dogs.json 只有代號）：打開網頁時跟 Worker 拿（GET /api/walkers，Worker 直接讀試算表），
// 只在畫面上顯示。{ 狗的 key: '嘉文+俐葶+岑' }；拿不到就不顯示名字，其他照常
let walkerNames = {};
let walkerNameList = []; // 表上出現過的名字（開頭畫面讓志工點選自己，#141）
let walkerOlderNames = []; // 以前溜過、現在表上沒有的名字（Worker 記下來的，K 2026-10-12）：打字時才推薦
let walkerCodeNames = {}; // 代號 → 名字（Worker 用名單換的，K 2026-10-12）：電腦版最近 30 天寫每天誰遛的
const allWalkerNames = () => [...new Set([...walkerNameList, ...walkerOlderNames])];
// 介面評估第三輪（K 2026-10-08）：沒網路時要告訴志工，不然溜狗人只有「—」、頁首照樣寫資料更新時間。
// 手機說離線，或拿溜狗人名字時連不上（不是 Worker 回錯誤），就當作沒網路
let walkerNamesOffline = false;
function isOffline() {
  return walkerNamesOffline || (typeof navigator !== 'undefined' && navigator.onLine === false);
}
function setWalkerNamesOffline(on) {
  if (walkerNamesOffline === on) return;
  walkerNamesOffline = on;
  renderUpdatedLabel();
  render();
  renderDetail();
}
async function loadWalkerNames() {
  if (!UPLOAD_URL) return;
  let res;
  try {
    res = await fetch(`${UPLOAD_URL}/walkers`, { cache: 'no-cache' });
  } catch (e) {
    console.error(e);
    setWalkerNamesOffline(true);
    return;
  }
  setWalkerNamesOffline(false);
  try {
    if (!res.ok) return;
    const out = await res.json();
    if (out && out.walkers && typeof out.walkers === 'object') {
      walkerNames = out.walkers;
      walkerNameList = [...new Set((Array.isArray(out.names) ? out.names : []).map(canonicalWalker).filter(Boolean))];
      walkerOlderNames = [...new Set((Array.isArray(out.older) ? out.older : []).map(canonicalWalker).filter(Boolean))];
      walkerCodeNames = out.codes && typeof out.codes === 'object' ? out.codes : {};
      reconcileSheetWrites();
      render();
      renderDetail();
      if (onboard && onboard.step === 0 && onboard.phase !== 'saving') renderOnboard();
    }
  } catch (e) { console.error(e); }
}
// K 2026-10-16：按了復原，試算表改回去了，但手機沒收到回應（例如馬上重新整理），手機上「今天我溜了」會一直留著。
// 拿到試算表現況時核對：這頁還沒寫過的狗，手機記的誰遛的跟試算表不一樣，就以試算表為準，清掉手機上的今天紀錄
function reconcileSheetWrites(today = new Date()) {
  if (!Object.keys(walkerNames).length) return;
  const items = loadSheetWrites(today);
  const ids = loadWalkedIds(today);
  const me = canonicalWalker(loadWalkerName());
  let changed = false;
  for (const [key, item] of Object.entries(items)) {
    if (sheetWritesThisPage.has(key) || !item || !item.current) continue;
    const live = String(walkerNames[key] || '');
    if (live === String(item.current.walker || '')) continue;
    delete items[key];
    changed = true;
    const at = ids.indexOf(key);
    if (at !== -1 && !splitWalkers(live).map(canonicalWalker).includes(me)) ids.splice(at, 1);
  }
  if (!changed) return;
  saveSheetWrites(items, today);
  saveWalkedIds(ids, today);
}
// ── 今日溜狗紀錄（ADR 0007）：別支手機按溜了／復原，這裡不用等同步 ──
// Worker 在 D1 記下按溜了／復原後試算表那隻狗的「遛狗日期」「誰遛的」，這裡從 /api/today 讀今天的清單。
// 試算表是正本：只採用比上次同步新的紀錄。狗卡安靜換掉，不跳提示；抓不到就照舊，下次再試
const TODAY_POLL_MS = 60 * 1000;   // 網頁顯示在螢幕上時每 1 分鐘抓一次
const TODAY_REFETCH_MS = 30 * 1000; // 切回網頁、距上次超過 30 秒就馬上抓
let todayWalks = { date: '', walks: [] };
let todayFetchedAt = 0;
const sheetWrittenAt = new Map(); // 這頁自己寫試算表的時間（狗的 key → ms）：比它舊的今日紀錄不蓋掉自己剛寫的
async function loadTodayWalks() {
  if (!UPLOAD_URL) return;
  todayFetchedAt = Date.now();
  try {
    const res = await fetch(`${UPLOAD_URL}/today`, { cache: 'no-cache' });
    if (!res.ok) return;
    const out = await res.json();
    if (!out || !Array.isArray(out.walks) || typeof out.date !== 'string') return;
    todayWalks = { date: out.date, walks: out.walks };
  } catch (e) { return; }
  if (applyTodayWalks()) { render(); renderDetail(); }
}
// 比上次同步新、今天的紀錄
function liveTodayWalks(today = new Date()) {
  if (todayWalks.date !== localDateKey(today)) return [];
  const since = dataSyncedAt ? dataSyncedAt.getTime() : 0;
  return todayWalks.walks.filter(w => w && w.key && Date.parse(w.at) > since && Date.parse(w.at) >= (sheetWrittenAt.get(w.key) || 0));
}
// 把今日紀錄套到狗卡、誰遛的、這支手機的今天已溜；回傳畫面要不要重畫
function applyTodayWalks(today = new Date()) {
  const walks = liveTodayWalks(today);
  if (!walks.length) return false;
  const me = canonicalWalker(loadWalkerName());
  const items = loadSheetWrites(today);
  const ids = loadWalkedIds(today);
  let changed = false, itemsChanged = false, idsChanged = false;
  for (const w of walks) {
    const date = w.walkedDate || '';
    const walker = String(w.walker || '');
    const dog = allDogs.find(d => walkKey(d) === w.key);
    if (dog) {
      const before = dog.walkedDate ? localDateKey(dog.walkedDate) : '';
      if (before !== date) { dog.walkedDate = parseYmd(date); changed = true; }
    }
    if (walkerNames[w.key] !== walker) { walkerNames[w.key] = walker; changed = true; }
    const mine = !!w.walked && !!me && splitWalkers(walker).map(canonicalWalker).includes(me);
    const item = items[w.key];
    if (item && item.current && (item.current.date !== date || item.current.walker !== walker)) {
      items[w.key] = { ...item, current: { date, walker }, mine };
      itemsChanged = true;
    }
    const at = ids.indexOf(w.key);
    if (mine && at === -1) { ids.unshift(w.key); idsChanged = true; }
    if (!mine && at !== -1) { ids.splice(at, 1); idsChanged = true; }
  }
  if (itemsChanged) saveSheetWrites(items, today);
  if (idsChanged) saveWalkedIds(ids, today);
  return changed || itemsChanged || idsChanged;
}
function refreshTodayWalks() {
  if (typeof document !== 'undefined' && document.hidden) return;
  if (Date.now() - todayFetchedAt < TODAY_REFETCH_MS) return;
  loadTodayWalks();
}
// 一格好幾個名字（「嘉文+俐葶+岑」「維芬。佳岑」）拆開，用頓號接起來，不重複
function canonicalWalker(name) {
  const n = String(name || '').trim().replace(/經常帶.*$/, '').trim();
  return n === '岑' ? '佳岑' : n;
}
function splitWalkers(text) {
  return [...new Set(String(text || '').split(WALKER_NAME_SEP).map(n => n.trim()).filter(Boolean))];
}
// 上次是誰溜的：這支手機今天按過溜了就是自己；否則用試算表的「誰遛的」
// 同一個人的不同寫法只顯示一次（「岑」＝「佳岑」，K 2026-10-05）
function walkerList(dog, today = new Date()) {
  const uniq = list => [...new Set(list.map(canonicalWalker).filter(Boolean))];
  const item = loadSheetWrites(today)[walkKey(dog)];
  if (item && item.current) return uniq(splitWalkers(item.current.walker));
  if (walkedNow(dog, today)) return uniq([...splitWalkers(walkerNames[walkKey(dog)]), loadWalkerName() || '你', ...(loadWalkWith(today)[walkKey(dog)] || [])]);
  return uniq(splitWalkers(walkerNames[walkKey(dog)]));
}

// ── 一起溜的人（#141 第 1 項，K：溜了要怎麼寫除了我以外的人）──
// 按溜了先寫自己；提示條「＋一起溜的人」選名字，再寫進試算表同一格（小程式用「、」接在後面）。
// 最近一起溜過的名字記在這支手機，下次排在前面一點就加；今天每隻狗加了誰也記著，畫面上顯示用
const COMPANIONS_KEY = 'bq-companions';
const WALK_WITH_KEY = 'bq-walk-with';
const COMPANIONS_MAX = 8;
function readJsonKey(key) {
  try { const raw = walkedStorage && walkedStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function writeJsonKey(key, v) {
  try { if (walkedStorage) walkedStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 存不了就算了 */ }
}
function loadCompanions() {
  const v = readJsonKey(COMPANIONS_KEY);
  return Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, COMPANIONS_MAX) : [];
}
function loadWalkWith(today = new Date()) {
  const v = readJsonKey(WALK_WITH_KEY);
  return v && v.date === localDateKey(today) && v.map && typeof v.map === 'object' ? v.map : {};
}
function addWalkWith(dogs, names, today = new Date()) {
  const map = loadWalkWith(today);
  for (const d of dogs) { const k = walkKey(d); if (k) map[k] = [...new Set([...(map[k] || []), ...names])]; }
  writeJsonKey(WALK_WITH_KEY, { date: localDateKey(today), map });
  writeJsonKey(COMPANIONS_KEY, [...new Set([...names, ...loadCompanions()])].slice(0, COMPANIONS_MAX));
}
function clearWalkWith(dogs, today = new Date()) {
  const map = loadWalkWith(today);
  for (const d of dogs) delete map[walkKey(d)];
  writeJsonKey(WALK_WITH_KEY, { date: localDateKey(today), map });
}
let withSheet = null; // { dogs, picked: Set, text, add }
// add：詳細資訊溜狗人旁的「＋」，選好的人接在目前名單後面（#141）；不是 add 就是溜了之後提示條的「＋一起溜的人」
function openWithSheet(dogs, add = false) {
  const already = add ? new Set(walkerList(dogs[0]).map(canonicalWalker)) : new Set(dogs.flatMap(d => loadWalkWith()[walkKey(d)] || []));
  withSheet = { dogs, picked: new Set(), text: '', already, add, phase: 'edit', error: '' };
  renderWithSheet();
}
function withSheetHtml() {
  const w = withSheet;
  const me = loadWalkerName();
  const names = [...new Set([...walkerNameList, ...loadCompanions(), ...w.picked])].filter(n => (w.add || n !== me) && !w.already.has(n));
  return `<div class="with-sheet" role="dialog" aria-modal="true" aria-labelledby="withTitle">
    <h3 id="withTitle">${w.add ? '加入溜狗人：' : '誰跟你一起溜 ' }${esc(w.dogs.map(d => d.name).join('、'))}${w.add ? '' : '？'}</h3>
    ${names.length ? `<div class="with-names">${names.map(n => `<button type="button" class="with-name${w.picked.has(n) ? ' on' : ''}" data-with="${esc(n)}" aria-pressed="${w.picked.has(n)}">${w.picked.has(n) ? icon('tick') : ''}${esc(n)}</button>`).join('')}</div>` : ''}
    <form class="with-add" id="withAdd" autocomplete="off">
      <input type="text" id="withInput" maxlength="20" placeholder="${names.length ? '其他人：輸入名字' : '輸入名字，例：嘉文'}" value="${esc(w.text)}" enterkeyhint="done">
      <button type="submit">加入</button>
    </form>
    ${w.error ? `<p role="alert">${esc(w.error)}</p>` : ''}
    <div class="with-bar">
      <button type="button" class="bar-btn" data-with-cancel>取消</button>
      <button type="button" class="with-ok" data-with-ok${w.phase === 'saving' ? ' disabled' : ''}>${w.phase === 'saving' ? '儲存中…' : '寫進試算表'}${w.picked.size ? `（${w.picked.size} 人）` : ''}</button>
    </div>
  </div>`;
}
function renderWithSheet() {
  let box = document.getElementById('withBackdrop');
  if (!withSheet) { if (box) box.remove(); return; }
  if (!box) {
    box = document.createElement('div');
    box.id = 'withBackdrop';
    box.className = 'with-backdrop';
    document.body.appendChild(box);
    box.addEventListener('click', e => {
      if (withSheet.phase === 'saving') return;
      if (e.target === box || e.target.closest('[data-with-cancel]')) { withSheet = null; renderWithSheet(); return; }
      const nameBtn = e.target.closest('[data-with]');
      if (nameBtn) {
        const n = nameBtn.dataset.with;
        if (withSheet.picked.has(n)) withSheet.picked.delete(n); else withSheet.picked.add(n);
        renderWithSheet();
        return;
      }
      if (e.target.closest('[data-with-ok]')) finishWithSheet();
    });
    box.addEventListener('input', e => { if (withSheet.phase !== 'saving' && e.target.id === 'withInput') withSheet.text = e.target.value; });
    box.addEventListener('submit', e => {
      e.preventDefault();
      if (withSheet.phase === 'saving') return;
      splitWalkers(withSheet.text).forEach(n => withSheet.picked.add(n));
      withSheet.text = '';
      renderWithSheet();
    });
  }
  box.innerHTML = withSheetHtml();
}
async function finishWithSheet() {
  const w = withSheet;
  splitWalkers(w.text).forEach(n => w.picked.add(n));
  const names = [...w.picked];
  if (w.add) {
    withSheet = null;
    renderWithSheet();
    const dog = w.dogs[0];
    const now = walkerList(dog);
    const added = names.filter(n => !now.map(canonicalWalker).includes(canonicalWalker(n)));
    if (added.length) editWalkers(dog, [...now, ...added], `已加入 ${added.join('、')}`);
    return;
  }
  withSheet = null;
  renderWithSheet();
  if (!names.length) return;
  addWalkWith(w.dogs, names);
  render();
  renderDetail();
  const text = `已加上 ${names.join('、')}`;
  showToast(text);
  queueSheetWrite(w.dogs, true, text, null, names.join('、'));
}

function firstWalkerName(text) {
  return String(text || '').split(WALKER_NAME_SEP).map(n => n.trim()).filter(Boolean)[0] || '';
}
function loadWalkerName() {
  try {
    if (walkedStorage) return (walkedStorage.getItem(WALKER_NAME_KEY) || '').trim();
  } catch (e) { /* 讀不到就用記憶體裡的 */ }
  return String(walkerNameMemory || '').trim();
}
function saveWalkerName(name) {
  walkerNameMemory = name || '';
  try {
    if (walkedStorage && name) walkedStorage.setItem(WALKER_NAME_KEY, name);
    else if (walkedStorage) walkedStorage.removeItem(WALKER_NAME_KEY);
  } catch (e) { /* 存不了就只記在記憶體 */ }
}
// { date: 今天, items: { 狗的 key: { id, name, prev, wrote } } }，不是今天的就丟掉
function loadSheetWrites(today = new Date()) {
  let data = sheetWritesMemory;
  try {
    const raw = walkedStorage && walkedStorage.getItem(SHEET_WRITES_KEY);
    if (raw) data = JSON.parse(raw);
  } catch (e) { /* 讀不到就用記憶體裡的 */ }
  return data && data.date === localDateKey(today) && data.items && typeof data.items === 'object' ? { ...data.items } : {};
}
function saveSheetWrites(items, today = new Date()) {
  sheetWritesMemory = { date: localDateKey(today), items };
  try {
    if (walkedStorage) walkedStorage.setItem(SHEET_WRITES_KEY, JSON.stringify(sheetWritesMemory));
  } catch (e) { /* 存不了就只記在記憶體 */ }
}

// 一個一個送，按了溜了馬上復原時，復原會等溜了寫完才送（才知道要改回什麼）
function queueSheetWrite(dogs, on, toastText, toastUndo, walker, expected) {
  // 按溜了時，那格今天已經用別的寫法寫了我（例：「岑」），就送那格原本的寫法：小程式看到已經有我就不動，
  // 不會接成「岑、佳岑」（K 2026-10-05）。寫法不同的狗分開送
  const groups = [];
  if (on && !walker && expected === undefined) {
    for (const d of dogs) {
      const w = myAliasIn(d);
      const g = groups.find(x => x.w === w);
      if (g) g.dogs.push(d); else groups.push({ w, dogs: [d] });
    }
  } else groups.push({ w: walker, dogs });
  // true：都寫進去了；false：有沒寫進去的；null：沒送（還沒設定名字、Worker 沒設定）
  let result = null;
  for (const g of groups) {
    sheetQueue = sheetQueue.then(() => sheetWrite(g.dogs, on, toastText, toastUndo, g.w, expected))
      .then(ok => { if (ok === false) result = false; else if (ok === true && result === null) result = true; })
      .catch(e => { console.error(e); result = false; });
  }
  return sheetQueue.then(() => result);
}
function myAliasIn(dog, today = new Date()) {
  const me = loadWalkerName();
  if (!me || !dog.walkedDate || localDateKey(dog.walkedDate) !== localDateKey(today)) return null;
  return splitWalkers(walkerNames[walkKey(dog)]).find(n => n !== me && canonicalWalker(n) === canonicalWalker(me)) || null;
}

// 提示條還是剛剛那則（使用者還沒按別的）才在後面補一句，不蓋掉「復原」
function addToToast(text, undo, extra) {
  const el = document.getElementById('toast');
  if (!el || el.hidden || toastUndo !== undo) return false;
  el.querySelector('.toast-text').textContent = `${text}${extra}`;
  return true;
}

// walker：加「一起溜的人」時傳那幾個名字（試算表那格已經有今天的名字，小程式會用「、」接在後面）
// 回傳 true：寫進去了；false：沒寫進去（原因在 sheetWriteFail／sheetWriteFailText，也已跳提示）；null：沒送
let sheetWriteFail = '';     // network／error／missed
let sheetWriteFailText = '';
async function sheetWrite(dogs, on, toastText, toastUndo, walker = null, expected = undefined) {
  if (!UPLOAD_URL || sheetWriteState === 'off') return null;
  const today = new Date();
  const withKey = dogs.map(d => ({ d, key: walkKey(d) })).filter(x => x.key);
  let payload;
  if (on) {
    const who = walker || loadWalkerName();
    if (!who) return null; // 還沒在「我溜過」設定名字（提醒放在我溜過頁）
    payload = { action: expected === undefined ? 'walk' : 'edit', walker: who, dogs: withKey.map(({ d, key }) => ({ id: d.id || '', name: d.name, ...(expected === undefined ? {} : { expected }) })) };
  } else {
    const items = loadSheetWrites(today);
    const list = withKey.filter(x => items[x.key] && items[x.key].prev && items[x.key].wrote).map(x => items[x.key]);
    if (!list.length) return null;
    payload = { action: 'undo', dogs: list.map(x => ({ id: x.id, name: x.name, prev: x.prev, wrote: x.wrote })) };
  }
  if (!payload.dogs.length) return null;
  let res = null, out = null;
  try {
    res = await fetch(`${UPLOAD_URL}/walk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    out = await res.json().catch(() => null);
  } catch (e) {
    // 一般的溜了沒寫進去會退回未溜（walkThenRecord 補「再試一次」），改溜狗人、復原則是請志工自己去改
    const plain = on && expected === undefined;
    sheetWriteFail = 'network';
    sheetWriteFailText = on ? '沒寫進試算表（網路不通）' : '試算表沒改回來（網路不通）';
    showToast(plain ? `${sheetWriteFailText}，已退回未溜` : `${sheetWriteFailText}，請自己到試算表${on ? '填' : '改'}`);
    return false;
  }
  if (res.status === 503 && out && out.code === 'off') { sheetWriteState = 'off'; return null; }
  if (!res.ok || !out || !out.ok) {
    const why = (out && out.error) || `HTTP ${res.status}`;
    sheetWriteFail = 'error';
    sheetWriteFailText = on ? `沒寫進試算表：${why}` : `試算表沒改回來：${why}`;
    showToast(sheetWriteFailText);
    return false;
  }
  sheetWriteState = 'on';
  const items = loadSheetWrites(today);
  const keyOf = r => (withKey.find(({ d }) => (d.id || '') === (r.id || '') && d.name === r.name) || {}).key;
  const missed = [];
  for (const r of out.results || []) {
    const key = keyOf(r);
    if (!key) continue;
    const old = items[key];
    sheetWritesThisPage.add(key);
    sheetWrittenAt.set(key, Date.now());
    if (on && (r.status === 'written' || r.status === 'already')) {
      const current = { date: out.today || localDateKey(today), walker: r.wrote ? r.wrote.walker : (r.current ? r.current.walker : walkerNames[key] || '') };
      items[key] = { id: r.id || '', name: r.name, prev: expected !== undefined ? r.prev : (old && old.prev ? old.prev : r.prev), wrote: r.wrote || (old && old.wrote), current, mine: splitWalkers(current.walker).map(canonicalWalker).includes(canonicalWalker(loadWalkerName())) };
      walkerNames[key] = current.walker;
    }
    if (!on && r.status === 'restored' && old) {
      const rawDate = old.prev.date || {};
      const parsed = parseYmd(String(rawDate.text || '').replace(/\//g, '-').replace(/-(\d)(?=-|$)/g, '-0$1'));
      const date = rawDate.date || (parsed ? localDateKey(parsed) : '');
      items[key] = { id: old.id, name: old.name, current: { date, walker: old.prev.walker }, mine: date === localDateKey(today) && splitWalkers(old.prev.walker).map(canonicalWalker).includes(canonicalWalker(loadWalkerName())) };
      walkerNames[key] = old.prev.walker;
      clearWalkWith([withKey.find(x => x.key === key).d], today);
    }
    if (r.status === 'changed' && r.current) {
      items[key] = { ...old, id: r.id || '', name: r.name, current: r.current, mine: r.current.date === localDateKey(today) && splitWalkers(r.current.walker).map(canonicalWalker).includes(canonicalWalker(loadWalkerName())) };
      walkerNames[key] = r.current.walker;
    }
    if (!['written', 'already', 'restored'].includes(r.status)) missed.push(r.name);
  }
  saveSheetWrites(items, today);
  const ids = loadWalkedIds(today);
  for (const { d, key } of withKey) {
    const item = items[key];
    if (item && item.current) {
      const at = ids.indexOf(key);
      if (item.mine && at === -1) ids.unshift(key);
      if (!item.mine && at !== -1) ids.splice(at, 1);
      d.walkedDate = parseYmd(item.current.date);
    }
  }
  saveWalkedIds(ids, today);
  render(); renderDetail();
  if (missed.length) {
    sheetWriteFail = 'missed';
    const statuses = (out.results || []).map(r => r.status);
    showToast(statuses.includes('badAction') ? '請先更新 Google Apps Script，再使用修改溜狗人。' : statuses.includes('changed') ? `${missed.join('、')} 在試算表已經被改過，沒有蓋掉別人的，畫面已換成最新名單` : `試算表找不到 ${missed.join('、')}，請自己填`);
  } else if (on && toastText) {
    addToToast(toastText, toastUndo, '，已寫進試算表');
  }
  return !missed.length;
}

// 開放編輯（ADR 0004）：不用通關碼，送出時帶這支手機選好的名字，Worker 記進編輯紀錄（edits.html）
const NEED_EDITOR = '請先選好你的名字再編輯（開頭畫面點自己的名字）';
const editorName = () => loadWalkerName();
const editorHeaders = () => ({ 'X-Editor': encodeURIComponent(editorName()) });

let toastTimer = null;
let toastUndo = null;
let toastExtra = null;
// extra：{ label, fn } 提示條上多一顆按鈕（例：溜了之後「＋一起溜的人」）
// ── 加備註、新增異動紀錄（#239、#281）：只追加，寫進試算表前先預覽；日期用台灣時間、名字用「我是誰」 ──
// 狗卡在「試算表備註」下面，異動紀錄只在電腦版右欄（K 2026-10-16）
const APPEND_MAX = 200;
let sheetAppend = null; // { kind: 'note'|'log', dog, text, phase: 'edit'|'preview'|'busy', error }
function taipeiStamp(now = new Date()) {
  const [y, m, d] = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }).split('-').map(Number);
  return `${y}/${m}/${d}`;
}
function appendEntry(text, who) { return `${taipeiStamp()}${text.trim()}（${who}）`; }
function nextLogLabel() {
  const nums = (typeof sheetNotes !== 'undefined' ? sheetNotes : []).map(n => Number((String(n.label).match(/^備註\s*(\d+)/) || [])[1]) || 0);
  return `備註${Math.max(0, ...nums) + 1}`;
}
function appendPreview(a, who) {
  const entry = appendEntry(a.text, who);
  if (a.kind === 'log') return `<div class="append-preview"><span class="append-label">${esc(nextLogLabel())}</span>${esc(entry)}</div>`;
  const now = a.dog.note || '';
  return `<div class="append-preview note-text">${now.trim() ? `${esc(now)};` : ''}<mark>${esc(entry)}</mark></div>`;
}
function sheetAppendHtml(kind, dog = null) {
  if (!UPLOAD_URL || sheetWriteState === 'off' || (dog && dog.departure)) return '';
  const a = sheetAppend && sheetAppend.kind === kind && sheetAppend.dog === dog ? sheetAppend : null;
  const label = kind === 'note' ? '加備註' : '新增一筆';
  if (!a) return `<button type="button" class="my-note-edit append-open" data-append-open="${kind}">${icon('note')}${label}</button>`;
  const who = loadWalkerName();
  const busy = a.phase === 'busy';
  const err = a.error ? `<p class="append-error" role="alert">${esc(a.error)}</p>` : '';
  if (!who) return `<div class="my-note-form append-form"><p class="append-hint">要先在「我溜過」設定名字，才能寫進試算表。</p>
    <div class="my-note-actions"><button type="button" class="photo-cancel" data-append-cancel>取消</button></div></div>`;
  if (a.phase === 'edit') return `<form class="my-note-form append-form" data-append-form>
    <label class="my-note-pass-label" for="appendText">${kind === 'note' ? '要接在備註後面的內容' : '要加在異動紀錄最下面的內容'}</label>
    <input type="text" id="appendText" maxlength="${APPEND_MAX}" value="${esc(a.text)}" autocomplete="off">
    <p class="append-hint">日期和名字（${esc(who)}）會自動加上；已經寫在試算表的字不會被改。</p>${err}
    <div class="my-note-actions"><button type="submit" class="my-note-save"${a.text.trim() ? '' : ' disabled'}>預覽</button>
      <button type="button" class="photo-cancel" data-append-cancel>取消</button></div></form>`;
  return `<div class="my-note-form append-form">
    <p class="my-note-pass-label">${kind === 'note' ? '送出後這格會變成：' : '送出後會在最下面新增：'}</p>
    ${appendPreview(a, who)}${err}
    <div class="my-note-actions"><button type="button" class="my-note-save" data-append-send${busy ? ' disabled' : ''}>${busy ? '寫入中…' : '送出'}</button>
      ${busy ? '' : '<button type="button" class="photo-cancel" data-append-back>改一下</button>'}</div></div>`;
}
function rerenderAppend(kind, focusSel) {
  if (kind === 'note') renderDetail(); else render();
  const el = focusSel && document.querySelector(focusSel);
  if (el) el.focus({ preventScroll: true });
}
async function sendAppend() {
  const a = sheetAppend;
  const who = loadWalkerName();
  if (!a || a.phase !== 'preview' || !who) return;
  a.phase = 'busy'; a.error = '';
  rerenderAppend(a.kind);
  const payload = { action: a.kind, walker: who, editor: who, text: a.text.trim(), dogs: a.kind === 'note' ? [{ id: a.dog.id || '', name: a.dog.name }] : [] };
  let res = null, out = null;
  try {
    res = await fetch(`${UPLOAD_URL}/walk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    out = await res.json().catch(() => null);
  } catch (e) { res = null; }
  if (sheetAppend !== a) return;
  const r = out && out.ok && Array.isArray(out.results) ? out.results[0] : null;
  if (!r || r.status !== 'written') {
    a.phase = 'preview';
    a.error = !res ? '網路不通，沒寫進試算表，請稍後再試' : r && r.status === 'notFound' ? '試算表找不到這隻狗，沒寫進去' : `沒寫進試算表：${(out && out.error) || `HTTP ${res.status}`}`;
    rerenderAppend(a.kind);
    return;
  }
  sheetAppend = null;
  if (a.kind === 'note') a.dog.note = r.wrote.note;
  else if (typeof sheetNotes !== 'undefined') sheetNotes.push({ label: r.wrote.label, text: r.wrote.text });
  rerenderAppend(a.kind);
  showToast(a.kind === 'note' ? `已加進 ${a.dog.name} 的試算表備註` : '已加進異動紀錄');
}
document.addEventListener('click', e => {
  const t = e.target && e.target.closest ? e.target : null;
  if (!t) return;
  const open = t.closest('[data-append-open]');
  if (open) {
    const kind = open.dataset.appendOpen;
    sheetAppend = { kind, dog: kind === 'note' ? detailDog : null, text: '', phase: 'edit', error: '' };
    rerenderAppend(kind, '#appendText');
    return;
  }
  if (!sheetAppend) return;
  const kind = sheetAppend.kind;
  if (t.closest('[data-append-cancel]')) { sheetAppend = null; rerenderAppend(kind, `[data-append-open="${kind}"]`); return; }
  if (t.closest('[data-append-back]')) { sheetAppend.phase = 'edit'; sheetAppend.error = ''; rerenderAppend(kind, '#appendText'); return; }
  if (t.closest('[data-append-send]')) sendAppend();
});
document.addEventListener('input', e => {
  if (!sheetAppend || !e.target || e.target.id !== 'appendText') return;
  sheetAppend.text = e.target.value;
  const btn = e.target.form && e.target.form.querySelector('.my-note-save');
  if (btn) btn.disabled = !e.target.value.trim();
});
document.addEventListener('submit', e => {
  if (!sheetAppend || !e.target.matches || !e.target.matches('[data-append-form]')) return;
  e.preventDefault();
  if (!sheetAppend.text.trim()) return;
  sheetAppend.phase = 'preview'; sheetAppend.error = '';
  rerenderAppend(sheetAppend.kind, '[data-append-send]');
});

function showToast(text, undo, extra) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `<span class="toast-text"></span><button type="button" class="toast-extra" hidden></button><button type="button" class="toast-undo">復原</button>`;
    el.querySelector('.toast-extra').addEventListener('click', () => {
      const fn = toastExtra;
      hideToast();
      if (fn) fn();
    });
    // 介面評估第三輪：提示條會蓋住下面那張狗卡，點文字就收起
    el.querySelector('.toast-text').addEventListener('click', hideToast);
    el.querySelector('.toast-undo').addEventListener('click', () => {
      const fn = toastUndo;
      hideToast();
      if (fn) fn();
    });
    document.body.appendChild(el);
  }
  el.querySelector('.toast-text').textContent = text;
  toastUndo = undo || null;
  el.querySelector('.toast-undo').hidden = !undo;
  toastExtra = extra ? extra.fn : null;
  const ex = el.querySelector('.toast-extra');
  ex.hidden = !extra;
  ex.textContent = extra ? extra.label : '';
  el.hidden = false;
  document.body.classList.add('toast-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}

function hideToast() {
  clearTimeout(toastTimer);
  toastUndo = null;
  toastExtra = null;
  const el = document.getElementById('toast');
  if (el) el.hidden = true;
  document.body.classList.remove('toast-on');
}

// 狗卡右側的「已遛」（溜狗表）／「移回」（今天已溜）按鈕；連犬名都沒有的狗記不了，照舊顯示箭頭
// V9（#141）拿掉今天已溜：按過的狗留在原地，按鈕變成「已溜」，再按一次復原
function walkButton(dog) {
  if (!walkKey(dog)) return `<span class="more">${icon('chevron')}</span>`;
  if (restOf(dog)) return ''; // 休養中暫停帶出：不放溜了，免得順手按到
  if (walkPendingNow(dog)) return `<button type="button" class="walk-btn pending" disabled aria-label="${esc(dog.name)} 正在寫進試算表">登記中</button>`;
  return walkedNow(dog)
    ? `<button type="button" class="walk-btn done" data-walk="back" aria-label="${esc(dog.name)} 今天已溜，按一下取消">${icon('tick')}已溜</button>`
    : `<button type="button" class="walk-btn" data-walk="add" aria-label="${esc(dog.name)} 溜了">溜了</button>`;
}

// 所有分頁、搜尋、籠位共用這張卡片。第一層只放照片、犬名、天數、籠位｜編號，
// 備註命中警示關鍵字才把原文放上來；一般備註、可一起遛、狗卡資訊點卡片看詳細資訊
// eager：第一屏的卡片（#91），照片不等延後載入、優先下載
function dogCard(dog, today, eager = false) {
  const flag = specialFlag(dog.note);
  return `
    <div class="card${flag ? ' flagged' : ''}" data-dog="${allDogs.indexOf(dog)}" role="button" tabindex="0" aria-haspopup="dialog">
      ${photoThumb(dog, 56, false, eager)}
      <div class="body">
        <div class="row">
          <div class="who">
            <div class="name">${esc(dog.name)}${sexMark(dog)}</div>
            ${cardMeta(dog)}
          </div>
          ${lastWalk(dog, today)}
          ${walkButton(dog)}
        </div>
      </div>
      ${flag ? warnNote(dog.note, flag) : ''}
    </div>
  `;
}

// 詳細資訊：備註（志工後續補充，試算表備註欄）／可以一起溜的狗／狗卡資訊（dogs/{編號}.md 的入所原始介紹，同步時已寫進 dogs.json）
// 詳細資訊名字旁的「☆ 常溜」／「★ 我的常溜」
function favButtonHtml(dog) {
  if (!walkKey(dog) || dog.departure) return '';
  const on = isFav(dog);
  return `<button type="button" class="fav-btn${on ? ' on' : ''}" id="favToggle" aria-pressed="${on}">${on ? '★ 我的常溜' : '☆ 常溜'}</button>`;
}

function detailHtml(dog, today) {
  if (dog.departure) return departedDetailHtml(dog, today);
  const flag = specialFlag(dog.note);
  const intro = introOf(dog);
  const walked = walkedToday(today);
  // V7（#112）：上面大照片，下面狗名和天數／籠位／入所標籤；關閉、在哪、溜了在底部固定列（在哪裡卡片 V7 小修正拿掉，改用底部「在哪」）
  return `
    <div class="detail-head">
      ${photoHeroHtml(dog)}
      ${photoUploadHtml(dog)}
      <div class="info">
        <div class="name-row"><h2 class="name" id="detailName">${esc(dog.name)}${sexMark(dog)}</h2>${favButtonHtml(dog)}</div>
        <div class="chips">${statusBadge(dog, today)}${detailChips(dog)}</div>
        ${metaLine(dog)}
        ${restNoteHtml(dog, today)}
      </div>
    </div>
    ${lastWalkSection(dog, today)}
    ${detailTrail.length ? `<button type="button" class="detail-back" id="detailBack">${icon('back')}回到 ${esc(detailTrail[detailTrail.length - 1].name)}</button>` : ''}
    <section class="detail-section" data-section="note">
      <h3>${icon('note')}試算表備註</h3>
      ${!dog.note ? `<div class="empty">目前沒有備註</div>`
        : `<div class="content note-text">${flag ? highlightNote(dog.note, flag.terms) : esc(dog.note)}</div>`}
      ${sheetAppendHtml('note', dog)}
    </section>
    ${togetherSection(dog, walked)}
    ${walkHistorySection(dog, today)}
    ${introSectionHtml(dog, intro)}
    ${staysSectionHtml(dog)}
    ${restAdminHtml(dog, today)}
    ${photoBarHtml(dog) || introBarHtml(dog) || `<div class="detail-bar">
      <button type="button" class="bar-btn" id="detailClose">關閉</button>
      ${typeof whereKnown === 'function' && whereKnown(dog) ? `<button type="button" class="bar-btn" id="detailWhere">${icon('pin')}在哪</button>` : ''}
      ${groupWalkButton(dog, walked)}
    </div>`}
  `;
}

// ── 休養中（K 2026-10-09：剛動完手術不能溜，「排到下面、休養中、10/20 前暫停帶出」，不動試算表）──
// 名字下面一行說明；改設定在詳細資訊最下面，任何人都能改、記編輯紀錄
function restNoteHtml(dog, today) {
  const r = restOf(dog, today);
  return r ? `<div class="rest-note"><b>休養中</b>，${monthDay(r.until)} 前暫停帶出${r.reason ? `（${esc(r.reason)}）` : ''}</div>` : '';
}
// 日期 → YYYY-MM-DD（日期輸入框、送給 Worker 用）
function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function restAdminHtml(dog, today) {
  if (!dog.id || !UPLOAD_URL) return '';
  const r = restOf(dog, today);
  const e = restEdit && restEdit.dog === dog ? restEdit : null;
  if (!e) {
    // 管理用（K 2026-10-10）：只剩設定休養中；入所介紹直接點那一段就能改。正在改介紹時先收起來
    if (introEdit && introEdit.dog === dog) return '';
    return `<section class="detail-section rest-admin" data-section="rest">
      <h3>${icon('write')}休養設定<span class="sub">會記在編輯紀錄</span></h3>
      <div class="admin-btns">
        <button type="button" class="admin-btn" id="restEdit">${icon('paw')}${r ? '改休養設定' : '設定休養中'}</button>
      </div>
    </section>`;
  }
  const busy = e.phase === 'saving';
  return `<section class="detail-section rest-admin" data-section="rest">
    <form class="rest-form" id="restForm" autocomplete="on">
      <h3>休養中</h3>
      <p class="rest-hint">排到溜狗表最下面、不能按溜了；過了那天自動恢復。</p>
      <label>原因<input type="text" id="restReason" maxlength="40" value="${esc(e.reason)}" placeholder="例：術後休養"${busy ? ' disabled' : ''}></label>
      <label>到哪一天（含那天）<input type="date" id="restUntil" value="${esc(e.until)}" min="${isoDay(today)}" required${busy ? ' disabled' : ''}></label>
      ${e.error ? `<div class="photo-error" role="alert">${esc(e.error)}</div>` : ''}
      <div class="rest-actions">
        <button type="submit" class="rest-save"${busy ? ' disabled' : ''}>${busy ? '儲存中…' : '儲存'}</button>
        ${r && !busy ? `<button type="button" class="rest-end" id="restEnd">結束休養</button>` : ''}
        ${busy ? '' : `<button type="button" class="rest-cancel" id="restCancel">取消</button>`}
      </div>
    </form>
  </section>`;
}
// ── 入所介紹（K 2026-10-10 補資料）：任何人都能改、記編輯紀錄（ADR 0004）；存 D1，不寫試算表 ──
const INTRO_MAX = 1000;
function intakeEventsOf(dog) {
  return dog.intakeEvents || [];
}
function intakeDraft(dog) {
  return intakeEventsOf(dog).map(row => ({ ...row }));
}
function intakeListHtml(dog) {
  const events = intakeEventsOf(dog);
  if (!events.length) return '';
  return `<ul class="intake-list">${events.map(e => `<li>${e.date ? `<time datetime="${esc(e.date)}">${esc(e.date.replace(/-/g, '/'))}</time>` : '<span class="intake-date-empty">日期未確認</span>'}<span class="intake-event">${esc(e.event)}</span>${e.number ? `<span class="intake-number">（${esc(e.number)}）</span>` : ''}</li>`).join('')}</ul>`;
}
function intakeEditorHtml(dog, e, busy) {
  const numbers = [...new Set([...(dog.formerIds || []), dog.id, ...e.events.map(row => row.number)].filter(Boolean))].sort();
  return `<p class="rest-hint">一次入所、退回或轉所一列。日期依確認的資料填寫，不確定就留空，不以編號推定。原因可留空。</p>
    <div class="intake-rows">${e.events.map((row, i) => `<fieldset class="intake-row"><legend>第 ${i + 1} 筆</legend>
      <label>日期<input type="date" data-intake-row="${i}" data-intake-field="date" value="${esc(row.date)}"${busy ? ' disabled' : ''}></label>
      <label>原因<input type="text" maxlength="1000" data-intake-row="${i}" data-intake-field="event" value="${esc(row.event)}" placeholder="例：迷路入所、認養後退回"${busy ? ' disabled' : ''}></label>
      <label>對應編號<select data-intake-row="${i}" data-intake-field="number"${busy ? ' disabled' : ''}><option value="">尚未確認</option>${numbers.map(n => `<option value="${esc(n)}"${n === row.number ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <button type="button" class="intake-remove" data-intake-remove="${i}"${busy ? ' disabled' : ''}>移除第 ${i + 1} 筆</button>
    </fieldset>`).join('')}</div>
    <button type="button" id="intakeAdd"${busy || e.events.length >= 30 ? ' disabled' : ''}>新增一筆</button>`;
}
function introOf(dog) {
  return dog.id && Object.prototype.hasOwnProperty.call(introOverrides, dog.id) ? introOverrides[dog.id] : dog.intro;
}
function introSectionHtml(dog, intro) {
  const e = introEdit && introEdit.dog === dog ? introEdit : null;
  if (!e) {
    const can = !!(dog.id && UPLOAD_URL) && !dog.departure;
    return `<section class="detail-section" data-section="intro">
      <h3 class="intro-heading">${icon('card')}入所介紹${can ? `<button type="button" class="intro-heading-edit" id="introEdit" aria-label="${intro || intakeEventsOf(dog).length ? '改' : '補'}入所介紹">${icon('write')}</button>` : ''}</h3>
      ${intakeListHtml(dog)}
      ${intro ? `<div class="content">${esc(intro)}</div>` : (!intakeEventsOf(dog).length ? '<div class="empty">還沒有入所介紹</div>' : '')}
    </section>`;
  }
  const busy = e.phase === 'saving';
  const n = [...e.text].length;
  return `<section class="detail-section" data-section="intro">
    <form class="rest-form intro-form" id="introForm" autocomplete="on">
      <h3>${icon('card')}入所介紹</h3>
      ${intakeEditorHtml(dog, e, busy)}
      <p class="rest-hint">存好後這台馬上看到，其他人幾分鐘後（下次更新資料）看到。只存在網站，不寫試算表。</p>
      <label>補充介紹（保留原文）<textarea id="introText" rows="7" maxlength="${INTRO_MAX}" placeholder="例：親人、喜歡散步，怕機車聲"${busy ? ' disabled' : ''}>${esc(e.text)}</textarea><small class="intro-count${n > INTRO_MAX ? ' over' : ''}">${n} / ${INTRO_MAX} 字</small></label>
      ${e.error ? `<div class="photo-error" role="alert">${esc(e.error)}</div>` : ''}
    </form>
  </section>`;
}
// 介紹表單打開時的底部列：取消＋儲存介紹（送出 #introForm）；溜了先收起來，跟換照片同一個做法（#146）
function introBarHtml(dog) {
  const e = introEdit && introEdit.dog === dog ? introEdit : null;
  if (!e) return '';
  const busy = e.phase === 'saving';
  return `<div class="detail-bar photo-bar">${busy ? '' : '<button type="button" class="bar-btn" id="introCancel">取消</button>'}<button type="submit" form="introForm" class="bar-confirm"${busy ? ' disabled' : ''}>${busy ? '儲存中…' : '儲存介紹'}</button></div>`;
}
function openIntroEdit(dog) {
  if (!dog || !dog.id || !UPLOAD_URL) return;
  introEdit = { dog, text: introOf(dog) || '', events: intakeDraft(dog), phase: 'edit', error: '' };
  renderDetail();
  const box = document.querySelector('#introForm [data-intake-field="date"]') || document.getElementById('introText');
  if (box) {
    box.focus({ preventScroll: true });
    if (box.scrollIntoView) box.scrollIntoView({ block: 'center' });
  }
}
async function saveIntro() {
  const e = introEdit;
  if (!e || e.phase === 'saving') return;
  const editor = editorName();
  if (!editor) { e.phase = 'error'; e.error = NEED_EDITOR; renderDetail(); return; }
  const text = e.text.replace(/\r\n?/g, '\n').trim();
  if ([...text].length > INTRO_MAX) { e.phase = 'error'; e.error = `最多 ${INTRO_MAX} 字`; renderDetail(); return; }
  if (e.events.reduce((n, row) => n + [...row.event].length, 0) > INTRO_MAX) { e.phase = 'error'; e.error = '原因合計最多 1000 字'; renderDetail(); return; }
  e.phase = 'saving'; e.error = ''; renderDetail();
  let out = null, error = '';
  try {
    const res = await fetch(`${UPLOAD_URL}/intro/${encodeURIComponent(e.dog.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editor, text, events: e.events }),
    });
    out = await res.json().catch(() => null);
    if (!res.ok || !out || !out.ok) error = (out && out.error) || `沒有存進去（${res.status}），請稍後再試`;
    else if (!Array.isArray(out.intakeEvents) && (e.events.length || intakeEventsOf(e.dog).length)) error = '伺服器尚未確認逐次紀錄已儲存，請稍後再試';
  } catch (err) {
    error = '沒有存進去，請確認網路後再試';
  }
  if (introEdit !== e) return;
  if (error) {
    e.phase = 'error'; e.error = error; renderDetail();
    return;
  }
  introOverrides[e.dog.id] = typeof out.intro === 'string' ? out.intro : text;
  e.dog.intakeEvents = Array.isArray(out.intakeEvents) ? out.intakeEvents : e.events;
  introEdit = null;
  render(); renderDetail();
  const b = document.getElementById('introEdit');
  if (b) b.focus({ preventScroll: true });
  showToast(`${e.dog.name} 的介紹已存好（其他人重新整理就看得到）`);
}

// 出入所紀錄（#333，ADR 0011）：照時間列出每一次在所；誰都能補、改、刪（要先選名字），離所的狗也可以改（ADR 0011）。
// 整隻狗一次存（Worker 的 /stays），連同打開時看到的內容一起送，別人剛改過會被擋下來
const STAYS_MAX = 30;
const stayDate = ymd => String(ymd || '').replace(/-/g, '/');
function staysSectionHtml(dog) {
  const list = dog.stays || [];
  const can = !!(dog.id && UPLOAD_URL);
  const e = staysEdit && staysEdit.dog === dog ? staysEdit : null;
  if (!e) {
    if (!list.length && !can) return '';
    return `<section class="detail-section" data-section="stays">
      <h3 class="intro-heading">${icon('note')}出入所紀錄${can ? `<button type="button" class="intro-heading-edit" id="staysEdit" aria-label="${list.length ? '改' : '補'}出入所紀錄">${icon('write')}</button>` : ''}</h3>
      ${list.length ? `<ul class="intake-list stays-list">${list.map(r => `<li><time datetime="${esc(r.in)}">${esc(stayDate(r.in))}</time><span class="intake-event">入所${r.out ? `，${esc(stayDate(r.out))} 出所` : ''}</span>${r.reason ? `<span class="intake-number">（${esc(r.reason)}）</span>` : ''}</li>`).join('')}</ul>`
        : '<div class="empty">還沒有補登。轉所、退養前的入所日查得到的話，可以補在這裡</div>'}
    </section>`;
  }
  const busy = e.phase === 'saving';
  const today = isoDay(new Date());
  return `<section class="detail-section" data-section="stays">
    <form class="rest-form stays-form" id="staysForm" autocomplete="off">
      <h3>${icon('note')}出入所紀錄</h3>
      <p class="rest-hint">每次在所一筆，還在所就不填出所日。入所日從現在的編號、舊編號和這裡最早的那天算。</p>
      <div class="intake-rows">${e.rows.map((row, i) => `<fieldset class="intake-row"><legend>第 ${i + 1} 筆</legend>
        <label>入所日<input type="date" max="${today}" data-stay-row="${i}" data-stay-field="in" value="${esc(row.in)}"${busy ? ' disabled' : ''}></label>
        <label>出所日<input type="date" max="${today}" data-stay-row="${i}" data-stay-field="out" value="${esc(row.out)}"${busy ? ' disabled' : ''}></label>
        <label>原因<input type="text" maxlength="40" data-stay-row="${i}" data-stay-field="reason" value="${esc(row.reason)}" placeholder="例：迷路、退養、整修移所"${busy ? ' disabled' : ''}></label>
        <button type="button" class="intake-remove" data-stay-remove="${i}"${busy ? ' disabled' : ''}>刪掉第 ${i + 1} 筆</button>
      </fieldset>`).join('')}</div>
      <button type="button" id="staysAdd"${busy || e.rows.length >= STAYS_MAX ? ' disabled' : ''}>新增一筆</button>
      ${e.error ? `<div class="photo-error" role="alert">${esc(e.error)}</div>` : ''}
      <div class="stays-actions">${busy ? '' : '<button type="button" class="former-cancel" id="staysCancel">取消</button>'}<button type="submit" class="former-save"${busy ? ' disabled' : ''}>${busy ? '儲存中…' : '儲存'}</button></div>
    </form>
  </section>`;
}
function openStaysEdit(dog) {
  if (!dog || !dog.id || !UPLOAD_URL) return;
  const before = (dog.stays || []).map(r => ({ ...r }));
  staysEdit = { dog, before, rows: before.length ? before.map(r => ({ ...r })) : [{ in: '', out: '', reason: '' }], phase: 'edit', error: '' };
  renderDetail();
  const box = document.querySelector('#staysForm [data-stay-field="in"]');
  if (box) {
    box.focus({ preventScroll: true });
    if (box.scrollIntoView) box.scrollIntoView({ block: 'center' });
  }
}
// 先在這台檢查一次（伺服器也會檢查）；回空字串是沒問題
function staysProblem(rows) {
  const today = isoDay(new Date());
  for (const r of rows) {
    if (!parseYmd(r.in)) return '每一筆都要填入所日';
    if (r.in > today || (r.out && r.out > today)) return '日期不能是未來的日子';
    if (r.out && r.out < r.in) return '出所日不能早於入所日';
  }
  return '';
}
async function saveStays() {
  const e = staysEdit;
  if (!e || e.phase === 'saving') return;
  const editor = editorName();
  if (!editor) { e.phase = 'error'; e.error = NEED_EDITOR; renderDetail(); return; }
  // 整列都空白的當成沒填
  const rows = e.rows.map(r => ({ in: r.in.trim(), out: r.out.trim(), reason: r.reason.trim() })).filter(r => r.in || r.out || r.reason);
  const problem = staysProblem(rows);
  if (problem) { e.phase = 'error'; e.error = problem; renderDetail(); return; }
  e.phase = 'saving'; e.error = ''; renderDetail();
  let out = null, error = '';
  try {
    const res = await fetch(`${UPLOAD_URL}/stays/${encodeURIComponent(e.dog.id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ editor, before: e.before, stays: rows }),
    });
    out = await res.json().catch(() => null);
    if (res.status === 409) error = '別人剛改過，請重新整理再改';
    else if (!res.ok || !out || !out.ok) error = (out && out.error) || `沒有存進去（${res.status}），請稍後再試`;
  } catch (err) {
    error = '沒有存進去，請確認網路後再試';
  }
  if (staysEdit !== e) return;
  if (error) { e.phase = 'error'; e.error = error; renderDetail(); return; }
  e.dog.stays = Array.isArray(out.stays) ? out.stays : rows;
  staysEdit = null;
  render(); renderDetail();
  const b = document.getElementById('staysEdit');
  if (b) b.focus({ preventScroll: true });
  const first = firstIntake(e.dog);
  showToast(`${e.dog.name} 的出入所紀錄已存好${first ? `，入所日從 ${ymdOf(first)} 算` : ''}`);
}

function openRestEdit(dog) {
  const r = restOf(dog);
  const until = r ? r.until : new Date(Date.now() + 10 * 86400000);
  restEdit = { dog, until: isoDay(until), reason: r ? r.reason : '術後休養', phase: 'edit', error: '' };
  renderDetail();
  const first = document.getElementById('restReason');
  if (first) {
    first.focus({ preventScroll: true });
    const form = document.getElementById('restForm');
    if (form.scrollIntoView) form.scrollIntoView({ block: 'center' });
  }
}
// 送到 Worker：end＝結束休養。成功後這支手機馬上生效，其他志工重新整理就看得到（#250 存 D1）
async function saveRest(end = false) {
  const e = restEdit;
  if (!e || e.phase === 'saving') return;
  const editor = editorName();
  if (!editor) { e.phase = 'error'; e.error = NEED_EDITOR; renderDetail(); return; }
  if (!end && !parseYmd(e.until)) { e.phase = 'error'; e.error = '請選到哪一天'; renderDetail(); return; }
  e.phase = 'saving'; e.error = ''; renderDetail();
  let out = null, error = '';
  try {
    const res = await fetch(`${UPLOAD_URL}/rest/${encodeURIComponent(e.dog.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(end ? { editor, end: true } : { editor, until: e.until, reason: e.reason.trim() }),
    });
    out = await res.json().catch(() => null);
    if (!res.ok || !out || !out.ok) error = (out && out.error) || `沒有存進去（${res.status}），請稍後再試`;
  } catch (err) {
    error = '沒有存進去，請確認網路後再試';
  }
  if (restEdit !== e) return;
  if (error) {
    e.phase = 'error'; e.error = error; renderDetail();
    return;
  }
  // 換成新的物件：讀取中的 loadRest 才知道這裡改過（見 loadRest）
  const next = { ...restMap };
  if (out.rest) next[e.dog.id] = out.rest; else delete next[e.dog.id];
  restMap = next;
  restEdit = null;
  resetWalkOrder();
  render(); renderDetail();
  showToast(out.rest ? `${e.dog.name} 休養到 ${monthDay(parseYmd(out.rest.until))}，排到溜狗表最下面` : `${e.dog.name} 結束休養`);
}
// 開網頁時讀休養設定；讀不到就當作沒有，不影響其他功能
async function loadRest() {
  const before = restMap;
  let next = {};
  try {
    const res = await fetch(REST_URL, { cache: 'no-cache' });
    const data = res.ok ? await res.json() : {};
    if (data && data.rest && typeof data.rest === 'object' && !Array.isArray(data.rest)) next = data.rest;
  } catch (e) { /* 讀不到就當作沒有 */ }
  // 讀的期間這支手機剛改過休養設定（restMap 換了）：讀到的可能是改之前的，不要蓋掉
  if (restMap !== before) return;
  restMap = next;
  resetWalkOrder();
  render();
  if (detailDog) renderDetail();
}

// 離所的狗（#164）：同一個詳細資訊，頂部標離所原因和日期取代天數，多一區離所紀錄；
// 沒有溜了、在哪、☆、換照片，也不放同籠和可以一起溜（那是在所時的事）
function departedDetailHtml(dog, today) {
  const dep = dog.departure;
  const flag = specialFlag(dog.note);
  const back = dep.returned && allDogs.find(d => d.id === dep.returned);
  return `
    <div class="detail-head">
      ${photoHeroHtml(dog)}
      <div class="info">
        <div class="name-row"><h2 class="name" id="detailName">${esc(dog.name)}${sexMark(dog)}</h2></div>
        <div class="chips">${departureBadge(dep)}${since(dog)}</div>
        ${metaLine(dog)}
      </div>
    </div>
    ${detailTrail.length ? `<button type="button" class="detail-back" id="detailBack">${icon('back')}回到 ${esc(detailTrail[detailTrail.length - 1].name)}</button>` : ''}
    <section class="detail-section departed" data-section="departure">
      <h3>${icon('note')}離所紀錄</h3>
      <div class="lw-row"><span class="lw-k">原因</span><span class="lw-v">${esc(DEPARTURE_LABELS[dep.reason])}</span></div>
      <div class="lw-row"><span class="lw-k">日期</span><span class="lw-v">${esc(ymdText(dep.date))}${dep.dateSource === 'seen' ? '<small>（從試算表消失的那天）</small>' : ''}</span></div>
      <div class="lw-row"><span class="lw-k">依據</span><span class="lw-v">${esc(departureBasis(dep))}</span></div>
      <div class="lw-row"><span class="lw-k">最後籠位</span><span class="lw-v">${esc(dog.cage || '—')}</span></div>
      ${back ? `<button type="button" class="detail-back" data-departed-back="${allDogs.indexOf(back)}">${icon('paw')}已再入所，看現在的 ${esc(back.name)}</button>` : ''}
    </section>
    <section class="detail-section last-walk" data-section="last">
      <div class="lw-row"><span class="lw-k">上次溜</span><span class="lw-v">${esc(dog.walkedDate ? ymdText(dog.walkedDate) : '沒有紀錄')}</span></div>
    </section>
    <section class="detail-section" data-section="note">
      <h3>${icon('note')}試算表備註<span class="sub">離所前最後一次</span></h3>
      ${!dog.note ? `<div class="empty">沒有備註</div>`
        : flag ? warnNote(dog.note, flag)
        : `<div class="content note-text">${esc(dog.note)}</div>`}
    </section>
    ${walkHistorySection(dog, today)}
    <section class="detail-section" data-section="intro">
      <h3>${icon('card')}入所介紹<span class="sub">收容所在入所時寫的</span></h3>
      ${dog.intro ? `<div class="content">${esc(dog.intro)}</div>` : `<div class="empty">沒有入所介紹</div>`}
    </section>
    ${staysSectionHtml(dog)}
    <div class="detail-bar"><button type="button" class="bar-btn" id="detailClose">關閉</button></div>
  `;
  function since(d) {
    const s = firstIntake(d);
    return s ? `<span class="badge plain">入所 ${s.getFullYear()}/${s.getMonth() + 1}</span>` : '';
  }
}

const DEPARTURE_LABELS = { adopt: '認養', death: '死亡', other: '其他', unknown: '待確認' };
function ymdText(d) {
  return d ? `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}` : '日期不明';
}
function departureBadge(dep) {
  const label = dep.reason === 'unknown' ? '待確認' : `已${DEPARTURE_LABELS[dep.reason] === '其他' ? '離所' : DEPARTURE_LABELS[dep.reason]}`;
  return `<span class="badge dep-${dep.reason}">${esc(label)}${dep.date ? ` · ${dep.date.getMonth() + 1}/${dep.date.getDate()}` : ''}</span>`;
}
// 判讀依據：只寫命中的關鍵字，不放已出所分頁的原文（K 2026-10-08）
function departureBasis(dep) {
  if (dep.reason !== 'unknown') return `已出所分頁寫了「${dep.matched}」`;
  if (dep.flags.includes('not-in-sheet')) return '已出所分頁找不到這隻狗';
  if (dep.flags.includes('conflict')) return `已出所分頁同時寫了「${dep.matched}」，看不出是哪一個`;
  if (dep.flags.includes('duplicate')) return '已出所分頁有好幾列，寫的不一樣';
  if (dep.flags.includes('unsure')) return `已出所分頁寫了「${dep.matched}」，還沒定案`;
  return '已出所分頁沒寫原因';
}

// V9（#141 第 9 項）：上次溜的日期和溜狗人，放在照片和名字下面第一個
function lastWalkSection(dog, today) {
  const s = computeStatus(dog, today);
  const d = s.mine ? today : effectiveWalkDate(dog, today);
  const date = d ? `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${'日一二三四五六'[d.getDay()]}）` : (s.kind === 'covered' ? '有人固定照顧' : '沒有紀錄');
  const who = walkerList(dog, today);
  return `<section class="detail-section last-walk" data-section="last">
    <div class="lw-row"><span class="lw-k">上次溜</span><span class="lw-v">${esc(date)}</span></div>
    <div class="lw-row"><span class="lw-k">溜狗人</span><span class="lw-v">${walkerChipsHtml(dog, who, today)}</span></div>
  </section>`;
}

// ── 溜狗人旁的＋／×（#141，K 2026-10-04 確認）──
// 這隻狗試算表上是今天溜的，就能在名字旁直接加人（＋）、拿掉人（×），按了直接寫進試算表，提示條可以復原。
// 寫的是整格新名單（Worker／Apps Script 的 edit），帶著目前那格的原文比對，別人先改過就不蓋掉。
// 只剩一個人不給 ×（那格至少留一人，整筆取消用提示條的復原）；列表模式不放
let walkerEditBusy = ''; // 正在寫的狗的 key，寫完前＋／×都不能按
function walkerEditBase(dog, today = new Date()) {
  if (!UPLOAD_URL || sheetWriteState === 'off' || dog.departure) return null;
  const key = walkKey(dog);
  if (!key) return null;
  const date = localDateKey(today);
  const item = loadSheetWrites(today)[key];
  if (item && item.current) return item.current.date === date && item.current.walker ? item.current.walker : null;
  if (walkedNow(dog, today)) return null; // 這支手機按了溜了，試算表還沒回來
  return dog.walkedDate && localDateKey(dog.walkedDate) === date && walkerNames[key] ? walkerNames[key] : null;
}
// 只剩自己一個人、而且是這支手機今天登記的（按錯了），那個 × 是取消這次登記：日期和名字改回登記前（K 2026-10-05）
function walkerUndoable(dog, who, today = new Date()) {
  const item = loadSheetWrites(today)[walkKey(dog)];
  return who.length === 1 && who[0] === canonicalWalker(loadWalkerName()) && walkedNow(dog, today)
    && !!(item && item.mine && item.prev && item.wrote && item.current && item.current.walker === item.wrote.walker);
}
function walkerChipsHtml(dog, who, today) {
  if (!who.length) return isOffline() ? '<span class="lw-none">讀不到（沒網路）</span>' : '<span class="lw-none">—</span>';
  if (!walkerEditBase(dog, today)) return who.map(n => `<span class="who-chip">${esc(n)}</span>`).join('');
  const busy = walkerEditBusy === walkKey(dog);
  const dis = busy ? ' disabled' : '';
  const undoable = walkerUndoable(dog, who, today);
  const x = n => who.length > 1 ? `<button type="button" class="who-x" data-who-remove="${esc(n)}" aria-label="拿掉 ${esc(n)}"${dis}>×</button>`
    : undoable ? `<button type="button" class="who-x" data-who-undo aria-label="取消這次登記（${esc(n)}）"${dis}>×</button>` : '';
  return who.map(n => `<span class="who-chip${x(n) ? ' editable' : ''}">${esc(n)}${x(n)}</span>`).join('')
    + `<button type="button" class="who-plus" id="whoAdd" aria-label="加入溜狗人"${dis}>${busy ? '…' : '＋'}</button>`;
}
async function editWalkers(dog, names, text) {
  const expected = walkerEditBase(dog);
  const key = walkKey(dog);
  if (!expected || walkerEditBusy) return;
  walkerEditBusy = key;
  renderDetail();
  const ok = await queueSheetWrite([dog], true, null, null, [...new Set(names)].join('、'), expected);
  walkerEditBusy = '';
  renderDetail();
  if (!ok) return; // 失敗、別人改過的提示 sheetWrite 已經跳了
  const undo = () => queueSheetWrite([dog], false);
  showToast(`${text}，已寫進試算表`, undo);
}

// 詳細資訊狗名下面的標籤：籠位、入所年月（天數標籤是 statusBadge）
function detailChips(dog) {
  const since = firstIntake(dog);
  const home = dog.homeCage ? `<small>暫住，原本 ${esc(dog.homeCage)}</small>` : '';
  // K 2026-10-09：詳細資訊的籠位也要能點開平面圖（找得到位置的籠位才做成按鈕）
  const where = typeof whereKnown === 'function' && whereKnown(dog);
  return (dog.cage ? (where
    ? `<button type="button" class="badge plain cage-badge" data-where aria-label="${esc(dog.name)} 在哪：${esc(dog.cage)}">${icon('pin')}${esc(dog.cage)}${home}</button>`
    : `<span class="badge plain">${icon('pin')}${esc(dog.cage)}${home}</span>`) : '')
    + (since ? `<span class="badge plain">入所 ${since.getFullYear()}/${since.getMonth() + 1}</span>` : '');
}

// 已經顯示過的照片畫成這支手機上的本機圖片（網站要幾分鐘才更新，換好後先用這個顯示）；讀不到回 null
async function imageToLocal(src) {
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
    return blob ? URL.createObjectURL(blob) : null;
  } catch (e) {
    return null;
  }
}

// 可以一起溜的每一隻：輕點照片換看那隻；右上角圓圈勾選，之後用下方按鈕一起記（#35，K 選 C）。
// 今天已溜的不顯示圓圈，改標「今天已溜」
function buddyTile(d, name, walkedNow, mate) {
  const walked = walkedNow.has(d);
  const canPick = walkKey(d) && !walked && allDogs.includes(d);
  const picked = canPick && pickedBuddies.has(walkKey(d));
  return `<div class="buddy-tile">
    <button class="buddy" data-dog="${allDogs.indexOf(d)}"${allDogs.includes(d) ? '' : ' disabled'}>${photoThumb(d, 64)}<span class="bname">${esc(name)}</span></button>
    ${mate ? `<span class="mate-tag">同籠</span>` : ''}
    ${walked ? `<span class="walked-tag">今天已溜</span>` : ''}
    ${canPick ? `<button type="button" class="pick${picked ? ' on' : ''}" data-pick="${esc(walkKey(d))}" aria-pressed="${picked}" aria-label="勾選 ${esc(name)} 一起記">${icon('tick')}</button>` : ''}
  </div>`;
}

// 同籠的狗（K 2026-09-27）：籠位欄位一樣的其他狗，跟「可以一起溜」同一種格子，也能勾選一起記。
// 「○○區」（住院區、C區）是整區不是一籠，不算同籠；母幼區（母幼A…）也是各自一籠（K 2026-10-16）；沒有同籠的狗整段不顯示
function cageMates(dog) {
  const cage = String(dog.cage || '').replace(/\s+/g, '');
  if (!cage || /區$/.test(cage) || /^母幼/.test(cage)) return [];
  return allDogs.filter(d => d !== dog && String(d.cage || '').replace(/\s+/g, '') === cage);
}

// 同籠＋可以一起溜合成一段（K 2026-10-10 減法：兩段常常是同一批狗）：同籠的排前面、標「同籠」，
// 登記可以一起溜又不同籠的接在後面；同一隻只出現一次
function togetherSection(dog, walked) {
  const byName = new Map(allDogs.map(d => [d.name, d]));
  const mates = cageMates(dog);
  const buddies = [...(groupMap[dog.name] || [])].map(n => byName.get(n) || { name: n, id: '' });
  const list = [...mates, ...buddies.filter(d => !mates.includes(d))];
  return `
    <section class="detail-section" data-section="group">
      <h3>${icon('group')}同籠、可以一起溜的狗</h3>
      ${list.length
        ? `<div class="buddies">${list.map(d => buddyTile(d, d.name, walked, mates.includes(d))).join('')}</div>`
        : `<div class="empty">沒有同籠，也沒有登記可以一起溜的狗</div>`}
      <a class="group-page-link" href="groups.html">看全部狗群、編輯</a>
    </section>`;
}

// 「可以一起溜」下方的按鈕：把目前這隻連同勾選的狗一次記進今天已溜。
// 目前這隻已溜又沒勾選時，就顯示目前這隻今天已溜，不放按鈕
function groupWalkButton(dog, walked) {
  if (walkPendingNow(dog)) return `<button type="button" class="group-walk" id="groupWalk" disabled>登記中</button>`;
  const rest = restOf(dog);
  const self = !!walkKey(dog) && !walked.has(dog) && !rest;
  const n = [...pickedBuddies].length;
  if (!self && !n) {
    if (rest) return `<div class="self-walked rest">休養中，暫停帶出</div>`;
    return walked.has(dog) ? `<div class="self-walked">${icon('tick')}今天已溜</div>` : '';
  }
  // 底部列空間小（#112）：只有自己寫「溜了」，有勾選才寫幾隻
  const label = !n ? '溜了'
    : self ? `和勾選的 ${n} 隻都溜了`
    : `勾選的 ${n} 隻都溜了`;
  return `<button type="button" class="group-walk" id="groupWalk">${icon('tick')}${label}</button>`;
}

// ── 上傳／更換照片（#48）：選照片 → 預覽 → 確認上傳 → 畫面立刻換新照片 ──

// 詳細資訊照片右下角的相機圖示（K 2026-09-25 問業界做法，比照大頭貼）：點照片看大圖、點相機換照片。
// 沒有編號（照片檔名要用編號）或上傳服務還沒設定就不顯示
function photoPickButton(dog) {
  if (dog.departure) return ''; // 離所的狗（#164）不能換照片
  if (!UPLOAD_URL || !dog.id) return '';
  return `<button type="button" class="photo-pick" id="photoPick" aria-label="上傳 ${esc(dog.name)} 的照片" title="上傳照片">${icon('camera')}</button>`;
}

// 詳細資訊最上面的大照片。選好新照片還沒上傳時，直接在這個位置換成新照片預覽（2026-10-04 K：要像社群網站，出現在按的地方），
// 裁切方式跟上傳後一模一樣（同一個 .thumb 框）；下面再放一張狗卡上的小照片，兩個地方的樣子都看得到
function photoPending(dog) {
  return UPLOAD_URL && dog.id && photoUpload && photoUpload.dog === dog ? photoUpload : null;
}
function photoHeroHtml(dog) {
  const up = photoPending(dog);
  if (!up) return `<div class="photo-wrap hero">${photoThumb(dog, 480, true, true, true)}${photoPickButton(dog)}</div>`;
  return `
    <div class="photo-wrap hero pending">
      <div class="thumb"><img class="photo-preview" src="${esc(up.url)}" alt="${esc(dog.name)} 的新照片預覽"></div>
      <span class="hero-tag">預覽</span>
    </div>`;
}

// 選好照片後，大照片下面的「裁切」「確認上傳」「取消」
function photoUploadHtml(dog) {
  const up = photoPending(dog);
  if (!up) return '';
  const busy = up.phase === 'uploading';
  return `
    <div class="photo-upload preview">
      <div class="photo-preview-row">
        <div class="thumb card-thumb"><img src="${esc(up.url)}" alt=""></div>
        <div class="photo-preview-hint">上面是詳細資訊、左邊是狗卡上的樣子，按下面「確認上傳」才會換（${esc(dog.name)}，編號 ${esc(dog.id)}）</div>
      </div>
      ${up.phase === 'error' ? `<div class="photo-error" role="alert">${icon('alert')}<span>${esc(up.error)}</span></div>` : ''}
      ${busy ? '' : `<button type="button" class="photo-crop" id="photoCrop">${icon('crop')}裁切</button>`}
    </div>`;
}

// #146：選了照片還沒上傳時，底部那列換成「取消／確認上傳（綠色）」，溜了先收起來，
// 照片的確認跟溜了不會再是兩顆一樣的藍色大按鈕（K 2026-10-04 選方案一）。上傳中只剩確認那顆（顯示進度）
function photoBarHtml(dog) {
  const up = photoPending(dog);
  if (!up) return '';
  const busy = up.phase === 'uploading';
  const cancel = `<button type="button" class="bar-btn" id="photoCancel">取消換照片</button>`;
  const confirm = `<button type="button" class="bar-confirm" id="photoConfirm"${busy ? ' disabled' : ''}>${busy ? '上傳中…' : '確認上傳'}</button>`;
  return `<div class="detail-bar photo-bar">${busy ? '' : cancel}${confirm}</div>`;
}

// ── 裁切：照片放在固定的框後面，拖曳移動、兩指（或滑桿、滑鼠滾輪）放大，框裡的部分就是裁好的照片 ──
// 主照片預設正方形（清單上的小照片是正方形）；也可以換直式、橫式
const CROP_ASPECTS = [
  { id: 'square', label: '正方形', ratio: 1 },
  { id: 'portrait', label: '直式 3:4', ratio: 3 / 4 },
  { id: 'landscape', label: '橫式 4:3', ratio: 4 / 3 },
  { id: 'original', label: '原比例', ratio: 0 },
];
let cropView = null; // { img, aspect, scale, minScale, tx, ty, frame: { x, y, w, h }, resolve, pointers: Map }

function cropOpen() {
  const el = document.getElementById('cropper');
  return !!el && !el.hidden;
}

// 開裁切畫面；完成回傳裁好的 JPEG（長邊最多 PHOTO_MAX_EDGE），取消回傳 null
async function openCropper(src, aspect = 'square') {
  const img = new Image();
  img.src = src;
  try { await img.decode(); } catch (e) { showToast('這張照片讀不到，沒辦法裁切'); return null; }
  let el = document.getElementById('cropper');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cropper';
    el.className = 'cropper';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', '裁切照片');
    el.innerHTML = `
      <div class="crop-stage"><img alt="要裁切的照片" draggable="false"><div class="crop-frame"></div></div>
      <div class="crop-panel">
        <div class="crop-aspects">${CROP_ASPECTS.map(a => `<button type="button" data-aspect="${a.id}">${a.label}</button>`).join('')}</div>
        <label class="crop-zoom">${icon('search')}<input type="range" id="cropZoom" min="1" max="4" step="0.01" value="1" aria-label="放大"></label>
        <div class="crop-actions">
          <button type="button" class="crop-cancel" id="cropCancel">取消</button>
          <button type="button" class="crop-done" id="cropDone">完成</button>
        </div>
      </div>`;
    const stage = el.querySelector('.crop-stage');
    stage.addEventListener('pointerdown', e => {
      if (!cropView) return;
      stage.setPointerCapture(e.pointerId);
      cropView.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    stage.addEventListener('pointermove', e => {
      const v = cropView;
      if (!v || !v.pointers.has(e.pointerId)) return;
      const prev = v.pointers.get(e.pointerId);
      const pts = [...v.pointers.values()];
      if (pts.length === 1) {
        v.tx += e.clientX - prev.x;
        v.ty += e.clientY - prev.y;
      } else if (pts.length === 2) {
        const other = pts.find(p => p !== prev);
        const before = Math.hypot(prev.x - other.x, prev.y - other.y);
        const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        const box = stage.getBoundingClientRect();
        if (before > 0) zoomCropAt(v.scale * after / before, (e.clientX + other.x) / 2 - box.left, (e.clientY + other.y) / 2 - box.top);
      }
      v.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      drawCrop();
    });
    const up = e => { if (cropView) cropView.pointers.delete(e.pointerId); };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', e => {
      if (!cropView) return;
      e.preventDefault();
      const box = stage.getBoundingClientRect();
      zoomCropAt(cropView.scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - box.left, e.clientY - box.top);
      drawCrop();
    }, { passive: false });
    el.querySelector('#cropZoom').addEventListener('input', e => {
      const v = cropView;
      if (!v) return;
      zoomCropAt(v.minScale * Number(e.target.value), v.frame.x + v.frame.w / 2, v.frame.y + v.frame.h / 2);
      drawCrop();
    });
    el.querySelectorAll('[data-aspect]').forEach(b => b.addEventListener('click', () => { setCropAspect(b.dataset.aspect); }));
    el.querySelector('#cropCancel').addEventListener('click', () => closeCropper(null));
    el.querySelector('#cropDone').addEventListener('click', finishCrop);
    window.addEventListener('resize', () => { if (cropOpen()) setCropAspect(cropView.aspect); });
    document.body.appendChild(el);
  }
  if (cropView) cropView.resolve(null);
  el.querySelector('img').src = src;
  el.hidden = false;
  document.documentElement.classList.add('lightbox-open');
  history.pushState({ bqCrop: true }, '');
  return new Promise(resolve => {
    cropView = { img, aspect, scale: 1, minScale: 1, tx: 0, ty: 0, frame: null, resolve, pointers: new Map(), opener: document.activeElement };
    setCropAspect(aspect);
    el.querySelector('#cropDone').focus({ preventScroll: true });
  });
}

// 換比例：框重新置中，照片縮到剛好蓋滿框
function setCropAspect(aspect) {
  const v = cropView;
  const el = document.getElementById('cropper');
  if (!v || !el) return;
  const a = CROP_ASPECTS.find(x => x.id === aspect) || CROP_ASPECTS[0];
  v.aspect = a.id;
  const ratio = a.ratio || v.img.naturalWidth / v.img.naturalHeight;
  const stage = el.querySelector('.crop-stage');
  const W = stage.clientWidth || 360, H = stage.clientHeight || 360;
  let w = W * 0.88, h = w / ratio;
  if (h > H * 0.88) { h = H * 0.88; w = h * ratio; }
  v.frame = { x: (W - w) / 2, y: (H - h) / 2, w, h };
  v.minScale = Math.max(w / v.img.naturalWidth, h / v.img.naturalHeight);
  v.scale = v.minScale;
  v.tx = v.frame.x + (w - v.img.naturalWidth * v.scale) / 2;
  v.ty = v.frame.y + (h - v.img.naturalHeight * v.scale) / 2;
  el.querySelectorAll('[data-aspect]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.aspect === a.id)));
  drawCrop();
}

// 以畫面上的 (cx, cy) 為中心放大縮小；最小剛好蓋滿框，最大 4 倍
function zoomCropAt(scale, cx, cy) {
  const v = cropView;
  const next = Math.min(v.minScale * 4, Math.max(v.minScale, scale));
  v.tx = cx - (cx - v.tx) * next / v.scale;
  v.ty = cy - (cy - v.ty) * next / v.scale;
  v.scale = next;
}

// 照片不能拖到露出框外的空白
function drawCrop() {
  const v = cropView;
  const el = document.getElementById('cropper');
  if (!v || !el) return;
  const { frame: f } = v;
  const w = v.img.naturalWidth * v.scale, h = v.img.naturalHeight * v.scale;
  v.tx = Math.min(f.x, Math.max(f.x + f.w - w, v.tx));
  v.ty = Math.min(f.y, Math.max(f.y + f.h - h, v.ty));
  const img = el.querySelector('.crop-stage img');
  img.style.width = `${w}px`;
  img.style.height = `${h}px`;
  img.style.transform = `translate(${v.tx}px, ${v.ty}px)`;
  Object.assign(el.querySelector('.crop-frame').style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` });
  el.querySelector('#cropZoom').value = String(v.scale / v.minScale);
}

// 框裡的範圍畫成 JPEG；太大就再降一點畫質
async function cropToBlob(v) {
  const { frame: f } = v;
  const sx = (f.x - v.tx) / v.scale, sy = (f.y - v.ty) / v.scale, sw = f.w / v.scale, sh = f.h / v.scale;
  const k = Math.min(1, PHOTO_MAX_EDGE / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * k));
  canvas.height = Math.max(1, Math.round(sh * k));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(v.img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.85, 0.7, 0.55]) {
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    if (blob && blob.size <= PHOTO_MAX_BYTES) return blob;
  }
  return null;
}

async function finishCrop() {
  const v = cropView;
  if (!v) return;
  const blob = await cropToBlob(v);
  if (!blob) { showToast('裁好的照片太大，請再放大一點'); return; }
  closeCropper(blob);
}

function hideCropper() {
  const el = document.getElementById('cropper');
  if (!el || el.hidden) return;
  el.hidden = true;
  el.querySelector('.crop-stage img').removeAttribute('src');
  if (!lightboxOpen()) document.documentElement.classList.remove('lightbox-open');
  const v = cropView;
  cropView = null;
  if (v) {
    v.resolve(v.result || null);
    if (v.opener && v.opener.isConnected && v.opener !== document.body) v.opener.focus({ preventScroll: true });
  }
}

// 關掉走「上一頁」，手機返回鍵也等於取消
function closeCropper(result) {
  if (cropView) cropView.result = result;
  if (history.state && history.state.bqCrop) history.back(); // popstate 會接著 hideCropper
  else hideCropper();
}

// 主照片預覽的「裁切」：裁好的換掉預覽
async function cropPhotoUpload() {
  const up = photoUpload;
  if (!up || up.phase === 'uploading') return;
  const blob = await openCropper(up.url, 'square');
  if (!blob || photoUpload !== up || up.phase === 'uploading') return;
  URL.revokeObjectURL(up.url);
  up.blob = blob;
  up.url = URL.createObjectURL(blob);
  up.phase = 'preview';
  up.error = '';
  renderDetail();
  const btn = document.getElementById('photoConfirm');
  if (btn) btn.focus({ preventScroll: true });
}

// 燈箱裡主照片的「裁切」：裁好後跟換主照片一樣先預覽、再按確認上傳
async function cropMainPhoto(dog) {
  const src = photoSrc(dog);
  closeLightbox();
  const blob = await openCropper(src, 'square');
  if (!blob || detailDog !== dog) return;
  if (photoUpload && photoUpload.phase === 'uploading') { showToast('上一張照片還在上傳，請稍等一下'); return; }
  clearPhotoUpload();
  photoUpload = { dog, blob, url: URL.createObjectURL(blob), phase: 'preview', error: '' };
  renderDetail();
  const btn = document.getElementById('photoConfirm');
  if (btn) {
    btn.focus({ preventScroll: true });
    if (btn.scrollIntoView) btn.scrollIntoView({ block: 'nearest' });
  }
}

// 手機或電腦選照片：隱藏的檔案選擇框，按「上傳照片」時才打開
function pickPhotoFile() {
  let input = document.getElementById('photoFile');
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.id = 'photoFile';
    input.hidden = true;
    input.addEventListener('change', () => {
      const files = [...(input.files || [])];
      input.value = ''; // 同一張再選一次也會觸發
      if (!files.length || !detailDog) return;
      preparePhoto(detailDog, files[0]);
    });
    document.body.appendChild(input);
  }
  input.click();
}

// 壓成 JPEG；太大就再降一點畫質。讀不了的格式（例：電腦上的 HEIC）丟錯
async function compressPhoto(file) {
  // 有些手機相簿給的檔案沒有類型，就交給下面實際讀讀看
  if (file.type && !/^image\//.test(file.type)) throw new Error('請選擇照片檔（JPG、PNG 等圖片）');
  const src = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = src;
    try { await img.decode(); } catch (e) { throw new Error('這張照片的格式無法讀取，請改選 JPG 或 PNG'); }
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // 透明背景的 PNG 轉 JPEG 時補白底
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7, 0.55]) {
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
      if (blob && blob.size <= PHOTO_MAX_BYTES) return blob;
    }
    throw new Error('照片太大，請換一張');
  } finally {
    URL.revokeObjectURL(src);
  }
}

async function preparePhoto(dog, file) {
  if (photoUpload && photoUpload.phase === 'uploading') {
    showToast('上一張照片還在上傳，請稍等一下');
    return;
  }
  let blob;
  try {
    blob = await compressPhoto(file);
  } catch (e) {
    showToast(e.message);
    return;
  }
  if (detailDog !== dog) return; // 壓縮途中換看別隻或關掉了
  clearPhotoUpload();
  photoUpload = { dog, blob, url: URL.createObjectURL(blob), phase: 'preview', error: '' };
  renderDetail();
  const confirm = document.getElementById('photoConfirm');
  if (confirm) {
    confirm.focus({ preventScroll: true });
    if (confirm.scrollIntoView) confirm.scrollIntoView({ block: 'nearest' });
  }
}

// 取消預覽（或換看別隻）時丟掉還沒上傳的照片
function clearPhotoUpload() {
  if (photoUpload && photoUpload.phase !== 'done') URL.revokeObjectURL(photoUpload.url);
  photoUpload = null;
}

// 送到 Worker；成功後這支手機馬上改顯示新照片（GitHub Pages 要幾分鐘才更新），失敗時原本照片不動
async function uploadPhoto() {
  const up = photoUpload;
  if (!up || up.phase === 'uploading') return;
  up.phase = 'uploading';
  up.error = '';
  renderDetail();
  let error = '';
  try {
    const res = await fetch(`${UPLOAD_URL}/photos/${encodeURIComponent(up.dog.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg', ...editorHeaders() },
      body: up.blob,
    });
    const out = await res.json().catch(() => null);
    if (!res.ok || !out || !out.ok) error = (out && out.error) || `網站暫時收不到照片（${res.status}），請稍後再試；原本的照片不受影響`;
  } catch (e) {
    error = '上傳失敗，請確認網路後再試；原本的照片不受影響';
  }
  if (photoUpload !== up) return; // 保險：上傳中不會被清掉（見 preparePhoto、hideDetail）
  if (error) {
    if (detailDog !== up.dog) { // 上傳途中關掉或換看別隻：用提示條告訴結果
      clearPhotoUpload();
      showToast(`${up.dog.name} 的照片沒有上傳成功：${error}`);
      return;
    }
    up.phase = 'error';
    up.error = error;
    renderDetail();
    showPhotoError();
    return;
  }
  up.phase = 'done';
  photoUpload = null;
  photoOverrides[up.dog.id] = up.url;
  render();
  renderDetail();
  showToast(`${up.dog.name} 的照片已更新（其他志工重新整理就會看到）`);
}

// 介面評估第三輪（K 2026-10-08）：上傳失敗的說明可能在底部按鈕列後面，捲到看得到的地方
function showPhotoError() {
  const el = document.querySelector('#detail .photo-error') || document.querySelector('.photo-error');
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
}

// 詳細資訊的按鈕（#86）：在外框綁一次，依按下的是哪個按鈕分派，每次重畫內容不用重新綁。
// 由上往下找第一個符合的，所以同一個按鈕只會做一件事
const DETAIL_CLICKS = [
  ['#detailClose', () => closeDetail()],
  ['[data-zoom]', el => { if (!el.classList.contains('no-photo')) openLightbox(detailDog, el); }],
  ['#photoCrop', () => cropPhotoUpload()],
  ['#photoPick', () => pickPhotoFile()],
  ['#restEdit', () => openRestEdit(detailDog)],
  ['#introEdit', () => openIntroEdit(detailDog)],
  ['#formerAdd', () => openFormerEdit(detailDog)],
  ['#staysEdit', () => openStaysEdit(detailDog)],
  ['#staysCancel', () => { staysEdit = null; renderDetail(); const b = document.getElementById('staysEdit'); if (b) b.focus({ preventScroll: true }); }],
  ['#formerCancel', () => { formerEdit = null; renderDetail(); const b = document.getElementById('formerAdd'); if (b) b.focus({ preventScroll: true }); }],
  ['[data-former-del]', el => removeFormer(detailDog, el.dataset.formerDel)],
  ['#walksToggle', () => { detailWalksOpen = !detailWalksOpen; renderDetail(); const b = document.getElementById('walksToggle'); if (b) b.focus({ preventScroll: true }); }],
  ['#introCancel', () => { introEdit = null; renderDetail(); const b = document.getElementById('introEdit'); if (b) b.focus({ preventScroll: true }); }],
  ['#restEnd', () => saveRest(true)],
  ['#restCancel', () => { restEdit = null; renderDetail(); const b = document.getElementById('restEdit'); if (b) b.focus({ preventScroll: true }); }],
  ['#photoConfirm', () => uploadPhoto()],
  ['#photoCancel', () => { clearPhotoUpload(); renderDetail(); }],
  ['.buddy', el => { const d = allDogs[el.dataset.dog]; if (d) showDetail(d); }],
  ['#whoAdd', () => openWithSheet([detailDog], true)],
  ['[data-who-undo]', () => setWalked([detailDog], false)],
  ['[data-who-remove]', el => {
    const n = el.dataset.whoRemove;
    editWalkers(detailDog, walkerList(detailDog).filter(x => x !== n), `已拿掉 ${n}`);
  }],
  ['#favToggle', () => { toggleFav(detailDog); renderDetail(); render(); }],
  ['#detailBack', () => { const d = detailTrail.pop(); if (d) showDetail(d, false); }],
  ['[data-departed-back]', el => { const d = allDogs[el.dataset.departedBack]; if (d) showDetail(d); }],
  ['#detailWhere', el => whereOpen(detailDog, el)],
  ['[data-where]', el => whereOpen(detailDog, el)],
  ['.pick', el => {
    const id = el.dataset.pick;
    if (pickedBuddies.has(id)) pickedBuddies.delete(id); else pickedBuddies.add(id);
    renderDetail();
  }],
  ['#groupWalk', () => {
    const picked = [...pickedBuddies].map(id => allDogs.find(d => walkKey(d) === id));
    setWalked([detailDog, ...picked], true);
  }],
];

function wireDetail(box) {
  if (box.bqWired) return;
  box.bqWired = true;
  box.addEventListener('click', e => {
    if (!staysEdit || staysEdit.phase === 'saving') return;
    if (e.target.closest('#staysAdd') && staysEdit.rows.length < STAYS_MAX) {
      staysEdit.rows.push({ in: '', out: '', reason: '' });
      renderDetail(); box.querySelector('.stays-form .intake-row:last-child input')?.focus({ preventScroll: true });
    }
    const remove = e.target.closest('[data-stay-remove]');
    if (remove) {
      staysEdit.rows.splice(Number(remove.dataset.stayRemove), 1);
      renderDetail(); box.querySelector('#staysAdd')?.focus({ preventScroll: true });
    }
  });
  box.addEventListener('click', e => {
    if (!introEdit || introEdit.phase === 'saving') return;
    if (e.target.closest('#intakeAdd') && introEdit.events.length < 30) {
      introEdit.events.push({ number: introEdit.dog.id, date: '', event: '' });
      renderDetail(); box.querySelector('.intake-row:last-child input')?.focus({ preventScroll: true });
    }
    const remove = e.target.closest('[data-intake-remove]');
    if (remove) {
      introEdit.events.splice(Number(remove.dataset.intakeRemove), 1);
      renderDetail(); box.querySelector('#intakeAdd')?.focus({ preventScroll: true });
    }
  });
  // 休養設定表單：打的字記在 restEdit，重畫不會不見；送出走 saveRest
  box.addEventListener('input', e => {
    if (staysEdit && e.target.dataset.stayField) {
      const row = staysEdit.rows[Number(e.target.dataset.stayRow)];
      if (row) row[e.target.dataset.stayField] = e.target.value;
      return;
    }
    if (introEdit && e.target.dataset.intakeField) {
      const row = introEdit.events[Number(e.target.dataset.intakeRow)];
      if (row) row[e.target.dataset.intakeField] = e.target.value;
      return;
    }
    if (introEdit && e.target.id === 'introText') {
      introEdit.text = e.target.value;
      const c = box.querySelector('.intro-count');
      if (c) { const n = [...introEdit.text].length; c.textContent = `${n} / ${INTRO_MAX} 字`; c.classList.toggle('over', n > INTRO_MAX); }
      return;
    }
    if (formerEdit && e.target.id === 'formerText') { formerEdit.text = e.target.value; return; }
    if (!restEdit) return;
    if (e.target.id === 'restReason') restEdit.reason = e.target.value;
    else if (e.target.id === 'restUntil') restEdit.until = e.target.value;
  });
  box.addEventListener('submit', e => {
    if (e.target.id === 'introForm') { e.preventDefault(); saveIntro(); return; }
    if (e.target.id === 'formerForm') { e.preventDefault(); saveFormer(); return; }
    if (e.target.id === 'staysForm') { e.preventDefault(); saveStays(); return; }
    if (e.target.id !== 'restForm') return;
    e.preventDefault();
    saveRest();
  });
  box.addEventListener('click', e => {
    if (!detailDog || !e.target.closest) return;
    for (const [sel, run] of DETAIL_CLICKS) {
      const el = e.target.closest(sel);
      if (!el || !box.contains(el)) continue;
      if (!el.disabled) run(el);
      return;
    }
  });
}

// 已經有照片就把相機按鈕叫「更換照片」；照片晚一點才載入完也會改（詳細資訊已關就不管）
function labelPhotoPick(box) {
  const pick = box.querySelector('#photoPick');
  const img = box.querySelector('[data-zoom] img');
  if (!pick || !img) return;
  const dog = detailDog;
  const label = () => {
    if (img.naturalWidth && pick.isConnected) { pick.setAttribute('aria-label', `更換 ${dog.name} 的照片`); pick.title = '更換照片'; }
  };
  label();
  img.addEventListener('load', label);
}

const detailEditorViewport = createDetailEditorViewport(document.getElementById('detailBackdrop'), document.getElementById('detail'));

function renderDetail() {
  if (!detailDog) return;
  const box = document.getElementById('detail');
  wireDetail(box);
  const editingFocus = detailEditorViewport.capture();
  const focused = box.contains(document.activeElement) ? document.activeElement : null;
  // 重畫後留在原本捲到的位置（K 2026-10-10：補完資料「整個卡片就會跳掉」）；換看別隻時 showDetail 會自己捲回最上面
  const top = box.scrollTop;
  box.innerHTML = detailHtml(detailDog, new Date());
  box.scrollTop = top;
  labelPhotoPick(box);
  if (focused) {
    const replacement = [...box.querySelectorAll('button, textarea, input:not([hidden])')].find(btn =>
      (focused.id && btn.id === focused.id) ||
      (focused.dataset.pick && btn.dataset.pick === focused.dataset.pick) ||
      (focused.classList.contains('buddy') && btn.classList.contains('buddy') && btn.dataset.dog === focused.dataset.dog) ||
      (focused.dataset.gFile && btn.dataset.gFile === focused.dataset.gFile) ||
      (focused.hasAttribute('data-g-main') && btn.hasAttribute('data-g-main')));
    // 選了照片時底部換成取消／確認上傳（#146），沒有關閉鈕就落到那列第一顆
    const fallback = box.querySelector('#detailClose') || box.querySelector('.photo-bar button');
    if (replacement || fallback) (replacement || fallback).focus({ preventScroll: true });
  }
  detailEditorViewport.restore(editingFocus);
}

// 在詳細資訊裡點「可以一起溜的狗」會直接換成那隻，不多疊一層；換之前的狗記在 detailTrail，可以按「回到 ○○」
function showDetail(dog, remember = true) {
  const wasOpen = !!detailDog;
  if (!wasOpen) detailOpener = { element: document.activeElement, index: allDogs.indexOf(dog) };
  if (wasOpen && remember && dog !== detailDog) detailTrail.push(detailDog);
  if (dog !== detailDog) {
    detailEditorViewport.reset();
    pickedBuddies.clear();
    detailWalksOpen = false;
    if (!restEdit || restEdit.phase !== 'saving') restEdit = null;
    if (!introEdit || introEdit.phase !== 'saving') introEdit = null;
    if (!formerEdit || formerEdit.phase !== 'saving') formerEdit = null;
    if (!staysEdit || staysEdit.phase !== 'saving') staysEdit = null;
    if (!photoUpload || photoUpload.phase !== 'uploading') clearPhotoUpload();
  }
  detailDog = dog;
  renderDetail();
  document.getElementById('detailBackdrop').hidden = false;
  detailEditorViewport.sync();
  document.documentElement.classList.add('detail-open');
  document.getElementById('detail').scrollTop = 0;
  // 手機按「返回」時只關掉詳細資訊，不離開網頁
  if (!wasOpen) history.pushState({ bqDetail: true }, '');
  const first = document.getElementById('detailClose') || document.querySelector('#detail .photo-bar button');
  if (first) first.focus({ preventScroll: true });
}

function hideDetail() {
  if (!detailDog) return;
  detailEditorViewport.reset();
  detailDog = null;
  detailWalksOpen = false;
  detailTrail = [];
  pickedBuddies.clear();
  if (!restEdit || restEdit.phase !== 'saving') restEdit = null;
  if (!introEdit || introEdit.phase !== 'saving') introEdit = null;
  if (!formerEdit || formerEdit.phase !== 'saving') formerEdit = null;
  if (!staysEdit || staysEdit.phase !== 'saving') staysEdit = null;
  if (!photoUpload || photoUpload.phase !== 'uploading') clearPhotoUpload();
  document.getElementById('detailBackdrop').hidden = true;
  document.getElementById('detail').innerHTML = '';
  document.documentElement.classList.remove('detail-open');
  if (detailOpener) {
    const card = document.querySelector(`#main .card[data-dog="${detailOpener.index}"]`);
    const opener = detailOpener.element;
    (card || (opener && opener.isConnected && opener !== document.body ? opener : searchInput)).focus({ preventScroll: true });
    detailOpener = null;
  }
}

function closeDetail() {
  if (history.state && history.state.bqDetail) history.back(); // popstate 會接著 hideDetail
  else hideDetail();
}

// 燈箱開著時「返回」只關燈箱，詳細資訊留著
window.addEventListener('popstate', e => {
  if (findZoomOpen()) findZoomHide(); // 找狗平面圖全螢幕（#102，js/find.js）
  else if (cropOpen()) hideCropper();
  else if (lightboxOpen()) hideLightbox();
  else if (whereDog) whereHide(); // 在哪面板（#111，js/find.js）
  else if (detailDog) hideDetail();
  else if (e.state && e.state.bqNavigation) {
    activeTab = e.state.base || 'walk';
    groupsReturnTab = e.state.returnTab || 'walk';
    switchTab(e.state.tab, false);
    if (e.state.tab === 'info') restoreInfoPage(e.state.infoPage || '');
  }
  else if (analysisOpen) hideAnalysis();
  else if (activeTab === 'groups') switchTab(groupsReturnTab, false);
});
document.getElementById('detailBackdrop').addEventListener('click', e => {
  if (e.target.id === 'detailBackdrop') closeDetail();
});
document.addEventListener('keydown', e => {
  if (typeof whereDog !== 'undefined' && whereDog) return; // 在哪面板（#111）自己處理 Esc、Tab
  if (cropOpen()) {
    // 裁切畫面：Esc 取消，Tab 只在裁切畫面的按鈕間移動
    if (e.key === 'Escape') closeCropper(null);
    if (e.key === 'Tab') {
      const items = [...document.querySelectorAll('#cropper button, #cropper input')];
      const at = items.indexOf(document.activeElement);
      e.preventDefault();
      items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus({ preventScroll: true });
    }
    return;
  }
  if (lightboxOpen()) {
    // Esc 關燈箱，Tab 只在燈箱裡的按鈕間移動
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'Tab') {
      const items = [...document.querySelectorAll('#lightbox button:not([hidden]):not(:disabled), #lightbox input:not([hidden]):not(:disabled)')]
        .filter(b => !b.closest('[hidden]'));
      const at = items.indexOf(document.activeElement);
      e.preventDefault();
      const next = items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length] || items[0];
      if (next) next.focus({ preventScroll: true });
    }
    return;
  }
  if (e.key === 'Escape' && detailDog) closeDetail();
  if (e.key !== 'Tab' || !detailDog) return;
  // 我的備註編輯時（#62）文字框和欄位也要能用 Tab 走到
  const buttons = [...document.querySelectorAll('#detail button:not(:disabled), #detail textarea:not(:disabled), #detail select:not(:disabled), #detail input:not([hidden]):not(:disabled), #toast:not([hidden]) button:not([hidden])')];
  const first = buttons[0], last = buttons[buttons.length - 1];
  if (!first) return;
  if (!buttons.includes(document.activeElement) || (e.shiftKey && document.activeElement === first) || (!e.shiftKey && document.activeElement === last)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus({ preventScroll: true });
  }
});

// 狗卡用事件委派：renderMain 每次重畫卡片都不用重新綁
function cardFromEvent(e) {
  const card = e.target.closest('#main .card[data-dog], #main .row-dog[data-dog]');
  return card && allDogs[card.dataset.dog];
}
// 點「已遛／移回」只記錄，不開詳細資訊；點照片開燈箱（#46，沒照片就照舊開詳細資訊）；點卡片其他地方開詳細資訊
document.getElementById('main').addEventListener('click', e => {
  const favBtn = e.target.closest('[data-walk-fav]');
  if (favBtn) { saveWalkFav(favBtn.dataset.walkFav === '1'); render(); return; }
  const viewBtn = e.target.closest('[data-walk-view]');
  if (viewBtn) { saveWalkView(viewBtn.dataset.walkView); render(); return; }
  const dog = cardFromEvent(e);
  if (!dog) return;
  const btn = e.target.closest('[data-walk]');
  const thumb = e.target.closest('.thumb');
  if (e.target.closest('[data-where]')) whereOpen(dog, e.target.closest('[data-where]'));
  else if (btn) setWalked([dog], btn.dataset.walk === 'add');
  else if (thumb && dog.id && !thumb.classList.contains('no-photo')) openLightbox(dog, thumb.closest('.card'));
  else showDetail(dog);
});
document.getElementById('main').addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.target.closest('button')) return; // 按鈕自己會觸發 click
  const dog = cardFromEvent(e);
  if (dog) { e.preventDefault(); showDetail(dog); }
});

// 搜尋比對用：去掉空白、全形轉半形、英文不分大小寫
function searchKey(text) {
  return String(text || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

// 犬名部分符合即算；沒輸入（或只有空白）時每隻都符合
function matchesSearch(dog, query) {
  const q = searchKey(query);
  return !q || searchKey(dog.name).includes(q);
}

// 主分類（V3，#33）：順序就是左右滑動切換的順序
const TABS = [
  { id: 'walk', label: '遛狗表', icon: 'list' },
  { id: 'groups', label: '常遛狗群', icon: 'group' },
  { id: 'mine', label: '我溜過', icon: 'paw' }, // #58 取代原本的「相關資訊（編輯中）」
  { id: 'info', label: '資訊', icon: 'chart' },
];

// counts：各分類要顯示的數字；沒有數字的分類留白
function buildTabs(counts) {
  const tabsEl = document.getElementById('tabs');
  const focusedTab = tabsEl.contains(document.activeElement) && document.activeElement.dataset.tab;
  const selected = analysisOpen ? 'info' : activeTab;
  tabsEl.innerHTML = TABS.map(t => {
    const n = counts[t.id] != null ? counts[t.id] : t.note || '';
    const label = n === '' ? '' : ` aria-label="${t.label}，${t.id === 'mine' ? `${n} 筆紀錄` : `${n} 隻`}"`;
    return `<button type="button" data-tab="${t.id}" class="${selected === t.id ? 'active' : ''}"${selected === t.id ? ' aria-current="page"' : ''}${label}>${icon(t.icon)}<span class="t">${t.label}</span><span class="n">${n}</span></button>`;
  }).join('');
  tabsEl.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  if (focusedTab) tabsEl.querySelector(`[data-tab="${focusedTab}"]`)?.focus({ preventScroll: true });
}

// 切換分類：標籤跟著亮起，畫面回到內容最上面
function switchTab(id, pushHistory = true) {
  // find 保留給舊入口與操作教學，底部不再佔一格。
  if (id !== 'find' && !TABS.some(t => t.id === id)) return;
  const changed = id !== (analysisOpen ? 'info' : activeTab);
  if (pushHistory && changed) {
    history.replaceState({ bqNavigation: true, tab: analysisOpen ? 'info' : activeTab, base: activeTab, returnTab: groupsReturnTab, infoPage: typeof infoPage === 'undefined' ? '' : infoPage }, '');
  }
  if (id === 'groups' && activeTab !== 'groups') groupsReturnTab = analysisOpen ? 'info' : activeTab;
  if (pushHistory && changed && id === 'info') infoPage = '';
  analysisOpen = id === 'info';
  if (!analysisOpen) activeTab = id;
  if (pushHistory && changed) history.pushState({ bqNavigation: true, tab: id, base: activeTab, returnTab: groupsReturnTab, infoPage: typeof infoPage === 'undefined' ? '' : infoPage }, '');
  if (changed) resetWalkOrder(); // 換分頁回來溜狗表時重排，剛溜的狗才會排到後面
  render();
  const btn = document.querySelector(`#tabs button[data-tab="${id}"]`);
  if (btn) btn.focus({ preventScroll: true });
  if (btn && btn.scrollIntoView) btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (changed) window.scrollTo(0, 0);
}

// step：+1 下一個分類、-1 上一個；第一頁再往前、最後一頁再往後都不動（不循環）
function stepTab(step) {
  const i = TABS.findIndex(t => t.id === activeTab);
  const next = i + step;
  if (next < 0 || next >= TABS.length) return false;
  switchTab(TABS[next].id);
  return true;
}


const mainEl = document.getElementById('main');
function render() {
  renderMain();
  if (loadWarning) {
    document.getElementById('main').insertAdjacentHTML('afterbegin',
      `<div class="alert-box warn">${icon('warn')}<span>${esc(loadWarning)}</span></div>`);
  }
  queueRange();
  queueTour();
}

// 讀取中（#78）：先畫幾張灰色卡片骨架，版面不會等資料來才突然跳出來；文字留給螢幕閱讀器
function skeletonHtml() {
  const card = `<div class="card skeleton" aria-hidden="true"><div class="sk sk-thumb"></div><div class="sk-lines"><div class="sk sk-name"></div><div class="sk sk-meta"></div></div><div class="sk sk-btn"></div></div>`;
  return `<div class="status-msg sr-only" role="status">讀取中…</div>` + card.repeat(6);
}

// 往下捲時頁首加陰影（#78），看得出內容捲到頁首下面
const appHeader = document.querySelector('header.app');
function syncHeaderShadow() {
  if (appHeader) appHeader.classList.toggle('scrolled', window.scrollY > 4);
}
window.addEventListener('scroll', syncHeaderShadow, { passive: true });

// 頁首收起（critique 2026-10-09 P1）：往下捲時標題那一行跟著捲走，只留搜尋框和範圍字黏在上面，
// 狗卡多看得到一兩隻；捲回最上面就回來。用 sticky 負 top 做，不判斷捲動方向，畫面不會跳
const appBrand = appHeader && appHeader.querySelector('.brand');
function syncHeaderTuck() {
  if (!appHeader || !appBrand || typeof getComputedStyle !== 'function') return; // node 測試的假 DOM 沒有
  document.documentElement.style.setProperty('--app-header-height', `${appHeader.getBoundingClientRect().height}px`);
  const pad = parseFloat(getComputedStyle(appHeader).paddingTop) || 0;
  appHeader.style.setProperty('--brand-h', `${Math.round(pad + appBrand.offsetHeight)}px`);
}
syncHeaderTuck();
window.addEventListener('resize', syncHeaderTuck);

// 頁首範圍字（K 2026-10-09 病歷夾色籤）：溜狗表捲動時，頁首寫出畫面上第一隻到最後一隻多久沒溜，
// 像檔案櫃抽屜上的範圍標籤。照片、列表模式都用「N 天前」（從資料算，不抄畫面上的字：列表模式顯示的是日期）
function dayWord(dog, today) {
  const s = computeStatus(dog, today);
  if (s.kind === 'dated') return s.days < 0 ? '日期看不懂' : s.days === 0 ? '今天' : `${s.days} 天前`;
  return s.kind === 'covered' ? '有人固定照顧' : s.kind === 'rest' ? '休養中' : '沒有紀錄';
}
function rangeText(words) {
  if (!words.length) return '';
  const a = words[0], b = words[words.length - 1];
  return a === b ? `畫面上：${a}` : `畫面上：${a} ～ ${b}`;
}
const rangeLabel = document.getElementById('rangeLabel');
let rangeFrame = 0;
function syncRange() {
  rangeFrame = 0;
  if (!rangeLabel) return;
  let text = '';
  if (activeTab === 'walk' && !analysisOpen) {
    const top = appHeader ? appHeader.getBoundingClientRect().bottom : 0;
    const bar = document.getElementById('bottomBar');
    const bottom = bar ? bar.getBoundingClientRect().top : window.innerHeight;
    const today = new Date();
    const words = [];
    for (const el of mainEl.querySelectorAll('.card[data-dog], .row-dog[data-dog]')) {
      const r = el.getBoundingClientRect();
      if (r.bottom > top + 8 && r.top < bottom - 8) {
        const dog = allDogs[Number(el.dataset.dog)];
        if (dog) words.push(dayWord(dog, today));
      } else if (words.length) break;
    }
    text = rangeText(words);
  }
  if (rangeLabel.textContent !== text) rangeLabel.textContent = text;
  rangeLabel.hidden = !text;
}
function queueRange() { if (!rangeFrame) rangeFrame = requestAnimationFrame(syncRange); }
window.addEventListener('scroll', queueRange, { passive: true });
window.addEventListener('resize', queueRange);

// 溜狗表（沿用原待巡房）：所有狗依幾天沒遛由久到近；沒有遛狗紀錄的排最前，有人固定照顧的排最後
function dueDogs(dogs, today) {
  // 休養中排最下面（K 2026-10-09），有人固定照顧在它上面
  const key = s => s.kind === 'unknown' ? Infinity : s.kind === 'dated' ? s.days : s.kind === 'covered' ? -1 : -2;
  return dogs
    .map(d => ({ d, k: key(computeStatus(d, today)) }))
    .sort((a, b) => (b.k === a.k ? 0 : b.k > a.k ? 1 : -1))
    .map(x => x.d);
}

// 溜狗表一律最久沒溜在前（2026-10-08 K 同意介面評估：拿掉排序切換和「幾天以上」篩選，天數的顏色就看得出來）。
// 按了溜了的狗留在原地（介面評估 P0：重排的話下一隻會滑到手指下，容易按錯寫進試算表）：
// 第一次排好的順序記著，重新讀資料（allDogs 換了）或換分頁才重排
let walkOrder = null;   // walkKey → 第幾個
let walkOrderFor = null; // 記順序時的 allDogs
function sortWalkList(dogs, today) {
  const due = dueDogs(dogs, today);
  if (!walkOrder || walkOrderFor !== allDogs) {
    walkOrder = new Map(due.map((d, i) => [walkKey(d) || d, i]));
    walkOrderFor = allDogs;
    return due;
  }
  const pos = d => { const p = walkOrder.get(walkKey(d) || d); return p === undefined ? Infinity : p; };
  return due.map((d, i) => ({ d, i, p: pos(d) })).sort((a, b) => a.p - b.p || a.i - b.i).map(x => x.d);
}
function resetWalkOrder() {
  walkOrder = null;
}

// 我的常溜（#155，K 2026-10-04 選兩頁都放）：溜狗表上面只剩「全部／★ 我的常溜」兩個選一個（2026-10-08）
const WALK_FAV_KEY = 'bq-walk-fav';
let walkFavMemory = false;
function loadWalkFav() {
  const v = readJsonKey(WALK_FAV_KEY);
  return typeof v === 'boolean' ? v : walkFavMemory;
}
function saveWalkFav(on) {
  walkFavMemory = on;
  writeJsonKey(WALK_FAV_KEY, on);
}

function walkFilterHtml(total, fav, favN) {
  const chip = (on, v, label, n) => `<button type="button" class="chip${on ? ' on' : ''}" data-walk-fav="${v}" aria-pressed="${on}">${label}<small>${n}</small></button>`;
  return `<div class="chips" role="group" aria-label="要看哪些狗">${chip(!fav, 0, '全部', total)}${chip(fav, 1, '★ 我的常溜', favN)}</div>`;
}

// V9（#141 第 6 項）：照片模式／列表模式（收起照片，像試算表一列一隻）。選了哪個記在這支手機
const WALK_VIEW_KEY = 'bq-walk-view';
let walkViewMemory = 'photo';
function loadWalkView() {
  let v = walkViewMemory;
  try {
    if (walkedStorage) v = walkedStorage.getItem(WALK_VIEW_KEY) || v;
  } catch (e) { /* 讀不到就用記憶體裡的 */ }
  return v === 'list' ? 'list' : 'photo';
}
function saveWalkView(v) {
  walkViewMemory = v;
  try {
    if (walkedStorage) walkedStorage.setItem(WALK_VIEW_KEY, v);
  } catch (e) { /* 存不了就這次開著網頁的期間記得 */ }
}
function walkToolsHtml(chips, view = loadWalkView()) {
  return `<div class="walk-tools">${chips}
    <div class="seg" role="group" aria-label="顯示方式">
      <button type="button" data-walk-view="photo" class="${view === 'photo' ? 'on' : ''}" aria-pressed="${view === 'photo'}" aria-label="照片">${icon('photos')}</button>
      <button type="button" data-walk-view="list" class="${view === 'list' ? 'on' : ''}" aria-pressed="${view === 'list'}" aria-label="列表（收起照片）">${icon('list')}</button>
    </div>
  </div>`;
}

// 列表模式的一列：天數｜狗名｜籠位｜溜了。
// K 2026-10-09：溜狗人拿掉（點進詳細資訊看得到），籠位跟狗卡一樣點了開平面圖
// critique 2026-10-09：列表模式也是天數優先，天數排最前面、寫「20天」不寫日期（不用心算）；
// 警示原文跟狗卡一樣放在那一列下面，不只一個小三角
function walkRow(dog, today) {
  const s = computeStatus(dog, today);
  const flag = specialFlag(dog.note);
  const days = s.kind === 'dated'
    ? (s.days < 0 ? '?<span class="sr-only">日期看不懂</span>' : s.days === 0 ? '今天' : `<b>${s.days}</b>天<span class="sr-only">前</span>`)
    : s.kind === 'covered' ? '固定<span class="sr-only">有人照顧</span>'
    : s.kind === 'rest' ? `休養<span class="sr-only">中，${monthDay(s.until)} 前暫停帶出</span>` : '—<span class="sr-only">沒有紀錄</span>';
  return `<div class="row-dog${flag ? ' flagged' : ''}" data-dog="${allDogs.indexOf(dog)}" role="button" tabindex="0" aria-haspopup="dialog">
    <span class="r-date ${s.kind === 'rest' ? 'rest' : s.level || 'muted'}">${days}</span>
    <span class="r-name">${esc(dog.name)}</span>
    ${typeof whereKnown === 'function' && whereKnown(dog)
      ? `<button type="button" class="r-cage cage-pill" data-where aria-label="${esc(dog.name)} 在哪：${esc(dog.cage)}${dog.homeCage ? '（暫住）' : ''}">${icon('pin')}${esc(dog.cage)}</button>`
      : `<span class="r-cage plain">${esc(dog.cage)}</span>`}
    ${walkButton(dog)}
    ${flag ? warnNote(dog.note, flag) : ''}
  </div>`;
}

function renderMain() {
  const today = new Date();
  document.getElementById('dateLabel').textContent =
    `${today.getMonth() + 1}月${today.getDate()}日 (${'日一二三四五六'[today.getDay()]})`;

  const main = document.getElementById('main');
  // 資訊與狗群共用內頁頁首；底部導覽保持可用。
  document.documentElement.classList.toggle('analysis-open', analysisOpen || activeTab === 'groups');
  // 常遛狗群、資訊都是底部導覽的主分頁：狗群用網站共用表頭，資訊首頁只寫「資訊」；只有資訊子頁有「回資訊」
  document.documentElement.classList.toggle('head-shared', !analysisOpen && activeTab === 'groups');
  document.documentElement.classList.toggle('head-sub', analysisOpen && !!infoPage);
  const title = document.querySelector('.head-title');
  if (title) title.textContent = analysisOpen ? (INFO_PAGES[infoPage] || '資訊') : '常遛狗群';
  const back = document.getElementById('analysisBack');
  if (back) back.innerHTML = `${icon('back')}回${(TABS.find(t => t.id === (analysisOpen ? activeTab : groupsReturnTab)) || TABS[0]).label}`;

  if (back && analysisOpen && infoPage) back.innerHTML = `${icon('back')}回資訊`;
  syncHeaderTuck();
  // #273 資訊分類與子頁。
  if (analysisOpen) {
    buildTabs(loadState === 'ready' ? { walk: allDogs.filter(d => matchesSearch(d, searchQuery.trim())).length, mine: myWalksCount('') } : {});
    if (!(infoPage === 'updates' && infoUpdateTab === 'edits' && main.querySelector('#infoEdits'))) main.innerHTML = analysisPageHtml(today);
    return;
  }
  if (activeTab === 'groups') {
    buildTabs(loadState === 'ready' ? { walk: allDogs.filter(d => matchesSearch(d, searchQuery.trim())).length, mine: myWalksCount('') } : {});
    // 沿用正式狗群頁及既有 API；獨立文件的觸控事件不會冒泡到主分類。
    main.innerHTML = groupStageHtml();
    return;
  }

  // 資料還沒好時標題、搜尋框、分類照樣能用，只有內容區顯示讀取中或失敗
  if (loadState !== 'ready') {
    buildTabs({});
    main.innerHTML = loadState === 'error'
      ? `<div class="status-msg">狗的資料讀不到，請確認網路後按「重新讀取」。<br><button class="retry-btn" id="retryBtn">重新讀取</button></div>`
      : skeletonHtml();
    const retry = document.getElementById('retryBtn');
    if (retry) retry.addEventListener('click', init);
    return;
  }

  // 搜尋時只篩選目前分類的內容，分類上的數字也改成各分類符合的隻數；清空就回到原本的內容
  const q = searchQuery.trim();
  const hit = d => matchesSearch(d, q);
  // V9（#141）：沒有今天已溜和收起了，全部的狗都在溜狗表；按過溜了的留在原地、顯示今天
  const walkList = sortWalkList(allDogs, today).filter(hit);
  // 介面評估第三輪（K 2026-10-08）：找狗分頁不放數字（跟溜狗表一樣是全部的狗）；
  // 我溜過一律是全部紀錄筆數，不跟著搜尋變（搜不到時「我溜過 0」像紀錄不見了）
  buildTabs({ walk: walkList.length, mine: myWalksCount('') });
  searchInput.placeholder = activeTab === 'find' ? '狗名、編號或籠位' : '搜尋狗名';
  if (activeTab === 'find') {
    // 找狗（#99）搜尋全部的狗：犬名、編號、籠位都算
    main.innerHTML = findPageHtml(q);
    return;
  }
  if (activeTab === 'mine') {
    main.innerHTML = myWalksHtml(today, q);
    return;
  }
  // 電腦版（K 2026-10-10）：寬螢幕的溜狗表是簡報＋全表，在 js/desk.js
  if (typeof deskOn === 'function' && deskOn()) {
    main.innerHTML = deskWalkHtml(today, q, walkList);
    return;
  }
  const fav = loadWalkFav();
  const list = fav ? walkList.filter(isFav) : walkList;
  const view = loadWalkView();
  const items = view === 'list'
    ? (list.length ? `<div class="rows"><div class="row-head"><span>天數</span><span>狗名</span><span>籠位</span><span></span></div>${list.map(d => walkRow(d, today)).join('')}</div>` : '')
    : list.map((d, i) => dogCard(d, today, i < FIRST_SCREEN_CARDS)).join('');
  const head = walkToolsHtml(walkFilterHtml(walkList.length, fav, walkList.filter(isFav).length), view);
  const empty = fav && !list.length && !q ? '還沒有常溜的狗。<br>點狗打開詳細資訊，<br>按名字旁的「☆ 常溜」加進來。'
    : q ? `找不到「${esc(q)}」` : '沒有符合的狗';
  main.innerHTML = head + (q && list.length ? `<div class="section-hint">${icon('search')}搜尋「${esc(q)}」：${list.length} 隻</div>` : '')
    + (items || `<div class="status-msg">${empty}</div>`);
}

// 我溜過：點照片開詳細資訊、讀取失敗時重新讀取（內容區每次重畫，所以用事件委派）
mainEl.addEventListener('click', e => {
  const tile = e.target.closest('[data-mine-dog]');
  if (tile) showDetail(allDogs[tile.dataset.mineDog]);
  else if (e.target.closest('#mineRetry')) loadMyWalks();
  else if (e.target.closest('#mineStats')) { mineStatsOpen = !mineStatsOpen; render(); }
  else if (e.target.closest('[data-mine-month]')) {
    const src = e.target.closest('[data-mine-month]');
    const dir = src.classList.contains('next') ? '.next' : ':not(.next)';
    mineMonth = src.dataset.mineMonth; mineDay = ''; loadWalkYear(mineMonth); render();
    const b = document.querySelector(`#main .mc-nav${dir}:not(:disabled)`) || document.querySelector('#main .mc-nav:not(:disabled)');
    if (b) b.focus({ preventScroll: true });
  }
  else if (e.target.closest('[data-mine-day]')) { mineDay = e.target.closest('[data-mine-day]').dataset.mineDay; render(); const b = document.querySelector('#main .mc-cell.sel'); if (b) b.focus({ preventScroll: true }); }
  else if (e.target.closest('[data-open-guide]')) openGuide();
  else if (e.target.closest('[data-who-name]')) {
    const n = e.target.closest('[data-who-name]').dataset.whoName;
    walkerSetup = { ...(walkerSetup || { error: '' }), phase: 'edit', text: canonicalWalker(walkerSetup ? walkerSetup.text : '') === n ? '' : n };
    render();
  } else if (e.target.closest('#whoEdit')) {
    walkerSetup = { text: loadWalkerName(), phase: 'edit', error: '' }; // 先填目前的名字，不用重打
    render();
    const input = document.getElementById('whoInput');
    if (input) input.focus();
  } else if (e.target.closest('#whoRename')) {
    renameWalker();
  } else if (e.target.closest('#whoMerge')) {
    confirmWalkerMerge();
  } else if (e.target.closest('#whoCancel')) {
    walkerSetup = null;
    render();
  } else if (e.target.closest('#whoClear')) {
    walkerSetup = { ...(walkerSetup || { text: '', phase: 'edit', error: '' }), confirmClear: true };
    render();
  } else if (e.target.closest('#whoClearNo')) {
    walkerSetup = { ...walkerSetup, confirmClear: false };
    render();
  } else if (e.target.closest('#whoClearOk')) {
    saveMyCodes([]);
    saveWalkerName('');
    walkerSetup = null;
    render();
  }
});
// 我是誰：輸入的名字先記著（別的資料讀好重畫時才不會被清掉），送出換代號
mainEl.addEventListener('input', e => {
  if (e.target.id !== 'whoInput') return;
  if (!walkerSetup) walkerSetup = { text: '', phase: 'edit', error: '' };
  if (walkerSetup.text !== e.target.value) { delete walkerSetup.operationId; delete walkerSetup.mergeOperationId; delete walkerSetup.merge; }
  walkerSetup.text = e.target.value;
  refreshNames(mainEl, walkerSetup, 'who', e);
});
mainEl.addEventListener('compositionend', e => {
  if (e.target.id !== 'whoInput' || !walkerSetup) return;
  walkerSetup.text = e.target.value;
  refreshNames(mainEl, walkerSetup, 'who');
});
mainEl.addEventListener('submit', e => {
  if (e.target.id !== 'whoForm') return;
  e.preventDefault();
  const input = document.getElementById('whoInput');
  const text = input ? input.value : '';
  // 問過「表上還沒有這個名字」、名字沒改又按一次：就是確定要用
  const confirmed = walkerSetup && walkerSetup.phase === 'confirm' && walkerSetup.text === text;
  walkerSetup = { ...(walkerSetup || {}), text, phase: confirmed ? 'confirm' : 'edit', error: '' };
  saveWalkerSetup();
});

// 注音、拼音選字途中不篩選，避免一直閃「找不到『ㄉㄡ』」；選好字才更新
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
// 搜尋框有字就顯示 X（選字途中也算有字，才能整個清掉）
function syncSearchClear() {
  if (searchClear) searchClear.hidden = !searchInput.value;
}
searchInput.addEventListener('input', e => {
  syncSearchClear();
  if (e.isComposing) return;
  searchQuery = e.target.value;
  render();
});
searchInput.addEventListener('compositionend', e => {
  syncSearchClear();
  searchQuery = e.target.value;
  render();
});
// 點 X：清空文字、回到目前分頁的完整內容，不換分頁；游標留在搜尋框方便重打
if (searchClear) searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchQuery = '';
  syncSearchClear();
  render();
  searchInput.focus();
});

function pad2(n) {
  return String(n).padStart(2, '0');
}

// ── 開頭畫面（#141 第 2 項）──
// 第一次打開：先問你在試算表上的名字，接著幾頁說明（像新網站上線的導覽），按「開始使用」就不再出現。
// 已經有名字（以前在我溜過設定過）只看說明；說明看過、名字被清掉了，只問名字
// 介面評估第四輪（K 2026-10-08）：名字可以「先看看，等一下再設定」（現場沒訊號也進得去），
// 沒名字的人按「溜了」時再問，設好直接幫他登記那隻；說明可以從我溜過的「說明」再打開
const ONBOARD_KEY = 'bq-onboarded';
const NAME_LATER_KEY = 'bq-name-later';
// ── 使用說明導覽（K 2026-10-09：直接用實際的網頁；一個說明一個動作，用手指示範）──
// 畫面變暗、只亮要說明的地方，旁邊小框一句話；有 demo 的步驟，手指會點一下示範那個動作。
// 「溜了」只換畫面上的樣子，不會送出、不寫試算表；打開詳細資訊、在哪、換分頁本來就不改資料，真的做，換下一步時收回。
// 說明文字都在 TOUR_STEPS（K 2026-10-09 在 Issue #171 改的字；「狗狗」照名詞表改「狗」，K 同意）；target 依序找，第一個找得到的就亮它，
// 都找不到（資料還沒讀到、列表模式沒有籠位）時小框放在畫面中間
const TOUR_STEPS = [
  { target: ['#main .card[data-dog]', '#main .row-dog[data-dog]', '#main .desk-table tbody tr'], title: '溜狗表', text: '依照上次溜狗時間排序，越久沒溜的狗會排越前面。' },
  { target: ['#main .card[data-dog] .last', '#main .row-dog[data-dog] .r-date', '#main .desk-table tbody .dr-day'], title: '上次溜狗天數', text: '顯示距離上次溜狗的天數過了幾天。' },
  { target: ['#main .card[data-dog] .name', '#main .row-dog[data-dog] .r-name', '#main .desk-table tbody .dr-name button'], title: '狗資料', text: '點擊名稱，可以查看照片和詳細紀錄。', demo: 'detail' },
  { target: ['#main .card[data-dog] .walk-btn', '#main .row-dog[data-dog] .walk-btn', '#main .desk-table tbody .dr-ck'], title: '溜狗登記', text: '溜完按「溜了」，就會自動記錄日期和名字。', deskText: '勾選溜過的狗（可以勾好幾隻），再按下面的「今天 溜了」，就會一起記錄日期和名字。', demo: 'walk' },
  { target: ['#main .card[data-dog] .walk-btn', '#main .row-dog[data-dog] .walk-btn', '#main .desk-table tbody .dr-name button'], title: '取消登記', text: '如果按錯，再按一次「已溜」就可以取消。', deskText: '如果登記錯了，按提示條的「復原」，或點狗名打開詳細資訊按「已溜」取消。', demo: 'unwalk' },
  { target: ['#main .card[data-dog] .cage-pill', '#main .row-dog[data-dog] .r-cage', '#main .desk-table tbody .dr-cage'], title: '籠位查詢', text: '點擊籠位，就能在平面圖查看位置。', demo: 'where' },
  { target: ['#main .walk-tools .seg', '#main .dt-view'], title: '照片／列表', text: '右上角可以切換：有照片的狗卡，或一列一隻、比較好掃過去的列表。', deskTitle: '全表／最近 30 天', deskText: '全表下面可以切換「最近 30 天」，看每隻狗這一個月哪幾天有出門。', demo: 'view' },
  { target: ['#tabs [data-tab="mine"]'], title: '我溜過', text: '查看自己溜過的狗。', demo: 'tab' },
  { target: ['#main [data-where]', '#main .card .meta', '#main .row-dog .r-cage'], title: '找狗', text: '點籠位查看狗的位置，也可以看平面圖。', demo: 'find' },
  { target: [], title: '加入手機主畫面', text: '下次點手機桌面的圖示，就能直接開啟網站。', install: true },
];
function tourStepCount() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const count = standalone || window.innerWidth >= 1100 ? TOUR_STEPS.length - 1 : TOUR_STEPS.length;
  return Math.max(count, tour ? tour.step + 1 : 0); // 安裝說明開著時旋轉手機，不讓最後一步變成超出範圍。
}
function tourInstallHtml() {
  return `<div class="tour-install">
    <p><strong>iPhone</strong>：用 Safari 開啟網站，點「分享」→「加入主畫面」→「加入」。若有「打開為網頁 App」，請開啟。</p>
    <p><strong>Android</strong>：用 Chrome 開啟網站，點右上角「⋮」→「安裝並建立捷徑」（或「新增至主畫面」），依提示選「安裝」或「建立捷徑」。</p>
    <p>在 LINE 裡開啟時，先選「用瀏覽器開啟」；建議使用一般分頁。</p>
  </div>`;
}
let tour = null; // { step, again, shown: 示範後改亮的地方, undo: 收回示範, timers }
function tourTarget(step) {
  for (const sel of TOUR_STEPS[step].target) {
    // 籠位示範只用舊／新犬舍有逐籠位置的狗；亮的籠位與示範打開的是同一隻。
    const el = TOUR_STEPS[step].demo === 'where'
      ? [...document.querySelectorAll(sel)].find(el => {
        const d = tourCageDog(el);
        return d && ['old', 'new'].includes(findZoneOf(d)) && findCageOf(d);
      })
      : document.querySelector(sel);
    if (el) return el;
  }
  return null;
}
function tourCageDog(el) {
  const row = el && el.closest('[data-dog], [data-desk-dog]');
  const i = el && el.dataset.dogI !== undefined ? el.dataset.dogI
    : row && (row.dataset.dog !== undefined ? row.dataset.dog : row.dataset.deskDog);
  return i != null ? allDogs[Number(i)] : null;
}
// 示範用的狗：溜狗表最上面那隻
function tourDog() {
  const el = document.querySelector('#main .card[data-dog], #main .row-dog[data-dog]');
  return el ? allDogs[Number(el.dataset.dog)] : null;
}
// 只換畫面上「溜了」按鈕和色籤的樣子（不送出）；收回時 render() 畫回原本的
function tourFakeWalk(state) {
  const row = document.querySelector('#main .card[data-dog], #main .row-dog[data-dog]');
  const btn = row && row.querySelector('.walk-btn');
  if (!btn) return;
  if (state === 'pending') { btn.className = 'walk-btn pending'; btn.textContent = '登記中'; return; }
  btn.className = 'walk-btn done';
  btn.innerHTML = `${icon('tick')}已溜`;
  const val = row.querySelector('.last .val');
  if (val) { val.className = 'val sage'; val.textContent = '今天'; }
}
const TOUR_DEMOS = {
  detail: { run: () => { const d = tourDog(); if (d) showDetail(d); }, show: '#detail', undo: () => { if (detailDog) closeDetail(); } },
  walk: { run: () => { tourFakeWalk('pending'); tourLater(() => { tourFakeWalk('done'); placeTour(); }, 700); }, undo: () => render() },
  unwalk: { before: () => tourFakeWalk('done'), run: () => render(), undo: () => render() },
  where: { run: el => { const d = tourCageDog(el); if (d) whereOpen(d); }, show: '#whereSheet', undo: () => { if (whereDog) whereClose(); } },
  // 照片／列表（K 2026-10-09）：示範切到另一種，收回時切回原本的
  view: {
    // 電腦版沒有照片／列表：示範切到「最近 30 天」再切回全表
    run: () => {
      if (typeof deskOn === 'function' && deskOn()) { tour.view = 'desk'; deskView = 'days30'; render(); return; }
      tour.view = loadWalkView(); saveWalkView(tour.view === 'list' ? 'photo' : 'list'); render();
    },
    show: '#main .walk-tools .seg, #main .dt-view',
    undo: () => {
      if (tour && tour.view === 'desk') { deskView = 'sheet'; tour.view = null; }
      else if (tour && tour.view) { saveWalkView(tour.view); tour.view = null; }
      render();
    },
  },
  tab: { run: el => { if (el) switchTab(el.dataset.tab); }, show: '#main .mc-head, #main .status-msg, #main .who-box', undo: () => switchTab('walk') },
  // 找狗（K 2026-10-09）：切過去後再隨便點平面圖上一個有狗的籠子，下面列出那一籠的狗。
  // 全圖不畫籠子（critique 2026-10-09），所以先點一區放大，再點那一區的籠子
  find: {
    run: () => switchTab('find'),
    show: '#main .find-map-card .find-map',
    then: [
      { at: tourZoneWithDogs, run: g => { findZone = g.dataset.findZone; findCage = null; render(); } },
      { at: tourCageWithDogs, run: g => findPickCage(g.dataset.findCage) },
    ],
    undo: () => { findCage = null; findZone = 'all'; switchTab('walk'); },
  },
};
// 全圖上隨便一個有逐籠、又有狗的區（找狗示範用）
function tourZoneWithDogs() {
  const zones = [...document.querySelectorAll('#main g[data-find-zone]')].filter(g => {
    const key = g.dataset.findZone;
    return allDogs.some(d => findZoneOf(d) === key && FIND_CAGES.cages.some(c => c.zone === key && c.id === findCageOf(d)));
  });
  return zones.length ? zones[Math.floor(Math.random() * zones.length)] : null;
}
// 放大的那一區裡隨便一個有狗的籠子（找狗示範用）
function tourCageWithDogs() {
  const cages = [...document.querySelectorAll(`#main g[data-find-zone="${findZone}"] g[data-find-cage]`)].filter(g => g.querySelector('rect.fm-cage.has'));
  return cages.length ? cages[Math.floor(Math.random() * cages.length)] : null;
}
function tourLater(fn, ms) {
  if (!tour) return;
  tour.timers.push(setTimeout(() => { if (tour) fn(); }, ms));
}
// 收回這一步的示範（換步、再看一次、結束時）
function tourReset() {
  if (!tour) return;
  tour.timers.forEach(clearTimeout);
  tour.timers = [];
  tour.shown = null;
  const undo = tour.undo;
  tour.undo = null;
  if (undo) undo();
  const finger = document.querySelector('#tour .tour-finger');
  if (finger) finger.className = 'tour-finger';
}
// 手指出現 → 點一下 → 做那個動作；手機設定減少動態效果時不播，直接顯示做完的樣子
function tourPlay() {
  const demo = TOUR_DEMOS[TOUR_STEPS[tour.step].demo];
  if (!demo) return;
  if (TOUR_STEPS[tour.step].demo === 'where' && !tourTarget(tour.step)) return;
  if (demo.before) { tour.undo = demo.undo; demo.before(); placeTour(); }
  const taps = [{ at: () => tourTarget(tour.step), run: el => { tour.undo = demo.undo; demo.run(el); if (demo.show) tour.shown = demo.show; } }];
  if (demo.then) taps.push(...[].concat(demo.then));
  const tap = t => { const el = t.at(); if (el) t.run(el); placeTour(); };
  const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still) return taps.forEach(tap);
  const finger = document.querySelector('#tour .tour-finger');
  let when = 500;
  for (const t of taps) {
    let el = null;
    tourLater(() => {
      el = t.at();
      if (!el || !finger) return;
      const r = el.getBoundingClientRect();
      Object.assign(finger.style, { left: `${r.left + r.width / 2}px`, top: `${r.top + r.height / 2}px` });
      finger.className = 'tour-finger on';
    }, when);
    tourLater(() => finger && finger.classList.add('press'), when + 500);
    tourLater(() => { if (el) t.run(el); placeTour(); }, when + 650);
    tourLater(() => { if (finger) finger.className = 'tour-finger'; }, when + 1000);
    when += 1700;
  }
}
function startTour(again = false) {
  onboard = null;
  renderOnboard();
  if (activeTab !== 'walk' || analysisOpen) {
    if (analysisOpen && typeof hideAnalysis === 'function') hideAnalysis();
    switchTab('walk');
  }
  window.scrollTo(0, 0);
  tour = { step: 0, again, shown: null, undo: null, timers: [] };
  renderTour(true);
}
function endTour() {
  tourReset();
  try { walkedStorage && walkedStorage.setItem(ONBOARD_KEY, '1'); } catch (e) { /* 存不了下次再看一次 */ }
  tour = null;
  renderTour();
}
// 目標不在畫面上（被頁首或底部列擋住）就捲過去
function scrollTourTarget(el) {
  const r = el.getBoundingClientRect();
  const top = appHeader ? appHeader.getBoundingClientRect().bottom : 0;
  const bar = document.getElementById('bottomBar');
  if (bar && bar.contains(el)) return; // 底部分類列一直在畫面上，不用捲
  const bottom = bar ? bar.getBoundingClientRect().top : window.innerHeight;
  if (r.top < top + 8) window.scrollBy(0, r.top - top - 16);
  else if (r.bottom > bottom - 8) window.scrollBy(0, r.bottom - bottom + 16);
}
function tourViewport() {
  const v = window.visualViewport;
  return { top: v ? v.offsetTop : 0, height: v ? v.height : window.innerHeight, width: v ? v.width : window.innerWidth };
}
function tourShownTarget() {
  if (!tour || !tour.shown) return null;
  for (const selector of tour.shown.split(',')) {
    const el = document.querySelector(selector.trim());
    if (el) return el;
  }
  return null;
}
function placeTour() {
  const box = document.getElementById('tour');
  if (!box || !tour) return;
  const hole = box.querySelector('.tour-hole');
  const tip = box.querySelector('.tour-tip');
  const root = document.documentElement;
  const viewport = tourViewport();
  const viewBottom = viewport.top + viewport.height;
  const wide = viewport.width >= 600 && viewport.height < 500;
  root.classList.toggle('tour-wide', wide);
  root.style.setProperty('--tour-viewport-height', `${viewport.height}px`);
  root.style.setProperty('--tour-viewport-top', `${viewport.top}px`);
  const whereDemo = tour.shown === '#whereSheet' && !!whereDog;
  const detailDemo = tour.shown === '#detail' && !!detailDog;
  // 籠位面板固定在底部，先替上方說明卡留空間，再量面板位置（小螢幕也不重疊）。
  root.classList.toggle('tour-where-demo', whereDemo);
  root.classList.toggle('tour-detail-demo', detailDemo);
  root.style.setProperty('--tour-tip-height', `${tip.offsetHeight}px`);
  const el = tourShownTarget() || tourTarget(tour.step);
  box.classList.toggle('no-target', !el);
  if (!el) { tip.style.top = ''; return; }
  if (!whereDemo && !detailDemo && el.closest('#main') && el.getBoundingClientRect().top < (appHeader ? appHeader.getBoundingClientRect().bottom : viewport.top) + 8) scrollTourTarget(el);
  const r = el.getBoundingClientRect();
  const pad = 6;
  // 只亮畫面裡看得到的部分（換到我溜過、找狗時亮整個內容區）
  const top = Math.max(r.top - pad, viewport.top), bottom = Math.min(r.bottom + pad, viewBottom);
  const rect = [r.left - pad, top, r.width + pad * 2, Math.max(bottom - top, 0)].map(v => `${Math.round(v)}px`);
  if (hole.dataset.rect !== rect.join()) { // 位置沒變就不動，免得每一格都重排
    hole.dataset.rect = rect.join();
    Object.assign(hole.style, { left: rect[0], top: rect[1], width: rect[2], height: rect[3] });
  }
  const h = tip.offsetHeight;
  let y;
  if (wide) y = viewport.top + (viewport.height - h) / 2;
  else if (whereDemo || detailDemo) y = viewport.top + 12;
  else if (r.bottom + pad + 12 + h <= viewBottom - 12) y = r.bottom + pad + 12;
  else if (r.top - pad - 12 - h >= viewport.top + 12) y = r.top - pad - 12 - h;
  else if (bottom - top > viewport.height * 0.55) y = viewBottom - h - 96;
  else if (r.top + r.height / 2 < viewport.top + viewport.height / 2) y = r.bottom + pad + 12;
  else y = r.top - pad - 12 - h; // 在下半部（例如底部分類列），小框放上面
  const tipTop = `${Math.round(Math.max(viewport.top + 12, Math.min(viewBottom - h - 12, y)))}px`;
  if (tip.style.top !== tipTop) tip.style.top = tipTop;
}
// 導覽開著時每一格都重新對位置（K 2026-10-09 黃框歪了）：頁首範圍字晚一格出現、狗卡重畫、在哪面板滑上來，
// 內容都會移動，只在捲動、重畫時對一次會跟不上
let tourFrame = 0;
function tourLoop() {
  if (!tour) { tourFrame = 0; return; }
  placeTour();
  tourFrame = requestAnimationFrame(tourLoop);
}
function queueTour() { if (tour && !tourFrame) tourFrame = requestAnimationFrame(tourLoop); }
function renderTour(stepChanged = false) {
  let box = document.getElementById('tour');
  document.documentElement.classList.toggle('tour-open', !!tour);
  if (!tour) {
    if (box) box.remove();
    document.documentElement.classList.remove('tour-where-demo', 'tour-detail-demo', 'tour-wide');
    document.documentElement.style.removeProperty('--tour-tip-height');
    document.documentElement.style.removeProperty('--tour-viewport-height');
    document.documentElement.style.removeProperty('--tour-viewport-top');
    setOnboardInert(null);
    return;
  }
  if (!box) {
    box = document.createElement('div');
    box.id = 'tour';
    box.className = 'tour';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'tourTitle');
    document.body.appendChild(box);
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-tour]');
      if (!b || !tour) return;
      const act = b.dataset.tour;
      if (act === 'replay') { tourReset(); placeTour(); tourPlay(); return; }
      if (act === 'done') return endTour();
      tourReset();
      tour.step = act === 'next' ? tour.step + 1 : Math.max(0, tour.step - 1);
      renderTour(true);
    });
    box.addEventListener('keydown', e => {
      e.stopPropagation(); // 導覽蓋在最上面，後面網頁的按鍵處理不要接到
      if (e.key === 'Escape') endTour();
    });
  }
  setOnboardInert(box);
  queueTour();
  if (!stepChanged && box.querySelector('.tour-tip')) return placeTour(); // 資料重畫時只重新對位置
  const i = tour.step;
  const desk = typeof deskOn === 'function' && deskOn();
  // 電腦版（K 2026-10-10）：沒有溜了按鈕、照片／列表，改說勾選登記、最近 30 天
  const st = desk ? { ...TOUR_STEPS[i], title: TOUR_STEPS[i].deskTitle || TOUR_STEPS[i].title, text: TOUR_STEPS[i].deskText || TOUR_STEPS[i].text } : TOUR_STEPS[i];
  const count = tourStepCount();
  const last = i === count - 1;
  box.innerHTML = `<div class="tour-hole"></div><div class="tour-finger"></div>
    <div class="tour-tip">
      <div class="tour-head"><h2 id="tourTitle" tabindex="-1">${esc(st.title)}</h2><button type="button" class="tour-skip" data-tour="done">${tour.again ? '關閉' : '略過'}</button></div>
      <p>${esc(st.text)}</p>
      ${st.install ? tourInstallHtml() : ''}
      <div class="tour-foot">
        <span class="tour-n">${i + 1} / ${count}</span>
        ${st.demo ? '<button type="button" class="tour-replay" data-tour="replay">再看一次</button>' : ''}
        ${i > 0 ? '<button type="button" class="tour-back" data-tour="back">上一步</button>' : ''}
        <button type="button" class="tour-next" data-tour="${last ? 'done' : 'next'}">${last ? (tour.again ? '看完了' : '開始使用') : '下一步'}</button>
      </div>
    </div>`;
  const el = tourTarget(i);
  if (el) scrollTourTarget(el);
  placeTour();
  box.querySelector('h2').focus({ preventScroll: true }); // 換一步後讀螢幕的人才知道到了哪裡
  tourPlay();
}
// { step: 0 名字／1… 說明, text, phase: edit／saving／error／confirm, error, unknown: 表上沒有的名字,
//   walk: 名字設好後要登記的狗（按溜了才問名字）, again: 從我溜過再打開說明 }
let onboard = null;
function onboardDone() {
  try { return walkedStorage && walkedStorage.getItem(ONBOARD_KEY) === '1'; } catch (e) { return false; }
}
function nameLater() {
  try { return walkedStorage && walkedStorage.getItem(NAME_LATER_KEY) === '1'; } catch (e) { return false; }
}
function setNameLater(on) {
  try { if (walkedStorage) on ? walkedStorage.setItem(NAME_LATER_KEY, '1') : walkedStorage.removeItem(NAME_LATER_KEY); } catch (e) { /* 存不了下次再問一次 */ }
}
function needOnboard() {
  return !onboardDone() || (!nameLater() && (!loadWalkerName() || !loadMyCodes().length));
}
// 按溜了要寫進試算表、卻還沒有名字：先問名字
function needNameToWalk() {
  return !!UPLOAD_URL && sheetWriteState !== 'off' && !loadWalkerName();
}
// 自己打的名字裡，名字清單上沒有的（打錯字會寫進大家共用的試算表，送出前問一次）。
// 清單只看主清單「誰遛的」現在寫的名字（每隻狗最後一個溜的人），最近沒溜的人不在上面，所以還要查遛狗紀錄（namesToConfirm）
function unknownWalkerNames(text) {
  if (!walkerNameList.length) return [];
  const known = new Set(allWalkerNames());
  return splitWalkers(text).map(canonicalWalker).filter(n => n && !known.has(n));
}
// 自己打的名字清單上沒有：送出前確認一次
function nameConfirmHtml(o) {
  return o.phase === 'confirm' ? `<div class="ob-confirm" role="alert">${icon('alert')}<span>溜狗紀錄裡還沒有「${esc(o.unknown.join('、'))}」，沒打錯就按「確定用這個名字」。</span></div>` : '';
}
function onboardHtml() {
  const o = onboard;
  if (o.step === 0) {
    const busy = o.phase === 'saving';
    const names = walkerNameList.length > 0;
    const head = o.walk
      ? `<h1 class="ob-ask">先告訴我們你是誰</h1>
      <p class="ob-lead">「溜了」會把你的名字寫進試算表「誰遛的」。設好就幫你登記 ${esc(o.walk.map(d => d.name).join('、'))}。</p>`
      : `<div class="ob-hero">${icon('paw')}</div>
      <h1>${esc(SITE.name)}</h1>
      <p class="ob-lead">歡迎！先告訴我們你是誰。</p>`;
    const label = `<label class="ob-label" for="obInput">輸入你在試算表上登記的名字</label>${!names && isOffline() ? '<p class="ob-label-note">沒網路，不會出現推薦，請打完整的名字。</p>' : ''}`;
    const submit = busy ? '設定中…' : o.phase === 'confirm' ? '確定用這個名字' : o.walk ? '設定並登記' : '下一步';
    return `<form class="ob-page ob-name" id="obForm" autocomplete="off">
      ${head}
      ${label}
      <input type="text" id="obInput" maxlength="60" placeholder="例：小明" value="${esc(o.text)}"${busy ? ' disabled' : ''} enterkeyhint="done">
      ${obNamesHtml(o, busy)}
      <div class="ob-foot">
        ${nameConfirmHtml(o)}
        ${o.phase === 'error' ? `<div class="photo-error" role="alert">${icon('alert')}<span>${esc(o.error)}${o.walk ? '' : '。可以先按「先看看」進網站，有訊號時再設定。'}</span></div>` : ''}
        ${o.walk ? '' : '<p class="ob-small">按「溜了」時，會把這個名字寫進試算表「誰遛的」。</p>'}
        <button type="submit" class="ob-next"${busy ? ' disabled' : ''}>${submit}</button>
        <button type="button" class="ob-later" data-ob="${o.walk ? 'cancel' : 'later'}"${busy ? ' disabled' : ''}>${o.walk ? '取消' : '先看看，等一下再設定'}</button>
      </div>
    </form>`;
  }
  return '';
}
// 開頭畫面的名字按鈕（K 2026-10-04：入口的名字要能從表上已有的人選）：一人選一個（K 2026-10-08），點了填進輸入框，再點一次拿掉
// 我溜過的「修改」也用同一排（kind 'who'）。選了用框線＋右上角勾勾（不是實心藍），跟「一起溜的人」分得出來，按鈕也不會變寬
// 打字時只留符合的名字（K 2026-10-12：打第一個字就出現推薦）：開頭一樣的排前面，再來是中間有這個字的；
// 沒打字不列（K 2026-10-12：說明只留一句，打一個字才出現推薦），最近溜過的和以前溜過的（walkerOlderNames）一起找
function namesMatching(text) {
  const q = canonicalWalker(text);
  const all = allWalkerNames();
  if (!q) return [];
  return [...all.filter(n => n.startsWith(q)), ...all.filter(n => !n.startsWith(q) && n.includes(q))];
}
function obNamesHtml(o, busy, kind = 'ob') {
  if (!walkerNameList.length) return '';
  const picked = new Set([canonicalWalker(o.text)]);
  return `<div class="ob-names" data-names="${kind}">${namesMatching(o.text).map(n =>
    `<button type="button" class="with-name me-name${picked.has(n) ? ' on' : ''}" data-${kind}-name="${esc(n)}" aria-pressed="${picked.has(n)}"${busy ? ' disabled' : ''}>${esc(n)}${picked.has(n) ? icon('tick') : ''}</button>`).join('')}</div>`;
}
// 打字時只換名字那一排（整個重畫會打斷注音選字）；選字途中不換，選好字（compositionend）再換
function refreshNames(scope, o, kind, e) {
  if (e && e.isComposing) return;
  const row = scope && scope.querySelector(`[data-names="${kind}"]`);
  if (row) row.outerHTML = obNamesHtml(o, false, kind);
}
// 開頭畫面蓋住整個網站：後面的東西設成不能點、Tab 也跑不過去（inert）
function setOnboardInert(box) {
  for (const el of document.body.children) {
    if (box && el !== box && !el.inert && el.tagName !== 'SCRIPT') { el.inert = true; el.dataset.obInert = '1'; }
    if (!box && el.dataset.obInert) { el.inert = false; delete el.dataset.obInert; }
  }
}
function closeOnboard() {
  onboard = null;
  renderOnboard();
}
function renderOnboard() {
  let box = document.getElementById('onboard');
  if (!onboard) {
    if (box) box.remove();
    setOnboardInert(null);
    document.documentElement.classList.remove('onboard-open');
    return;
  }
  if (!box) {
    box = document.createElement('div');
    box.id = 'onboard';
    box.className = 'onboard';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', '開始使用');
    document.body.appendChild(box);
    box.addEventListener('click', e => {
      const nameBtn = e.target.closest('[data-ob-name]');
      if (nameBtn) {
        const n = nameBtn.dataset.obName;
        onboard.text = canonicalWalker(onboard.text) === n ? '' : n;
        if (onboard.phase === 'error' || onboard.phase === 'confirm') onboard.phase = 'edit';
        renderOnboard();
        return;
      }
      const b = e.target.closest('[data-ob]');
      if (!b) return;
      const act = b.dataset.ob;
      if (act === 'cancel') return closeOnboard();
      if (act === 'later') {
        setNameLater(true);
        if (onboardDone()) { closeOnboard(); render(); } else startTour();
      }
    });
    box.addEventListener('input', e => {
      if (!onboard || onboard.phase === 'saving' || e.target.id !== 'obInput') return;
      onboard.text = e.target.value;
      // 改了名字，之前的錯誤和「確定用這個名字」就不算了（重畫時游標留在原處）
      if (onboard.phase === 'error' || onboard.phase === 'confirm') { onboard.phase = 'edit'; renderOnboard(); }
      else refreshNames(box, onboard, 'ob', e);
    });
    box.addEventListener('compositionend', e => {
      if (onboard && e.target.id === 'obInput') { onboard.text = e.target.value; refreshNames(box, onboard, 'ob'); }
    });
    box.addEventListener('keydown', e => {
      e.stopPropagation(); // 開頭畫面蓋在最上面，後面網頁（在哪面板、裁切）的按鍵處理不要接到
      if (e.key !== 'Escape' || !onboard) return;
      if (onboard.walk) closeOnboard();
    });
    box.addEventListener('submit', async e => {
      e.preventDefault();
      if (onboard.phase === 'saving') return;
      const confirmed = onboard.phase === 'confirm';
      onboard.phase = 'saving';
      renderOnboard();
      if (!confirmed) {
        const o = onboard, unknown = await namesToConfirm(o.text);
        if (onboard !== o) return;
        if (unknown.length) { o.phase = 'confirm'; o.unknown = unknown; renderOnboard(); return; }
      }
      const error = await setWalkerName(onboard.text);
      if (error) { onboard.phase = 'error'; onboard.error = error; renderOnboard(); return; }
      setNameLater(false);
      const walk = onboard.walk;
      onboard = null;
      renderOnboard();
      render();
      if (walk) setWalked(walk, true);
      else if (!onboardDone()) startTour();
    });
  }
  // 重畫時正在打字的人游標不要掉（名字清單比畫面晚到也會重畫）
  const typing = document.activeElement && document.activeElement.id === 'obInput' && box.contains(document.activeElement)
    ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  document.documentElement.classList.add('onboard-open');
  setOnboardInert(box);
  const stepChanged = box.dataset.step !== String(onboard.step);
  box.dataset.step = String(onboard.step);
  box.innerHTML = onboardHtml();
  const input = box.querySelector('#obInput');
  if (input && typing && !input.disabled) {
    input.focus({ preventScroll: true });
    try { input.setSelectionRange(typing[0], typing[1]); } catch (e) { /* 有些輸入法不給設 */ }
  } else if (input && onboard.phase === 'edit' && stepChanged) {
    input.focus({ preventScroll: true }); // 名字頁只有輸入框，直接叫出鍵盤
  } else if (!box.contains(document.activeElement)) {
    (box.querySelector('h1, h2') || box).setAttribute('tabindex', '-1');
    (box.querySelector('h1, h2') || box).focus({ preventScroll: true });
  }
}
function startOnboard() {
  if (onboard || !needOnboard()) return;
  if ((loadWalkerName() && loadMyCodes().length) || nameLater()) return startTour();
  onboard = { step: 0, text: '', phase: 'edit', error: '' };
  renderOnboard();
}
// 按溜了才問名字（先看看的人）：設好直接登記這幾隻
function askNameThenWalk(dogs) {
  onboard = { step: 0, text: '', phase: 'edit', error: '', walk: dogs };
  renderOnboard();
}
// 我溜過的「說明」：回到溜狗表從第一步再看一次，不動名字
function openGuide() {
  startTour(true);
}

// 先畫出分類列與內容區的讀取中（標題、搜尋框本來就在 index.html），再背景讀 dogs.json
async function init() {
  startOnboard();
  loadWalkerNames(); // 開頭畫面的名字按鈕也要用，不等狗的資料
  loadState = 'loading';
  loadWarning = '';
  render();
  let data;
  try {
    data = await loadDogsData();
  } catch (e) {
    console.error(e);
    loadState = 'error';
    render();
    return;
  }
  applyDogsData(data);
}

// 換上讀到的 dogs.json（打開網頁時、按「更新」拿到新資料時）
let dataSyncedAt = null;
function applyDogsData(data) {
  allDogs = mergeTempCages(data.dogs);
  photoVersions = data.photoVersions || {};
  groupMap = data.groups || {};
  sheetNotes = Array.isArray(data.sheetNotes) ? data.sheetNotes : [];
  loadWarning = data.groups ? '' : '「可以一起溜」暫時讀不到，其他資訊正常。';
  // 顯示試算表最後同步的時間（不是打開網頁的時間），志工才知道資料有多新
  dataSyncedAt = data.syncedAt;
  renderUpdatedLabel();
  loadState = 'ready';
  render();
  loadMyWalks();
  loadRest();
  syncFavs();
  loadTodayWalks();
}

// 頁首的資料時間；沒網路時改寫「沒網路・資料 10/8 09:01」，志工才知道看的是舊資料、溜了寫不進試算表
function renderUpdatedLabel() {
  const el = document.getElementById('updatedLabel');
  if (!el) return;
  const t = dataSyncedAt;
  const when = t ? `${t.getMonth() + 1}/${t.getDate()} ${pad2(t.getHours())}:${pad2(t.getMinutes())}` : '';
  const off = isOffline();
  el.textContent = off ? (when ? `沒網路・資料 ${when}` : '沒網路') : when ? `資料更新 ${when}` : '';
  el.classList.toggle('offline', off);
}
window.addEventListener('offline', () => { renderUpdatedLabel(); render(); renderDetail(); });
window.addEventListener('online', () => { renderUpdatedLabel(); render(); renderDetail(); loadWalkerNames(); syncFavs(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncFavs(); });
// 今日溜狗紀錄：顯示在螢幕上時每分鐘抓；鎖螢幕、切到別的 App 時不抓，切回來超過 30 秒就馬上抓
document.addEventListener('visibilitychange', refreshTodayWalks);
if (!window.__BQ_TEST__) setInterval(refreshTodayWalks, TODAY_POLL_MS);

// ── 頁首「更新」按鈕：請 Worker 叫 GitHub 同步試算表，再等讀到的資料換新 ──
// 同步寫進 D1 約 1 分鐘（不用重新部署）；每 5 秒看一次，同步完不必再多等一輪 15 秒
// 試算表沒有新東西時 syncedAt 不會變，等滿就告訴志工已經是最新
const SYNC_POLL_MS = 5 * 1000;
const SYNC_POLL_TRIES = 48; // 5 秒 × 48 ＝ 最多等 4 分鐘
let syncing = false;

async function requestSync(btn, { pollMs = SYNC_POLL_MS, tries = SYNC_POLL_TRIES } = {}) {
  if (syncing) return;
  syncing = true;
  btn.classList.add('syncing');
  btn.setAttribute('aria-busy', 'true');
  try {
    let res = null;
    try {
      res = await fetch(`${UPLOAD_URL}/sync`, { method: 'POST' });
    } catch (e) {
      showToast('連不到更新服務，請檢查網路');
      return;
    }
    // 429 表示同一支手機剛按過，同步已經在跑，一樣等新資料
    if (!res.ok && res.status !== 429) {
      // 附上 Worker 說的原因（例：GitHub 403＝token 沒開 Actions 權限），設定出錯時才查得到
      let why = '';
      try { why = String((await res.json()).error || ''); } catch (e) { /* 沒有內容就只顯示狀態碼 */ }
      showToast(`更新失敗：${why || `HTTP ${res.status}`}`);
      return;
    }
    // ADR 0012：Worker 比對過試算表沒變，沒有叫同步，不用等
    if (res.ok && (await res.clone().json().catch(() => ({}))).unchanged) {
      showToast('試算表沒有新的修改，已經是最新的');
      return;
    }
    showToast('正在更新，約 1 分鐘');
    const before = dataSyncedAt ? dataSyncedAt.getTime() : 0;
    for (let i = 0; i < tries; i++) {
      await new Promise(r => setTimeout(r, pollMs));
      let data;
      try { data = await loadDogsData(); } catch (e) { continue; }
      if (data.syncedAt && data.syncedAt.getTime() > before) {
        applyDogsData(data);
        showToast('資料已更新');
        return;
      }
    }
    showToast('已經是最新的');
  } finally {
    syncing = false;
    btn.classList.remove('syncing');
    btn.removeAttribute('aria-busy');
  }
}

const syncBtn = document.getElementById('syncBtn');
if (syncBtn) syncBtn.addEventListener('click', () => requestSync(syncBtn));

// tests/index.html 會設定 __BQ_TEST__，只載入函式、不去讀 dogs.json
// 等 find.js、analysis.js 也載入完才開始：dogs.json 提早抓（手機開啟加速）可能比它們先到，畫面要用到它們的函式
if (!window.__BQ_TEST__) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}
