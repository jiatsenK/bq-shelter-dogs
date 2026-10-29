import { canShow, loadSettings } from './feature-settings.js';
import { BQApi } from './api.js';
import { BQStore } from './store.js';
import { analysisState, appState, findState, groupStageState } from './page-state.js';
import { parseDogsData } from './dog-data.js';
import { BQDates } from './dates.js';
import { BQWelcome } from './welcome.js';
import { BQPhoto } from './photo.js';
import { findPageHtml, whereKnown, whereOpen } from './find.js';
import { BQWalkUI } from './walk-ui.js';
import { BQWalks } from './walk-flow.js';
import { BQFavorites } from './favorites.js';
import { INFO_PAGES, analysisPageHtml, hideAnalysis, restoreInfoPage, shareFromInfo } from './analysis.js';
import { groupStageHtml, receiveGroupData, refreshGroupStage } from './group-stage.js';
import { BQTour } from './tour.js';
import { deskClearChecked, deskOn, deskWalkHtml } from './desk.js';
import { deskMineHtml } from './desk-mine.js';
import { esc, highlightNote, icon, matchesSearch, monthDay, pad2, searchKey } from './ui-kit.js';
import { dogStatus, restFrom, sortDue, specialFlag, walkKey } from './dog-status.js';
import { closeDetail, renderDetail, showDetail } from './detail.js';
import { bindSheetAppend } from './sheet-append.js';
import { bindOverlays, closeOverlay, pushOverlay, pushPage, registerOverlay, trapFocus } from './overlays.js';

// 狗狗資料：試算表同步進 D1（#245），網站從 Worker 的 /api/dogs 讀；前端不直接連試算表（#32）
// 照片上傳服務（Cloudflare Worker，#47／#48）的網址。這裡只放網址，GitHub 寫入權限只在 Worker 裡，網站碰不到
// - 網站和 Worker 是同一個 Cloudflare Worker（#125）：API 就在同一個網址的 /api 底下（本機用 wrangler dev 也一樣）
// - 舊的單獨照片上傳 Worker 和舊網址的判斷 2026-10 拿掉了（舊網址只剩轉址，#129）
// 留空的話詳細資訊不顯示上傳按鈕；測試可經 appState 開關寫入。呼叫 /api 都經過 BQApi。
appState.UPLOAD_URL = BQApi.base();
// 手機第一屏大約看得到幾張狗卡：這幾張的照片不延後載入、優先下載（#91）
const FIRST_SCREEN_CARDS = 8;
// 我最近溜過（#58）：同步時累積的遛狗紀錄（#56）。#96 起每個志工看自己的：
// 紀錄裡的 walkers 是遛的人的代號，志工在「我溜過」輸入名字、經 Worker 換成代號後記在這支手機
// 休養中（K 2026-10-09）：在網站上設定「到哪天前暫停帶出」，經 Worker 存 D1、記編輯紀錄，不碰試算表
const WALKER_CODES_KEY = BQStore.keys.walkerCodes;
const WALKER_CODE_PATTERN = /^[0-9a-f]{12}$/; // 跟 Worker 的 WALKER_CODE_LENGTH 一致
// 這間收容所的設定在 js/site-config.js（K 2026-10-10：以後其他收容所要用，只改那個檔）；天數色標與警示關鍵字見 js/dog-status.js

// 圖鑑（cards.html）的「去設定」連到 index.html#mine，直接打開我溜過

