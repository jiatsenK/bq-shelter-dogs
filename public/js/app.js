import { canEdit, canShow, loadSettings } from './feature-settings.js';
import { BQApi } from './api.js';
import { BQStore } from './store.js';
import { SITE } from './site-config.js';
import { BQDetailEditor } from './detail-editor.js';
import { analysisState, appState, findState, groupStageState } from './page-state.js';
import { parseDogsData } from './dog-data.js';
import { BQDates } from './dates.js';
import { BQWelcome } from './welcome.js';
import { BQPhoto } from './photo.js';
import { findPageHtml, findZoomHide, findZoomOpen, whereHide, whereKnown, whereOpen } from './find.js';
import { BQWalkUI } from './walk-ui.js';
import { BQWalks } from './walk-flow.js';
import { BQFavorites } from './favorites.js';
import { INFO_PAGES, analysisPageHtml, hideAnalysis, restoreInfoPage, walkHistorySection } from './analysis.js';
import { createDetailEditorViewport } from './detail-viewport.js';
import { groupStageHtml, receiveGroupData, refreshGroupStage } from './group-stage.js';
import { BQTour } from './tour.js';
import { deskOn, deskWalkHtml } from './desk.js';

// 狗狗資料：試算表同步進 D1（#245），網站從 Worker 的 /api/dogs 讀；前端不直接連試算表（#32）
// 照片上傳服務（Cloudflare Worker，#47／#48）的網址。這裡只放網址，GitHub 寫入權限只在 Worker 裡，網站碰不到
// - 網站和 Worker 是同一個 Cloudflare Worker（#125）：API 就在同一個網址的 /api 底下（本機用 wrangler dev 也一樣）
// - 舊的單獨照片上傳 Worker 和舊網址的判斷 2026-10 拿掉了（舊網址只剩轉址，#129）
// 留空的話詳細資訊不顯示上傳按鈕；測試可經 appState 開關寫入。呼叫 /api 都經過 BQApi。
appState.UPLOAD_URL = BQApi.base();
const fixedCareEdits = new Map(); // 每隻狗各自的儲存狀態，關閉詳細資訊不會取消已送出的設定。
// 手機第一屏大約看得到幾張狗卡：這幾張的照片不延後載入、優先下載（#91）
const FIRST_SCREEN_CARDS = 8;
// 我最近溜過（#58）：同步時累積的遛狗紀錄（#56）。#96 起每個志工看自己的：
// 紀錄裡的 walkers 是遛的人的代號，志工在「我溜過」輸入名字、經 Worker 換成代號後記在這支手機
// 休養中（K 2026-10-09）：在網站上設定「到哪天前暫停帶出」，經 Worker 存 D1、記編輯紀錄，不碰試算表
const WALKER_CODES_KEY = BQStore.keys.walkerCodes;
const WALKER_CODE_PATTERN = /^[0-9a-f]{12}$/; // 跟 Worker 的 WALKER_CODE_LENGTH 一致
// 這間收容所的設定在 js/site-config.js（K 2026-10-10：以後其他收容所要用，只改那個檔）
// 警示關鍵字（#28）：備註含任一個，就把備註原文直接顯示在卡片第一層，字眼標紅；
// 只用來判斷要不要顯示，不改寫原文、不另外產生標籤。狗照樣留在待巡房，由志工自己判斷。
const SPECIAL_KEYWORDS = SITE.warnKeywords;
// 天數色標：0～AMBER_DAYS-1 天綠、AMBER_DAYS 天起黃、RED_DAYS 天起紅
const AMBER_DAYS = SITE.days.amber;
const RED_DAYS = SITE.days.red;

// 圖鑑（cards.html）的「去設定」連到 index.html#mine，直接打開我溜過

appState.allDogs = [];
appState.groupMap = {};
appState.activeTab = typeof location !== 'undefined' && ['#mine', '#find', '#groups'].includes(location.hash) ? location.hash.slice(1) : 'walk';
appState.groupsReturnTab = 'walk';
appState.detailDog = null; // 詳細資訊正在看的狗
appState.detailOpener = null;
appState.detailTrail = []; // 在詳細資訊裡點「可以一起溜」換過的狗（#99）：可以按「回到 ○○」一隻一隻回去
const detailEdits = BQDetailEditor.create(renderDetail);
appState.restMap = {}; // 休養中：編號 → { until: 'YYYY-MM-DD', reason }
appState.restState = 'loading'; // 初次休養設定未到齊前，不先排出不完整的溜狗表
appState.restLoaded = false; // 首次失敗後重試，必須補建可靠排序
appState.detailWalksOpen = false; // 詳細資訊的溜狗紀錄有沒有展開每一天（K 2026-10-10 減法：預設只有一行字）
appState.formerEdit = null; // 詳細資訊正在補的舊編號（#289）：{ dog, text, phase: 'edit'|'saving'|'error', error }
appState.staysEdit = null; // 詳細資訊正在改的出入所紀錄（#333）：{ dog, before, rows, phase: 'edit'|'saving'|'error', error }
appState.introEdit = null; // 詳細資訊正在改的入所介紹（K 2026-10-10 補資料）：{ dog, text, phase: 'edit'|'saving'|'error', error }
const introOverrides = {}; // 編號 → 剛存好的介紹：這台電腦不用重新讀就看到（#250 起存 D1，其他人重新整理就看得到）

// 把 dogs.json 整理成畫面用的資料。狗清單不對就丟錯（整個內容區顯示失敗）；
// 可以一起溜（groups）缺了只回 null，跟以前「常遛狗群」讀不到一樣只少這一塊

// 暫住（K 2026-10-09 阿拉丁）：試算表裡「(阿拉丁)」這種名字加括號、沒有編號的列，是同名那隻狗暫時住的籠子。
// 合成一隻：籠位換成暫住的那籠（在哪、找狗都指過去），原本的籠位記在 homeCage；括號那列不另外算一隻。
// 溜了照舊用編號＋名字寫試算表那隻狗本來的列，不受籠位影響。找不到同名的就照原樣留著
appState.restEdit = null; // 詳細資訊正在改的休養設定：{ dog, until, reason, phase: 'edit'|'saving'|'error', error }
appState.pickedBuddies = new Set(); // 詳細資訊「可以一起溜」勾選的狗（walkKey）
appState.searchQuery = '';
appState.loadWarning = '';
appState.analysisOpen = false; // 分析頁（#59）開著嗎
appState.myWalks = []; // 我遛過的紀錄（#58）：[{ id, name, date: Date, ymd }]，新到舊
appState.sheetNotes = []; // 試算表狗清單下面的異動紀錄（K 2026-10-10），dogs.json 的 sheetNotes；電腦版右欄用（js/desk.js）
appState.walksData = null; // api/walks 讀回來的原始內容；換「我是誰」時不用重讀
appState.myWalksState = 'loading'; // loading／ready／error
appState.loadState = 'loading'; // loading：還在讀 dogs.json；error：讀取失敗；ready：資料好了
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

