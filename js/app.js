// 狗狗資料：試算表由 GitHub Action 每天同步成這個檔（#31），前端只讀它、不直接連試算表（#32）
const DATA_URL = 'data/dogs.json';
// 照片上傳服務（Cloudflare Worker，#47／#48）的網址。這裡只放網址，GitHub 寫入權限只在 Worker 裡，網站碰不到
// - 網站放在 Cloudflare（*.workers.dev，#125）：Worker 就在同一個網址的 /api 底下
// - 舊網址（GitHub Pages）和本機測試：用原本單獨的照片上傳 Worker
// 留空的話詳細資訊不顯示上傳按鈕（用 let 是讓 tests/index.html 能換成測試網址）
const OLD_UPLOAD_URL = 'https://bq-shelter-photos.<子網域>.workers.dev';
function uploadUrlFor(loc) {
  return loc && /\.workers\.dev$/.test(loc.hostname) ? `${loc.origin}/api` : OLD_UPLOAD_URL;
}
let UPLOAD_URL = uploadUrlFor(globalThis.location); // 同步腳本的測試在 Node 裡讀這個檔，沒有 location
// 上傳前先在手機上壓成 JPEG：長邊最多 1280px，避免 repo 堆滿手機原圖；上限要跟 Worker 的 MAX_BYTES 一致
const PHOTO_MAX_EDGE = 1280;
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
// 我的備註（#61／#62）：寫入與最新內容都經過同一個 Worker；讀不到 Worker 時改讀網站上的這個檔（可能晚一兩分鐘）
// 相簿：每隻狗除了主照片還能多放幾張（photos/gallery/{編號}/），清單在這個檔；最新清單一樣先問 Worker
const GALLERY_URL = 'data/gallery.json';
// 手機第一屏大約看得到幾張狗卡：這幾張的照片不延後載入、優先下載（#91）
const FIRST_SCREEN_CARDS = 8;
const GALLERY_MAX = 30; // 跟 Worker 的 GALLERY_MAX 一致
const GALLERY_BATCH_MAX = 10; // 相簿一次最多選幾張（一張一張依序傳，Worker 相簿頻率限制 1 分鐘 12 張）
// 我最近溜過（#58）：同步時累積的遛狗紀錄（#56）。#96 起每個志工看自己的：
// 紀錄裡的 walkers 是遛的人的代號，志工在「我溜過」輸入名字、經 Worker 換成代號後記在這支手機
const WALKS_URL = 'data/walks.json';
const WALKER_CODES_KEY = 'bq-walker-codes';
const WALKER_CODE_PATTERN = /^[0-9a-f]{12}$/; // 跟 Worker 的 WALKER_CODE_LENGTH 一致
// 警示關鍵字（2026-09-24 K 定，#28）：備註含任一個，就把備註原文直接顯示在卡片第一層，字眼標紅；
// 只用來判斷要不要顯示，不改寫原文、不另外產生標籤。狗照樣留在待巡房，由志工自己判斷。
// 每組第一個是關鍵字，後面是常見異體寫法，一起比對。志工發現新的慣用字眼時，只要在這裡加一組。
// 「住院」不列入：住院區只是籠位，那裡的狗照常會遛。
const SPECIAL_KEYWORDS = [
  ['勿溜', '勿遛', '勿蹓'],
  ['不要'],
  ['攻擊'],
  ['不親狗'],
  ['不親'],
];
// 天數色標（2026-09-24 K 定案）：0～6 天綠、第 7 天起黃、第 30 天起紅
const AMBER_DAYS = 7;
const RED_DAYS = 30;

let allDogs = [];
let groupMap = {};
let activeTab = 'walk';
let detailDog = null; // 詳細資訊正在看的狗
let detailOpener = null;
let detailTrail = []; // 在詳細資訊裡點「可以一起溜」換過的狗（#99）：可以按「回到 ○○」一隻一隻回去
let photoUpload = null; // 詳細資訊正在上傳的主照片：{ dog, blob, url, phase: 'preview'|'uploading'|'error', error }
// 相簿一次加好幾張：{ dog, phase: 'preview'|'uploading'|'error', items: [{ blob, url, state: 'ready'|'uploading'|'done'|'error', error }] }
let galleryBatch = null;
let gallery = {}; // 相簿：編號 → [{ file, addedAt }]，舊到新
let galleryState = 'loading'; // loading／worker／site／error（同我的備註）
let gallerySwap = null; // 燈箱裡正在設為主照片的相簿照片：{ dog, file }
let galleryDelete = null; // 燈箱裡正在刪的相簿照片：{ dog, file, pass, needPass, phase: 'confirm'|'deleting'|'error', error }
let pickedBuddies = new Set(); // 詳細資訊「可以一起溜」勾選的狗（walkKey）
let searchQuery = '';
let loadWarning = '';
let analysisOpen = false; // 分析頁（#59）開著嗎
let myWalks = []; // 我遛過的紀錄（#58）：[{ id, name, date: Date, ymd }]，新到舊
let walksData = null; // data/walks.json 讀回來的原始內容；換「我是誰」時不用重讀
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
  }));
  let groups = null;
  if (data.groups && typeof data.groups === 'object' && !Array.isArray(data.groups)) {
    groups = {};
    for (const [name, list] of Object.entries(data.groups)) {
      if (Array.isArray(list)) groups[name] = new Set(list.map(text).filter(n => n && n !== name));
    }
  }
  const synced = data.syncedAt ? new Date(data.syncedAt) : null;
  // 照片版本（#127）：部署到 Cloudflare 時才加（scripts/photo-versions.mjs），照片路徑 → 內容雜湊；repo 裡的 dogs.json 沒有
  const versions = {};
  if (data.photoVersions && typeof data.photoVersions === 'object' && !Array.isArray(data.photoVersions)) {
    for (const [path, v] of Object.entries(data.photoVersions)) {
      if (typeof v === 'string' && /^[0-9a-f]{1,16}$/.test(v)) versions[path] = v;
    }
  }
  return { dogs, groups, syncedAt: synced && !isNaN(synced) ? synced : null, photoVersions: versions };
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
  if (!res.ok) throw new Error(`讀取 dogs.json 失敗（HTTP ${res.status}）。`);
  let data;
  try { data = await res.json(); } catch (e) { throw new Error('dogs.json 內容壞掉了。'); }
  return parseDogsData(data);
}

// ── 我最近溜過（#58）──