appState.allDogs = [];
appState.groupMap = {};
appState.activeTab = typeof location !== 'undefined' && ['#mine', '#find', '#groups'].includes(location.hash) ? location.hash.slice(1) : 'walk';
appState.groupsReturnTab = 'walk';
appState.detailDog = null; // 詳細資訊正在看的狗
appState.detailOpener = null;
appState.detailTrail = []; // 在詳細資訊裡點「可以一起溜」換過的狗（#99）：可以按「回到 ○○」一隻一隻回去
appState.restMap = {}; // 休養中：編號 → { until: 'YYYY-MM-DD', reason }
appState.restState = 'loading'; // 初次休養設定未到齊前，不先排出不完整的溜狗表
appState.restLoaded = false; // 首次失敗後重試，必須補建可靠排序
appState.detailWalksOpen = false; // 詳細資訊的溜狗紀錄有沒有展開每一天（K 2026-10-10 減法：預設只有一行字）
appState.staysEdit = null; // 詳細資訊正在改的出入所紀錄（#333）：{ dog, before, rows, phase: 'edit'|'saving'|'error', error }
appState.introEdit = null; // 詳細資訊正在改的入所介紹（K 2026-10-10 補資料）：{ dog, text, phase: 'edit'|'saving'|'error', error }

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
// syncFavs：常溜同步自己換身分時傳 false，不然會再排一次同步、一直循環
function saveMyCodes(codes, { syncFavs = true } = {}) {
  appState.walkerCodesMemory = codes.length ? [...codes] : null;
  try {
    if (appState.phoneStore && codes.length) appState.phoneStore.writeJson(WALKER_CODES_KEY, codes);
    else if (appState.phoneStore) appState.phoneStore.remove(WALKER_CODES_KEY);
  } catch (e) { /* 存不了就只記在記憶體 */ }
  try { appState.myWalks = appState.walksData ? parseMyWalks(appState.walksData, codes) : []; } catch (e) { appState.myWalks = []; }
  if (syncFavs) appState.favorites.syncFavs();
}
// Worker 回的志工身分（identity.js）存進這支手機：登記名字和代號一起換
function saveIdentity(identity, options) {
  saveWalkerName(identity.name);
  saveMyCodes(identity.codes, options);
}
// 跟 Worker 換身分時比對的這支手機現況（identity.js 的 read）
const currentIdentity = () => ({ name: loadWalkerName(), codes: loadMyCodes() });

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
  const confirmedToday = walkRegistration.today(appState.allDogs, BQDates.localDateKey(today)).some(row => row.mine);
  if (appState.todayState === 'loading' || (appState.myWalksState === 'loading' && !confirmedToday)) return `<div class="status-msg">讀取溜狗紀錄中…</div>`;
  if (appState.myWalksState === 'error' && !confirmedToday) {
    return `<div class="status-msg">溜狗紀錄讀不到，請確認網路後按「重新讀取」。<br><button class="retry-btn" id="mineRetry">重新讀取</button></div>`;
  }
  // 電腦版（critique 2026-10-28）：月曆撐寬、右欄放當天明細和統計，在 js/desk-mine.js
  if (deskOn()) return deskMineHtml(today, query);
  if (BQWelcome.needsSetup()) return BQWelcome.setupHtml();
  // #138 之前設定的只有代號、沒記名字：請他再輸入一次，按溜了才能寫進試算表
  const named = !!loadWalkerName();
  // V9（#141 第 11 項）：小計收進「統計」按鈕，按了才展開；統計、修改是綠色底線字，名字前不放腳掌（#738）
  const statsBtn = visibleWalks.length ? `<button type="button" class="who-edit${appState.mineStatsOpen ? ' on' : ''}" id="mineStats" aria-expanded="${appState.mineStatsOpen}">統計</button>` : '';
  const who = query ? '' : `<div class="section-hint who-hint"><span class="who-name">${named ? esc(loadWalkerName()) : '再按「修改」輸入一次名字'}</span>${statsBtn}<button type="button" class="who-edit" id="whoEdit">修改</button></div>`;
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



function effectiveWalkDate(dog, today = new Date()) {
  return BQDates.parseYmd(walkRegistration.state(dog, BQDates.localDateKey(today)).date);
}

// 規則在 js/dog-status.js；這裡帶入今天的登記狀態與休養設定
function computeStatus(dog, today) {
  return dogStatus(dog, today, { rest: restOf(dog, today), walk: walkRegistration.state(dog, BQDates.localDateKey(today)) });
}