appState.dogsRead = null;
function loadDogsData() {
  if (!appState.dogsRead) {
    const controller = new AbortController();
    let timeout;
    const expired = new Promise((_, reject) => { timeout = setTimeout(() => {
      controller.abort(); reject(new Error('讀取狗的資料逾時。'));
    }, 8000); });
    appState.dogsRead = Promise.race([fetchDogsData(controller.signal), expired]).finally(() => {
      clearTimeout(timeout); appState.dogsRead = null;
    });
  }
  return appState.dogsRead;
}
async function fetchDogsData(signal) {
  const r = await BQApi.dogs({ signal });
  if (r.error === 'network') throw new Error('連不到網站，可能是網路中斷。');
  if (r.error === 'http') throw new Error(`讀取狗的資料失敗（HTTP ${r.status}）。`);
  if (r.error) throw new Error('狗的資料格式壞掉了。');
  return parseDogsData(r.data);
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
    const date = BQDates.parseYmd(w.date);
    const id = text(w.id), name = text(w.name);
    if (!date || (!id && !name)) return;
    const key = `${id || name}|${w.date}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ id, name, date, ymd: text(w.date), i });
  });
  return list.sort((a, b) => b.date - a.date || b.i - a.i).map(({ i, ...w }) => w);
}

// 讀取用：成功回 JSON，不然丟錯（非 2xx 是 HTTP 狀態碼，其他是瀏覽器原文）
function apiData(r) {
  if (r.error === 'http') throw new Error(`HTTP ${r.status}`);
  if (r.error) throw new Error(r.message);
  return r.data;
}
async function fetchWalks() {
  return apiData(await BQApi.walks());
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
  return Object.keys((appState.walksData && appState.walksData.years) || {}).filter(y => `${y}-01` < recent && walkYears[y] !== 'ready').sort();
}
async function loadWalkYear(month, today = new Date()) {
  const year = month.slice(0, 4);
  const ver = appState.walksData && appState.walksData.years && appState.walksData.years[year];
  if (!ver || month >= recentStartMonth(today) || walkYears[year] === 'ready' || walkYears[year] === 'loading') return;
  walkYears[year] = 'loading';
  try {
    const body = apiData(await BQApi.walksYear(year, ver));
    // 近期範圍以內以 api/walks 為準；那一年更早的換成拿回來的
    const cut = `${recentStartMonth(today)}-01`;
    const old = y => w => !(String(w.date || '').startsWith(y) && String(w.date || '') < cut);
    appState.walksData = { ...appState.walksData, walks: [...appState.walksData.walks.filter(old(year)), ...(body.walks || []).filter(w => String(w.date || '') < cut)] };
    appState.myWalks = parseMyWalks(appState.walksData);
    walkYears[year] = 'ready';
  } catch (e) {
    console.error(e);
    walkYears[year] = 'error';
  }
  render();
}

async function loadMyWalks() {
  appState.myWalksState = appState.walksData ? 'ready' : 'loading';
  try {
    const data = await fetchWalks();
    const mine = parseMyWalks(data);
    appState.walksData = data;
    for (const y of Object.keys(walkYears)) delete walkYears[y];
    appState.myWalks = mine;
    appState.myWalksState = 'ready';
  } catch (e) {
    console.error(e);
    appState.myWalksState = appState.walksData ? 'ready' : 'error';
  }
  // 不在「我溜過」就只更新分類上的數字（#91）：整頁重畫會把第一屏正在載入的照片換掉
  const n = document.querySelector('#tabs [data-tab="mine"] .n');
  if (appState.activeTab !== 'mine' && !appState.analysisOpen && n) {
    const count = myWalksCount('');
    n.textContent = mineTabNumber(count);
    n.closest('button').setAttribute('aria-label', mineTabLabel(count));
  } else {
    render();
  }
}

// 分類上的數字；還沒讀好或還沒設定我是誰時不顯示（null）
function currentMyWalks(today = new Date()) {
  const list = [...appState.myWalks];
  const date = BQDates.localDateKey(today);
  for (const row of walkRegistration.today(appState.allDogs, date)) {
    const dog = row.dog;
    const at = list.findIndex(w => (dog.id ? w.id === dog.id : !w.id && w.name === dog.name) && w.ymd === date);
    if (at !== -1) list.splice(at, 1);
    if (row.mine) list.unshift({ id: dog.id || '', name: dog.name, date: BQDates.parseYmd(date), ymd: date });
  }
  return list.sort((a, b) => b.date - a.date);
}

function myWalksCount(query) {
  if (!loadMyCodes().length || appState.myWalksState !== 'ready' || appState.todayState === 'loading') return null;
  return myWalkGroups(currentMyWalks(), query).reduce((k, g) => k + g.walks.length, 0);
}
function mineTabNumber(count) {
  return count != null ? count : !loadMyCodes().length ? '' : appState.myWalksState === 'loading' || appState.todayState === 'loading' ? '…' : '—';
}
function mineTabLabel(count) {
  return count != null ? `我溜過，${count} 筆紀錄` : !loadMyCodes().length ? '我溜過' : mineTabNumber(count) === '…' ? '我溜過，紀錄讀取中' : '我溜過，紀錄暫時讀不到';
}

// ── 我是誰（#96）──
// 代號記在這支手機（跟今天已溜同一個 localStorage）；讀寫不了（無痕模式）就這次開著網頁的期間記在記憶體。
// #138 起名字（第一個寫法）也記在這支手機，按「溜了」時寫進試算表「誰遛的」用；不會送到 repo 或網站其他地方

appState.walkerCodesMemory = null;
function loadMyCodes() {
  let list = appState.walkerCodesMemory;
  try {
    list = appState.phoneStore.readJson(WALKER_CODES_KEY, list);
  } catch (e) { /* 讀不到就用記憶體裡的 */ }
  return Array.isArray(list) ? list.filter(c => WALKER_CODE_PATTERN.test(c)) : [];
}
function saveMyCodes(codes) {
  appState.walkerCodesMemory = codes.length ? [...codes] : null;
  try {
    if (appState.phoneStore && codes.length) appState.phoneStore.writeJson(WALKER_CODES_KEY, codes);
    else if (appState.phoneStore) appState.phoneStore.remove(WALKER_CODES_KEY);
  } catch (e) { /* 存不了就只記在記憶體 */ }
  try { appState.myWalks = appState.walksData ? parseMyWalks(appState.walksData, codes) : []; } catch (e) { appState.myWalks = []; }
  appState.favorites.syncFavs();
}

// 名字送 Worker 換代號：回 { codes } 或 { codes: [], error: 原因 }
async function walkerCodesFor(names) {
  let out = null;
  try {
    const r = await BQApi.walkerCodes([...new Set(names)]);
    if (r.error === 'network') throw new Error(r.message);
    out = r.data;
    if (r.error === 'http') throw new Error((out && out.error) || `HTTP ${r.status}`);
  } catch (e) {
    console.error(e);
    return { codes: [], error: out && out.error ? out.error : '連不上網路，請稍後再試' };
  }
  return { codes: out && Array.isArray(out.codes) ? out.codes.filter(c => WALKER_CODE_PATTERN.test(c)) : [] };
}
// 紀錄對到目前清單上的狗：有編號用編號，沒有才用犬名；對不到（例：已離所）回 null
function dogOfWalk(w) {
  if (w.id) return appState.allDogs.find(d => d.id === w.id) || null;
  const key = searchKey(w.name);
  return appState.allDogs.find(d => !d.id && searchKey(d.name) === key) || null;
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
      ? `<button type="button" class="mine-dog" data-mine-dog="${appState.allDogs.indexOf(dog)}" aria-label="${esc(w.name)}：看詳細資訊">${inner}</button>`
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
  const total = appState.allDogs.length;
  const pct = total ? Math.round(seen.size / total * 100) : 0;
  return `<div class="mine-progress">
    <div class="row"><span>在所的狗，你溜過</span><b>${seen.size}<small> / ${total} 隻</small></b></div>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${seen.size}" aria-label="在所的狗，你溜過 ${seen.size} 隻，共 ${total} 隻"><i style="width:${pct}%"></i></div>
  </div>`;
}

appState.mineStatsOpen = false;
appState.mineMonth = ''; // 我溜過月曆正在看的月份（YYYY-MM）；空的＝最近有紀錄的那個月
appState.mineDay = ''; // 月曆上選的那一天（YYYY-MM-DD）；空的＝那個月最近一次到所
function myWalksHtml(today, query) {
  const visibleWalks = currentMyWalks(today);
  const confirmedToday = SITE.d1WalkAccept ? walkRegistration.today(appState.allDogs, BQDates.localDateKey(today)).some(row => row.mine) : Object.values(loadSheetWrites(today)).some(item => item.current?.date === BQDates.localDateKey(today) && splitWalkers(item.current.walker).map(canonicalWalker).includes(canonicalWalker(loadWalkerName())));
  if (appState.todayState === 'loading' || (appState.myWalksState === 'loading' && !confirmedToday)) return `<div class="status-msg">讀取溜狗紀錄中…</div>`;
  if (appState.myWalksState === 'error' && !confirmedToday) {
    return `<div class="status-msg">溜狗紀錄讀不到，請確認網路後按「重新讀取」。<br><button class="retry-btn" id="mineRetry">重新讀取</button></div>`;
  }
  if (BQWelcome.needsSetup()) return BQWelcome.setupHtml();
  // #138 之前設定的只有代號、沒記名字：請他再輸入一次，按溜了才能寫進試算表
  const named = !!loadWalkerName();
  // V9（#141 第 11 項）：小計收進「統計」按鈕，按了才展開
  const statsBtn = visibleWalks.length ? `<button type="button" class="who-edit${appState.mineStatsOpen ? ' on' : ''}" id="mineStats" aria-expanded="${appState.mineStatsOpen}">${icon('chart')}統計</button>` : '';
  const who = query ? '' : `<div class="section-hint who-hint">${icon('paw')}<span class="who-name">${named ? esc(loadWalkerName()) : '再按「修改」輸入一次名字'}</span>${statsBtn}<button type="button" class="who-edit" id="whoEdit">修改</button></div>`;
  if (!visibleWalks.length) return who + `<div class="status-msg">還沒有你的溜狗紀錄。<br>試算表「誰遛的」寫上你設定的名字，同步後就會出現在這裡。</div>`;
  // 所有到所紀錄新到舊一路往下排（K 2026-09-25：不要選日期）；搜尋時不顯示小計
  const groups = myWalkGroups(currentMyWalks(), query);
  if (!groups.length) return `<div class="status-msg">找不到「${esc(query)}」</div>`;
  const stats = !query && appState.mineStatsOpen ? `<div class="mine-stats-box">${myProgressHtml(visibleWalks)}${myMonthStats(visibleWalks, today)}</div>` : '';
  // 標題層級（critique 2026-10-09）：頁首 h1 下面先有 h2，每次到所的 h3 才不會跳號
  // 搜尋時照舊一路往下列；平常是一個月一張月曆、點哪天看那天溜的狗（K 2026-10-10：常來的志工頁面太長）
  if (query) return '<h2 class="sr-only">我溜過的紀錄</h2>' + groups.map(g => myVisitCard(g)).join('');
  return '<h2 class="sr-only">我溜過的紀錄</h2>' + who + stats + myCalendarHtml(groups, today);
}

// 我溜過的月曆：有來的那幾天塗檔案綠、寫溜幾隻；點了下面換成那天溜的狗。可以往前翻到最早有紀錄的那個月
function myCalendarState(groups, today) {
  const months = [...new Set(groups.map(g => g.ymd.slice(0, 7)))].sort();
  const nowMonth = BQDates.localDateKey(today).slice(0, 7);
  // 還有沒拿的年份：可以翻到那年 1 月，翻到了再拿（#346）
  const missing = missingWalkYears(today)[0];
  const first = [months[0] || nowMonth, ...(missing ? [`${missing}-01`] : [])].sort()[0];
  // 拿回來那年比翻到的月份晚開始：停在最早有紀錄的那個月，不跳回最近
  let month = appState.mineMonth && appState.mineMonth <= nowMonth ? (appState.mineMonth >= first ? appState.mineMonth : first) : (months[months.length - 1] || nowMonth);
  const inMonth = groups.filter(g => g.ymd.slice(0, 7) === month); // 新到舊
  const day = inMonth.some(g => g.ymd === appState.mineDay) ? appState.mineDay : (inMonth[0] ? inMonth[0].ymd : '');
  return { month, first, nowMonth, inMonth, day };
}
function myCalendarHtml(groups, today) {
  const { month, first, nowMonth, inMonth, day } = myCalendarState(groups, today);
  const y = +month.slice(0, 4), m = +month.slice(5, 7);
  const byDay = new Map(inMonth.map(g => [g.ymd, g]));
  const lead = new Date(y, m - 1, 1).getDay(), total = new Date(y, m, 0).getDate();
  const todayKey = BQDates.localDateKey(today);
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
  return BQDates.parseYmd(walkRegistration.state(dog, BQDates.localDateKey(today)).date);
}

function computeStatus(dog, today) {
  const rest = restOf(dog, today);
  if (rest) return { kind: 'rest', ...rest };
  if (dog.covered) return { kind: 'covered' };
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
  return { kind: 'unknown' };
}

// 休養中：今天還在設定的日期以內（含那一天）才算；過了自動恢復
function restOf(dog, today = new Date()) {
  const r = dog && dog.id && appState.restMap[dog.id];
  const until = r && BQDates.parseYmd(r.until);
  if (!until) return null;
  const day = BQDates.makeDate(today.getFullYear(), today.getMonth() + 1, today.getDate());
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
appState.photoVersions = {}; // 照片路徑（photos/...）→ 內容雜湊，來自 /api/dogs 的 photoVersions
function versioned(path) {
  const v = appState.photoVersions[path];
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

appState.lightboxOpener = null;
appState.lightboxView = null; // { dog, src }
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
  appState.lightboxView = { dog, src: photoSrc(dog) };
  el.setAttribute('aria-label', `${dog.name} 的照片`);
  showLightboxPhoto();
  appState.lightboxOpener = opener || document.activeElement;
  el.hidden = false;
  document.documentElement.classList.add('lightbox-open');
  // 手機按「返回」時只關掉燈箱
  history.pushState({ bqPhoto: true }, '');
  el.querySelector('.lightbox-close').focus({ preventScroll: true });
}

// 畫出照片，和下方列（裁切）
function showLightboxPhoto() {
  const el = document.getElementById('lightbox');
  const v = appState.lightboxView;
  if (!el || !v) return;
  const img = el.querySelector('img');
  img.src = v.src;
  img.alt = `${v.dog.name} 的照片`;
  const bar = el.querySelector('.lightbox-bar');
  bar.innerHTML = appState.UPLOAD_URL && appState.detailDog === v.dog && !v.dog.departure ? `<button type="button" class="lightbox-delete" id="mainCropBtn">${icon('crop')}裁切</button>` : '';
  bar.hidden = !bar.querySelector('button');
  const cropBtn = bar.querySelector('#mainCropBtn');
  if (cropBtn) cropBtn.addEventListener('click', () => BQPhoto.cropMain(v.dog));
}

function hideLightbox() {
  const el = document.getElementById('lightbox');
  if (!el || el.hidden) return;
  el.hidden = true;
  el.querySelector('img').removeAttribute('src');
  appState.lightboxView = null;
  document.documentElement.classList.remove('lightbox-open');
  const opener = appState.lightboxOpener;
  appState.lightboxOpener = null;
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

// 卡片天數比照列表：今天／X天；完整意思保留給輔助閱讀。
function lastWalk(dog, today) {
  const s = computeStatus(dog, today);
  let text = '沒有紀錄', level = 'muted', small = false;
  if (s.kind === 'dated') {
    if (s.days < 0) text = '日期看不懂';
    else {
      text = `<b>${s.days === 0 ? '今天' : s.days}</b>${s.days > 0 ? '<span class="last-unit">天</span>' : ''}`;
      level = s.level;
    }
  } else if (s.kind === 'rest') {
    text = `<span class="nowrap">休養中</span><span class="nowrap rest-until">到 ${monthDay(s.until)}</span>`; level = 'rest'; small = true;
  } else if (s.kind === 'covered') {
    // 窄螢幕放不下一行時只在「有人固定｜照顧」之間換行，不會剩一個「顧」字
    text = '<span class="nowrap">有人固定</span><span class="nowrap">照顧</span>'; level = 'sage'; small = true;
  }
  return `<div class="last"${s.kind === 'dated' && s.days >= 0 ? ` data-days="${s.days}"` : ''}>${s.kind === 'dated' && s.days >= 0 ? '<span class="sr-only">上次溜</span>' : ''}<span class="val ${level}${small ? ' small' : ''}">${text}</span>${s.kind === 'dated' && s.days > 0 ? '<span class="sr-only">前</span>' : ''}</div>`;
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

const ymdOf = d => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;

// 舊編號（#75、#289）：編號下面一行「舊編號 …・最早入所 YYYY/M/D」，每個舊編號旁邊一個 ✕ 可以刪；
// 換新編號就是再入所（GLOSSARY），但畫面不標第幾次入所（K 2026-10-16）。
// 最後一個「補舊編號」，點了原地變輸入框。誰都能補、都能刪（ADR 0005），要先選好名字（ADR 0004），離所的狗只看不改
function reentryLine(dog) {
  const former = dog.formerIds || [];
  const can = canEdit('editFormer') && !!(dog.id && appState.UPLOAD_URL) && !dog.departure;
  const first = BQDates.firstIntake(dog);
  const list = former.map(f => `<span class="former-num">${esc(f)}${can ? `<button type="button" class="former-del" data-former-del="${esc(f)}" aria-label="刪掉舊編號 ${esc(f)}">✕</button>` : ''}</span>`).join('');
  const e = appState.formerEdit && appState.formerEdit.dog === dog ? appState.formerEdit : null;
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
  if (!dog || !dog.id || !appState.UPLOAD_URL) return;
  appState.formerEdit = detailEdits.open(dog, { text: '' });
  renderDetail();
  const box = document.getElementById('formerText');
  if (box) box.focus({ preventScroll: true });
}

// 補或刪舊編號（method 由呼叫的人給）；回空字串是成功，不然是要給人看的原因
async function sendFormer(dog, former, method) {
  const r = await BQApi.saveFormer(dog.id, method, { editor: editorName(), former });
  if (r.error === 'network') return '沒有存進去，請確認網路後再試';
  const out = r.data;
  if (!r.ok || !out || !out.ok) return (out && out.error) || `沒有存進去（${r.status}），請稍後再試`;
  return '';
}

// 存好就改這台的狗資料，天數、排序馬上重算
async function saveFormer() {
  const e = appState.formerEdit;
  if (!e || e.phase === 'saving') return;
  const former = e.text.replace(/\s+/g, '');
  if (!/^\d{10}$/.test(former) || !BQDates.idDate(former)) { detailEdits.fail(e, '舊編號要是 10 碼數字，前 8 碼是入所日期'); return; }
  if (!editorName()) { detailEdits.fail(e, NEED_EDITOR); return; }
  detailEdits.saving(e);
  const error = await sendFormer(e.dog, former, 'POST');
  if (appState.formerEdit !== e) return;
  if (error) {
    detailEdits.fail(e, error);
    const b = document.getElementById('formerText');
    if (b) b.focus({ preventScroll: true });
    return;
  }
  e.dog.formerIds = [...(e.dog.formerIds || []), former].sort();
  appState.formerEdit = null;
  render(); renderDetail();
  BQWalkUI.showToast(`${e.dog.name} 補上舊編號 ${former}，入所日改從 ${ymdOf(BQDates.firstIntake(e.dog))} 算`);
}

async function removeFormer(dog, former) {
  if (!editorName()) { BQWalkUI.showToast(NEED_EDITOR); return; }
  if (!confirm(`刪掉 ${dog.name} 的舊編號 ${former}？`)) return;
  const error = await sendFormer(dog, former, 'DELETE');
  if (error) { BQWalkUI.showToast(error); return; }
  dog.formerIds = (dog.formerIds || []).filter(f => f !== former);
  render(); if (appState.detailDog === dog) renderDetail();
  BQWalkUI.showToast(`已刪掉 ${dog.name} 的舊編號 ${former}`);
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
// 只存在瀏覽器 localStorage，不寫 GitHub、不用登入；#138 起另外寫進試算表（見 BQWalkUI.sheetWrite）。
// 存成 { date: '2026-09-24', ids: [編號…] }（本地日期＋狗狗編號）：日期不是今天就當作沒有紀錄，
// 所以隔天自動全部未勾選；前一天的紀錄不用刪，下次記錄時直接蓋掉。
// 無痕模式等讀寫不了 localStorage 時，至少這次開著網頁的期間還記得

appState.phoneStore = BQStore;
appState.walkRecords = BQWalks.createRecords({ store: () => appState.phoneStore, dates: BQDates, key: walkKey });
function loadWalkedIds(today = new Date()) { return appState.walkRecords.loadWalkedIds(today); }

function saveWalkedIds(ids, today = new Date()) { return appState.walkRecords.saveWalkedIds(ids, today); }

// 今天已溜用編號記；新來還沒有編號的狗改用犬名記（K 說不會有同名的狗）
function walkKey(dog) {
  if (dog.id) return dog.id;
  return dog.name ? `名:${dog.name}` : '';
}

// 今天名單包含自己就算已登記；本機暫存只用於尚未收到寫入結果時。
function walkedNow(dog, today = new Date()) {
  return walkRegistration.state(dog, BQDates.localDateKey(today)).mine;
}

// 今天已溜的查詢入口（#85）：讀一次這支手機今天的紀錄，之後問「這隻溜了沒」、排今天已溜清單都用它，
// 不用再把編號陣列傳來傳去
function walkedToday(today = new Date()) {
  const ids = loadWalkedIds(today);
  const has = dog => walkedNow(dog, today);
  return {
    has,
    // 今天已溜清單：最近記的排最上面
    dogs: list => list.filter(has).sort((a, b) => ids.indexOf(walkKey(a)) - ids.indexOf(walkKey(b))),
  };
}

// 加入（on=true）或移回（on=false）今天已溜；連犬名都沒有的狗記不了，直接略過，新加入的排在最上面。
// 回傳真的有變的狗和 undo（回到記之前的樣子）；都沒變就不寫入
function recordWalked(dogs, on, today = new Date()) { return appState.walkRecords.recordWalked(dogs, on, today); }

// 我的常溜的快取、排隊及同步由 favorites.js 管理。

// ── 按「溜了」寫進試算表（#138）──
// 經過 Worker 的 /walk 轉給 K 部署的 Google Apps Script，只改主清單的「遛狗日期」「誰遛的」。
// 寫成功的記下試算表原本的內容（只記今天的），復原或放回時帶回去改回來；小程式只在格子還是我們寫的樣子時才改回。
// Worker 還沒設定（回 code: 'off'）就照舊只記在手機上，不打擾
appState.favorites = BQFavorites.create();
const WALKER_NAME_KEY = BQStore.keys.walkerName;
// 跟 worker/src/sheet-read.js 的 NAME_SEP 一樣
const WALKER_NAME_SEP = /[、,，\/／&＆+＋。｡．.;；:：|｜·・\s]+/;

// ── 誰遛的名字（#141 第 9 項）──
// 名字不放進公開的 repo（dogs.json 只有代號）：打開網頁時跟 Worker 拿（GET /api/walkers，Worker 從 D1 讀，#519），
// 只在畫面上顯示。{ 狗的 key: '嘉文+俐葶+岑' }；拿不到就不顯示名字，其他照常

appState.walkerNameMemory = '';
appState.sheetWriteState = 'unknown'; // unknown／on／off
appState.sheetQueue = Promise.resolve();
appState.walkerNames = {};
appState.walkerDates = {}; // 試算表現在的「遛狗日期」（狗的 key → 'YYYY-MM-DD'）：直接改試算表也 1 分鐘內看到（K 2026-10-20）
appState.walkerNameList = []; // 表上出現過的名字（開頭畫面讓志工點選自己，#141）
appState.walkerOlderNames = []; // 以前溜過、現在表上沒有的名字（Worker 記下來的，K 2026-10-12）：打字時才推薦
appState.walkerCodeNames = {}; // 代號 → 名字（Worker 用名單換的，K 2026-10-12）：電腦版最近 30 天寫每天誰遛的
const allWalkerNames = () => [...new Set([...appState.walkerNameList, ...appState.walkerOlderNames])];
// 介面評估第三輪（K 2026-10-08）：沒網路時要告訴志工，不然溜狗人只有「—」、頁首照樣寫資料更新時間。
// 手機說離線，或拿溜狗人名字時連不上（不是 Worker 回錯誤），就當作沒網路

appState.walkerNamesOffline = false;
function isOffline() {
  return appState.walkerNamesOffline || (typeof navigator !== 'undefined' && navigator.onLine === false);
}
function setWalkerNamesOffline(on) {
  if (appState.walkerNamesOffline === on) return;
  appState.walkerNamesOffline = on;
  renderUpdatedLabel();
  render();
  renderDetail();
}
async function loadWalkerNames() {
  if (!appState.UPLOAD_URL) return;
  const read = walkRegistration.beginRead();
  const r = await BQApi.walkers();
  if (r.error === 'network') {
    console.error(r.message);
    setWalkerNamesOffline(true);
    return;
  }
  setWalkerNamesOffline(false);
  try {
    if (r.error === 'http') return;
    const out = apiData(r);
    if (out && out.walkers && typeof out.walkers === 'object') {
      appState.walkerNames = out.walkers;
      appState.walkerDates = out.dates && typeof out.dates === 'object' ? out.dates : {};
      appState.walkerNameList = [...new Set((Array.isArray(out.names) ? out.names : []).map(canonicalWalker).filter(Boolean))];
      appState.walkerOlderNames = [...new Set((Array.isArray(out.older) ? out.older : []).map(canonicalWalker).filter(Boolean))];
      appState.walkerCodeNames = out.codes && typeof out.codes === 'object' ? out.codes : {};
      walkRegistration.receiveNames(out.walkers, appState.allDogs, read, appState.walkerDates, Date.parse(out.readAt) || read.at);
      render();
      renderDetail();
      BQWelcome.refresh();
    }
  } catch (e) { console.error(e); }
}
// 今日紀錄只負責傳輸；新舊順序與狀態套用交給共用登記模組（ADR 0007）。
const TODAY_POLL_MS = 60 * 1000;
const TODAY_REFETCH_MS = 30 * 1000;

// 排序需要的兩份狀態不能無限等待；包含讀取回應內容的時間。
appState.todayFetchedAt = 0;
appState.todayState = 'loading'; // 初次請求完成後才呈現完整狀態；失敗沿用同步資料
function fetchWalkStatus(call) { return BQWalks.fetchStatus(call); }
async function loadTodayWalks() {
  appState.todayFetchedAt = Date.now();
  const received = await walkRegistration.loadToday(() => appState.allDogs);
  if (appState.todayState === 'loading' && (!SITE.d1WalkAccept || received)) { appState.todayState = 'ready'; render(); }
}
function refreshTodayWalks() {
  if (typeof document !== 'undefined' && document.hidden) return;
  if (Date.now() - appState.todayFetchedAt < TODAY_REFETCH_MS) return;
  loadTodayWalks();
  // 試算表名單也每分鐘重讀：直接改試算表的也要同步（K 2026-10-20）。
  // #460：D1 模式人工改表由伺服器比對後進 D1 資料包，手機不再每分鐘讀試算表名單
  if (!SITE.d1WalkAccept) loadWalkerNames();
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
  return walkRegistration.state(dog, BQDates.localDateKey(today)).walkers;
}

// ── 一起溜的人（#141 第 1 項，K：溜了要怎麼寫除了我以外的人）──
// 按溜了先寫自己；提示條「＋一起溜的人」選名字，再寫進試算表同一格（小程式用「、」接在後面）。
// 最近一起溜過的名字記在這支手機，下次排在前面一點就加；今天每隻狗加了誰也記著，畫面上顯示用
function loadCompanions() { return appState.walkRecords.loadCompanions(); }
function loadWalkWith(today = new Date()) { return appState.walkRecords.loadWalkWith(today); }
function addWalkWith(dogs, names, today = new Date()) { return appState.walkRecords.addWalkWith(dogs, names, today); }
function clearWalkWith(dogs, today = new Date()) { return appState.walkRecords.clearWalkWith(dogs, today); }
function firstWalkerName(text) {
  return String(text || '').split(WALKER_NAME_SEP).map(n => n.trim()).filter(Boolean)[0] || '';
}
function loadWalkerName() {
  try {
    if (appState.phoneStore) return (appState.phoneStore.get(WALKER_NAME_KEY) || '').trim();
  } catch (e) { /* 讀不到就用記憶體裡的 */ }
  return String(appState.walkerNameMemory || '').trim();
}
function saveWalkerName(name) {
  appState.walkerNameMemory = name || '';
  try {
    if (appState.phoneStore && name) appState.phoneStore.set(WALKER_NAME_KEY, name);
    else if (appState.phoneStore) appState.phoneStore.remove(WALKER_NAME_KEY);
  } catch (e) { /* 存不了就只記在記憶體 */ }
}
// { date: 今天, items: { 狗的 key: { id, name, prev, wrote } } }，不是今天的就丟掉
function loadSheetWrites(today = new Date()) { return appState.walkRecords.loadSheetWrites(today); }
function saveSheetWrites(items, today = new Date()) { return appState.walkRecords.saveSheetWrites(items, today); }

function myAliasIn(dog, today = new Date()) {
  const me = loadWalkerName();
  if (!me || !dog.walkedDate || BQDates.localDateKey(dog.walkedDate) !== BQDates.localDateKey(today)) return null;
  return splitWalkers(appState.walkerNames[walkKey(dog)]).find(n => n !== me && canonicalWalker(n) === canonicalWalker(me)) || null;
}

// walker：加「一起溜的人」時傳那幾個名字（試算表那格已經有今天的名字，小程式會用「、」接在後面）
// 回傳 true：寫進去了；false：沒寫進去且已跳提示；null：沒送
// 畫面提供當下身分與狗清單；HTTP、手機紀錄與結果分類由 BQWalks 處理。
const walkRegistration = BQWalks.create({
  get d1() { return SITE.d1WalkAccept; },
  records: () => appState.walkRecords, store: () => appState.phoneStore, api: BQApi, dates: BQDates,
  enabled: () => !!appState.UPLOAD_URL,
  getWriteState: () => appState.sheetWriteState, setWriteState: state => { appState.sheetWriteState = state; },
  key: walkKey, date: () => BQDates.localDateKey(new Date()), walker: loadWalkerName, alias: myAliasIn,
  canonical: canonicalWalker, split: splitWalkers,
  names: () => loadMyCodes().map(code => appState.walkerCodeNames[code]).filter(Boolean),
  base: dog => SITE.d1WalkAccept ? d1Base(dog) : ({ date: Object.hasOwn(appState.walkerDates, walkKey(dog)) ? appState.walkerDates[walkKey(dog)] : (dog.walkedDate ? BQDates.localDateKey(dog.walkedDate) : ''), walker: appState.walkerNames[walkKey(dog)] || '' }),
  syncedAt: () => appState.dataSyncedAt?.getTime() || 0,
  apply: () => { render(); renderDetail(); },
});
// #460：還沒經過新流程的狗，用 D1 狗清單（同步進 D1 的主清單）的日期與代號，不用試算表即時名單
function d1Base(dog) {
  const walker = [...new Set((Array.isArray(dog.walkers) ? dog.walkers : []).map(code => appState.walkerCodeNames[code]).filter(Boolean))].join('、');
  return { date: dog.walkedDate ? BQDates.localDateKey(dog.walkedDate) : '', walker };
}
// 開放編輯（ADR 0004）：不用通關碼，送出時帶這支手機選好的名字，Worker 記進編輯紀錄（edits.html）
const NEED_EDITOR = '請先選好你的名字再編輯（開頭畫面點自己的名字）';
const editorName = () => loadWalkerName();
const editorHeaders = () => ({ 'X-Editor': encodeURIComponent(editorName()) });

// ── 加備註、新增異動紀錄（#239、#281）：只追加，寫進試算表前先預覽；日期用台灣時間、名字用「我是誰」 ──
// 狗卡在「試算表備註」下面，異動紀錄只在電腦版右欄（K 2026-10-16）
const APPEND_MAX = 200;
appState.sheetAppend = null; // { kind: 'note'|'log', dog, text, phase: 'edit'|'preview'|'busy', error }
function appendEntry(text, who) { return `${BQDates.taipeiStamp()}${text.trim()}（${who}）`; }
function nextLogLabel() {
  const nums = (typeof appState.sheetNotes !== 'undefined' ? appState.sheetNotes : []).map(n => Number((String(n.label).match(/^備註\s*(\d+)/) || [])[1]) || 0);
  return `備註${Math.max(0, ...nums) + 1}`;
}
function appendPreview(a, who) {
  const entry = appendEntry(a.text, who);
  if (a.kind === 'log') return `<div class="append-preview"><span class="append-label">${esc(nextLogLabel())}</span>${esc(entry)}</div>`;
  const now = a.dog.note || '';
  return `<div class="append-preview note-text">${now.trim() ? `${esc(now)};` : ''}<mark>${esc(entry)}</mark></div>`;
}
function sheetAppendHtml(kind, dog = null) {
  if (!appState.UPLOAD_URL || appState.sheetWriteState === 'off' || (dog && dog.departure)) return '';
  const a = appState.sheetAppend && appState.sheetAppend.kind === kind && appState.sheetAppend.dog === dog ? appState.sheetAppend : null;
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
  const a = appState.sheetAppend;
  const who = loadWalkerName();
  if (!a || a.phase !== 'preview' || !who) return;
  a.phase = 'busy'; a.error = '';
  rerenderAppend(a.kind);
  const payload = { action: a.kind, walker: who, editor: who, text: a.text.trim(), dogs: a.kind === 'note' ? [{ id: a.dog.id || '', name: a.dog.name }] : [] };
  const res = await BQApi.walk(payload);
  const out = res.data;
  if (appState.sheetAppend !== a) return;
  const r = out && out.ok && Array.isArray(out.results) ? out.results[0] : null;
  if (!r || r.status !== 'written') {
    a.phase = 'preview';
    a.error = res.error === 'network' ? '網路不通，沒寫進試算表，請稍後再試' : r && r.status === 'notFound' ? '試算表找不到這隻狗，沒寫進去' : `沒寫進試算表：${(out && out.error) || `HTTP ${res.status}`}`;
    rerenderAppend(a.kind);
    return;
  }
  appState.sheetAppend = null;
  if (a.kind === 'note') a.dog.note = r.wrote.note;
  else if (typeof appState.sheetNotes !== 'undefined') appState.sheetNotes.push({ label: r.wrote.label, text: r.wrote.text });
  rerenderAppend(a.kind);
  BQWalkUI.showToast(a.kind === 'note' ? `已加進 ${a.dog.name} 的試算表備註` : '已加進異動紀錄');
}

// 所有分頁、搜尋、籠位共用這張卡片。第一層只放照片、犬名、天數、籠位｜編號，
// 備註命中警示關鍵字才把原文放上來；一般備註、可一起遛、狗卡資訊點卡片看詳細資訊
// eager：第一屏的卡片（#91），照片不等延後載入、優先下載
function dogCard(dog, today, eager = false) {
  const flag = specialFlag(dog.note);
  return `
    <div class="card${flag ? ' flagged' : ''}" data-dog="${appState.allDogs.indexOf(dog)}" role="button" tabindex="0" aria-haspopup="dialog">
      ${photoThumb(dog, 56, false, eager)}
      <div class="body">
        <div class="row">
          <div class="who">
            <div class="name">${esc(dog.name)}${sexMark(dog)}</div>
            ${cardMeta(dog)}
          </div>
          ${lastWalk(dog, today)}
          ${BQWalkUI.walkButton(dog)}
        </div>
        ${BQWalkUI.walkSyncHtml(dog)}
      </div>
      ${flag ? warnNote(dog.note, flag) : ''}
    </div>
  `;
}

// 詳細資訊：備註（志工後續補充，試算表備註欄）／可以一起溜的狗／狗卡資訊（dogs/{編號}.md 的入所原始介紹，同步時已寫進 dogs.json）
// 詳細資訊名字旁的「☆ 常溜」／「★ 我的常溜」
function favButtonHtml(dog) {
  if (!walkKey(dog) || dog.departure) return '';
  const on = appState.favorites.isFav(dog);
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
      ${BQPhoto.heroHtml(dog)}
      ${BQPhoto.uploadHtml(dog)}
      <div class="info">
        <div class="name-row"><h2 class="name" id="detailName">${esc(dog.name)}${sexMark(dog)}</h2>${favButtonHtml(dog)}</div>
        <div class="chips">${statusBadge(dog, today)}${detailChips(dog)}</div>
        ${metaLine(dog)}
        ${restNoteHtml(dog, today)}
      </div>
    </div>
    ${lastWalkSection(dog, today)}
    ${appState.detailTrail.length ? `<button type="button" class="detail-back" id="detailBack">${icon('back')}回到 ${esc(appState.detailTrail[appState.detailTrail.length - 1].name)}</button>` : ''}
    <section class="detail-section" data-section="note">
      <h3>${icon('note')}試算表備註</h3>
      ${!dog.note ? `<div class="empty">目前沒有備註</div>`
        : `<div class="content note-text">${flag ? highlightNote(dog.note, flag.terms) : esc(dog.note)}</div>`}
      ${sheetAppendHtml('note', dog)}
    </section>
    ${togetherSection(dog, walked)}
    ${walkHistorySection(dog, today)}
    ${introSectionHtml(dog, intro)}
    ${fixedCareHtml(dog)}
    ${restAdminHtml(dog, today)}
    ${BQPhoto.barHtml(dog) || introBarHtml(dog) || `<div class="detail-bar">
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
function fixedCareHtml(dog) {
  if (!canEdit('editFixedCare') || !(dog.id || dog.dogId) || dog.departure || !appState.UPLOAD_URL) return '';
  const state = fixedCareEdits.get(dog.id || dog.dogId);
  const busy = state?.busy;
  return `<section class="detail-section fixed-care" data-section="fixed-care">
    <div class="fixed-care-row">
      <span id="fixedCareLabel">有人固定照顧</span>
      <button type="button" id="fixedCareToggle" class="care-switch" role="switch" aria-labelledby="fixedCareLabel" aria-describedby="fixedCareHint" aria-checked="${dog.covered ? 'true' : 'false'}"${busy ? ' disabled aria-busy="true"' : ''}>
        <span class="care-switch-state" aria-hidden="true">${dog.covered ? '開啟' : '關閉'}</span><span class="care-switch-track" aria-hidden="true"></span>
      </button>
    </div>
    <p class="rest-hint" id="fixedCareHint">所有人共用。開啟後排在一般待溜狗之後、不計入天數統計，仍可溜。</p>
    ${busy ? '<p class="rest-hint" role="status">儲存中…</p>' : ''}
    ${state?.error ? `<p class="photo-error" role="alert">${esc(state.error)}</p>` : ''}
  </section>`;
}

async function toggleFixedCare(dog) {
  const key = dog?.id || dog?.dogId;
  if (!key || fixedCareEdits.get(key)?.busy) return;
  const editor = editorName();
  if (!editor) {
    fixedCareEdits.set(key, { error: NEED_EDITOR });
    renderDetail();
    return;
  }
  const enabled = !dog.covered;
  const state = { busy: true, error: '' };
  fixedCareEdits.set(key, state);
  renderDetail();
  try {
    const r = await BQApi.saveFixedCare(key, { editor, enabled });
    if (r.error === 'network') throw new Error(r.message);
    const out = r.data;
    if (!r.ok || !out?.ok || out.enabled !== enabled) throw new Error(out?.error || '沒有存進去，請稍後再試');
    dog.covered = enabled;
    for (const current of appState.allDogs) if ((current.id || current.dogId) === key) current.covered = enabled;
    if (appState.detailDog && (appState.detailDog.id || appState.detailDog.dogId) === key) appState.detailDog.covered = enabled;
    BQWalkUI.showToast(`${dog.name} 的固定照顧已${enabled ? '開啟' : '關閉'}`);
    render();
  } catch (e) {
    state.error = e.message === 'Failed to fetch' ? '沒有存進去，請確認網路後再試' : e.message;
  } finally {
    state.busy = false;
    if (appState.detailDog && (appState.detailDog.id || appState.detailDog.dogId) === key) {
      renderDetail();
      document.getElementById('fixedCareToggle')?.focus({ preventScroll: true });
    }
  }
}

function restAdminHtml(dog, today) {
  if (!canEdit('editRest')) return '';
  if (!dog.id || !appState.UPLOAD_URL) return '';
  const r = restOf(dog, today);
  const e = appState.restEdit && appState.restEdit.dog === dog ? appState.restEdit : null;
  if (!e) {
    // 管理用（K 2026-10-10）：只剩設定休養中；入所介紹直接點那一段就能改。正在改介紹時先收起來
    if (appState.introEdit && appState.introEdit.dog === dog) return '';
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
// #390：僅整理閱讀畫面，不修改原介紹、stays 或入所日算法。
function intakePresentation(dog, intro) {
  const events = intakeEventsOf(dog).map(e => ({ date: e.date, event: e.event }));
  let supplement = intro || '';
  // 只排版開頭明寫完整日期的句子；沒有年份、不合理日期與其餘文字照原樣保留。
  const datedSentence = /^(\d{4})年(\d{1,2})月(\d{1,2})日([^。\n]+)(?:[。\n]+|$)/;
  for (;;) {
    const match = supplement.match(datedSentence);
    if (!match) break;
    const date = BQDates.makeDate(+match[1], +match[2], +match[3]);
    if (!date) break;
    events.push({ date: isoDay(date), event: match[4] });
    supplement = supplement.slice(match[0].length);
  }
  const sameText = value => String(value || '').replace(/[\s。]+/g, '');
  const add = row => {
    if (!events.some(e => e.date === row.date && sameText(e.event) === sameText(row.event))) events.push(row);
  };
  for (const stay of dog.stays || []) {
    // #392 盤點的舊資料：這兩種原因記的是該段怎麼結束，不能改標成入所原因。
    const ending = stay.out && ['整修移所', '領養後退養'].includes(stay.reason);
    const reason = ending ? '' : stay.reason;
    const arrival = reason ? (/入所$/.test(reason) ? reason : `${reason}入所`) : '入所';
    const hasArrival = events.some(e => e.date === stay.in && (sameText(e.event) === sameText(arrival) || (!reason && /入所|轉來|退回/.test(e.event))));
    if (!hasArrival) add({ date: stay.in, event: arrival });
    if (stay.out) add({ date: stay.out, event: ending ? stay.reason : '出所' });
  }
  const unique = [];
  const covers = (longer, shorter) => {
    const a = sameText(longer), b = sameText(shorter);
    return a === b || (b && ['，', ',', '；', ';'].some(mark => a.startsWith(b + mark)));
  };
  for (const row of events) {
    if (unique.some(e => e.date === row.date && covers(e.event, row.event))) continue;
    for (let i = unique.length - 1; i >= 0; i--) {
      if (unique[i].date === row.date && covers(row.event, unique[i].event)) unique.splice(i, 1);
    }
    unique.push(row);
  }
  unique.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  return { events: unique, supplement };
}
function intakeListHtml(events) {
  if (!events.length) return '';
  return `<ul class="intake-list">${events.map(e => `<li>${e.date ? `<time datetime="${esc(e.date)}">${esc(e.date.replace(/-/g, '/'))}</time>` : '<span class="intake-date-empty">日期未確認</span>'}<span class="intake-event">${esc(e.event || '原因未填')}</span></li>`).join('')}</ul>`;
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
  if (appState.staysEdit && appState.staysEdit.dog === dog) return staysSectionHtml(dog);
  const e = appState.introEdit && appState.introEdit.dog === dog ? appState.introEdit : null;
  if (!e) {
    const can = canEdit('editIntro') && !!(dog.id && appState.UPLOAD_URL) && !dog.departure;
    const canStays = canEdit('editStays') && !!(dog.id && appState.UPLOAD_URL);
    const { events, supplement } = intakePresentation(dog, intro);
    if (!events.length && !supplement && !canStays) return '';
    return `<section class="detail-section" data-section="intro">
      <h3 class="intro-heading">${icon('card')}入所介紹${can ? `<button type="button" class="intro-heading-edit" id="introEdit" aria-label="${events.length || supplement ? '改' : '補'}入所介紹">${icon('write')}</button>` : canStays ? `<button type="button" class="intro-heading-edit" id="staysEdit" aria-label="${(dog.stays || []).length ? '改' : '補'}出入所紀錄">${icon('write')}</button>` : ''}</h3>
      ${intakeListHtml(events)}
      ${supplement ? `<div class="content">${esc(supplement)}</div>` : ''}
    </section>`;
  }
  const busy = e.phase === 'saving';
  const n = [...e.text].length;
  return `<section class="detail-section" data-section="intro">
    <form class="rest-form intro-form" id="introForm" autocomplete="on">
      <h3>${icon('card')}入所介紹</h3>
      <button type="button" class="admin-btn" id="staysEdit"${!canEdit('editStays') || busy ? ' disabled' : ''}>${(dog.stays || []).length ? '改' : '補'}出入所紀錄</button>
      ${intakeEditorHtml(dog, e, busy)}
      <p class="rest-hint">存好後這台馬上看到，其他人幾分鐘後（下次更新資料）看到。只存在網站，不寫試算表。</p>
      <label>補充介紹（保留原文）<textarea id="introText" rows="7" maxlength="${INTRO_MAX}" placeholder="例：親人、喜歡散步，怕機車聲"${busy ? ' disabled' : ''}>${esc(e.text)}</textarea><small class="intro-count${n > INTRO_MAX ? ' over' : ''}">${n} / ${INTRO_MAX} 字</small></label>
      ${e.error ? `<div class="photo-error" role="alert">${esc(e.error)}</div>` : ''}
    </form>
  </section>`;
}
// 介紹表單打開時的底部列：取消＋儲存介紹（送出 #introForm）；溜了先收起來，跟換照片同一個做法（#146）
function introBarHtml(dog) {
  if (appState.staysEdit && appState.staysEdit.dog === dog) return '';
  const e = appState.introEdit && appState.introEdit.dog === dog ? appState.introEdit : null;
  if (!e) return '';
  const busy = e.phase === 'saving';
  return `<div class="detail-bar photo-bar">${busy ? '' : '<button type="button" class="bar-btn" id="introCancel">取消</button>'}<button type="submit" form="introForm" class="bar-confirm"${busy ? ' disabled' : ''}>${busy ? '儲存中…' : '儲存介紹'}</button></div>`;
}
function openIntroEdit(dog) {
  if (!dog || !dog.id || !appState.UPLOAD_URL) return;
  appState.introEdit = detailEdits.open(dog, { text: introOf(dog) || '', events: intakeDraft(dog) });
  renderDetail();
  const box = document.querySelector('#introForm [data-intake-field="date"]') || document.getElementById('introText');
  if (box) {
    box.focus({ preventScroll: true }); // 捲到看得見交給 detail-viewport.js，只捲狗卡不捲整頁（#389）
  }
}
async function saveIntro() {
  const e = appState.introEdit;
  if (!e || e.phase === 'saving') return;
  const editor = editorName();
  if (!editor) { detailEdits.fail(e, NEED_EDITOR); return; }
  const text = e.text.replace(/\r\n?/g, '\n').trim();
  if ([...text].length > INTRO_MAX) { detailEdits.fail(e, `最多 ${INTRO_MAX} 字`); return; }
  if (e.events.reduce((n, row) => n + [...row.event].length, 0) > INTRO_MAX) { detailEdits.fail(e, '原因合計最多 1000 字'); return; }
  detailEdits.saving(e);
  let out = null, error = '';
  const r = await BQApi.saveIntro(e.dog.id, { editor, text, events: e.events });
  out = r.data;
  if (r.error === 'network') error = '沒有存進去，請確認網路後再試';
  else if (!r.ok || !out || !out.ok) error = (out && out.error) || `沒有存進去（${r.status}），請稍後再試`;
  else if (!Array.isArray(out.intakeEvents) && (e.events.length || intakeEventsOf(e.dog).length)) error = '伺服器尚未確認逐次紀錄已儲存，請稍後再試';
  if (appState.introEdit !== e) return;
  if (error) {
    detailEdits.fail(e, error);
    return;
  }
  introOverrides[e.dog.id] = typeof out.intro === 'string' ? out.intro : text;
  e.dog.intakeEvents = Array.isArray(out.intakeEvents) ? out.intakeEvents : e.events;
  appState.introEdit = null;
  render(); renderDetail();
  const b = document.getElementById('introEdit');
  if (b) b.focus({ preventScroll: true });
  BQWalkUI.showToast(`${e.dog.name} 的介紹已存好（其他人重新整理就看得到）`);
}

// 出入所紀錄（#333，ADR 0011）：照時間列出每一次在所；誰都能補、改、刪（要先選名字），離所的狗也可以改（ADR 0011）。
// 整隻狗一次存（Worker 的 /stays），連同打開時看到的內容一起送，別人剛改過會被擋下來
const STAYS_MAX = 30;
function staysSectionHtml(dog) {
  const e = appState.staysEdit && appState.staysEdit.dog === dog ? appState.staysEdit : null;
  if (!e) return '';
  const busy = e.phase === 'saving';
  const today = isoDay(new Date());
  return `<section class="detail-section" data-section="intro">
    <form class="rest-form stays-form" id="staysForm" autocomplete="off">
      <h3>${icon('card')}入所介紹</h3>
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
  if (!dog || !dog.id || !appState.UPLOAD_URL) return;
  const before = (dog.stays || []).map(r => ({ ...r }));
  appState.staysEdit = detailEdits.open(dog, { before, rows: before.length ? before.map(r => ({ ...r })) : [{ in: '', out: '', reason: '' }] });
  renderDetail();
  const box = document.querySelector('#staysForm [data-stay-field="in"]');
  if (box) {
    box.focus({ preventScroll: true }); // 捲到看得見交給 detail-viewport.js，只捲狗卡不捲整頁（#389）
  }
}
// 先在這台檢查一次（伺服器也會檢查）；回空字串是沒問題
function staysProblem(rows) {
  const today = isoDay(new Date());
  for (const r of rows) {
    if (!BQDates.parseYmd(r.in)) return '每一筆都要填入所日';
    if (r.in > today || (r.out && r.out > today)) return '日期不能是未來的日子';
    if (r.out && r.out < r.in) return '出所日不能早於入所日';
  }
  return '';
}
async function saveStays() {
  const e = appState.staysEdit;
  if (!e || e.phase === 'saving') return;
  const editor = editorName();
  if (!editor) { detailEdits.fail(e, NEED_EDITOR); return; }
  // 整列都空白的當成沒填
  const rows = e.rows.map(r => ({ in: r.in.trim(), out: r.out.trim(), reason: r.reason.trim() })).filter(r => r.in || r.out || r.reason);
  const problem = staysProblem(rows);
  if (problem) { detailEdits.fail(e, problem); return; }
  detailEdits.saving(e);
  let out = null, error = '';
  const r = await BQApi.saveStays(e.dog.id, { editor, before: e.before, stays: rows });
  out = r.data;
  if (r.error === 'network') error = '沒有存進去，請確認網路後再試';
  else if (r.status === 409) error = '別人剛改過，請重新整理再改';
  else if (!r.ok || !out || !out.ok) error = (out && out.error) || `沒有存進去（${r.status}），請稍後再試`;
  if (appState.staysEdit !== e) return;
  if (error) { detailEdits.fail(e, error); return; }
  e.dog.stays = Array.isArray(out.stays) ? out.stays : rows;
  appState.staysEdit = null;
  render(); renderDetail();
  const b = document.getElementById('staysEdit') || document.getElementById('introEdit');
  if (b) b.focus({ preventScroll: true });
  const first = BQDates.firstIntake(e.dog);
  BQWalkUI.showToast(`${e.dog.name} 的出入所紀錄已存好${first ? `，入所日從 ${ymdOf(first)} 算` : ''}`);
}

function openRestEdit(dog) {
  const r = restOf(dog);
  const until = r ? r.until : new Date(Date.now() + 10 * 86400000);
  appState.restEdit = detailEdits.open(dog, { until: isoDay(until), reason: r ? r.reason : '術後休養' });
  renderDetail();
  const first = document.getElementById('restReason');
  if (first) {
    first.focus({ preventScroll: true }); // 同上（#389）
  }
}
// 送到 Worker：end＝結束休養。成功後這支手機馬上生效，其他志工重新整理就看得到（#250 存 D1）
async function saveRest(end = false) {
  const e = appState.restEdit;
  if (!e || e.phase === 'saving') return;
  const editor = editorName();
  if (!editor) { detailEdits.fail(e, NEED_EDITOR); return; }
  if (!end && !BQDates.parseYmd(e.until)) { detailEdits.fail(e, '請選到哪一天'); return; }
  detailEdits.saving(e);
  let out = null, error = '';
  const r = await BQApi.saveRest(e.dog.id, end ? { editor, end: true } : { editor, until: e.until, reason: e.reason.trim() });
  out = r.data;
  if (r.error === 'network') error = '沒有存進去，請確認網路後再試';
  else if (!r.ok || !out || !out.ok) error = (out && out.error) || `沒有存進去（${r.status}），請稍後再試`;
  if (appState.restEdit !== e) return;
  if (error) {
    detailEdits.fail(e, error);
    return;
  }
  // 換成新的物件：讀取中的 loadRest 才知道這裡改過（見 loadRest）
  const next = { ...appState.restMap };
  if (out.rest) next[e.dog.id] = out.rest; else delete next[e.dog.id];
  appState.restMap = next;
  appState.restEdit = null;
  resetWalkOrder();
  render(); renderDetail();
  BQWalkUI.showToast(out.rest ? `${e.dog.name} 休養到 ${monthDay(BQDates.parseYmd(out.rest.until))}，排到溜狗表最下面` : `${e.dog.name} 結束休養`);
}
// 初次讀取前不顯示未確認的排序；背景讀取失敗保留已知設定。
async function loadRest() {
  const before = appState.restMap;
  try {
    const data = await fetchWalkStatus(signal => BQApi.rest({ signal }));
    if (!data || !data.rest || typeof data.rest !== 'object' || Array.isArray(data.rest)) throw new Error('休養設定格式不對');
    // 讀的期間這支手機剛改過設定，不蓋掉自己的修改。
    if (appState.restMap === before) appState.restMap = data.rest;
    if (!appState.restLoaded) resetWalkOrder();
    appState.restLoaded = true;
    appState.restState = 'ready';
  } catch (e) { appState.restState = 'error'; }
  // 已顯示的狗保留原位，避免背景讀取或按了溜了之後跳位。
  render();
  if (appState.detailDog) renderDetail();
}

// 離所的狗（#164）：同一個詳細資訊，頂部標離所原因和日期取代天數，多一區離所紀錄；
// 沒有溜了、在哪、☆、換照片，也不放同籠和可以一起溜（那是在所時的事）
function departedDetailHtml(dog, today) {
  const dep = dog.departure;
  const flag = specialFlag(dog.note);
  const back = dep.returned && appState.allDogs.find(d => d.id === dep.returned);
  return `
    <div class="detail-head">
      ${BQPhoto.heroHtml(dog)}
      <div class="info">
        <div class="name-row"><h2 class="name" id="detailName">${esc(dog.name)}${sexMark(dog)}</h2></div>
        <div class="chips">${departureBadge(dep)}${since(dog)}</div>
        ${metaLine(dog)}
      </div>
    </div>
    ${appState.detailTrail.length ? `<button type="button" class="detail-back" id="detailBack">${icon('back')}回到 ${esc(appState.detailTrail[appState.detailTrail.length - 1].name)}</button>` : ''}
    <section class="detail-section departed" data-section="departure">
      <h3>${icon('note')}離所紀錄</h3>
      <div class="lw-row"><span class="lw-k">原因</span><span class="lw-v">${esc(DEPARTURE_LABELS[dep.reason])}</span></div>
      <div class="lw-row"><span class="lw-k">日期</span><span class="lw-v">${esc(ymdText(dep.date))}${dep.dateSource === 'seen' ? '<small>（從試算表消失的那天）</small>' : ''}</span></div>
      <div class="lw-row"><span class="lw-k">依據</span><span class="lw-v">${esc(departureBasis(dep))}</span></div>
      <div class="lw-row"><span class="lw-k">最後籠位</span><span class="lw-v">${esc(dog.cage || '—')}</span></div>
      ${back ? `<button type="button" class="detail-back" data-departed-back="${appState.allDogs.indexOf(back)}">${icon('paw')}已再入所，看現在的 ${esc(back.name)}</button>` : ''}
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
    ${introSectionHtml(dog, introOf(dog))}
    <div class="detail-bar"><button type="button" class="bar-btn" id="detailClose">關閉</button></div>
  `;
  function since(d) {
    const s = BQDates.firstIntake(d);
    return s ? `<span class="badge plain">入所 ${s.getFullYear()}/${s.getMonth() + 1}</span>` : '';
  }
}

const DEPARTURE_LABELS = { adopt: '認養', death: '離世', other: '其他', unknown: '待確認' };
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
    <div class="lw-row"><span class="lw-k">溜狗人</span><span class="lw-v">${BQWalkUI.walkerChipsHtml(dog, who, today)}</span></div>
    ${BQWalkUI.walkSyncHtml(dog)}
  </section>`;
}

// 詳細資訊狗名下面的標籤：籠位、入所年月（天數標籤是 statusBadge）
function detailChips(dog) {
  const since = BQDates.firstIntake(dog);
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
  const canPick = walkKey(d) && !walked && appState.allDogs.includes(d);
  const picked = canPick && appState.pickedBuddies.has(walkKey(d));
  return `<div class="buddy-tile">
    <button class="buddy" data-dog="${appState.allDogs.indexOf(d)}"${appState.allDogs.includes(d) ? '' : ' disabled'}>${photoThumb(d, 64)}<span class="bname">${esc(name)}</span></button>
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
  return appState.allDogs.filter(d => d !== dog && String(d.cage || '').replace(/\s+/g, '') === cage);
}

// 同籠＋可以一起溜合成一段（K 2026-10-10 減法：兩段常常是同一批狗）：同籠的排前面、標「同籠」，
// 登記可以一起溜又不同籠的接在後面；同一隻只出現一次
function togetherSection(dog, walked) {
  const byName = new Map(appState.allDogs.map(d => [d.name, d]));
  const mates = cageMates(dog);
  const buddies = [...(appState.groupMap[dog.name] || [])].map(n => byName.get(n) || { name: n, id: '' });
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
  if (BQWalkUI.walkPendingNow(dog) && !walkedNow(dog)) return `<button type="button" class="group-walk" id="groupWalk" disabled>登記中</button>`;
  const rest = restOf(dog);
  const self = !!walkKey(dog) && !walked.has(dog) && !rest;
  const n = [...appState.pickedBuddies].length;
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

// 詳細資訊的按鈕（#86）：在外框綁一次，依按下的是哪個按鈕分派，每次重畫內容不用重新綁。
// 由上往下找第一個符合的，所以同一個按鈕只會做一件事
const DETAIL_CLICKS = [
  ['#fixedCareToggle', () => toggleFixedCare(appState.detailDog)],
  ['#detailClose', () => closeDetail()],
  ['[data-zoom]', el => { if (!el.classList.contains('no-photo')) openLightbox(appState.detailDog, el); }],
  ['#photoCrop', () => BQPhoto.cropPreview()],
  ['#photoPick', () => BQPhoto.pick()],
  ['#restEdit', () => openRestEdit(appState.detailDog)],
  ['#introEdit', () => openIntroEdit(appState.detailDog)],
  ['#formerAdd', () => openFormerEdit(appState.detailDog)],
  ['#staysEdit', () => openStaysEdit(appState.detailDog)],
  ['#staysCancel', () => { appState.staysEdit = null; renderDetail(); const b = document.getElementById('staysEdit') || document.getElementById('introEdit'); if (b) b.focus({ preventScroll: true }); }],
  ['#formerCancel', () => { appState.formerEdit = null; renderDetail(); const b = document.getElementById('formerAdd'); if (b) b.focus({ preventScroll: true }); }],
  ['[data-former-del]', el => removeFormer(appState.detailDog, el.dataset.formerDel)],
  ['#walksToggle', () => { appState.detailWalksOpen = !appState.detailWalksOpen; renderDetail(); const b = document.getElementById('walksToggle'); if (b) b.focus({ preventScroll: true }); }],
  ['#introCancel', () => { appState.introEdit = null; renderDetail(); const b = document.getElementById('introEdit'); if (b) b.focus({ preventScroll: true }); }],
  ['#restEnd', () => saveRest(true)],
  ['#restCancel', () => { appState.restEdit = null; renderDetail(); const b = document.getElementById('restEdit'); if (b) b.focus({ preventScroll: true }); }],
  ['#photoConfirm', () => BQPhoto.upload()],
  ['#photoCancel', () => { BQPhoto.clear(); renderDetail(); }],
  ['.buddy', el => { const d = appState.allDogs[el.dataset.dog]; if (d) showDetail(d); }],
  ['#whoAdd', () => BQWalkUI.openWithSheet([appState.detailDog], true)],
  ['[data-who-undo]', () => BQWalkUI.sheetUndoable(appState.detailDog) ? BQWalkUI.setWalked([appState.detailDog], false) : BQWalkUI.undoSheetWalks([appState.detailDog], null, { revert: true })],
  ['[data-who-remove]', el => {
    const n = el.dataset.whoRemove;
    BQWalkUI.editWalkers(appState.detailDog, walkerList(appState.detailDog).filter(x => x !== n), `已拿掉 ${n}`);
  }],
  ['#favToggle', () => { appState.favorites.toggleFav(appState.detailDog); renderDetail(); render(); }],
  ['#detailBack', () => { const d = appState.detailTrail.pop(); if (d) showDetail(d, false); }],
  ['[data-departed-back]', el => { const d = appState.allDogs[el.dataset.departedBack]; if (d) showDetail(d); }],
  ['#detailWhere', el => whereOpen(appState.detailDog, el)],
  ['[data-where]', el => whereOpen(appState.detailDog, el)],
  ['.pick', el => {
    const id = el.dataset.pick;
    if (appState.pickedBuddies.has(id)) appState.pickedBuddies.delete(id); else appState.pickedBuddies.add(id);
    renderDetail();
  }],
  ['#groupWalk', () => {
    const picked = [...appState.pickedBuddies].map(id => appState.allDogs.find(d => walkKey(d) === id));
    BQWalkUI.setWalked([appState.detailDog, ...picked], true);
  }],
];

function wireDetail(box) {
  if (box.bqWired) return;
  box.bqWired = true;
  box.addEventListener('click', e => {
    if (!appState.staysEdit || appState.staysEdit.phase === 'saving') return;
    if (e.target.closest('#staysAdd') && appState.staysEdit.rows.length < STAYS_MAX) {
      appState.staysEdit.rows.push({ in: '', out: '', reason: '' });
      renderDetail(); box.querySelector('.stays-form .intake-row:last-child input')?.focus({ preventScroll: true });
    }
    const remove = e.target.closest('[data-stay-remove]');
    if (remove) {
      appState.staysEdit.rows.splice(Number(remove.dataset.stayRemove), 1);
      renderDetail(); box.querySelector('#staysAdd')?.focus({ preventScroll: true });
    }
  });
  box.addEventListener('click', e => {
    if (!appState.introEdit || appState.introEdit.phase === 'saving') return;
    if (e.target.closest('#intakeAdd') && appState.introEdit.events.length < 30) {
      appState.introEdit.events.push({ number: appState.introEdit.dog.id, date: '', event: '' });
      renderDetail(); box.querySelector('.intake-row:last-child input')?.focus({ preventScroll: true });
    }
    const remove = e.target.closest('[data-intake-remove]');
    if (remove) {
      appState.introEdit.events.splice(Number(remove.dataset.intakeRemove), 1);
      renderDetail(); box.querySelector('#intakeAdd')?.focus({ preventScroll: true });
    }
  });
  // 休養設定表單：打的字記在 restEdit，重畫不會不見；送出走 saveRest
  box.addEventListener('input', e => {
    if (appState.staysEdit && e.target.dataset.stayField) {
      const row = appState.staysEdit.rows[Number(e.target.dataset.stayRow)];
      if (row) detailEdits.draft(row, { [e.target.dataset.stayField]: e.target.value });
      return;
    }
    if (appState.introEdit && e.target.dataset.intakeField) {
      const row = appState.introEdit.events[Number(e.target.dataset.intakeRow)];
      if (row) detailEdits.draft(row, { [e.target.dataset.intakeField]: e.target.value });
      return;
    }
    if (appState.introEdit && e.target.id === 'introText') {
      detailEdits.draft(appState.introEdit, { text: e.target.value });
      const c = box.querySelector('.intro-count');
      if (c) { const n = [...appState.introEdit.text].length; c.textContent = `${n} / ${INTRO_MAX} 字`; c.classList.toggle('over', n > INTRO_MAX); }
      return;
    }
    if (appState.formerEdit && e.target.id === 'formerText') { detailEdits.draft(appState.formerEdit, { text: e.target.value }); return; }
    if (!appState.restEdit) return;
    if (e.target.id === 'restReason') detailEdits.draft(appState.restEdit, { reason: e.target.value });
    else if (e.target.id === 'restUntil') detailEdits.draft(appState.restEdit, { until: e.target.value });
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
    if (!appState.detailDog || !e.target.closest) return;
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
  const dog = appState.detailDog;
  const label = () => {
    if (img.naturalWidth && pick.isConnected) { pick.setAttribute('aria-label', `更換 ${dog.name} 的照片`); pick.title = '更換照片'; }
  };
  label();
  img.addEventListener('load', label);
}

const detailEditorViewport = createDetailEditorViewport(document.getElementById('detailBackdrop'), document.getElementById('detail'));

function renderDetail() {
  for (const [key, field] of [['editIntro','introEdit'],['editRest','restEdit'],['editStays','staysEdit'],['editFormer','formerEdit']]) {
    if (!canEdit(key) && appState[field]?.phase !== 'saving') appState[field] = null;
  }
  if (!appState.detailDog) return;
  const box = document.getElementById('detail');
  wireDetail(box);
  const editingFocus = detailEditorViewport.capture();
  const focused = box.contains(document.activeElement) ? document.activeElement : null;
  // 重畫後留在原本捲到的位置（K 2026-10-10：補完資料「整個卡片就會跳掉」）；換看別隻時 showDetail 會自己捲回最上面
  const top = box.scrollTop;
  box.innerHTML = detailHtml(appState.detailDog, new Date());
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
  const wasOpen = !!appState.detailDog;
  if (!wasOpen) appState.detailOpener = { element: document.activeElement, index: appState.allDogs.indexOf(dog) };
  if (wasOpen && remember && dog !== appState.detailDog) appState.detailTrail.push(appState.detailDog);
  if (dog !== appState.detailDog) {
    detailEditorViewport.reset();
    appState.pickedBuddies.clear();
    appState.detailWalksOpen = false;
    if (!appState.restEdit || appState.restEdit.phase !== 'saving') appState.restEdit = null;
    if (!appState.introEdit || appState.introEdit.phase !== 'saving') appState.introEdit = null;
    if (!appState.formerEdit || appState.formerEdit.phase !== 'saving') appState.formerEdit = null;
    if (!appState.staysEdit || appState.staysEdit.phase !== 'saving') appState.staysEdit = null;
    BQPhoto.leaveDetail();
  }
  appState.detailDog = dog;
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
  if (!appState.detailDog) return;
  detailEditorViewport.reset();
  appState.detailDog = null;
  appState.detailWalksOpen = false;
  appState.detailTrail = [];
  appState.pickedBuddies.clear();
  if (!appState.restEdit || appState.restEdit.phase !== 'saving') appState.restEdit = null;
  if (!appState.introEdit || appState.introEdit.phase !== 'saving') appState.introEdit = null;
  if (!appState.formerEdit || appState.formerEdit.phase !== 'saving') appState.formerEdit = null;
  if (!appState.staysEdit || appState.staysEdit.phase !== 'saving') appState.staysEdit = null;
  BQPhoto.leaveDetail();
  document.getElementById('detailBackdrop').hidden = true;
  document.getElementById('detail').innerHTML = '';
  document.documentElement.classList.remove('detail-open');
  if (appState.detailOpener) {
    const card = document.querySelector(`#main .card[data-dog="${appState.detailOpener.index}"]`);
    const opener = appState.detailOpener.element;
    (card || (opener && opener.isConnected && opener !== document.body ? opener : searchInput)).focus({ preventScroll: true });
    appState.detailOpener = null;
  }
}

function closeDetail() {
  if (history.state && history.state.bqDetail) history.back(); // popstate 會接著 hideDetail
  else hideDetail();
}

// 燈箱開著時「返回」只關燈箱，詳細資訊留著

// 狗卡用事件委派：renderMain 每次重畫卡片都不用重新綁
function cardFromEvent(e) {
  const card = e.target.closest('#main .card[data-dog], #main .row-dog[data-dog]');
  return card && appState.allDogs[card.dataset.dog];
}
// 點「已遛／移回」只記錄，不開詳細資訊；點照片開燈箱（#46，沒照片就照舊開詳細資訊）；點卡片其他地方開詳細資訊

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
  const selected = appState.analysisOpen ? 'info' : appState.activeTab;
  tabsEl.innerHTML = TABS.map(t => {
    const n = t.id === 'mine' ? mineTabNumber(counts.mine) : counts[t.id] != null ? counts[t.id] : t.note || '';
    const label = t.id === 'mine' ? ` aria-label="${mineTabLabel(counts.mine)}"` : n === '' ? '' : ` aria-label="${t.label}，${n} 隻"`;
    return `<button type="button" data-tab="${t.id}" class="${selected === t.id ? 'active' : ''}"${selected === t.id ? ' aria-current="page"' : ''}${label}>${icon(t.icon)}<span class="t">${t.label}</span><span class="n">${n}</span></button>`;
  }).join('');
  tabsEl.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  if (focusedTab) tabsEl.querySelector(`[data-tab="${focusedTab}"]`)?.focus({ preventScroll: true });
}

// 最後一次輸入是不是觸控，決定切頁後要不要補焦點（#420）

// 切換分類：標籤跟著亮起，畫面回到內容最上面
appState.lastInputTouch = false;
function switchTab(id, pushHistory = true) {
  // find 保留給舊入口與操作教學，底部不再佔一格。
  if (id !== 'find' && !TABS.some(t => t.id === id)) return;
  const changed = id !== (appState.analysisOpen ? 'info' : appState.activeTab);
  if (pushHistory && changed) {
    history.replaceState({ bqNavigation: true, tab: appState.analysisOpen ? 'info' : appState.activeTab, base: appState.activeTab, returnTab: appState.groupsReturnTab, infoPage: typeof analysisState.infoPage === 'undefined' ? '' : analysisState.infoPage }, '');
  }
  if (id === 'groups' && appState.activeTab !== 'groups') appState.groupsReturnTab = appState.analysisOpen ? 'info' : appState.activeTab;
  if (pushHistory && changed && id === 'info') analysisState.infoPage = '';
  appState.analysisOpen = id === 'info';
  if (!appState.analysisOpen) appState.activeTab = id;
  if (pushHistory && changed) history.pushState({ bqNavigation: true, tab: id, base: appState.activeTab, returnTab: appState.groupsReturnTab, infoPage: typeof analysisState.infoPage === 'undefined' ? '' : analysisState.infoPage }, '');
  if (changed) resetWalkOrder(); // 換分頁回來溜狗表時重排，剛溜的狗才會排到後面
  if (changed && id === 'groups') refreshGroupStage();
  const prevFocus = document.activeElement;
  render();
  const btn = document.querySelector(`#tabs button[data-tab="${id}"]`);
  // 焦點原本在頁籤上就跟著移；原焦點被重繪拿掉（如返回鈕）時，觸控以外才補到頁籤。
  // 觸控時主動 focus 會被 iOS 當成鍵盤焦點而留下橘框（#420）
  const focusRemoved = prevFocus && prevFocus !== document.body && !prevFocus.isConnected;
  if (btn && (prevFocus?.closest?.('#tabs') || (!appState.lastInputTouch && focusRemoved))) btn.focus({ preventScroll: true });
  if (btn && btn.scrollIntoView) btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (changed) window.scrollTo(0, 0);
}

// step：+1 下一個分類、-1 上一個；第一頁再往前、最後一頁再往後都不動（不循環）
function stepTab(step) {
  const i = TABS.findIndex(t => t.id === appState.activeTab);
  const next = i + step;
  if (next < 0 || next >= TABS.length) return false;
  switchTab(TABS[next].id);
  return true;
}

const mainEl = document.getElementById('main');
function render() {
  renderMain();
  if (appState.loadWarning) {
    document.getElementById('main').insertAdjacentHTML('afterbegin',
      `<div class="alert-box warn">${icon('warn')}<span>${esc(appState.loadWarning)}</span></div>`);
  }
  if (appState.loadState === 'ready' && appState.activeTab === 'walk' && !appState.analysisOpen && appState.restState === 'error') {
    mainEl.insertAdjacentHTML('afterbegin', `<div class="alert-box warn" role="status"><span>休養設定暫時讀不到，帶出前請確認。已讀到的設定會保留。<br><button type="button" class="retry-btn" id="restRetry">重讀休養設定</button></span></div>`);
  }
  queueRange();
  BQTour.queue();
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

// 頁首收起（critique 2026-10-09 P1）：往下捲時標題那一行跟著捲走，只留搜尋框和範圍字黏在上面，
// 狗卡多看得到一兩隻；捲回最上面就回來。用 sticky 負 top 做，不判斷捲動方向，畫面不會跳
const appBrand = appHeader && appHeader.querySelector('.brand');
function syncHeaderTuck() {
  if (!appHeader || !appBrand || typeof getComputedStyle !== 'function') return; // node 測試的假 DOM 沒有
  document.documentElement.style.setProperty('--app-header-height', `${appHeader.getBoundingClientRect().height}px`);
  const pad = parseFloat(getComputedStyle(appHeader).paddingTop) || 0;
  appHeader.style.setProperty('--brand-h', `${Math.round(pad + appBrand.offsetHeight)}px`);
}

// 常溜狗群「溜了」那排黏在底部分類列上方（#443）：分類列高度隨字級、安全區變，量實際高度
const bottomBarEl = document.getElementById('bottomBar');
function syncBottomBar() {
  if (typeof bottomBarEl?.getBoundingClientRect !== 'function') return; // node 測試的假 DOM 沒有
  document.documentElement.style.setProperty('--bottom-bar-height', `${bottomBarEl.getBoundingClientRect().height}px`);
}

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

appState.rangeFrame = 0;
function syncRange() {
  appState.rangeFrame = 0;
  if (!rangeLabel) return;
  let text = '';
  if (appState.activeTab === 'walk' && !appState.analysisOpen) {
    const top = appHeader ? appHeader.getBoundingClientRect().bottom : 0;
    const bar = document.getElementById('bottomBar');
    const bottom = bar ? bar.getBoundingClientRect().top : window.innerHeight;
    const today = new Date();
    const words = [];
    for (const el of mainEl.querySelectorAll('.card[data-dog], .row-dog[data-dog]')) {
      const r = el.getBoundingClientRect();
      if (r.bottom > top + 8 && r.top < bottom - 8) {
        const dog = appState.allDogs[Number(el.dataset.dog)];
        if (dog) words.push(dayWord(dog, today));
      } else if (words.length) break;
    }
    text = rangeText(words);
  }
  if (rangeLabel.textContent !== text) rangeLabel.textContent = text;
  rangeLabel.hidden = !text;
}
function queueRange() { if (!appState.rangeFrame) appState.rangeFrame = requestAnimationFrame(syncRange); }

// 溜狗表（沿用原待巡房）：所有狗依幾天沒遛由久到近；沒有遛狗紀錄的排最前，有人固定照顧的排最後
function dueDogs(dogs, today) {
  // 休養中排最下面（K 2026-10-09），有人固定照顧在它上面
  const key = s => s.kind === 'unknown' ? Infinity : s.kind === 'dated' ? Math.max(0, s.days) : s.kind === 'covered' ? -1 : -2;
  return dogs
    .map(d => ({ d, k: key(computeStatus(d, today)) }))
    .sort((a, b) => (b.k === a.k ? 0 : b.k > a.k ? 1 : -1))
    .map(x => x.d);
}

// 溜狗表一律最久沒溜在前（2026-10-08 K 同意介面評估：拿掉排序切換和「幾天以上」篩選，天數的顏色就看得出來）。
// 按了溜了的狗留在原地（介面評估 P0：重排的話下一隻會滑到手指下，容易按錯寫進試算表）：
// 只有這支手機按過的狗留在原位（K 2026-10-20：別人溜的不是我按的，照天數排到後面）；換分頁或按「更新」才全部重排（#418）
appState.walkOrder = null; // 上次畫出來的順序：walkKey → 第幾個
appState.walkOrderFor = null; // 記順序時的 allDogs
const walkPinned = new Set(); // 這次排好之後，這支手機按過溜了／復原的狗（walkKey）
function sortWalkList(dogs, today) {
  const due = dueDogs(dogs, today);
  const k = d => walkKey(d) || d;
  let out = due;
  if (appState.walkOrder && appState.walkOrderFor === appState.allDogs && walkPinned.size) {
    const pinned = due.filter(d => walkPinned.has(k(d)) && appState.walkOrder.has(k(d))).sort((a, b) => appState.walkOrder.get(k(a)) - appState.walkOrder.get(k(b)));
    out = due.filter(d => !pinned.includes(d));
    for (const d of pinned) out.splice(Math.min(appState.walkOrder.get(k(d)), out.length), 0, d);
  }
  appState.walkOrder = new Map(out.map((d, i) => [k(d), i]));
  appState.walkOrderFor = appState.allDogs;
  return out;
}
function pinWalkOrder(dogs) {
  for (const d of dogs) if (d) walkPinned.add(walkKey(d) || d);
}
function resetWalkOrder() {
  appState.walkOrder = null;
  walkPinned.clear();
}

// 我的常溜（#155，K 2026-10-04 選兩頁都放）：溜狗表上面只剩「全部／★ 我的常溜」兩個選一個（2026-10-08）
const WALK_FAV_KEY = BQStore.keys.walkFav;

appState.walkFavMemory = false;
function loadWalkFav() {
  const v = appState.phoneStore.readJson(WALK_FAV_KEY);
  return typeof v === 'boolean' ? v : appState.walkFavMemory;
}
function saveWalkFav(on) {
  appState.walkFavMemory = on;
  appState.phoneStore.writeJson(WALK_FAV_KEY, on);
}

function walkFilterHtml(total, fav, favN) {
  const chip = (on, v, label, n) => `<button type="button" class="chip${on ? ' on' : ''}" data-walk-fav="${v}" aria-pressed="${on}">${label}<small>${n}</small></button>`;
  return `<div class="chips" role="group" aria-label="要看哪些狗">${chip(!fav, 0, '全部', total)}${chip(fav, 1, '★ 我的常溜', favN)}</div>`;
}

// V9（#141 第 6 項）：照片模式／列表模式（收起照片，像試算表一列一隻）。選了哪個記在這支手機
const WALK_VIEW_KEY = BQStore.keys.walkView;

appState.walkViewMemory = 'photo';
function loadWalkView() {
  let v = appState.walkViewMemory;
  try {
    if (appState.phoneStore) v = appState.phoneStore.get(WALK_VIEW_KEY) || v;
  } catch (e) { /* 讀不到就用記憶體裡的 */ }
  return v === 'list' ? 'list' : 'photo';
}
function saveWalkView(v) {
  appState.walkViewMemory = v;
  try {
    if (appState.phoneStore) appState.phoneStore.set(WALK_VIEW_KEY, v);
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
  return `<div class="row-dog${flag ? ' flagged' : ''}" data-dog="${appState.allDogs.indexOf(dog)}" role="button" tabindex="0" aria-haspopup="dialog">
    <span class="r-date ${s.kind === 'rest' ? 'rest' : s.level || 'muted'}">${days}</span>
    <span class="r-name">${esc(dog.name)}</span>
    ${typeof whereKnown === 'function' && whereKnown(dog)
      ? `<button type="button" class="r-cage cage-pill" data-where aria-label="${esc(dog.name)} 在哪：${esc(dog.cage)}${dog.homeCage ? '（暫住）' : ''}">${icon('pin')}${esc(dog.cage)}</button>`
      : `<span class="r-cage plain">${esc(dog.cage)}</span>`}
    ${BQWalkUI.walkButton(dog)}
    ${flag ? warnNote(dog.note, flag) : ''}
  </div>`;
}

function renderMain() {
  const today = new Date();
  document.getElementById('dateLabel').textContent =
    `${today.getMonth() + 1}月${today.getDate()}日 (${'日一二三四五六'[today.getDay()]})`;

  const main = document.getElementById('main');
  // 資訊與狗群共用內頁頁首；底部導覽保持可用。
  document.documentElement.classList.toggle('analysis-open', appState.analysisOpen || appState.activeTab === 'groups');
  // 四個主分頁都用網站共用表頭（K 2026-10-17）；只有資訊子頁換成「回資訊」＋子頁標題
  document.documentElement.classList.toggle('head-shared', appState.analysisOpen ? !analysisState.infoPage : appState.activeTab === 'groups');
  // 常遛狗群也有搜尋狗名（K 2026-10-17）：前三個主分頁都能搜尋，資訊沒有
  document.documentElement.classList.toggle('head-search', !appState.analysisOpen && appState.activeTab === 'groups');
  document.documentElement.classList.toggle('head-sub', appState.analysisOpen && !!analysisState.infoPage);
  const title = document.querySelector('.head-title');
  if (title) title.textContent = appState.analysisOpen ? (INFO_PAGES[analysisState.infoPage] || '資訊') : '常遛狗群';
  const back = document.getElementById('analysisBack');
  if (back) back.innerHTML = `${icon('back')}回${(TABS.find(t => t.id === (appState.analysisOpen ? appState.activeTab : appState.groupsReturnTab)) || TABS[0]).label}`;

  if (back && appState.analysisOpen && analysisState.infoPage) back.innerHTML = `${icon('back')}回資訊`;
  syncHeaderTuck();
  // #273 資訊分類與子頁。
  if (appState.analysisOpen) {
    buildTabs(appState.loadState === 'ready' ? { walk: appState.allDogs.filter(d => matchesSearch(d, appState.searchQuery.trim())).length, mine: myWalksCount('') } : {});
    if (!(canShow('updates') && analysisState.infoPage === 'updates' && analysisState.infoUpdateTab === 'edits' && main.querySelector('#infoEdits'))) main.innerHTML = analysisPageHtml(today);
    return;
  }
  if (appState.activeTab === 'groups') {
    buildTabs(appState.loadState === 'ready' ? { walk: appState.allDogs.filter(d => matchesSearch(d, appState.searchQuery.trim())).length, mine: myWalksCount('') } : {});
    // 沿用正式狗群頁及既有 API；獨立文件的觸控事件不會冒泡到主分類。
    main.innerHTML = groupStageHtml();
    return;
  }

  // 資料還沒好時標題、搜尋框、分類照樣能用，只有內容區顯示讀取中或失敗
  if (appState.loadState !== 'ready') {
    buildTabs({});
    main.innerHTML = appState.loadState === 'error'
      ? `<div class="status-msg">狗的資料讀不到，請確認網路後按「重新讀取」。<br><button class="retry-btn" id="retryBtn">重新讀取</button></div>`
      : skeletonHtml();
    const retry = document.getElementById('retryBtn');
    if (retry) retry.addEventListener('click', init);
    return;
  }

  // 搜尋時只篩選目前分類的內容，分類上的數字也改成各分類符合的隻數；清空就回到原本的內容
  const q = appState.searchQuery.trim();
  const hit = d => matchesSearch(d, q);
  if (appState.activeTab === 'walk' && (appState.restState === 'loading' || appState.todayState === 'loading')) {
    buildTabs({ walk: appState.allDogs.filter(hit).length, mine: myWalksCount('') });
    main.innerHTML = skeletonHtml();
    return;
  }
  // V9（#141）：沒有今天已溜和收起了，全部的狗都在溜狗表；按過溜了的留在原地、顯示今天
  const walkList = (appState.activeTab === 'walk' ? sortWalkList(appState.allDogs, today) : appState.allDogs).filter(hit);
  // 介面評估第三輪（K 2026-10-08）：找狗分頁不放數字（跟溜狗表一樣是全部的狗）；
  // 我溜過一律是全部紀錄筆數，不跟著搜尋變（搜不到時「我溜過 0」像紀錄不見了）
  buildTabs({ walk: walkList.length, mine: myWalksCount('') });
  searchInput.placeholder = appState.activeTab === 'find' ? '狗名、編號或籠位' : '搜尋狗名';
  if (appState.activeTab === 'find') {
    // 找狗（#99）搜尋全部的狗：犬名、編號、籠位都算
    main.innerHTML = findPageHtml(q);
    return;
  }
  if (appState.activeTab === 'mine') {
    main.innerHTML = myWalksHtml(today, q);
    return;
  }
  // 電腦版（K 2026-10-10）：寬螢幕的溜狗表是簡報＋全表，在 js/desk.js
  if (typeof deskOn === 'function' && deskOn()) {
    main.innerHTML = deskWalkHtml(today, q, walkList);
    return;
  }
  const fav = loadWalkFav();
  const list = fav ? walkList.filter(appState.favorites.isFav) : walkList;
  const view = loadWalkView();
  const items = view === 'list'
    ? (list.length ? `<div class="rows"><div class="row-head"><span>天數</span><span>狗名</span><span>籠位</span><span></span></div>${list.map(d => walkRow(d, today)).join('')}</div>` : '')
    : list.map((d, i) => dogCard(d, today, i < FIRST_SCREEN_CARDS)).join('');
  const head = walkToolsHtml(walkFilterHtml(walkList.length, fav, walkList.filter(appState.favorites.isFav).length), view);
  const empty = fav && !list.length && !q ? '還沒有常溜的狗。<br>點狗打開詳細資訊，<br>按名字旁的「☆ 常溜」加進來。'
    : q ? `找不到「${esc(q)}」` : '沒有符合的狗';
  main.innerHTML = head + (q && list.length ? `<div class="section-hint">${icon('search')}搜尋「${esc(q)}」：${list.length} 隻</div>` : '')
    + (items || `<div class="status-msg">${empty}</div>`);
}

// 我溜過：點照片開詳細資訊、讀取失敗時重新讀取（內容區每次重畫，所以用事件委派）

// 注音、拼音選字途中不篩選，避免一直閃「找不到『ㄉㄡ』」；選好字才更新
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
// 搜尋框有字就顯示 X（選字途中也算有字，才能整個清掉）
function syncSearchClear() {
  if (searchClear) searchClear.hidden = !searchInput.value;
}

// 點 X：清空文字、回到目前分頁的完整內容，不換分頁；游標留在搜尋框方便重打

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 資訊的「使用說明」（#447）：回到溜狗表從第一步再看一次，不動名字
function openGuide() {
  BQTour.start(true);
}

// 先畫出分類列與內容區的讀取中（標題、搜尋框本來就在 index.html），再背景讀 dogs.json
async function init() {
  void loadSettings().then(() => { render(); if (appState.detailDog) renderDetail(); });
  BQWelcome.start();
  loadWalkerNames(); // 開頭畫面的名字按鈕也要用，不等狗的資料
  appState.loadState = 'loading';
  appState.loadWarning = '';
  render();
  let data;
  try {
    data = await loadDogsData();
  } catch (e) {
    console.error(e);
    appState.loadState = 'error';
    render();
    return;
  }
  applyDogsData(data);
}

// 換上讀到的 dogs.json（打開網頁時、按「更新」拿到新資料時）

appState.dataSyncedAt = null;
function applyDogsData(data) {
  appState.allDogs = mergeTempCages(data.dogs);
  // 背景讀回不重排正在操作的清單；換分頁仍照原約定重排。
  if (appState.walkOrder) appState.walkOrderFor = appState.allDogs;
  if (appState.detailDog) {
    const current = appState.allDogs.find(d => (d.id || d.dogId) === (appState.detailDog.id || appState.detailDog.dogId));
    if (current) appState.detailDog.covered = current.covered;
  }
  appState.photoVersions = data.photoVersions || {};
  appState.groupMap = data.groups || {};
  if (typeof receiveGroupData === 'function') receiveGroupData(data);
  appState.sheetNotes = Array.isArray(data.sheetNotes) ? data.sheetNotes : [];
  appState.loadWarning = data.groups ? '' : '「可以一起溜」暫時讀不到，其他資訊正常。';
  // 顯示試算表最後同步的時間（不是打開網頁的時間），志工才知道資料有多新
  appState.dataSyncedAt = data.syncedAt;
  renderUpdatedLabel();
  appState.loadState = 'ready';
  render();
  loadMyWalks();
  loadRest();
  appState.favorites.syncFavs();
  loadTodayWalks();
  if (appState.detailDog) renderDetail();
}

// 頁首的資料時間；沒網路時改寫「沒網路・資料 10/8 09:01」，志工才知道看的是舊資料、溜了寫不進試算表
function renderUpdatedLabel() {
  const el = document.getElementById('updatedLabel');
  if (!el) return;
  const t = appState.dataSyncedAt;
  const when = t ? `${t.getMonth() + 1}/${t.getDate()} ${pad2(t.getHours())}:${pad2(t.getMinutes())}` : '';
  const off = isOffline();
  el.textContent = off ? (when ? `沒網路・資料 ${when}` : '沒網路') : when ? `資料更新 ${when}` : '';
  el.classList.toggle('offline', off);
}

// 今日溜狗紀錄：顯示在螢幕上時每分鐘抓；鎖螢幕、切到別的 App 時不抓，切回來超過 30 秒就馬上抓

// ── 頁首「更新」按鈕（#512）：狗清單有人編輯就直接進 D1，按了只重讀 D1，不叫同步 ──
// 一定重抓狗清單、今日紀錄和試算表名單，再全部重排（K 2026-10-20：網站上按的不會讓試算表「有改」）
// 今日紀錄、名單不等回應：先照現有資料重排，讀到新的再排一次（抓不到就維持現況）
appState.syncing = false;
function freshWalkList() {
  appState.todayFetchedAt = 0;
  const resort = () => { resetWalkOrder(); render(); };
  resort();
  Promise.all([loadTodayWalks(), loadWalkerNames()]).then(resort, () => {});
}
async function refreshData(btn) {
  if (appState.syncing) return;
  appState.syncing = true;
  await loadSettings();
  render();
  if (appState.detailDog) renderDetail();
  btn.classList.add('syncing');
  btn.setAttribute('aria-busy', 'true');
  try {
    try { applyDogsData(await loadDogsData()); } catch (e) {
      BQWalkUI.showToast('暫時讀不到資料，請稍後再更新');
      return;
    }
    freshWalkList();
    BQWalkUI.showToast('資料已更新');
  } finally {
    appState.syncing = false;
    btn.classList.remove('syncing');
    btn.removeAttribute('aria-busy');
  }
}

const syncBtn = document.getElementById('syncBtn');

// tests/index.html 會設定 __BQ_TEST__，只載入函式、不去讀 dogs.json
// 等 find.js、analysis.js 也載入完才開始：dogs.json 提早抓（手機開啟加速）可能比它們先到，畫面要用到它們的函式
// Entry point starts only after every imported page module has initialized.
function startApp() {
if (!window.__BQ_TEST__) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}
}

export { fixedCareEdits, FIRST_SCREEN_CARDS, WALKER_CODES_KEY, WALKER_CODE_PATTERN, SPECIAL_KEYWORDS, AMBER_DAYS, RED_DAYS, detailEdits, introOverrides, mergeTempCages, loadDogsData, fetchDogsData, parseMyWalks, apiData, fetchWalks, walkYears, recentStartMonth, missingWalkYears, loadWalkYear, loadMyWalks, currentMyWalks, myWalksCount, mineTabNumber, mineTabLabel, loadMyCodes, saveMyCodes, walkerCodesFor, dogOfWalk, walkDateLabel, myWalkGroups, myVisitCard, myMonthStats, myProgressHtml, myWalksHtml, myCalendarState, myCalendarHtml, specialFlag, highlightNote, effectiveWalkDate, computeStatus, restOf, monthDay, esc, icon, versioned, photoOverrides, photoSrc, photoThumbSrc, thumbFallback, thumbAttrs, photoThumb, lightboxOpen, insidePhoto, openLightbox, showLightboxPhoto, hideLightbox, closeLightbox, statusBadge, lastWalk, cardMeta, tempCageText, metaLine, ymdOf, reentryLine, openFormerEdit, sendFormer, saveFormer, removeFormer, sexMark, warnNote, loadWalkedIds, saveWalkedIds, walkKey, walkedNow, walkedToday, recordWalked, WALKER_NAME_KEY, WALKER_NAME_SEP, allWalkerNames, isOffline, setWalkerNamesOffline, loadWalkerNames, TODAY_POLL_MS, TODAY_REFETCH_MS, fetchWalkStatus, loadTodayWalks, refreshTodayWalks, canonicalWalker, splitWalkers, walkerList, loadCompanions, loadWalkWith, addWalkWith, clearWalkWith, firstWalkerName, loadWalkerName, saveWalkerName, loadSheetWrites, saveSheetWrites, myAliasIn, walkRegistration, d1Base, NEED_EDITOR, editorName, editorHeaders, APPEND_MAX, appendEntry, nextLogLabel, appendPreview, sheetAppendHtml, rerenderAppend, sendAppend, dogCard, favButtonHtml, detailHtml, restNoteHtml, isoDay, fixedCareHtml, toggleFixedCare, restAdminHtml, INTRO_MAX, intakeEventsOf, intakeDraft, intakePresentation, intakeListHtml, intakeEditorHtml, introOf, introSectionHtml, introBarHtml, openIntroEdit, saveIntro, STAYS_MAX, staysSectionHtml, openStaysEdit, staysProblem, saveStays, openRestEdit, saveRest, loadRest, departedDetailHtml, DEPARTURE_LABELS, ymdText, departureBadge, departureBasis, lastWalkSection, detailChips, imageToLocal, buddyTile, cageMates, togetherSection, groupWalkButton, DETAIL_CLICKS, wireDetail, labelPhotoPick, detailEditorViewport, renderDetail, showDetail, hideDetail, closeDetail, cardFromEvent, searchKey, matchesSearch, TABS, buildTabs, switchTab, stepTab, mainEl, render, skeletonHtml, appHeader, syncHeaderShadow, appBrand, syncHeaderTuck, bottomBarEl, syncBottomBar, dayWord, rangeText, rangeLabel, syncRange, queueRange, dueDogs, walkPinned, sortWalkList, pinWalkOrder, resetWalkOrder, WALK_FAV_KEY, loadWalkFav, saveWalkFav, walkFilterHtml, WALK_VIEW_KEY, loadWalkView, saveWalkView, walkToolsHtml, walkRow, renderMain, searchInput, searchClear, syncSearchClear, pad2, openGuide, init, applyDogsData, renderUpdatedLabel, freshWalkList, refreshData, syncBtn, startApp };
export { appState } from './page-state.js';
export { parseDogsData } from './dog-data.js';

export function bindApp() {
  document.addEventListener('click', e => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    const open = t.closest('[data-append-open]');
    if (open) {
      const kind = open.dataset.appendOpen;
      appState.sheetAppend = { kind, dog: kind === 'note' ? appState.detailDog : null, text: '', phase: 'edit', error: '' };
      rerenderAppend(kind, '#appendText');
      return;
    }
    if (!appState.sheetAppend) return;
    const kind = appState.sheetAppend.kind;
    if (t.closest('[data-append-cancel]')) { appState.sheetAppend = null; rerenderAppend(kind, `[data-append-open="${kind}"]`); return; }
    if (t.closest('[data-append-back]')) { appState.sheetAppend.phase = 'edit'; appState.sheetAppend.error = ''; rerenderAppend(kind, '#appendText'); return; }
    if (t.closest('[data-append-send]')) sendAppend();
  });
  document.addEventListener('input', e => {
    if (!appState.sheetAppend || !e.target || e.target.id !== 'appendText') return;
    appState.sheetAppend.text = e.target.value;
    const btn = e.target.form && e.target.form.querySelector('.my-note-save');
    if (btn) btn.disabled = !e.target.value.trim();
  });
  document.addEventListener('submit', e => {
    if (!appState.sheetAppend || !e.target.matches || !e.target.matches('[data-append-form]')) return;
    e.preventDefault();
    if (!appState.sheetAppend.text.trim()) return;
    appState.sheetAppend.phase = 'preview'; appState.sheetAppend.error = '';
    rerenderAppend(appState.sheetAppend.kind, '[data-append-send]');
  });
  window.addEventListener('popstate', e => {
    if (findZoomOpen()) findZoomHide(); // 找狗平面圖全螢幕（#102，js/find.js）
    else if (BQPhoto.cropOpen()) BQPhoto.hideCropper();
    else if (lightboxOpen()) hideLightbox();
    else if (findState.whereDog) whereHide(); // 在哪面板（#111，js/find.js）
    else if (appState.detailDog) hideDetail();
    else if (e.state && e.state.bqNavigation) {
      appState.activeTab = e.state.base || 'walk';
      appState.groupsReturnTab = e.state.returnTab || 'walk';
      switchTab(e.state.tab, false);
      if (e.state.tab === 'info') restoreInfoPage(e.state.infoPage || '');
    }
    else if (appState.analysisOpen) hideAnalysis();
    else if (appState.activeTab === 'groups') switchTab(appState.groupsReturnTab, false);
  });
  document.getElementById('detailBackdrop').addEventListener('click', e => {
    if (e.target.id === 'detailBackdrop') closeDetail();
  });
  document.addEventListener('keydown', e => {
    if (typeof findState.whereDog !== 'undefined' && findState.whereDog) return; // 在哪面板（#111）自己處理 Esc、Tab
    if (BQPhoto.cropOpen()) {
      // 裁切畫面：Esc 取消，Tab 只在裁切畫面的按鈕間移動
      if (e.key === 'Escape') BQPhoto.closeCropper(null);
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
    if (e.key === 'Escape' && appState.detailDog) closeDetail();
    if (e.key !== 'Tab' || !appState.detailDog) return;
    // 我的備註編輯時（#62）文字框和欄位也要能用 Tab 走到
    const buttons = [...document.querySelectorAll('#detail button:not(:disabled), #detail textarea:not(:disabled), #detail select:not(:disabled), #detail input:not([hidden]):not(:disabled), #toast:not([hidden]) button:not([hidden])')];
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (!first) return;
    if (!buttons.includes(document.activeElement) || (e.shiftKey && document.activeElement === first) || (!e.shiftKey && document.activeElement === last)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus({ preventScroll: true });
    }
  });
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
    else if (btn) BQWalkUI.setWalked([dog], btn.dataset.walk === 'add');
    else if (thumb && dog.id && !thumb.classList.contains('no-photo')) openLightbox(dog, thumb.closest('.card'));
    else showDetail(dog);
  });
  document.getElementById('main').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('button')) return; // 按鈕自己會觸發 click
    const dog = cardFromEvent(e);
    if (dog) { e.preventDefault(); showDetail(dog); }
  });

  document.addEventListener('keydown', () => { appState.lastInputTouch = false; }, true);
  document.addEventListener('pointerdown', e => { appState.lastInputTouch = e.pointerType === 'touch'; }, true);
  window.addEventListener('scroll', syncHeaderShadow, { passive: true });
  syncHeaderTuck();
  window.addEventListener('resize', syncHeaderTuck);
  syncBottomBar();
  if (bottomBarEl && typeof ResizeObserver === 'function') new ResizeObserver(syncBottomBar).observe(bottomBarEl);

  window.addEventListener('scroll', queueRange, { passive: true });
  window.addEventListener('resize', queueRange);

  mainEl.addEventListener('click', e => {
    if (e.target.closest('#restRetry')) { loadRest(); return; }
    const tile = e.target.closest('[data-mine-dog]');
    if (tile) showDetail(appState.allDogs[tile.dataset.mineDog]);
    else if (e.target.closest('#mineRetry')) loadMyWalks();
    else if (e.target.closest('#mineStats')) { appState.mineStatsOpen = !appState.mineStatsOpen; render(); }
    else if (e.target.closest('[data-mine-month]')) {
      const src = e.target.closest('[data-mine-month]');
      const dir = src.classList.contains('next') ? '.next' : ':not(.next)';
      appState.mineMonth = src.dataset.mineMonth; appState.mineDay = ''; loadWalkYear(appState.mineMonth); render();
      const b = document.querySelector(`#main .mc-nav${dir}:not(:disabled)`) || document.querySelector('#main .mc-nav:not(:disabled)');
      if (b) b.focus({ preventScroll: true });
    }
    else if (e.target.closest('[data-mine-day]')) { appState.mineDay = e.target.closest('[data-mine-day]').dataset.mineDay; render(); const b = document.querySelector('#main .mc-cell.sel'); if (b) b.focus({ preventScroll: true }); }
    else if (e.target.closest('[data-open-guide]')) openGuide();

  });
  BQWelcome.bindSetup();
  searchInput.addEventListener('input', e => {
    syncSearchClear();
    if (e.isComposing) return;
    appState.searchQuery = e.target.value;
    render();
  });
  searchInput.addEventListener('compositionend', e => {
    syncSearchClear();
    appState.searchQuery = e.target.value;
    render();
  });
  if (searchClear) searchClear.addEventListener('click', () => {
    searchInput.value = '';
    appState.searchQuery = '';
    syncSearchClear();
    render();
    searchInput.focus();
  });

  window.addEventListener('offline', () => { renderUpdatedLabel(); render(); renderDetail(); });
  window.addEventListener('online', () => { renderUpdatedLabel(); render(); renderDetail(); loadWalkerNames(); appState.favorites.syncFavs(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) appState.favorites.syncFavs(); });
  document.addEventListener('visibilitychange', refreshTodayWalks);
  if (!window.__BQ_TEST__) setInterval(refreshTodayWalks, TODAY_POLL_MS);

  if (syncBtn) syncBtn.addEventListener('click', () => refreshData(syncBtn));
}