// walks.json 只取 walkers 有我的代號的紀錄（#96；舊紀錄只有 mine 沒有 walkers 的不算），日期不合理的丟掉；
// 同一隻狗同一天只留一筆；新到舊（同一天後記的在前）
function parseMyWalks(data, codes = loadMyCodes()) {
  if (!data || !Array.isArray(data.walks)) throw new Error('walks.json 格式不對');
  const text = v => (v == null ? '' : String(v).trim());
  const seen = new Set();
  const list = [];
  data.walks.forEach((w, i) => {
    if (!w || !Array.isArray(w.walkers) || !w.walkers.some(c => codes.includes(c))) return;
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

async function loadMyWalks() {
  myWalksState = 'loading';
  try {
    const res = await fetch(WALKS_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    walksData = await res.json();
    myWalks = parseMyWalks(walksData);
    myWalksState = 'ready';
  } catch (e) {
    console.error(e);
    myWalksState = 'error';
  }
  // 不在「我溜過」就只更新分類上的數字（#91）：整頁重畫會把第一屏正在載入的照片換掉
  const n = document.querySelector('#tabs [data-tab="mine"] .n');
  if (activeTab !== 'mine' && !analysisOpen && n) {
    const count = myWalksCount(searchQuery.trim());
    n.textContent = count == null ? '' : count;
  } else {
    render();
  }
}

// 分類上的數字；還沒讀好或還沒設定我是誰時不顯示（null）
function currentMyWalks(today = new Date()) {
  const list = [...myWalks];
  const date = localDateKey(today);
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
}

function walkerSetupHtml() {
  const edit = walkerSetup || { text: '', phase: 'edit', error: '' };
  const busy = edit.phase === 'saving';
  const has = loadMyCodes().length > 0;
  return `<form class="who-box" id="whoForm" autocomplete="off">
    <h3>${icon('paw')}你是誰？</h3>
    <p>輸入你在溜狗表「誰遛的」欄寫的名字。有好幾種寫法的話可以用頓號隔開。</p>
    <input type="text" id="whoInput" maxlength="60" placeholder="例：小明" aria-label="你在試算表寫的名字" value="${esc(edit.text)}"${busy ? ' disabled' : ''}>
    <p class="who-note">名字和換出來的代號只記在這支手機；按「溜了」時會用第一個名字寫進試算表「誰遛的」，網站上其他人看不到。換手機或換瀏覽器要重新設定。</p>
    ${edit.phase === 'error' ? `<div class="photo-error" role="alert">${icon('alert')}<span>${esc(edit.error)}</span></div>` : ''}
    <div class="my-note-actions">
      <button type="submit" class="my-note-save" id="whoSave"${busy ? ' disabled' : ''}>${busy ? '設定中…' : '設定'}</button>
      ${has && !busy ? `<button type="button" class="photo-cancel" id="whoCancel">取消</button>` : ''}
    </div>
    ${has && !busy ? `<button type="button" class="who-clear" id="whoClear">清除這支手機的設定</button>` : ''}
  </form>`;
}

// 送名字到 Worker 換代號；成功就記住代號、顯示我溜過，失敗保留輸入的名字並顯示原因
async function saveWalkerSetup() {
  const edit = walkerSetup;
  if (!edit || edit.phase === 'saving') return;
  const failWith = msg => { edit.phase = 'error'; edit.error = msg; render(); };
  edit.phase = 'saving';
  render();
  const error = await setWalkerName(edit.text);
  if (error) return failWith(error);
  if (walkerSetup === edit) walkerSetup = null;
  render();
}

// 名字送 Worker 換代號，成功就記在這支手機；失敗回傳原因（開頭畫面和我溜過的「修改」共用）
async function setWalkerName(raw) {
  const text = String(raw || '').trim();
  if (!text) return '請輸入你在溜狗表上寫的名字';
  if (!UPLOAD_URL) return '暫時不能設定，網站這邊還沒準備好';
  let out = null;
  try {
    const res = await fetch(`${UPLOAD_URL}/walker-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: [...new Set(splitWalkers(text).map(canonicalWalker).filter(Boolean).flatMap(n => n === 'K' ? [n, '岑'] : [n]))] }),
    });
    out = await res.json().catch(() => null);
    if (!res.ok) throw new Error((out && out.error) || `HTTP ${res.status}`);
  } catch (e) {
    console.error(e);
    return out && out.error ? out.error : '連不上網路，請稍後再試';
  }
  const codes = out && Array.isArray(out.codes) ? out.codes.filter(c => WALKER_CODE_PATTERN.test(c)) : [];
  if (!codes.length) return '設定沒有成功，請稍後再試';
  saveMyCodes(codes);
  saveWalkerName(canonicalWalker(firstWalkerName(text)));
  return '';
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
function myWalksHtml(today, query) {
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
  const who = query ? '' : `<div class="section-hint who-hint">${icon('paw')}<span class="who-name">${named ? esc(loadWalkerName()) : '再按「修改」輸入一次名字'}</span>${statsBtn}<button type="button" class="who-edit" id="whoEdit">修改</button></div>`;
  if (!visibleWalks.length) return who + `<div class="status-msg">還沒有你的溜狗紀錄。<br>試算表「誰遛的」寫上你設定的名字，同步後就會出現在這裡。</div>`;
  // 所有到所紀錄新到舊一路往下排（K 2026-09-25：不要選日期）；搜尋時不顯示小計
  const groups = myWalkGroups(currentMyWalks(), query);
  if (!groups.length) return `<div class="status-msg">找不到「${esc(query)}」</div>`;
  const stats = !query && mineStatsOpen ? `<div class="mine-stats-box">${myProgressHtml(visibleWalks)}${myMonthStats(visibleWalks, today)}</div>` : '';
  return who + stats + groups.map(g => myVisitCard(g)).join('');
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

function esc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function icon(id) {
  return `<svg class="icon"><use href="#i-${id}"/></svg>`;
}

// 照片網址加版本號（#127）：Cloudflare 讓照片在手機上快取 30 天（_headers），換了照片內容雜湊就變、網址跟著變，
// 手機就會抓新的。沒有版本（舊網址 GitHub Pages、剛上傳還沒部署）就不加，照舊用原本的短快取
let photoVersions = {}; // 照片路徑（photos/...）→ 內容雜湊，來自 dogs.json 的 photoVersions
function versioned(path) {
  const v = photoVersions[path];
  return v ? `${path}?v=${v}` : path;
}

// 前端剛上傳成功的照片（編號 → 本機圖片網址）：網站要一兩分鐘才會更新，這段期間先顯示剛傳的那張（#48）
const photoOverrides = {};
function photoSrc(dog) {
  return photoOverrides[dog.id] || versioned(`photos/${encodeURIComponent(dog.id)}.jpg`);
}

// 相簿照片：清單舊到新，畫面上新的在前；剛傳的那張同樣先用本機圖片（編號/檔名 → 本機圖片網址）
const galleryOverrides = {};
function galleryList(dog) {
  return dog && dog.id ? [...(gallery[dog.id] || [])].reverse() : [];
}
function gallerySrc(dog, file) {
  return galleryOverrides[`${dog.id}/${file}`] || versioned(`photos/gallery/${encodeURIComponent(dog.id)}/${encodeURIComponent(file)}`);
}

// 縮圖（#83）：清單、相簿格子只載 photos/thumbs/ 的小圖，燈箱才看原圖；縮圖由 Action 產生（scripts/make-thumbs.py）
// 剛上傳的照片先用本機圖片；縮圖還沒產生就在 img 的 onerror 改讀 data-full 的原圖（thumbFallback）
function photoThumbSrc(dog) {
  return photoOverrides[dog.id] || versioned(`photos/thumbs/${encodeURIComponent(dog.id)}.jpg`);
}
function galleryThumbSrc(dog, file) {
  return galleryOverrides[`${dog.id}/${file}`] || versioned(`photos/thumbs/gallery/${encodeURIComponent(dog.id)}/${encodeURIComponent(file)}`);
}
// 放在 img 的 onerror 最前面：還有原圖可試就換原圖、這次不算讀取失敗
const thumbFallback = "if (this.dataset.full) { this.src = this.dataset.full; this.removeAttribute('data-full'); return; }";
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
// 有相簿時主照片和相簿照片排成一串，左右滑（或按兩側箭頭、鍵盤左右鍵）換張
let lightboxOpener = null;
let lightboxView = null; // { dog, items: [{ src, file }], index }
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

// 燈箱要翻的照片：主照片（withMain：知道有主照片才放）＋相簿，相簿新的在前
function photoItems(dog, withMain) {
  const items = withMain ? [{ src: photoSrc(dog), file: null }] : [];
  return items.concat(galleryList(dog).map(p => ({ src: gallerySrc(dog, p.file), file: p.file })));
}

// opener：關掉後焦點回到哪裡（詳細資訊的照片或狗卡）；start：從第幾張開始
function openLightbox(dog, opener, start = 0, withMain = true) {
  if (!dog || !dog.id) return;
  const items = photoItems(dog, withMain);
  if (!items.length) return;
  let el = document.getElementById('lightbox');
  if (!el) {
    el = document.createElement('div');
    el.id = 'lightbox';
    el.className = 'lightbox';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<img alt="">
      <button type="button" class="lightbox-close" aria-label="關閉照片">${icon('close')}</button>
      <button type="button" class="lightbox-nav prev" data-step="-1" aria-label="上一張">${icon('back')}</button>
      <button type="button" class="lightbox-nav next" data-step="1" aria-label="下一張">${icon('chevron')}</button>
      <div class="lightbox-bar"></div>`;
    el.addEventListener('click', e => {
      if (e.target.closest('.lightbox-close')) { closeLightbox(); return; }
      const nav = e.target.closest('[data-step]');
      if (nav) { stepLightbox(Number(nav.dataset.step)); return; }
      // 張數、刪除都在下方列，點了不關；按了「刪除」後下方列會重畫，按鈕已經不在畫面上也不能當成點背景
      if (!e.target.isConnected || e.target.closest('.lightbox-bar')) return;
      if (!insidePhoto(e)) closeLightbox(); // 點背景（含照片旁的留白）
    });
    // 左右滑換張（只看明顯的水平滑動，兩指縮放不算）
    let touch = null;
    el.addEventListener('touchstart', e => { touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
    el.addEventListener('touchend', e => {
      if (!touch || e.target.closest('.lightbox-bar')) { touch = null; return; }
      const t = e.changedTouches[0];
      const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
      touch = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) stepLightbox(dx < 0 ? 1 : -1);
    });
    document.body.appendChild(el);
  }
  lightboxView = { dog, items, index: Math.max(0, Math.min(start, items.length - 1)) };
  if (!galleryDelete || galleryDelete.phase !== 'deleting') galleryDelete = null;
  el.setAttribute('aria-label', `${dog.name} 的照片`);
  showLightboxPhoto();
  lightboxOpener = opener || document.activeElement;
  el.hidden = false;
  document.documentElement.classList.add('lightbox-open');
  // 手機按「返回」時只關掉燈箱
  history.pushState({ bqPhoto: true }, '');
  el.querySelector('.lightbox-close').focus({ preventScroll: true });
}

// 畫出目前這張，和下方列（第幾張、刪除）
function showLightboxPhoto() {
  const el = document.getElementById('lightbox');
  const v = lightboxView;
  if (!el || !v) return;
  const item = v.items[v.index];
  const img = el.querySelector('img');
  img.src = item.src;
  img.alt = `${v.dog.name} 的照片${v.items.length > 1 ? `（第 ${v.index + 1} 張，共 ${v.items.length} 張）` : ''}`;
  const many = v.items.length > 1;
  el.querySelectorAll('.lightbox-nav').forEach(b => { b.hidden = !many; });
  const bar = el.querySelector('.lightbox-bar');
  const del = galleryDelete && galleryDelete.dog === v.dog && galleryDelete.file === item.file ? galleryDelete : null;
  const canEdit = !!(UPLOAD_URL && item.file);
  const swapping = gallerySwap && gallerySwap.dog === v.dog;
  bar.innerHTML = del ? galleryDeleteForm(del) : `
    ${many ? `<span class="lightbox-count">${v.index + 1} / ${v.items.length}</span>` : ''}
    ${!item.file && many ? `<span class="lightbox-tag">主照片</span>` : ''}
    ${UPLOAD_URL && !item.file && detailDog === v.dog ? `<button type="button" class="lightbox-delete" id="mainCropBtn">${icon('crop')}裁切</button>` : ''}
    ${canEdit ? `<button type="button" class="lightbox-delete" id="galleryMainBtn"${swapping ? ' disabled' : ''}>${icon('photos')}${swapping ? '設定中…' : '設為主照片'}</button>` : ''}
    ${canEdit && !swapping ? `<button type="button" class="lightbox-delete" id="galleryDeleteBtn">${icon('trash')}刪除</button>` : ''}`;
  bar.hidden = !bar.textContent.trim() && !bar.querySelector('button');
  bindGalleryDelete(bar);
  const mainBtn = bar.querySelector('#galleryMainBtn');
  if (mainBtn) mainBtn.addEventListener('click', setGalleryAsMain);
  const cropBtn = bar.querySelector('#mainCropBtn');
  if (cropBtn) cropBtn.addEventListener('click', () => cropMainPhoto(v.dog));
}

function stepLightbox(step) {
  const v = lightboxView;
  if (!v || v.items.length < 2 || gallerySwap || (galleryDelete && galleryDelete.phase === 'deleting')) return;
  galleryDelete = null;
  v.index = (v.index + step + v.items.length) % v.items.length;
  showLightboxPhoto();
}

function hideLightbox() {
  const el = document.getElementById('lightbox');
  if (!el || el.hidden) return;
  el.hidden = true;
  el.querySelector('img').removeAttribute('src');
  lightboxView = null;
  if (!galleryDelete || galleryDelete.phase !== 'deleting') galleryDelete = null;
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
  return `<span class="badge muted">沒有紀錄</span>`;
}

// 卡片上的「上次遛狗」：天數用 #3 的綠／黃／紅文字色
function lastWalk(dog, today) {
  const s = computeStatus(dog, today);
  let text = '沒有紀錄', level = 'muted', small = false;
  if (s.kind === 'dated') {
    if (s.days < 0) text = '日期看不懂';
    else { text = s.days === 0 ? '今天' : `${s.days} 天前`; level = s.level; }
  } else if (s.kind === 'covered') {
    // 窄螢幕放不下一行時只在「有人固定｜照顧」之間換行，不會剩一個「顧」字
    text = '<span class="nowrap">有人固定</span><span class="nowrap">照顧</span>'; level = 'sage'; small = true;
  }
  return `<div class="last"><span class="lbl">上次溜</span><span class="val ${level}${small ? ' small' : ''}">${text}</span></div>`;
}

// 卡片用「編號｜籠位」（照 K 的參考圖）；詳細資訊沿用 metaLine
// V7（#111）：平面圖上找得到的籠位做成橘色膠囊，點了跳「在哪」面板（js/find.js 的 whereOpen）
function cardMeta(dog) {
  if (typeof whereKnown === 'function' && whereKnown(dog)) {
    // 籠位膠囊放前面（最常點），編號放後面、放不下就換行
    return `<div class="meta has-pill"><button type="button" class="cage-pill" data-where aria-label="${esc(dog.name)} 在哪：${esc(dog.cage)}">${icon('pin')}${esc(dog.cage)}</button>${dog.id ? `<span class="id">${esc(dog.id)}</span>` : ''}</div>`;
  }
  return `<div class="meta">${dog.id ? `${esc(dog.id)}<span class="sep">|</span>` : ''}${esc(dog.cage)}</div>`;
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

// 再次入所（#75）：詳細資訊編號下面標「第 N 次入所・首次 YYYY/M/D（舊編號 …）」
function reentryLine(dog) {
  if (!dog.formerIds || !dog.formerIds.length) return '';
  const first = dog.formerIds.map(idDate).filter(Boolean).sort((a, b) => a - b)[0];
  const firstText = first ? `・首次 ${first.getFullYear()}/${first.getMonth() + 1}/${first.getDate()}` : '';
  return `<div class="reentry"><span>第 ${dog.formerIds.length + 1} 次入所${firstText}</span> <span>（舊編號 ${dog.formerIds.map(esc).join('、')}）</span></div>`;
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
function setWalked(dogs, on) {
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

// ── 我的常溜（#155）：志工自己收藏的狗，只存這支手機，不寫試算表、不送伺服器；跟「我溜過」（歷史）分開 ──
const FAVS_KEY = 'bq-favs';
function loadFavs() { const v = readJsonKey(FAVS_KEY); return Array.isArray(v) ? v.map(String) : []; }
function isFav(dog) { const k = walkKey(dog); return !!k && loadFavs().includes(k); }
function toggleFav(dog) {
  const k = walkKey(dog);
  if (!k) return;
  const favs = loadFavs();
  writeJsonKey(FAVS_KEY, favs.includes(k) ? favs.filter(x => x !== k) : [k, ...favs]);
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

// ── 誰遛的名字（#141 第 9 項）──
// 名字不放進公開的 repo（dogs.json 只有代號）：打開網頁時跟 Worker 拿（GET /api/walkers，Worker 直接讀試算表），
// 只在畫面上顯示。{ 狗的 key: '志工乙+志工丙+岑' }；拿不到就不顯示名字，其他照常
let walkerNames = {};
let walkerNameList = []; // 表上出現過的名字（開頭畫面讓志工點選自己，#141）
async function loadWalkerNames() {
  if (!UPLOAD_URL) return;
  try {
    const res = await fetch(`${UPLOAD_URL}/walkers`, { cache: 'no-cache' });
    if (!res.ok) return;
    const out = await res.json();
    if (out && out.walkers && typeof out.walkers === 'object') {
      walkerNames = out.walkers;
      walkerNameList = [...new Set((Array.isArray(out.names) ? out.names : []).map(canonicalWalker).filter(Boolean))];
      render();
      renderDetail();
      if (onboard && onboard.step === 0 && onboard.phase !== 'saving') renderOnboard();
    }
  } catch (e) { console.error(e); }
}
// 一格好幾個名字（「志工乙+志工丙+岑」「志工甲。K」）拆開，用頓號接起來，不重複
function canonicalWalker(name) {
  const n = String(name || '').trim().replace(/經常帶.*$/, '').trim();
  return n === '岑' ? 'K' : n;
}
function splitWalkers(text) {
  return [...new Set(String(text || '').split(WALKER_NAME_SEP).map(n => n.trim()).filter(Boolean))];
}
// 上次是誰溜的：這支手機今天按過溜了就是自己；否則用試算表的「誰遛的」
function walkerList(dog, today = new Date()) {
  const item = loadSheetWrites(today)[walkKey(dog)];
  if (item && item.current) return splitWalkers(item.current.walker);
  if (walkedNow(dog, today)) return [...new Set([...splitWalkers(walkerNames[walkKey(dog)]), loadWalkerName() || '你', ...(loadWalkWith(today)[walkKey(dog)] || [])])];
  return splitWalkers(walkerNames[walkKey(dog)]);
}
function walkerText(dog, today) {
  return walkerList(dog, today).join('、');
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
      <input type="text" id="withInput" maxlength="20" placeholder="${names.length ? '其他人：輸入名字' : '輸入名字，例：志工乙'}" value="${esc(w.text)}" enterkeyhint="done">
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
    if (walkedStorage) return canonicalWalker(walkedStorage.getItem(WALKER_NAME_KEY) || '');
  } catch (e) { /* 讀不到就用記憶體裡的 */ }
  return canonicalWalker(walkerNameMemory);
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
  sheetQueue = sheetQueue.then(() => sheetWrite(dogs, on, toastText, toastUndo, walker, expected)).catch(e => console.error(e));
  return sheetQueue;
}

// 提示條還是剛剛那則（使用者還沒按別的）才在後面補一句，不蓋掉「復原」
function addToToast(text, undo, extra) {
  const el = document.getElementById('toast');
  if (!el || el.hidden || toastUndo !== undo) return false;
  el.querySelector('.toast-text').textContent = `${text}${extra}`;
  return true;
}

// walker：加「一起溜的人」時傳那幾個名字（試算表那格已經有今天的名字，小程式會用「、」接在後面）
async function sheetWrite(dogs, on, toastText, toastUndo, walker = null, expected = undefined) {
  if (!UPLOAD_URL || sheetWriteState === 'off') return;
  const today = new Date();
  const withKey = dogs.map(d => ({ d, key: walkKey(d) })).filter(x => x.key);
  let payload;
  if (on) {
    const who = walker || loadWalkerName();
    if (!who) return; // 還沒在「我溜過」設定名字（提醒放在我溜過頁）
    payload = { action: expected === undefined ? 'walk' : 'edit', walker: who, dogs: withKey.map(({ d, key }) => ({ id: d.id || '', name: d.name, ...(expected === undefined ? {} : { expected }) })) };
  } else {
    const items = loadSheetWrites(today);
    const list = withKey.filter(x => items[x.key] && items[x.key].prev && items[x.key].wrote).map(x => items[x.key]);
    if (!list.length) return;
    payload = { action: 'undo', dogs: list.map(x => ({ id: x.id, name: x.name, prev: x.prev, wrote: x.wrote })) };
  }
  if (!payload.dogs.length) return;
  let res = null, out = null;
  try {
    res = await fetch(`${UPLOAD_URL}/walk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    out = await res.json().catch(() => null);
  } catch (e) {
    showToast(on ? '沒寫進試算表（網路不通），請自己到試算表填' : '試算表沒改回來（網路不通），請自己到試算表改');
    return;
  }
  if (res.status === 503 && out && out.code === 'off') { sheetWriteState = 'off'; return; }
  if (!res.ok || !out || !out.ok) {
    const why = (out && out.error) || `HTTP ${res.status}`;
    showToast(on ? `沒寫進試算表：${why}` : `試算表沒改回來：${why}`);
    return;
  }
  sheetWriteState = 'on';
  const items = loadSheetWrites(today);
  const keyOf = r => (withKey.find(({ d }) => (d.id || '') === (r.id || '') && d.name === r.name) || {}).key;
  const missed = [];
  for (const r of out.results || []) {
    const key = keyOf(r);
    if (!key) continue;
    const old = items[key];
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
    const statuses = (out.results || []).map(r => r.status);
    showToast(statuses.includes('badAction') ? '請先更新 Google Apps Script，再使用修改溜狗人。' : statuses.includes('changed') ? `${missed.join('、')} 在試算表已經被改過，沒有蓋掉別人的，畫面已換成最新名單` : `試算表找不到 ${missed.join('、')}，請自己填`);
  } else if (on && toastText) {
    addToToast(toastText, toastUndo, '，已寫進試算表');
  }
  return !missed.length;
}

// 相簿刪除照片的通關碼（原本 #62 我的備註用，V9 拿掉我的備註後只剩相簿刪除用）：成功後記在這支手機，被拒絕就清掉重問
const NOTES_PASS_KEY = 'bq-notes-passcode';
let notesPassMemory = '';
function loadNotesPass() {
  try {
    return (walkedStorage && walkedStorage.getItem(NOTES_PASS_KEY)) || notesPassMemory;
  } catch (e) {
    return notesPassMemory;
  }
}
function saveNotesPass(pass) {
  notesPassMemory = pass;
  try {
    if (!walkedStorage) return;
    if (pass) walkedStorage.setItem(NOTES_PASS_KEY, pass);
    else walkedStorage.removeItem(NOTES_PASS_KEY);
  } catch (e) { /* 存不了就只記在記憶體 */ }
}

let toastTimer = null;
let toastUndo = null;
let toastExtra = null;
// extra：{ label, fn } 提示條上多一顆按鈕（例：溜了之後「＋一起溜的人」）
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
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}

function hideToast() {
  clearTimeout(toastTimer);
  toastUndo = null;
  toastExtra = null;
  const el = document.getElementById('toast');
  if (el) el.hidden = true;
}

// 狗卡右側的「已遛」（溜狗表）／「移回」（今天已溜）按鈕；連犬名都沒有的狗記不了，照舊顯示箭頭
// V9（#141）拿掉今天已溜：按過的狗留在原地，按鈕變成「已溜」，再按一次復原
function walkButton(dog) {
  if (!walkKey(dog)) return `<span class="more">${icon('chevron')}</span>`;
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
  if (!walkKey(dog)) return '';
  const on = isFav(dog);
  return `<button type="button" class="fav-btn${on ? ' on' : ''}" id="favToggle" aria-pressed="${on}">${on ? '★ 我的常溜' : '☆ 常溜'}</button>`;
}

function detailHtml(dog, today) {
  const flag = specialFlag(dog.note);
  const buddies = [...(groupMap[dog.name] || [])];
  const byName = new Map(allDogs.map(d => [d.name, d]));
  const intro = dog.intro;
  const walked = walkedToday(today);
  // V7（#112）：上面大照片，下面狗名和天數／籠位／入所標籤；關閉、在哪、溜了在底部固定列（在哪裡卡片 V7 小修正拿掉，改用底部「在哪」）
  return `
    <div class="detail-head">
      ${photoHeroHtml(dog)}
      ${photoUploadHtml(dog)}
      <div class="info">
        <div class="name-row"><div class="name" id="detailName">${esc(dog.name)}${sexMark(dog)}</div>${favButtonHtml(dog)}</div>
        <div class="chips">${statusBadge(dog, today)}${detailChips(dog)}</div>
        ${metaLine(dog)}
      </div>
    </div>
    ${lastWalkSection(dog, today)}
    ${detailTrail.length ? `<button type="button" class="detail-back" id="detailBack">${icon('back')}回到 ${esc(detailTrail[detailTrail.length - 1].name)}</button>` : ''}
    <section class="detail-section" data-section="note">
      <h3>${icon('note')}試算表備註</h3>
      ${!dog.note ? `<div class="empty">目前沒有備註</div>`
        : flag ? warnNote(dog.note, flag)
        : `<div class="content note-text">${esc(dog.note)}</div>`}
    </section>
    ${cageMatesSection(dog, walked)}
    <section class="detail-section" data-section="group">
      <h3>${icon('group')}可以一起溜的狗</h3>
      ${buddies.length
        ? `<div class="buddies">${buddies.map(n => {
            const d = byName.get(n) || { name: n, id: '' };
            return buddyTile(d, n, walked);
          }).join('')}</div>`
        : `<div class="empty">沒有登記可以一起溜的狗</div>`}
    </section>
    ${walkHistorySection(dog, today)}
    <section class="detail-section" data-section="intro">
      <h3>${icon('card')}入所介紹<span class="sub">收容所在入所時寫的</span></h3>
      ${intro ? `<div class="content">${esc(intro)}</div>` : `<div class="empty">還沒有入所介紹</div>`}
    </section>
    ${gallerySection(dog)}
    ${photoBarHtml(dog) || `<div class="detail-bar">
      <button type="button" class="bar-btn" id="detailClose">關閉</button>
      ${typeof whereKnown === 'function' && whereKnown(dog) ? `<button type="button" class="bar-btn" id="detailWhere">${icon('pin')}在哪</button>` : ''}
      ${groupWalkButton(dog, walked)}
    </div>`}
  `;
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
  if (!UPLOAD_URL || sheetWriteState === 'off') return null;
  const key = walkKey(dog);
  if (!key) return null;
  const date = localDateKey(today);
  const item = loadSheetWrites(today)[key];
  if (item && item.current) return item.current.date === date && item.current.walker ? item.current.walker : null;
  if (walkedNow(dog, today)) return null; // 這支手機按了溜了，試算表還沒回來
  return dog.walkedDate && localDateKey(dog.walkedDate) === date && walkerNames[key] ? walkerNames[key] : null;
}
function walkerChipsHtml(dog, who, today) {
  if (!who.length) return '<span class="lw-none">—</span>';
  if (!walkerEditBase(dog, today)) return who.map(n => `<span class="who-chip">${esc(n)}</span>`).join('');
  const busy = walkerEditBusy === walkKey(dog);
  const dis = busy ? ' disabled' : '';
  return who.map(n => `<span class="who-chip${who.length > 1 ? ' editable' : ''}">${esc(n)}${who.length > 1 ? `<button type="button" class="who-x" data-who-remove="${esc(n)}" aria-label="拿掉 ${esc(n)}"${dis}>×</button>` : ''}</span>`).join('')
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
  const since = idDate(dog.id);
  return (dog.cage ? `<span class="badge plain">${icon('pin')}${esc(dog.cage)}</span>` : '')
    + (since ? `<span class="badge plain">入所 ${since.getFullYear()}/${since.getMonth() + 1}</span>` : '');
}

// 相簿（狗卡資訊下方）：主照片＋另外上傳的照片排成縮圖格，點了用燈箱看大圖、左右滑換張。
// 「新增」在主照片後面第二格（新傳的排在前面）；選好的照片就在那格出現、跟上傳後的樣子一樣（2026-10-04 K：要像社群網站，出現在按的地方）。
// 主照片讀不到就把那格藏起來
function gallerySection(dog) {
  if (!dog.id) return '';
  const list = galleryList(dog);
  const canAdd = !!UPLOAD_URL && list.length < GALLERY_MAX;
  const up = galleryBatch && galleryBatch.dog === dog;
  // 相簿照片讀不到（例：別人剛傳、網站還沒更新）就顯示腳掌、不能點；主照片讀不到整格藏起來
  const tile = (thumb, src, attrs, main = false) => `
    <button type="button" class="g-tile" ${attrs}>
      <img ${thumbAttrs(thumb, src)} alt="" loading="lazy" decoding="async" onerror="${thumbFallback} this.parentNode.classList.add('broken'); this.parentNode.disabled = true;${main ? ' this.parentNode.hidden = true;' : ''}">
      ${main ? `<span class="g-tag">主照片</span>` : `<span class="g-fallback">${icon('paw')}</span>`}
    </button>`;
  const tiles = [
    tile(photoThumbSrc(dog), photoSrc(dog), `data-g-main aria-label="放大 ${esc(dog.name)} 的主照片"`, true),
    canAdd && !up ? `<button type="button" class="g-add" id="galleryAdd" aria-label="新增 ${esc(dog.name)} 的相簿照片">${icon('plus')}<span>新增</span></button>` : '',
    up ? galleryPendingTiles(galleryBatch) : '',
    ...list.map((p, i) => tile(galleryThumbSrc(dog, p.file), gallerySrc(dog, p.file), `data-g-file="${esc(p.file)}" aria-label="放大 ${esc(dog.name)} 的相簿照片（第 ${i + 1} 張）"`)),
  ];
  const note = galleryState === 'loading' ? '讀取中…' : galleryState === 'error' ? '相簿清單暫時讀不到' : '';
  return `
    <section class="detail-section" data-section="gallery">
      <h3>${icon('photos')}相簿<span class="sub">${list.length ? `另外 ${list.length} 張，` : ''}點照片看大圖</span></h3>
      <div class="gallery-grid">
        ${tiles.join('')}
      </div>
      ${note ? `<div class="empty gallery-note">${note}</div>` : ''}
      ${up ? galleryBatchHtml(galleryBatch) : ''}
    </section>`;
}

// 燈箱下方的刪除確認：通關碼跟我的備註同一組，這支手機記過就不用再輸入
function galleryDeleteForm(del) {
  const busy = del.phase === 'deleting';
  return `
    <form class="lightbox-del" id="galleryDeleteForm" autocomplete="on">
      <div class="lightbox-del-q">從相簿刪掉這張照片？</div>
      ${del.needPass ? `
        <input type="text" name="username" autocomplete="username" value="板收志工溜狗表" hidden readonly>
        <input type="password" id="galleryDeletePass" name="password" autocomplete="current-password" placeholder="通關碼（同我的備註）" aria-label="通關碼" value="${esc(del.pass)}"${busy ? ' disabled' : ''}>` : ''}
      ${del.phase === 'error' ? `<div class="photo-error" role="alert">${icon('alert')}<span>${esc(del.error)}</span></div>` : ''}
      <div class="lightbox-del-actions">
        <button type="submit" class="lightbox-del-yes" id="galleryDeleteYes"${busy ? ' disabled' : ''}>${busy ? '刪除中…' : '刪除'}</button>
        ${busy ? '' : `<button type="button" class="lightbox-del-no" id="galleryDeleteNo">取消</button>`}
      </div>
    </form>`;
}

function bindGalleryDelete(bar) {
  const btn = bar.querySelector('#galleryDeleteBtn');
  if (btn) btn.addEventListener('click', () => {
    const v = lightboxView;
    galleryDelete = { dog: v.dog, file: v.items[v.index].file, pass: '', needPass: !loadNotesPass(), phase: 'confirm', error: '' };
    showLightboxPhoto();
    const first = document.getElementById('galleryDeletePass') || document.getElementById('galleryDeleteYes');
    if (first) first.focus({ preventScroll: true });
  });
  const form = bar.querySelector('#galleryDeleteForm');
  if (!form) return;
  const pass = form.querySelector('#galleryDeletePass');
  if (pass) pass.addEventListener('input', () => { galleryDelete.pass = pass.value; });
  form.addEventListener('submit', e => { e.preventDefault(); deleteGalleryPhoto(); });
  const no = form.querySelector('#galleryDeleteNo');
  if (no) no.addEventListener('click', () => {
    galleryDelete = null;
    showLightboxPhoto();
    const b = document.getElementById('galleryDeleteBtn');
    if (b) b.focus({ preventScroll: true });
  });
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

// 燈箱裡相簿照片的「設為主照片」：跟主照片互換（原本的主照片放進相簿同一格），不用通關碼（跟換主照片一樣）
async function setGalleryAsMain() {
  const v = lightboxView;
  if (!v || gallerySwap) return;
  const item = v.items[v.index];
  if (!item || !item.file) return;
  const dog = v.dog, file = item.file;
  const hadMain = !v.items[0].file;
  gallerySwap = { dog, file };
  showLightboxPhoto();
  const [pickedUrl, oldMainUrl] = await Promise.all([imageToLocal(item.src), hadMain ? imageToLocal(v.items[0].src) : null]);
  let out = null, error = '';
  try {
    const res = await fetch(`${UPLOAD_URL}/gallery/${encodeURIComponent(dog.id)}/${encodeURIComponent(file)}/main`, { method: 'POST' });
    out = await res.json().catch(() => null);
    if (!res.ok || !out || !out.ok) error = (out && out.error) || `主照片沒有換成（${res.status}），照片都沒動`;
  } catch (e) {
    error = '主照片沒有換成，請確認網路後再試；照片都沒動';
  }
  gallerySwap = null;
  if (error) {
    [pickedUrl, oldMainUrl].forEach(u => { if (u) URL.revokeObjectURL(u); });
    if (lightboxOpen()) showLightboxPhoto();
    showToast(error);
    return;
  }
  photoOverrides[dog.id] = pickedUrl || item.src;
  if (out.swapped) {
    if (oldMainUrl) galleryOverrides[`${dog.id}/${file}`] = oldMainUrl;
  } else {
    const rest = (gallery[dog.id] || []).filter(p => p.file !== file);
    if (rest.length) gallery[dog.id] = rest; else delete gallery[dog.id];
    delete galleryOverrides[`${dog.id}/${file}`];
    if (oldMainUrl) URL.revokeObjectURL(oldMainUrl);
  }
  // 燈箱改看新的主照片（第一張）
  if (lightboxView && lightboxView.dog === dog) {
    lightboxView.items = photoItems(dog, true);
    lightboxView.index = 0;
    showLightboxPhoto();
  }
  render();
  if (detailDog) renderDetail();
  showToast(out.swapped ? `已設為 ${dog.name} 的主照片，原本的主照片放進相簿` : `已設為 ${dog.name} 的主照片`);
}

// 刪除：送到 Worker（要通關碼）；成功後燈箱換到下一張（沒有了就關掉），相簿格重畫
async function deleteGalleryPhoto() {
  const del = galleryDelete;
  if (!del || del.phase === 'deleting') return;
  const pass = del.needPass ? del.pass : loadNotesPass();
  if (!pass) {
    del.needPass = true; del.phase = 'error'; del.error = '請輸入通關碼'; showLightboxPhoto();
    const input = document.getElementById('galleryDeletePass');
    if (input) input.focus({ preventScroll: true });
    return;
  }
  del.phase = 'deleting';
  del.error = '';
  showLightboxPhoto();
  let out = null, error = '';
  try {
    const res = await fetch(`${UPLOAD_URL}/gallery/${encodeURIComponent(del.dog.id)}/${encodeURIComponent(del.file)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: pass }),
    });
    out = await res.json().catch(() => null);
    if (!res.ok || !out || !out.ok) error = (out && out.error) || `沒有刪掉（${res.status}），請稍後再試`;
  } catch (e) {
    error = '沒有刪掉，請確認網路後再試';
  }
  if (galleryDelete !== del) return;
  if (error) {
    if (out && out.code === 'passcode') { saveNotesPass(''); del.needPass = true; del.pass = ''; }
    del.phase = 'error';
    del.error = error;
    if (lightboxOpen()) showLightboxPhoto();
    else { galleryDelete = null; showToast(`照片沒有刪掉：${error}`); }
    return;
  }
  saveNotesPass(pass);
  galleryDelete = null;
  const rest = (gallery[del.dog.id] || []).filter(p => p.file !== del.file);
  if (rest.length) gallery[del.dog.id] = rest;
  else delete gallery[del.dog.id];
  delete galleryOverrides[`${del.dog.id}/${del.file}`];
  const v = lightboxView;
  if (v && v.dog === del.dog) {
    const at = v.items.findIndex(it => it.file === del.file);
    if (at >= 0) v.items.splice(at, 1);
    if (!v.items.length) closeLightbox();
    else { v.index = Math.min(at < 0 ? v.index : at, v.items.length - 1); showLightboxPhoto(); }
  }
  if (detailDog) renderDetail();
  showToast(`已從 ${del.dog.name} 的相簿刪除這張照片`);
}

// 開網頁時讀相簿清單：先問 Worker（新傳的馬上看得到），不行再讀網站上的 data/gallery.json
async function loadGallery() {
  galleryState = 'loading';
  let data = null;
  if (UPLOAD_URL) {
    try {
      data = await readJsonObject(`${UPLOAD_URL}/gallery`, d => d && d.ok ? d.gallery : null);
      galleryState = 'worker';
    } catch (e) { data = null; }
  }
  if (!data) {
    try {
      data = await readJsonObject(GALLERY_URL, d => d);
      galleryState = 'site';
    } catch (e) {
      data = {};
      galleryState = 'error';
    }
  }
  gallery = {};
  for (const [id, list] of Object.entries(data)) {
    if (!Array.isArray(list)) continue;
    const photos = list.filter(p => p && typeof p.file === 'string' && /^[\w-]+\.jpg$/.test(p.file))
      .map(p => ({ file: p.file, addedAt: p.addedAt || '' }));
    if (photos.length) gallery[id] = photos;
  }
  if (detailDog) renderDetail();
}

// 可以一起溜的每一隻：輕點照片換看那隻；右上角圓圈勾選，之後用下方按鈕一起記（#35，K 選 C）。
// 今天已溜的不顯示圓圈，改標「今天已溜」
function buddyTile(d, name, walkedNow) {
  const walked = walkedNow.has(d);
  const canPick = walkKey(d) && !walked && allDogs.includes(d);
  const picked = canPick && pickedBuddies.has(walkKey(d));
  return `<div class="buddy-tile">
    <button class="buddy" data-dog="${allDogs.indexOf(d)}"${allDogs.includes(d) ? '' : ' disabled'}>${photoThumb(d, 64)}<span class="bname">${esc(name)}</span></button>
    ${walked ? `<span class="walked-tag">今天已溜</span>` : ''}
    ${canPick ? `<button type="button" class="pick${picked ? ' on' : ''}" data-pick="${esc(walkKey(d))}" aria-pressed="${picked}" aria-label="勾選 ${esc(name)} 一起記">${icon('tick')}</button>` : ''}
  </div>`;
}

// 同籠的狗（K 2026-09-27）：籠位欄位一樣的其他狗，跟「可以一起溜」同一種格子，也能勾選一起記。
// 「○○區」（住院區、C區）是整區不是一籠，不算同籠；沒有同籠的狗整段不顯示
function cageMates(dog) {
  const cage = String(dog.cage || '').replace(/\s+/g, '');
  if (!cage || /區$/.test(cage)) return [];
  return allDogs.filter(d => d !== dog && String(d.cage || '').replace(/\s+/g, '') === cage);
}

function cageMatesSection(dog, walked) {
  const mates = cageMates(dog);
  if (!mates.length) return '';
  return `
    <section class="detail-section" data-section="cage">
      <h3>${icon('pin')}同籠的狗<span class="sub">${esc(dog.cage)}</span></h3>
      <div class="buddies">${mates.map(d => buddyTile(d, d.name, walked)).join('')}</div>
    </section>`;
}

// 「可以一起溜」下方的按鈕：把目前這隻連同勾選的狗一次記進今天已溜。
// 目前這隻已溜又沒勾選時，就顯示目前這隻今天已溜，不放按鈕
function groupWalkButton(dog, walked) {
  const self = !!walkKey(dog) && !walked.has(dog);
  const n = [...pickedBuddies].length;
  if (!self && !n) {
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
  const gb = galleryBatch && galleryBatch.dog === dog ? galleryBatch : null;
  if (!up && !gb) return '';
  const busy = (up || gb).phase === 'uploading';
  let cancel, confirm;
  if (up) {
    cancel = `<button type="button" class="bar-btn" id="photoCancel">取消換照片</button>`;
    confirm = `<button type="button" class="bar-confirm" id="photoConfirm"${busy ? ' disabled' : ''}>${busy ? '上傳中…' : '確認上傳'}</button>`;
  } else {
    const left = gb.items.filter(it => it.state !== 'done');
    const doneCount = gb.items.length - left.length;
    const label = busy ? `上傳中 ${Math.min(doneCount + 1, gb.items.length)} / ${gb.items.length}…`
      : gb.phase === 'error' ? `重新上傳沒傳成的 ${left.length} 張` : `上傳 ${gb.items.length} 張`;
    cancel = `<button type="button" class="bar-btn" id="galleryBatchCancel">${doneCount ? '不傳了' : '取消'}</button>`;
    confirm = `<button type="button" class="bar-confirm" id="galleryUpload"${busy ? ' disabled' : ''}>${label}</button>`;
  }
  return `<div class="detail-bar photo-bar">${busy ? '' : cancel}${confirm}</div>`;
}

// ── 裁切：照片放在固定的框後面，拖曳移動、兩指（或滑桿、滑鼠滾輪）放大，框裡的部分就是裁好的照片 ──
// 主照片預設正方形（清單上的小照片是正方形），相簿預設原比例；也可以換直式、橫式
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

// 相簿預覽格每張的「裁切」
async function cropGalleryBatchItem(index) {
  const batch = galleryBatch;
  const it = batch && batch.items[index];
  if (!it || batch.phase === 'uploading' || it.state === 'done') return;
  const blob = await openCropper(it.url, 'original');
  if (!blob || galleryBatch !== batch || batch.phase === 'uploading' || !batch.items.includes(it)) return;
  URL.revokeObjectURL(it.url);
  it.blob = blob;
  it.url = URL.createObjectURL(blob);
  renderDetail();
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

// 手機或電腦選照片：隱藏的檔案選擇框，按「上傳照片」（或相簿的「新增」）時才打開
let photoPickTarget = 'main';
function pickPhotoFile(target = 'main') {
  photoPickTarget = target === 'gallery' ? 'gallery' : 'main';
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
      if (photoPickTarget === 'gallery') prepareGalleryPhotos(detailDog, files);
      else preparePhoto(detailDog, files[0]);
    });
    document.body.appendChild(input);
  }
  input.multiple = photoPickTarget === 'gallery'; // 相簿可以一次選好幾張，主照片只能一張
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
      headers: { 'Content-Type': 'image/jpeg' },
      body: up.blob,
    });
    const out = await res.json().catch(() => null);
    if (!res.ok || !out || !out.ok) error = (out && out.error) || `上傳失敗（${res.status}），原本的照片不受影響`;
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
    return;
  }
  up.phase = 'done';
  photoUpload = null;
  photoOverrides[up.dog.id] = up.url;
  render();
  renderDetail();
  showToast(`${up.dog.name} 的照片已更新（其他志工重新整理就會看到）`);
}

// ── 相簿一次加好幾張：選照片 → 每張壓成 JPEG、排成預覽格（可拿掉幾張）→ 「上傳 N 張」一張一張依序送 ──

// 相簿還能放幾張（滿 30 張就是 0）
function galleryRoom(dog) {
  return Math.max(0, GALLERY_MAX - (gallery[dog.id] || []).length);
}

// 還沒傳好的照片放在相簿格「新增」那格的位置，跟傳好後一樣是正方形格子；傳好的那張已經在相簿清單裡，不重複放
function galleryPendingTiles(batch) {
  const busy = batch.phase === 'uploading';
  const left = batch.items.filter(it => it.state !== 'done');
  const badge = it => it.state === 'uploading' ? `<span class="gb-state busy">上傳中</span>`
    : it.state === 'error' ? `<span class="gb-state bad">${icon('alert')}</span>` : '';
  return batch.items.map((it, i) => it.state === 'done' ? '' : `
    <div class="gb-item ${it.state}">
      <img src="${esc(it.url)}" alt="第 ${i + 1} 張預覽">
      <span class="g-tag">預覽</span>
      ${badge(it)}
      ${!busy ? `<button type="button" class="gb-crop" data-gb-crop="${i}" aria-label="裁切第 ${i + 1} 張">${icon('crop')}</button>` : ''}
      ${!busy && left.length > 1 ? `<button type="button" class="gb-remove" data-gb-remove="${i}" aria-label="不要傳第 ${i + 1} 張">${icon('close')}</button>` : ''}
    </div>`).join('');
}

function galleryBatchHtml(batch) {
  const { dog, items } = batch;
  const busy = batch.phase === 'uploading';
  const left = items.filter(it => it.state !== 'done');
  const doneCount = items.length - left.length;
  const firstError = (items.find(it => it.state === 'error') || {}).error;
  // 上傳／取消按鈕在底部那列（#146，photoBarHtml）
  return `
    <div class="photo-upload preview in-gallery gallery-batch">
      <div class="photo-preview-hint">加進相簿：${items.length} 張（${esc(dog.name)}，編號 ${esc(dog.id)}）。標「預覽」的格子就是傳好後的樣子，按下面「上傳」才會加</div>
      ${firstError ? `<div class="photo-error" role="alert">${icon('alert')}<span>${doneCount ? `已傳 ${doneCount} 張，另外 ${left.length} 張沒傳成：` : ''}${esc(firstError)}</span></div>` : ''}
    </div>`;
}

// 選好的照片先全部壓好再一起預覽；一次最多 10 張，也不超過相簿剩下的格數
async function prepareGalleryPhotos(dog, files) {
  if (galleryBatch && galleryBatch.phase === 'uploading') {
    showToast('上一批照片還在上傳，請稍等一下');
    return;
  }
  const limit = Math.min(GALLERY_BATCH_MAX, galleryRoom(dog));
  if (!limit) { showToast(`相簿最多 ${GALLERY_MAX} 張，請先刪掉幾張`); return; }
  const picked = files.slice(0, limit);
  const items = [];
  let failed = '';
  for (const file of picked) {
    try {
      const blob = await compressPhoto(file);
      items.push({ blob, url: URL.createObjectURL(blob), state: 'ready', error: '' });
    } catch (e) {
      failed = failed || e.message;
    }
  }
  if (detailDog !== dog) { items.forEach(it => URL.revokeObjectURL(it.url)); return; } // 壓縮途中換看別隻或關掉了
  const notes = [];
  if (files.length > limit) notes.push(limit < GALLERY_BATCH_MAX ? `相簿只剩 ${limit} 格，只取前 ${limit} 張` : `一次最多 ${GALLERY_BATCH_MAX} 張，只取前 ${GALLERY_BATCH_MAX} 張`);
  if (failed) notes.push(items.length ? `有 ${picked.length - items.length} 張讀不了，已略過（${failed}）` : failed);
  if (notes.length) showToast(notes.join('；'));
  if (!items.length) return;
  clearGalleryBatch();
  galleryBatch = { dog, phase: 'preview', items };
  renderDetail();
  const btn = document.getElementById('galleryUpload');
  if (btn) {
    btn.focus({ preventScroll: true });
    if (btn.scrollIntoView) btn.scrollIntoView({ block: 'nearest' });
  }
}

// 取消（或換看別隻）時丟掉還沒上傳的照片；上傳好的那幾張本機圖片還要給相簿格用，不收回
function clearGalleryBatch() {
  if (galleryBatch) galleryBatch.items.forEach(it => { if (it.state !== 'done') URL.revokeObjectURL(it.url); });
  galleryBatch = null;
}

function removeGalleryBatchItem(index) {
  const batch = galleryBatch;
  if (!batch || batch.phase === 'uploading') return;
  const [it] = batch.items.splice(index, 1);
  if (it) URL.revokeObjectURL(it.url);
  if (!batch.items.some(x => x.state !== 'done')) clearGalleryBatch();
  renderDetail();
}

// 一張一張依序送到 Worker（同時送會讓相簿清單互相搶著改）；傳成的馬上出現在相簿格。
// 相簿新的排前面，所以從最後選的那張先傳，傳完的順序才會跟預覽時一樣、不會跳來跳去
// 被頻率限制或相簿滿了就停下來，剩下的留著可以重傳
async function uploadGalleryBatch() {
  const batch = galleryBatch;
  if (!batch || batch.phase === 'uploading') return;
  batch.phase = 'uploading';
  batch.items.forEach(it => { if (it.state === 'error') { it.state = 'ready'; it.error = ''; } });
  const shown = () => detailDog === batch.dog && galleryBatch === batch;
  if (shown()) renderDetail();
  const id = batch.dog.id;
  for (const it of [...batch.items].reverse()) {
    if (it.state === 'done') continue;
    if (it.state === 'error') continue; // 前面已經停下來、整批標成沒傳成
    it.state = 'uploading';
    if (shown()) renderDetail();
    let out = null, status = 0, error = '';
    try {
      const res = await fetch(`${UPLOAD_URL}/gallery/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: it.blob,
      });
      status = res.status;
      out = await res.json().catch(() => null);
      if (!res.ok || !out || !out.ok) error = (out && out.error) || `上傳失敗（${res.status}）`;
      else if (!(out.photo && typeof out.photo.file === 'string')) error = '上傳服務回應不對，請重新整理後再看看';
    } catch (e) {
      error = '上傳失敗，請確認網路後再試';
    }
    if (error) {
      it.state = 'error';
      it.error = error;
      // 太頻繁、相簿滿了：後面的也不用試了
      if (status === 429 || status === 409) batch.items.forEach(x => { if (x.state === 'ready') { x.state = 'error'; x.error = error; } });
      continue;
    }
    it.state = 'done';
    gallery[id] = [...(gallery[id] || []).filter(p => p.file !== out.photo.file), { file: out.photo.file, addedAt: out.photo.addedAt || '' }];
    galleryOverrides[`${id}/${out.photo.file}`] = it.url;
  }
  const done = batch.items.filter(it => it.state === 'done').length;
  const left = batch.items.length - done;
  if (galleryBatch !== batch) return;
  if (!left) {
    galleryBatch = null;
    if (detailDog === batch.dog) renderDetail();
    showToast(`已加進 ${done} 張到 ${batch.dog.name} 的相簿（其他志工重新整理就會看到）`);
    return;
  }
  batch.phase = 'error';
  if (shown()) { renderDetail(); return; }
  // 上傳途中關掉或換看別隻：用提示條告訴結果，沒傳成的丟掉
  const error = (batch.items.find(it => it.state === 'error') || {}).error;
  clearGalleryBatch();
  showToast(`${batch.dog.name} 的相簿${done ? `已加進 ${done} 張，` : ''}${left} 張沒有上傳成功：${error}`);
}

// 讀一個「編號 → 內容」的 JSON（相簿清單用）；pick 從回應挑出要的物件，不是物件就算失敗
async function readJsonObject(url, pick) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = pick(await res.json());
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('格式不對');
  return data;
}

// 詳細資訊的按鈕（#86）：在外框綁一次，依按下的是哪個按鈕分派，每次重畫內容不用重新綁。
// 由上往下找第一個符合的，所以同一個按鈕只會做一件事
const DETAIL_CLICKS = [
  ['#detailClose', () => closeDetail()],
  ['[data-zoom]', el => { if (!el.classList.contains('no-photo')) openLightbox(detailDog, el); }],
  // 相簿：點哪張就從哪張開燈箱；主照片讀不到就只翻相簿
  ['.g-tile', el => {
    const tiles = [...el.parentNode.querySelectorAll('.g-tile')];
    const hasMain = tiles.some(x => x.hasAttribute('data-g-main') && !x.hidden && !x.classList.contains('broken'));
    const index = tiles.filter(x => hasMain || !x.hasAttribute('data-g-main')).indexOf(el);
    openLightbox(detailDog, el, Math.max(0, index), hasMain);
  }],
  ['#galleryAdd', () => pickPhotoFile('gallery')],
  ['#galleryUpload', () => uploadGalleryBatch()],
  ['#galleryBatchCancel', () => {
    clearGalleryBatch(); renderDetail();
    const b = document.getElementById('galleryAdd');
    if (b) b.focus({ preventScroll: true });
  }],
  ['[data-gb-remove]', el => removeGalleryBatchItem(Number(el.dataset.gbRemove))],
  ['[data-gb-crop]', el => cropGalleryBatchItem(Number(el.dataset.gbCrop))],
  ['#photoCrop', () => cropPhotoUpload()],
  ['#photoPick', () => pickPhotoFile('main')],
  ['#photoConfirm', () => uploadPhoto()],
  ['#photoCancel', () => { clearPhotoUpload(); renderDetail(); }],
  ['.buddy', el => { const d = allDogs[el.dataset.dog]; if (d) showDetail(d); }],
  ['#whoAdd', () => openWithSheet([detailDog], true)],
  ['[data-who-remove]', el => {
    const n = el.dataset.whoRemove;
    editWalkers(detailDog, walkerList(detailDog).filter(x => x !== n), `已拿掉 ${n}`);
  }],
  ['#favToggle', () => { toggleFav(detailDog); renderDetail(); render(); }],
  ['#detailBack', () => { const d = detailTrail.pop(); if (d) showDetail(d, false); }],
  ['#detailWhere', el => whereOpen(detailDog, el)],
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

function renderDetail() {
  if (!detailDog) return;
  const box = document.getElementById('detail');
  wireDetail(box);
  const focused = box.contains(document.activeElement) ? document.activeElement : null;
  box.innerHTML = detailHtml(detailDog, new Date());
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
}

// 在詳細資訊裡點「可以一起溜的狗」會直接換成那隻，不多疊一層；換之前的狗記在 detailTrail，可以按「回到 ○○」
function showDetail(dog, remember = true) {
  const wasOpen = !!detailDog;
  if (!wasOpen) detailOpener = { element: document.activeElement, index: allDogs.indexOf(dog) };
  if (wasOpen && remember && dog !== detailDog) detailTrail.push(detailDog);
  if (dog !== detailDog) {
    pickedBuddies.clear();
    if (!photoUpload || photoUpload.phase !== 'uploading') clearPhotoUpload();
    if (!galleryBatch || galleryBatch.phase !== 'uploading') clearGalleryBatch();
  }
  detailDog = dog;
  renderDetail();
  document.getElementById('detailBackdrop').hidden = false;
  document.documentElement.classList.add('detail-open');
  document.getElementById('detail').scrollTop = 0;
  // 手機按「返回」時只關掉詳細資訊，不離開網頁
  if (!wasOpen) history.pushState({ bqDetail: true }, '');
  const first = document.getElementById('detailClose') || document.querySelector('#detail .photo-bar button');
  if (first) first.focus({ preventScroll: true });
}

function hideDetail() {
  if (!detailDog) return;
  detailDog = null;
  detailTrail = [];
  pickedBuddies.clear();
  if (!photoUpload || photoUpload.phase !== 'uploading') clearPhotoUpload();
  if (!galleryBatch || galleryBatch.phase !== 'uploading') clearGalleryBatch();
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
window.addEventListener('popstate', () => {
  if (findZoomOpen()) findZoomHide(); // 找狗平面圖全螢幕（#102，js/find.js）
  else if (cropOpen()) hideCropper();
  else if (lightboxOpen()) hideLightbox();
  else if (whereDog) whereHide(); // 在哪面板（#111，js/find.js）
  else if (detailDog) hideDetail();
  else if (analysisOpen) hideAnalysis();
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
    // Esc 關燈箱（刪除確認開著時先收起確認），左右鍵換張，Tab 只在燈箱裡的按鈕間移動
    const typing = e.target.closest && e.target.closest('#lightbox input');
    if (e.key === 'Escape') {
      if (galleryDelete && galleryDelete.phase !== 'deleting') { galleryDelete = null; showLightboxPhoto(); document.querySelector('#lightbox .lightbox-close').focus({ preventScroll: true }); }
      else if (!galleryDelete) closeLightbox();
    }
    if (!typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) stepLightbox(e.key === 'ArrowLeft' ? -1 : 1);
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
  // 我的備註編輯時（#62）文字框和通關碼欄位也要能用 Tab 走到
  const buttons = [...document.querySelectorAll('#detail button:not(:disabled), #detail textarea:not(:disabled), #detail input:not([hidden]):not(:disabled), #toast:not([hidden]) button:not([hidden])')];
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
  const filterBtn = e.target.closest('[data-walk-filter]');
  if (filterBtn) { const v = filterBtn.dataset.walkFilter; saveWalkFilter(v === 'none' ? 'none' : Number(v)); render(); return; }
  if (e.target.closest('[data-walk-fav]')) { saveWalkFav(!loadWalkFav()); render(); return; }
  const viewBtn = e.target.closest('[data-walk-view]');
  if (viewBtn) { saveWalkView(viewBtn.dataset.walkView); render(); return; }
  const sortBtn = e.target.closest('[data-walk-sort]');
  if (sortBtn) { saveWalkSort(sortBtn.dataset.walkSort); render(); return; }
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
  { id: 'walk', label: '溜狗表', icon: 'list' },
  { id: 'mine', label: '我溜過', icon: 'paw' }, // #58 取代原本的「相關資訊（編輯中）」
  { id: 'find', label: '找狗', icon: 'map' }, // #99 照片圖鑑＋平面圖，程式在 js/find.js
];

// counts：各分類要顯示的數字；沒有數字的分類留白
function buildTabs(counts) {
  const tabsEl = document.getElementById('tabs');
  tabsEl.innerHTML = TABS.map(t => {
    const n = counts[t.id] != null ? counts[t.id] : t.note || '';
    return `<button data-tab="${t.id}" class="${activeTab === t.id ? 'active' : ''}"${activeTab === t.id ? ' aria-current="page"' : ''}>${icon(t.icon)}<span class="t">${t.label}</span><span class="n">${n}</span></button>`;
  }).join('');
  tabsEl.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

// 切換分類：標籤跟著亮起，畫面回到內容最上面
function switchTab(id) {
  if (!TABS.some(t => t.id === id)) return;
  const changed = id !== activeTab;
  activeTab = id;
  render();
  const btn = document.querySelector(`#tabs button[data-tab="${id}"]`);
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

// 判斷一次手指移動算不算換分類的滑動：水平距離夠長、而且明顯比垂直移動多（上下捲動不算）。
// 回傳 +1（向左滑，下一個分類）、-1（向右滑，上一個分類）或 0
const SWIPE_MIN_PX = 60;
function swipeStep(dx, dy) {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}

// 內容區左右滑動換分類，狗卡上也可以滑（K 2026-09-24 定：加入／移回今天已溜改用狗卡上的按鈕，#35）；
// 按鈕、輸入框上不算，避免誤觸
const SWIPE_IGNORE = 'button, input, a, textarea';
let swipeStart = null;
const mainEl = document.getElementById('main');
mainEl.addEventListener('touchstart', e => {
  swipeStart = null;
  if (e.touches.length !== 1 || e.target.closest(SWIPE_IGNORE)) return;
  swipeStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
mainEl.addEventListener('touchend', e => {
  if (!swipeStart || analysisOpen) return; // 分析頁不是分類，滑動不換頁
  const t = e.changedTouches[0];
  const step = swipeStep(t.clientX - swipeStart.x, t.clientY - swipeStart.y);
  swipeStart = null;
  if (step) stepTab(step);
});
mainEl.addEventListener('touchcancel', () => { swipeStart = null; });

function render() {
  renderMain();
  if (loadWarning) {
    document.getElementById('main').insertAdjacentHTML('afterbegin',
      `<div class="alert-box warn">${icon('warn')}<span>${esc(loadWarning)}</span></div>`);
  }
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

// 溜狗表（沿用原待巡房）：所有狗依幾天沒遛由久到近；沒有遛狗紀錄的排最前，有人固定照顧的排最後
function dueDogs(dogs, today) {
  const key = s => s.kind === 'unknown' ? Infinity : s.kind === 'dated' ? s.days : -Infinity;
  return dogs
    .map(d => ({ d, k: key(computeStatus(d, today)) }))
    .sort((a, b) => (b.k === a.k ? 0 : b.k > a.k ? 1 : -1))
    .map(x => x.d);
}

// 溜狗表排序（2026-10-04 K：要可以改排序；之後 K：一個時間順序的按鈕就好，籠位、狗名不用）：
// 一顆按鈕在「最久沒溜」（預設）和「最近溜」（時間倒過來）之間切換。選了哪個記在這支手機（跟今天已溜同一個 localStorage）
const WALK_SORT_KEY = 'bq-walk-sort';
const WALK_SORTS = [
  { id: 'due', label: '最久沒溜在前' },
  { id: 'recent', label: '最近溜在前' },
];
let walkSortMemory = 'due';
function loadWalkSort() {
  let v = walkSortMemory;
  try {
    if (walkedStorage) v = walkedStorage.getItem(WALK_SORT_KEY);
  } catch (e) { /* 讀不到就用記憶體裡的 */ }
  return WALK_SORTS.some(s => s.id === v) ? v : 'due';
}
function saveWalkSort(id) {
  walkSortMemory = id;
  try {
    if (walkedStorage) walkedStorage.setItem(WALK_SORT_KEY, id);
  } catch (e) { /* 存不了就這次開著網頁的期間記得 */ }
}
function sortWalkList(dogs, today, sort = loadWalkSort()) {
  const due = dueDogs(dogs, today);
  if (sort !== 'recent') return due;
  // 最近溜：有日期的照最近溜在前；有人固定照顧、沒有紀錄的放最後（不是剛溜過）
  const dated = due.filter(d => computeStatus(d, today).kind === 'dated');
  return [...dated.reverse(), ...due.filter(d => computeStatus(d, today).kind !== 'dated')];
}
// 按一下換另一種；箭頭表示目前的方向
function walkSortHtml(sort = loadWalkSort()) {
  const now = WALK_SORTS.find(s => s.id === sort);
  const next = WALK_SORTS.find(s => s.id !== sort);
  return `<div class="walk-sort"><button type="button" class="walk-sort-btn" id="walkSort" data-walk-sort="${next.id}" aria-label="排序：${now.label}，按一下改成${next.label}">${icon('sort')}${now.label}</button></div>`;
}

// V9（#141 第 4 項）：溜狗表上面不再放三格，改成「幾天以上沒溜」篩選。
// 選項照目前的資料生出來：只列有狗、而且跟上一個選項隻數不同的天數（不會出現一排一樣的數字）
const WALK_FILTER_KEY = 'bq-walk-filter';
const WALK_FILTER_DAYS = [7, 3, 2];
let walkFilterMemory = 0;
function loadWalkFilter() {
  let v = walkFilterMemory;
  try {
    if (walkedStorage) { const raw = walkedStorage.getItem(WALK_FILTER_KEY); if (raw != null) v = raw; }
  } catch (e) { /* 讀不到就用記憶體裡的 */ }
  return v === 'none' ? 'none' : (WALK_FILTER_DAYS.includes(Number(v)) ? Number(v) : 0);
}
function saveWalkFilter(v) {
  walkFilterMemory = v;
  try {
    if (walkedStorage) walkedStorage.setItem(WALK_FILTER_KEY, String(v));
  } catch (e) { /* 存不了就這次開著網頁的期間記得 */ }
}
// 0：全部；N：N 天以上沒溜（含沒有紀錄的）；'none'：沒有紀錄
function passesWalkFilter(dog, today, f) {
  if (!f) return true;
  const s = computeStatus(dog, today);
  if (f === 'none') return s.kind === 'unknown';
  return s.kind === 'unknown' || (s.kind === 'dated' && s.days >= f);
}
function walkFilterOptions(list, today) {
  const opts = WALK_FILTER_DAYS.map(days => ({ v: days, label: `${days} 天以上`, n: list.filter(d => passesWalkFilter(d, today, days)).length }));
  const none = list.filter(d => passesWalkFilter(d, today, 'none')).length;
  if (none) opts.push({ v: 'none', label: '沒有紀錄', n: none });
  return opts;
}
// 我的常溜（#155，K 2026-10-04 選兩頁都放）：溜狗表的「★ 我的常溜」跟天數篩選可以一起用（例：常溜裡 7 天以上沒溜的）
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

function walkFilterHtml(list, today, f, fav = false, favN = 0) {
  const opts = walkFilterOptions(list, today);
  // 選的天數這次資料裡沒有了（例：大家都溜過了），照樣留著那顆，才按得掉
  if (f && !opts.some(o => o.v === f)) opts.unshift({ v: f, label: f === 'none' ? '沒有紀錄' : `${f} 天以上`, n: list.filter(d => passesWalkFilter(d, today, f)).length });
  const chip = o => `<button type="button" class="chip${o.v === f ? ' on' : ''}" data-walk-filter="${o.v}" aria-pressed="${o.v === f}">${o.label}<small>${o.n}</small></button>`;
  const favChip = `<button type="button" class="chip fav-chip${fav ? ' on' : ''}" data-walk-fav aria-pressed="${fav}">★ 我的常溜<small>${favN}</small></button>`;
  return `<div class="chips" role="group" aria-label="篩選：我的常溜、幾天以上沒溜">${favChip}${chip({ v: 0, label: '全部', n: list.length })}${opts.map(chip).join('')}</div>`;
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
function walkToolsHtml(view = loadWalkView()) {
  return `<div class="walk-tools">${walkSortHtml()}
    <div class="seg" role="group" aria-label="顯示方式">
      <button type="button" data-walk-view="photo" class="${view === 'photo' ? 'on' : ''}" aria-pressed="${view === 'photo'}" aria-label="照片">${icon('photos')}</button>
      <button type="button" data-walk-view="list" class="${view === 'list' ? 'on' : ''}" aria-pressed="${view === 'list'}" aria-label="列表（收起照片）">${icon('list')}</button>
    </div>
  </div>`;
}

// 列表模式的一列：籠位｜犬名｜遛狗日期｜誰遛的｜溜了，跟試算表同一個順序
function walkRow(dog, today) {
  const s = computeStatus(dog, today);
  const flag = specialFlag(dog.note);
  const date = s.kind === 'dated' ? (s.days === 0 ? '今天' : shortDate(effectiveWalkDate(dog, today))) : s.kind === 'covered' ? '固定' : '—';
  const who = walkerText(dog, today);
  return `<div class="row-dog${flag ? ' flagged' : ''}" data-dog="${allDogs.indexOf(dog)}" role="button" tabindex="0" aria-haspopup="dialog">
    <span class="r-cage">${esc(dog.cage)}</span>
    <span class="r-name">${flag ? icon('warn') : ''}${esc(dog.name)}</span>
    <span class="r-date ${s.level || 'muted'}">${date}</span>
    <span class="r-who">${esc(who)}</span>
    ${walkButton(dog)}
  </div>`;
}
function shortDate(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function renderMain() {
  const today = new Date();
  document.getElementById('dateLabel').textContent =
    `${today.getMonth() + 1}月${today.getDate()}日 (${'日一二三四五六'[today.getDay()]})`;

  const main = document.getElementById('main');
  // 分析頁開著時底部列收起來（分析頁有自己的「返回」）
  document.documentElement.classList.toggle('analysis-open', analysisOpen);

  // 分析頁（#59）：頁首右上角的圖示打開，蓋住分類清單；統計與畫面在 js/analysis.js
  if (analysisOpen) {
    main.innerHTML = analysisPageHtml(today);
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
  const mineCount = myWalksCount(q);
  // 找狗只要隻數，不用排序（每次重畫都排一百多隻很慢）
  buildTabs({ walk: walkList.length, mine: mineCount, find: allDogs.filter(d => findMatches(d, q)).length });
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
  const filter = loadWalkFilter();
  const fav = loadWalkFav();
  const base = fav ? walkList.filter(isFav) : walkList;
  const list = base.filter(d => passesWalkFilter(d, today, filter));
  const view = loadWalkView();
  const items = view === 'list'
    ? (list.length ? `<div class="rows"><div class="row-head"><span>籠位</span><span>狗名</span><span>日期</span><span>溜狗人</span><span>登記</span></div>${list.map(d => walkRow(d, today)).join('')}</div>` : '')
    : list.map((d, i) => dogCard(d, today, i < FIRST_SCREEN_CARDS)).join('');
  const head = walkFilterHtml(base, today, filter, fav, walkList.filter(isFav).length) + walkToolsHtml(view);
  const empty = fav && !base.length && !q ? '還沒有常溜的狗。<br>點狗打開詳細資訊，<br>按名字旁的「☆ 常溜」加進來。'
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
  else if (e.target.closest('#whoEdit')) {
    walkerSetup = { text: '', phase: 'edit', error: '' };
    render();
    const input = document.getElementById('whoInput');
    if (input) input.focus();
  } else if (e.target.closest('#whoCancel')) {
    walkerSetup = null;
    render();
  } else if (e.target.closest('#whoClear')) {
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
  walkerSetup.text = e.target.value;
});
mainEl.addEventListener('submit', e => {
  if (e.target.id !== 'whoForm') return;
  e.preventDefault();
  const input = document.getElementById('whoInput');
  walkerSetup = { ...(walkerSetup || {}), text: input ? input.value : '', phase: 'edit', error: '' };
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
// 第一次打開：先輸入你在溜狗表上的名字，才進網站；接著幾頁說明（像新網站上線的導覽），按「開始使用」就不再出現。
// 已經有名字（以前在我溜過設定過）只看說明；說明看過、名字被清掉了，只問名字
const ONBOARD_KEY = 'bq-onboarded';
const ONBOARD_SLIDES = [
  { icon: 'list', title: '溜狗表', text: '最久沒溜的狗排在最上面。上面可以篩「7 天以上沒溜」，右上角可以收起照片、像試算表一樣一列一隻。' },
  { icon: 'tick', title: '溜完按「溜了」', text: '狗卡右邊按一下「溜了」，日期和你的名字會直接寫進溜狗表，其他志工也看得到。按錯再按一次就取消。' },
  { icon: 'map', title: '找狗', text: '看照片認狗，或看平面圖找籠位。點狗卡上的籠位，也會告訴你狗在哪。' },
  { icon: 'paw', title: '我溜過', text: '你溜過的狗都在這裡，一次到所一張卡。' },
];
let onboard = null; // { step: 0 名字／1… 說明, text, phase, error }
function onboardDone() {
  try { return walkedStorage && walkedStorage.getItem(ONBOARD_KEY) === '1'; } catch (e) { return false; }
}
function needOnboard() {
  return !onboardDone() || !loadWalkerName() || !loadMyCodes().length;
}
function onboardHtml() {
  const o = onboard;
  if (o.step === 0) {
    const busy = o.phase === 'saving';
    return `<form class="ob-page ob-name" id="obForm" autocomplete="off">
      <div class="ob-hero">${icon('paw')}</div>
      <h1>板收志工溜狗表</h1>
      <p class="ob-lead">歡迎！先告訴我們你是誰。</p>
      <label class="ob-label" for="obInput">${walkerNameList.length ? '點選你在溜狗表上的名字' : '你在溜狗表「誰遛的」寫的名字'}</label>
      ${obNamesHtml(o, busy)}
      <input type="text" id="obInput" maxlength="60" placeholder="${walkerNameList.length ? '找不到？自己輸入' : '例：小明'}" value="${esc(o.text)}"${busy ? ' disabled' : ''} enterkeyhint="done">
      <p class="ob-help">如果沒有你的名字，請自行輸入。</p>
      ${o.phase === 'error' ? `<div class="photo-error" role="alert">${icon('alert')}<span>${esc(o.error)}</span></div>` : ''}
      <div class="ob-foot">
        <button type="submit" class="ob-next"${busy ? ' disabled' : ''}>${busy ? '設定中…' : '下一步'}</button>
        <p class="ob-small">名字只記在這支手機，用來記你溜過的狗。</p>
      </div>
    </form>`;
  }
  const i = o.step - 1;
  const sl = ONBOARD_SLIDES[i];
  const last = i === ONBOARD_SLIDES.length - 1;
  return `<div class="ob-page ob-slide">
    <button type="button" class="ob-skip" data-ob="done">略過</button>
    <div class="ob-art">${icon(sl.icon)}</div>
    <h2>${sl.title}</h2>
    <p>${sl.text}</p>
    <div class="ob-foot">
      <div class="ob-dots">${ONBOARD_SLIDES.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
      <button type="button" class="ob-next" data-ob="${last ? 'done' : 'next'}">${last ? '開始使用' : '下一步'}</button>
    </div>
  </div>`;
}
// 開頭畫面的名字按鈕（K 2026-10-04：入口的名字要能從表上已有的人選）：點了就加進輸入框，再點一次拿掉
function obNamesHtml(o, busy) {
  if (!walkerNameList.length) return '';
  const picked = new Set(splitWalkers(o.text));
  return `<div class="ob-names">${walkerNameList.map(n =>
    `<button type="button" class="with-name${picked.has(n) ? ' on' : ''}" data-ob-name="${esc(n)}" aria-pressed="${picked.has(n)}"${busy ? ' disabled' : ''}>${picked.has(n) ? icon('tick') : ''}${esc(n)}</button>`).join('')}</div>`;
}
function renderOnboard() {
  let box = document.getElementById('onboard');
  if (!onboard) { if (box) box.remove(); document.documentElement.classList.remove('onboard-open'); return; }
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
        const list = splitWalkers(onboard.text);
        onboard.text = (list.includes(n) ? list.filter(x => x !== n) : [...list, n]).join('、');
        if (onboard.phase === 'error') onboard.phase = 'edit';
        renderOnboard();
        return;
      }
      const b = e.target.closest('[data-ob]');
      if (!b) return;
      if (b.dataset.ob === 'next') onboard.step++;
      else { try { walkedStorage && walkedStorage.setItem(ONBOARD_KEY, '1'); } catch (err) { /* 存不了下次再看一次 */ } onboard = null; render(); }
      renderOnboard();
    });
    box.addEventListener('input', e => { if (onboard && onboard.phase !== 'saving' && e.target.id === 'obInput') onboard.text = e.target.value; });
    box.addEventListener('submit', async e => {
      e.preventDefault();
      if (onboard.phase === 'saving') return;
      onboard.phase = 'saving';
      renderOnboard();
      const error = await setWalkerName(onboard.text);
      if (error) { onboard.phase = 'error'; onboard.error = error; renderOnboard(); return; }
      onboard = onboardDone() ? null : { step: 1 };
      renderOnboard();
      render();
    });
  }
  document.documentElement.classList.add('onboard-open');
  box.innerHTML = onboardHtml();
  const input = box.querySelector('#obInput');
  // 有名字可以點時不自動叫出鍵盤，免得蓋住名字
  if (input && onboard.phase !== 'saving' && !walkerNameList.length) input.focus({ preventScroll: true });
}
function startOnboard() {
  if (onboard || !needOnboard()) return;
  onboard = loadWalkerName() && loadMyCodes().length ? { step: 1 } : { step: 0, text: '', phase: 'edit', error: '' };
  renderOnboard();
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
  loadGallery();
}

// 換上讀到的 dogs.json（打開網頁時、按「更新」拿到新資料時）
let dataSyncedAt = null;
function applyDogsData(data) {
  allDogs = data.dogs;
  photoVersions = data.photoVersions || {};
  groupMap = data.groups || {};
  loadWarning = data.groups ? '' : '「可以一起溜」暫時讀不到，其他資訊正常。';
  // 顯示試算表最後同步的時間（不是打開網頁的時間），志工才知道資料有多新
  const t = data.syncedAt;
  dataSyncedAt = t;
  document.getElementById('updatedLabel').textContent = t
    ? `資料更新 ${t.getMonth() + 1}/${t.getDate()} ${pad2(t.getHours())}:${pad2(t.getMinutes())}` : '';
  loadState = 'ready';
  render();
  loadMyWalks();
}

// ── 頁首「更新」按鈕：請 Worker 叫 GitHub 同步試算表，再等網站上的 dogs.json 換新 ──
// 同步約 1 分鐘、網站重新部署再約 1 分鐘；試算表沒有新東西時 dogs.json 不會變，等滿就告訴志工已經是最新
const SYNC_POLL_MS = 15 * 1000;
const SYNC_POLL_TRIES = 16; // 15 秒 × 16 ＝ 最多等 4 分鐘
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
    showToast('正在更新，約 1–2 分鐘');
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