function restOf(dog, today = new Date()) {
  return restFrom(dog, today, appState.restMap);
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
  return photoOverrides[dog.id] || versioned(`photos/${encodeURIComponent(dog.id||dog.dogId)}.jpg`);
}

// 縮圖（#83）：清單只載 photos/thumbs/ 的小圖，燈箱才看原圖；縮圖由 Action 產生（scripts/make-thumbs.py）
// 剛上傳的照片先用本機圖片；縮圖還沒產生就在 img 的 onerror 改讀 data-full 的原圖（thumbFallback）
function photoThumbSrc(dog) {
  return photoOverrides[dog.id] || versioned(`photos/thumbs/${encodeURIComponent(dog.id)}.jpg`);
}
// 放在 img 的 onerror 最前面：還有原圖可試就換原圖、這次不算讀取失敗。
// 縮圖只在上傳時產生一次（#305），沒產生的框標 thumb-full（#646 起畫面不顯示小圓點，查哪張沒縮圖用開發者工具）
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
  pushOverlay('lightbox');
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
  closeOverlay('lightbox');
}
registerOverlay('lightbox', { isOpen: lightboxOpen, hide: hideLightbox });

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
// #558 起以 D1 今日紀錄為準（walkRegistration）；手機只記同行人與尚未查明的登記識別。

appState.phoneStore = BQStore;
appState.walkRecords = BQWalks.createRecords({ store: () => appState.phoneStore, dates: BQDates, key: walkKey });

// 今天名單包含自己就算已登記；本機暫存只用於尚未收到寫入結果時。
function walkedNow(dog, today = new Date()) {
  return walkRegistration.state(dog, BQDates.localDateKey(today)).mine;
}

// 今天已溜的查詢入口（#85）：問「這隻溜了沒」都用它
function walkedToday(today = new Date()) {
  return { has: dog => walkedNow(dog, today) };
}

// 我的常溜的快取、排隊及同步由 favorites.js 管理。

// ── 按「溜了」：經過 Worker 的 /walk 寫進 D1（#558、ADR 0018），Worker 再同步到試算表 ──
appState.favorites = BQFavorites.create();
const WALKER_NAME_KEY = BQStore.keys.walkerName;
// 跟 worker/src/sheet-read.js 的 NAME_SEP 一樣
const WALKER_NAME_SEP = /[、,，\/／&＆+＋。｡．.;；:：|｜·・\s]+/;

// ── 誰遛的名字（#141 第 9 項）──
// 名字不放進公開的 repo（dogs.json 只有代號）：打開網頁時跟 Worker 拿（GET /api/walkers，Worker 從 D1 讀，#519），
// 只在畫面上顯示。{ 狗的 key: '志工甲+志工乙' }；拿不到就不顯示名字，其他照常

appState.walkerNameMemory = '';
appState.sheetWriteState = 'unknown'; // unknown／on／off
appState.sheetQueue = Promise.resolve();
appState.walkerNames = {};
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
      appState.walkerNameList = [...new Set((Array.isArray(out.names) ? out.names : []).map(canonicalWalker).filter(Boolean))];
      appState.walkerOlderNames = [...new Set((Array.isArray(out.older) ? out.older : []).map(canonicalWalker).filter(Boolean))];
      appState.walkerCodeNames = out.codes && typeof out.codes === 'object' ? out.codes : {};
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
function receiveTodayWithDogs(today) {
  if (today?.source !== 'd1' || today.date !== BQDates.localDateKey(new Date()) || !Array.isArray(today.walks)) return false;
  walkRegistration.receiveToday(today, appState.allDogs);
  appState.todayFetchedAt = Date.now();
  appState.todayState = 'ready';
  return true;
}
async function loadTodayWalks() {
  appState.todayFetchedAt = Date.now();
  const received = await walkRegistration.loadToday(() => appState.allDogs);
  if (appState.todayState === 'loading' && received) { appState.todayState = 'ready'; render(); }
}
function refreshTodayWalks() {
  if (typeof document !== 'undefined' && document.hidden) return;
  if (Date.now() - appState.todayFetchedAt < TODAY_REFETCH_MS) return;
  loadTodayWalks(); // #460：人工改表由伺服器比對後進 D1 資料包，手機不再每分鐘讀試算表名單
}
// 一格好幾個名字（「志工甲+志工乙」「志工丙。志工丁」）拆開，用頓號接起來，不重複；名字後面的「經常帶」敘述去掉
function canonicalWalker(name) {
  return String(name || '').trim().replace(/經常帶.*$/, '').trim();
}
function splitWalkers(text) {
  return [...new Set(String(text || '').split(WALKER_NAME_SEP).map(n => n.trim()).filter(Boolean))];
}
// 上次是誰溜的：這支手機今天按過溜了就是自己；否則用試算表的「誰遛的」
// 同一個人的不同寫法（例：名字後面多了「經常帶」）只顯示一次
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

function myAliasIn(dog, today = new Date()) {
  const me = loadWalkerName();
  if (!me || !dog.walkedDate || BQDates.localDateKey(dog.walkedDate) !== BQDates.localDateKey(today)) return null;
  return splitWalkers(appState.walkerNames[walkKey(dog)]).find(n => n !== me && canonicalWalker(n) === canonicalWalker(me)) || null;
}

// 畫面提供當下身分與狗清單；HTTP、手機紀錄與結果分類由 BQWalks 處理。
const walkRegistration = BQWalks.create({
  records: () => appState.walkRecords, store: () => appState.phoneStore, api: BQApi, dates: BQDates,
  enabled: () => !!appState.UPLOAD_URL,
  getWriteState: () => appState.sheetWriteState, setWriteState: state => { appState.sheetWriteState = state; },
  key: walkKey, date: () => BQDates.localDateKey(new Date()), walker: loadWalkerName, alias: myAliasIn,
  canonical: canonicalWalker, split: splitWalkers,
  names: () => loadMyCodes().map(code => appState.walkerCodeNames[code]).filter(Boolean),
  base: d1Base,
  // #643：手機說沒網路就不送，算確定沒登記到
  offline: () => typeof navigator !== 'undefined' && navigator.onLine === false,
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

// 狗名是 tabindex=-1 的按鈕（#644）：鍵盤停在整張卡就好；手機的觸控修正會把點擊吸到最近的可點元素，狗名不可點時吸到籠位標籤、開成在哪
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
            <button type="button" class="name" tabindex="-1">${esc(dog.name)}${sexMark(dog)}</button>
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

// 初次讀取前不顯示未確認的排序；背景讀取失敗保留已知設定。
async function loadRest() {
  const before = appState.restMap;
  try {
    const data = await fetchWalkStatus(signal => BQApi.rest({ signal }));
    if (!data || !data.rest || typeof data.rest !== 'object' || Array.isArray(data.rest)) throw new Error('休養設定格式不對');
    // 讀的期間這支手機剛改過設定，不蓋掉自己的修改。
    if (appState.restMap === before) appState.restMap = data.rest;
    appState.restLoaded = true;
    appState.restState = 'ready';
  } catch (e) { appState.restState = 'error'; }
  render();
  if (appState.detailDog) renderDetail();
}

// 燈箱開著時「返回」只關燈箱，詳細資訊留著

// 狗卡用事件委派：renderMain 每次重畫卡片都不用重新綁
function cardFromEvent(e) {
  const card = e.target.closest('#main .card[data-dog], #main .row-dog[data-dog]');
  return card && appState.allDogs[card.dataset.dog];
}
// 點「已遛／移回」只記錄，不開詳細資訊；點照片開燈箱（#46，沒照片就照舊開詳細資訊）；點卡片其他地方開詳細資訊



// 主分類（V3，#33）：順序就是左右滑動切換的順序
const TABS = [
  { id: 'walk', label: '溜狗表', icon: 'list' },
  { id: 'groups', label: '常溜狗群', icon: 'group' },
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
// 頁籤的歷史紀錄：按返回時照這筆換回頁籤（bindOverlays 的 navigate）
function navigationState(tab) {
  return { bqNavigation: true, tab, base: appState.activeTab, returnTab: appState.groupsReturnTab, infoPage: typeof analysisState.infoPage === 'undefined' ? '' : analysisState.infoPage };
}
function switchTab(id, pushHistory = true) {
  // find 保留給舊入口與操作教學，底部不再佔一格。
  if (id !== 'find' && !TABS.some(t => t.id === id)) return;
  const changed = id !== (appState.analysisOpen ? 'info' : appState.activeTab);
  const before = pushHistory && changed ? navigationState(appState.analysisOpen ? 'info' : appState.activeTab) : null;
  if (id === 'groups' && appState.activeTab !== 'groups') appState.groupsReturnTab = appState.analysisOpen ? 'info' : appState.activeTab;
  if (pushHistory && changed && id === 'info') analysisState.infoPage = '';
  appState.analysisOpen = id === 'info';
  if (!appState.analysisOpen) appState.activeTab = id;
  if (before) pushPage(before, navigationState(id));
  if (changed && id === 'groups') refreshGroupStage();
  if (changed) deskClearChecked();
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

// 頁首收起（critique 2026-10-09 P1）：往下捲時標題那一行跟著捲走，手機搜尋框在表頭下面另外黏住（.page-search），
// 狗卡多看得到一兩隻；捲回最上面就回來。用 sticky 負 top 做，不判斷捲動方向，畫面不會跳
const appBrand = appHeader && appHeader.querySelector('.brand');
function syncHeaderTuck() {
  if (!appHeader || !appBrand || typeof getComputedStyle !== 'function') return; // node 測試的假 DOM 沒有
  document.documentElement.style.setProperty('--app-header-height', `${appHeader.getBoundingClientRect().height}px`);
  const pad = parseFloat(getComputedStyle(appHeader).paddingTop) || 0;
  document.documentElement.style.setProperty('--brand-h', `${Math.round(pad + appBrand.offsetHeight)}px`);
}
// 上面黏住的頁首＋手機搜尋框蓋到哪裡：捲狗卡進畫面時要躲開（K 2026-10-26 搜尋框跟著捲）
function stickyTopBottom() {
  const page = document.getElementById('pageSearch');
  const head = appHeader ? appHeader.getBoundingClientRect().bottom : 0;
  return page && page.offsetHeight ? Math.max(head, page.getBoundingClientRect().bottom) : head;
}

// 常溜狗群「溜了」那排黏在底部分類列上方（#443）：分類列高度隨字級、安全區變，量實際高度
const bottomBarEl = document.getElementById('bottomBar');
function syncBottomBar() {
  if (typeof bottomBarEl?.getBoundingClientRect !== 'function') return; // node 測試的假 DOM 沒有
  document.documentElement.style.setProperty('--bottom-bar-height', `${bottomBarEl.getBoundingClientRect().height}px`);
}

// 溜狗表排序規則在 js/dog-status.js
function dueDogs(dogs, today) {
  return sortDue(dogs, d => computeStatus(d, today));
}

// 溜狗表一律最久沒溜在前（2026-10-08 K 同意介面評估：拿掉排序切換和「幾天以上」篩選，天數的顏色就看得出來）。
// K 2026-10-21（#445）：按了溜了直接照天數排到後面，不再固定在原位（取代 2026-10-08 介面評估 P0 與 #418）

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
// 列表模式的天數色籤；常溜狗群的狗列共用（#738），同一隻狗兩邊文字與顏色一樣
function dayChip(dog, today) {
  const s = computeStatus(dog, today);
  const days = s.kind === 'dated'
    ? (s.days < 0 ? '?<span class="sr-only">日期看不懂</span>' : s.days === 0 ? '今天' : `<b>${s.days}</b>天<span class="sr-only">前</span>`)
    : s.kind === 'covered' ? '固定<span class="sr-only">有人照顧</span>'
    : s.kind === 'rest' ? `休養<span class="sr-only">中，${monthDay(s.until)} 前暫停帶出</span>` : '—<span class="sr-only">沒有紀錄</span>';
  return `<span class="r-date ${s.kind === 'rest' ? 'rest' : s.level || 'muted'}">${days}</span>`;
}
function walkRow(dog, today) {
  const flag = specialFlag(dog.note);
  return `<div class="row-dog${flag ? ' flagged' : ''}" data-dog="${appState.allDogs.indexOf(dog)}" role="button" tabindex="0" aria-haspopup="dialog">
    ${dayChip(dog, today)}
    <button type="button" class="r-name" tabindex="-1">${esc(dog.name)}</button>
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
  // 常溜狗群也有搜尋狗名（K 2026-10-17）：前三個主分頁都能搜尋，資訊沒有
  document.documentElement.classList.toggle('head-search', !appState.analysisOpen && appState.activeTab === 'groups');
  document.documentElement.classList.toggle('head-sub', appState.analysisOpen && !!analysisState.infoPage);
  const title = document.querySelector('.head-title');
  if (title) title.textContent = appState.analysisOpen ? (INFO_PAGES[analysisState.infoPage] || '資訊') : '常溜狗群';
  const back = document.getElementById('analysisBack');
  if (back) back.innerHTML = `${icon('back')}回${(TABS.find(t => t.id === (appState.analysisOpen ? appState.activeTab : appState.groupsReturnTab)) || TABS[0]).label}`;

  if (back && appState.analysisOpen && analysisState.infoPage) back.innerHTML = `${icon('back')}回資訊`;
  syncHeaderTuck();
  // #273 資訊分類與子頁。
  if (appState.analysisOpen) {
    buildTabs(appState.loadState === 'ready' ? { walk: appState.allDogs.filter(d => matchesSearch(d, appState.searchQuery.trim())).length, mine: myWalksCount('') } : {});
    if (!(canShow('updates') && analysisState.infoPage === 'updates' && main.querySelector('#infoEdits'))) main.innerHTML = analysisPageHtml(today);
    return;
  }
  if (appState.activeTab === 'groups') {
    buildTabs(appState.loadState === 'ready' ? { walk: appState.allDogs.filter(d => matchesSearch(d, appState.searchQuery.trim())).length, mine: myWalksCount('') } : {});
    searchInput.placeholder = '搜尋狗名'; // 狗群只比對狗名（#646）
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
  // V9（#141）：沒有今天已溜和收起了，全部的狗都在溜狗表；按過溜了的顯示今天、照天數排到後面（#445）
  const walkList = (appState.activeTab === 'walk' ? dueDogs(appState.allDogs, today) : appState.allDogs).filter(hit);
  // 介面評估第三輪（K 2026-10-08）：找狗分頁不放數字（跟溜狗表一樣是全部的狗）；
  // 我溜過一律是全部紀錄筆數，不跟著搜尋變（搜不到時「我溜過 0」像紀錄不見了）
  buildTabs({ walk: walkList.length, mine: myWalksCount('') });
  searchInput.placeholder = '狗名、編號或籠位';
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
// groupCheck：狗群頁登記前與背景檢查重讀狗清單時，只補休養與今日登記（登記前要擋休養中的狗）；
// 我溜過、常溜照開頁與按「更新」的時機讀，不跟著每次狗群檢查重抓（R7）

appState.dataSyncedAt = null;
function applyDogsData(data, { groupCheck = false } = {}) {
  appState.allDogs = mergeTempCages(data.dogs);
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
  // 狗清單帶了今天的紀錄（K 2026-10-26）：開頁不用再等 /today，讀到狗清單就能排溜狗表
  const withToday = receiveTodayWithDogs(data.today);
  render();
  if (!groupCheck) loadMyWalks();
  loadRest();
  if (!groupCheck) appState.favorites.syncFavs();
  if (!withToday) loadTodayWalks();
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
  render();
  Promise.all([loadTodayWalks(), loadWalkerNames()]).then(render, () => {});
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

export { FIRST_SCREEN_CARDS, WALKER_CODES_KEY, WALKER_CODE_PATTERN, saveIdentity, currentIdentity, mergeTempCages, loadDogsData, fetchDogsData, parseMyWalks, apiData, fetchWalks, walkYears, recentStartMonth, missingWalkYears, loadWalkYear, loadMyWalks, currentMyWalks, myWalksCount, mineTabNumber, mineTabLabel, loadMyCodes, saveMyCodes, walkerCodesFor, dogOfWalk, walkDateLabel, myWalkGroups, myVisitCard, myMonthStats, myProgressHtml, myWalksHtml, myCalendarState, myCalendarHtml, effectiveWalkDate, computeStatus, restOf, versioned, photoOverrides, photoSrc, photoThumbSrc, thumbFallback, thumbAttrs, photoThumb, lightboxOpen, insidePhoto, openLightbox, showLightboxPhoto, hideLightbox, closeLightbox, lastWalk, cardMeta, tempCageText, sexMark, warnNote, walkedNow, walkedToday, WALKER_NAME_KEY, WALKER_NAME_SEP, allWalkerNames, isOffline, setWalkerNamesOffline, loadWalkerNames, TODAY_POLL_MS, TODAY_REFETCH_MS, fetchWalkStatus, loadTodayWalks, refreshTodayWalks, canonicalWalker, splitWalkers, walkerList, loadCompanions, loadWalkWith, addWalkWith, clearWalkWith, firstWalkerName, loadWalkerName, saveWalkerName, myAliasIn, walkRegistration, d1Base, NEED_EDITOR, editorName, editorHeaders, dogCard, loadRest, cardFromEvent, TABS, buildTabs, switchTab, mainEl, render, skeletonHtml, appHeader, syncHeaderShadow, appBrand, syncHeaderTuck, stickyTopBottom, bottomBarEl, syncBottomBar, dueDogs, WALK_FAV_KEY, loadWalkFav, saveWalkFav, walkFilterHtml, WALK_VIEW_KEY, loadWalkView, saveWalkView, walkToolsHtml, dayChip, walkRow, renderMain, searchInput, searchClear, syncSearchClear, openGuide, init, applyDogsData, renderUpdatedLabel, freshWalkList, refreshData, syncBtn, startApp };
export { appState } from './page-state.js';
export { parseDogsData } from './dog-data.js';

export function bindApp() {
  bindSheetAppend();
  // 覆蓋層（平面圖放大、裁切、燈箱、在哪、詳細資訊）由 overlays.js 先關；都沒開才換頁籤
  bindOverlays(e => {
    if (e.state && e.state.bqNavigation) {
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
      trapFocus(e, [...document.querySelectorAll('#cropper button, #cropper input')]);
      return;
    }
    if (lightboxOpen()) {
      // Esc 關燈箱，Tab 只在燈箱裡的按鈕間移動
      if (e.key === 'Escape') closeLightbox();
      trapFocus(e, [...document.querySelectorAll('#lightbox button:not([hidden]):not(:disabled), #lightbox input:not([hidden]):not(:disabled)')]
        .filter(b => !b.closest('[hidden]')));
      return;
    }
    if (e.key === 'Escape' && appState.detailDog) closeDetail();
    if (e.key !== 'Tab' || !appState.detailDog) return;
    // 我的備註編輯時（#62）文字框和欄位也要能用 Tab 走到
    trapFocus(e, [...document.querySelectorAll('#detail button:not(:disabled), #detail textarea:not(:disabled), #detail select:not(:disabled), #detail input:not([hidden]):not(:disabled), #toast:not([hidden]) button:not([hidden])')], { edgesOnly: true });
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
    else if (e.target.closest('[data-share-site]')) shareFromInfo();

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
  document.addEventListener('visibilitychange', () => { if (!document.hidden) appState.favorites.syncFavsOnReturn(); });
  document.addEventListener('visibilitychange', refreshTodayWalks);
  if (!window.__BQ_TEST__) setInterval(refreshTodayWalks, TODAY_POLL_MS);

  if (syncBtn) syncBtn.addEventListener('click', () => refreshData(syncBtn));
}
