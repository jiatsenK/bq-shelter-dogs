// 狗狗資料：試算表由 GitHub Action 每天同步成這個檔（#31），前端只讀它、不直接連試算表（#32）
const DATA_URL = 'data/dogs.json';
// 照片上傳服務（Cloudflare Worker，#47／#48）的網址，例：https://bq-shelter-photos.xxx.workers.dev
// 還沒部署就留空：詳細資訊不顯示上傳按鈕。這裡只放網址，GitHub 寫入權限只在 Worker 裡，網站碰不到
// （用 let 是讓 tests/index.html 能換成測試網址）
let UPLOAD_URL = 'https://bq-shelter-photos.jiatsen-k.workers.dev';
// 上傳前先在手機上壓成 JPEG：長邊最多 1280px，避免 repo 堆滿手機原圖；上限要跟 Worker 的 MAX_BYTES 一致
const PHOTO_MAX_EDGE = 1280;
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
// 我的備註（#61／#62）：寫入與最新內容都經過同一個 Worker；讀不到 Worker 時改讀網站上的這個檔（可能晚一兩分鐘）
const MY_NOTES_URL = 'data/my-notes.json';
const MY_NOTE_MAX_CHARS = 1000; // 跟 Worker 的 NOTE_MAX_CHARS 一致
// 相簿：每隻狗除了主照片還能多放幾張（photos/gallery/{編號}/），清單在這個檔；最新清單一樣先問 Worker
const GALLERY_URL = 'data/gallery.json';
// 手機第一屏大約看得到幾張狗卡：這幾張的照片不延後載入、優先下載（#91）
const FIRST_SCREEN_CARDS = 8;
const GALLERY_MAX = 30; // 跟 Worker 的 GALLERY_MAX 一致
const GALLERY_BATCH_MAX = 10; // 相簿一次最多選幾張（一張一張依序傳，Worker 相簿頻率限制 1 分鐘 12 張）
// 我最近溜過（#58）：同步時累積的遛狗紀錄（#56），只看 mine（#57 判斷是不是我遛的）
const WALKS_URL = 'data/walks.json';
const MY_WALKS_SINCE = '2026/9/25'; // #57 上線、開始判斷是不是我遛的那天
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
let myNotes = {}; // 我的備註（#62）：編號 → { text, updatedAt }
let myNotesState = 'loading'; // loading／worker（Worker 讀到最新）／site（退回網站上的檔）／error
let noteEdit = null; // 正在編輯的我的備註：{ dog, text, pass, needPass, phase: 'edit'|'saving'|'error', error }
let analysisOpen = false; // 分析頁（#59）開著嗎
let myWalks = []; // 我遛過的紀錄（#58）：[{ id, name, date: Date, ymd }]，新到舊
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
  return { dogs, groups, syncedAt: synced && !isNaN(synced) ? synced : null };
}

// 瀏覽器可能拿快取的舊檔；no-cache 讓它每次都先問 GitHub Pages 有沒有新版（沒變只回 304，很省）
async function loadDogsData() {
  let res;
  try {
    res = await fetch(DATA_URL, { cache: 'no-cache' });
  } catch (e) {
    throw new Error('連不到網站，可能是網路中斷。');
  }
  if (!res.ok) throw new Error(`讀取 dogs.json 失敗（HTTP ${res.status}）。`);
  let data;
  try { data = await res.json(); } catch (e) { throw new Error('dogs.json 內容壞掉了。'); }
  return parseDogsData(data);
}

// ── 我最近溜過（#58）──

// walks.json 只取 mine 的紀錄，日期不合理的丟掉；同一隻狗同一天只留一筆；新到舊（同一天後記的在前）
function parseMyWalks(data) {
  if (!data || !Array.isArray(data.walks)) throw new Error('walks.json 格式不對');
  const text = v => (v == null ? '' : String(v).trim());
  const seen = new Set();
  const list = [];
  data.walks.forEach((w, i) => {
    if (!w || w.mine !== true) return;
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
    myWalks = parseMyWalks(await res.json());
    myWalksState = 'ready';
  } catch (e) {
    console.error(e);
    myWalksState = 'error';
  }
  // 不在「我溜過」就只更新分類上的數字（#91）：整頁重畫會把第一屏正在載入的照片換掉
  const n = document.querySelector('#tabs [data-tab="mine"] .n');
  if (activeTab !== 'mine' && !analysisOpen && n) {
    n.textContent = myWalksState === 'ready'
      ? myWalkGroups(myWalks, searchQuery.trim()).reduce((k, g) => k + g.walks.length, 0) : '';
  } else {
    render();
  }
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
function myVisitCard(g, firstSeen) {
  const tiles = g.walks.map(w => {
    const dog = dogOfWalk(w);
    const first = firstSeen.get(w.id || w.name) === w.ymd && w.ymd !== firstSeen.earliest;
    const inner = `${photoThumb(dog || { name: w.name, id: '' }, 56)}<span class="bname">${esc(w.name)}</span>${first ? '<span class="first">第一次</span>' : ''}`;
    return dog
      ? `<button type="button" class="mine-dog" data-mine-dog="${allDogs.indexOf(dog)}" aria-label="${esc(w.name)}：看詳細資訊">${inner}</button>`
      : `<div class="mine-dog gone" title="已不在目前的溜狗表">${inner}</div>`;
  }).join('');
  return `<section class="visit">
    <h3 class="walk-date">${esc(walkDateLabel(g.date))}<span class="n">${g.walks.length} 隻</span></h3>
    <div class="visit-dogs">${tiles}</div>
  </section>`;
}

// 每隻狗我第一次遛的日期（看全部紀錄，不受日期選擇與搜尋影響）
function myFirstWalks(walks) {
  const first = new Map();
  for (const w of walks) {
    const k = w.id || w.name;
    if (!first.has(k) || first.get(k) > w.ymd) first.set(k, w.ymd);
    if (!first.earliest || first.earliest > w.ymd) first.earliest = w.ymd;
  }
  return first;
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
      <div><b>${new Set(now.map(w => w.id || w.name)).size}</b><span>遛過幾隻</span></div>
      <div><b>${now.length}</b><span>總共幾趟</span></div>
    </div>
  </div>`;
}

function myWalksHtml(today, query) {
  if (myWalksState === 'loading') return `<div class="status-msg">讀取遛狗紀錄中…</div>`;
  if (myWalksState === 'error') {
    return `<div class="status-msg">遛狗紀錄讀取失敗，請稍後重新整理。<br><button class="retry-btn" id="mineRetry">重新讀取</button></div>`;
  }
  if (!myWalks.length) return `<div class="status-msg">從 ${MY_WALKS_SINCE} 開始記錄，目前還沒有資料。<br>試算表「誰遛的」填你的名字，同步後就會出現在這裡。</div>`;
  // 所有到所紀錄新到舊一路往下排（K 2026-09-25：不要選日期）；搜尋時不顯示小計
  const groups = myWalkGroups(myWalks, query);
  if (!groups.length) return `<div class="status-msg">找不到「${esc(query)}」</div>`;
  const firstSeen = myFirstWalks(myWalks);
  return (query ? '' : myMonthStats(myWalks, today)) + groups.map(g => myVisitCard(g, firstSeen)).join('');
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

function computeStatus(dog, today) {
  if (dog.walkedDate) {
    const days = Math.floor((today - dog.walkedDate) / 86400000);
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

// 前端剛上傳成功的照片（編號 → 本機圖片網址）：GitHub Pages 要一兩分鐘才會更新，這段期間先顯示剛傳的那張（#48）
const photoOverrides = {};
function photoSrc(dog) {
  return photoOverrides[dog.id] || `photos/${encodeURIComponent(dog.id)}.jpg`;
}

// 相簿照片：清單舊到新，畫面上新的在前；剛傳的那張同樣先用本機圖片（編號/檔名 → 本機圖片網址）
const galleryOverrides = {};
function galleryList(dog) {
  return dog && dog.id ? [...(gallery[dog.id] || [])].reverse() : [];
}
function gallerySrc(dog, file) {
  return galleryOverrides[`${dog.id}/${file}`] || `photos/gallery/${encodeURIComponent(dog.id)}/${encodeURIComponent(file)}`;
}

// 縮圖（#83）：清單、相簿格子只載 photos/thumbs/ 的小圖，燈箱才看原圖；縮圖由 Action 產生（scripts/make-thumbs.py）
// 剛上傳的照片先用本機圖片；縮圖還沒產生就在 img 的 onerror 改讀 data-full 的原圖（thumbFallback）
function photoThumbSrc(dog) {
  return photoOverrides[dog.id] || `photos/thumbs/${encodeURIComponent(dog.id)}.jpg`;
}
function galleryThumbSrc(dog, file) {
  return galleryOverrides[`${dog.id}/${file}`] || `photos/thumbs/gallery/${encodeURIComponent(dog.id)}/${encodeURIComponent(file)}`;
}
// 放在 img 的 onerror 最前面：還有原圖可試就換原圖、這次不算讀取失敗
const thumbFallback = "if (this.dataset.full) { this.src = this.dataset.full; this.removeAttribute('data-full'); return; }";
function thumbAttrs(thumb, full) {
  return thumb === full ? `src="${esc(full)}"` : `src="${esc(thumb)}" data-full="${esc(full)}"`;
}

// zoom：詳細資訊上方的照片做成按鈕，點了用燈箱放大（#46）；照片讀不到就標 no-photo，按了不放大
function photoThumb(dog, size = 56, zoom = false, eager = false) {
  // 沒有編號就直接顯示腳掌圖示，不去抓 photos/.jpg
  if (!dog.id) {
    return `<div class="thumb"><div class="thumb-fallback" style="display:flex">${icon('paw')}</div></div>`;
  }
  const tag = zoom ? 'button' : 'div';
  const attrs = zoom ? ` type="button" class="thumb zoom" data-zoom aria-label="放大 ${esc(dog.name)} 的照片"` : ' class="thumb"';
  return `
    <${tag}${attrs}>
      <img ${thumbAttrs(photoThumbSrc(dog), photoSrc(dog))} alt="" width="${size}" height="${size}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"
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
    if (s.days < 0) return `<span class="badge muted">日期異常</span>`;
    const label = s.days === 0 ? '今天' : `${s.days} 天前`;
    return `<span class="badge ${s.level}">${label}</span>`;
  }
  if (s.kind === 'covered') return `<span class="badge sage">有人固定照顧</span>`;
  return `<span class="badge muted">尚無遛狗記錄</span>`;
}

// 卡片上的「上次遛狗」：天數用 #3 的綠／黃／紅文字色
function lastWalk(dog, today) {
  const s = computeStatus(dog, today);
  let text = '尚無紀錄', level = 'muted', small = false;
  if (s.kind === 'dated') {
    if (s.days < 0) text = '日期異常';
    else { text = s.days === 0 ? '今天' : `${s.days} 天前`; level = s.level; }
  } else if (s.kind === 'covered') {
    // 窄螢幕放不下一行時只在「有人固定｜照顧」之間換行，不會剩一個「顧」字
    text = '<span class="nowrap">有人固定</span><span class="nowrap">照顧</span>'; level = 'sage'; small = true;
  }
  return `<div class="last"><span class="lbl">上次遛狗</span><span class="val ${level}${small ? ' small' : ''}">${text}</span></div>`;
}

// 卡片用「編號｜籠位」（照 K 的參考圖）；詳細資訊沿用 metaLine
function cardMeta(dog) {
  return `<div class="meta">${dog.id ? `${esc(dog.id)}<span class="sep">|</span>` : ''}${esc(dog.cage)}</div>`;
}

function metaLine(dog) {
  return `<div class="meta">${esc(dog.cage)}${dog.id ? `<span class="sep">|</span>${esc(dog.id)}` : ''}</div>${reentryLine(dog)}`;
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
function sexMark(dog) {
  const cls = dog.sex === '♂' ? ' male' : dog.sex === '♀' ? ' female' : '';
  return `<span class="sex${cls}">${esc(dog.sex || '')}</span>`;
}

// 備註命中警示關鍵字時的原文顯示；同一筆備註命中幾個關鍵字都只顯示一次
function warnNote(note, flag) {
  return `<div class="warn-note">${icon('warn')}<span class="text">${highlightNote(note, flag.terms)}</span></div>`;
}

// ── 今天已溜（V3 第 4 節，#35）──
// 只記「這支手機、這個瀏覽器的人」今天自己溜過哪些狗，不是所有志工的紀錄。
// 只存在瀏覽器 localStorage，不寫試算表、不寫 GitHub、不用登入。
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

// 按「溜了」、一起記、移回：記下後重畫，底部跳提示條，可以按「復原」
function setWalked(dogs, on) {
  const { changed, undo } = recordWalked(dogs, on);
  if (!changed.length) return;
  pickedBuddies.clear();
  render();
  renderDetail();
  const names = changed.map(d => d.name).join('、');
  showToast(on ? `已記下今天溜了：${names}` : `${names} 移回溜狗表`, () => {
    undo();
    render();
    renderDetail();
  });
}

// 我的備註的通關碼（#62）：第一次儲存成功後記在這支手機，之後不用再輸入；被拒絕就清掉重問。
// 和今天已溜用同一個 localStorage；讀寫不了（無痕模式）就這次開著網頁的期間記在記憶體
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

// ── 收起（#79）──
// 暫時不想在溜狗表看到的狗（剛看到別人溜、這隻我不會溜）先收起來，溜狗表最下面「已收起」點開可以放回。
// 跟今天已溜一樣只存在這支手機的 localStorage：{ today: { date, ids }, always: [ids] }。
// 「今天先收起」隔天自動回來；「一直收起」要自己放回。
const HIDDEN_KEY = 'bq-hidden';
let hiddenMemory = null;
let hiddenOpen = false; // 溜狗表最下面「已收起」有沒有展開

function readHidden() {
  let data = hiddenMemory;
  try {
    const raw = walkedStorage && walkedStorage.getItem(HIDDEN_KEY);
    if (raw) data = JSON.parse(raw);
  } catch (e) { /* 讀不到就用這次開網頁期間的紀錄 */ }
  const list = v => (Array.isArray(v) ? v.map(String) : []);
  return { today: data && data.today ? { date: String(data.today.date || ''), ids: list(data.today.ids) } : { date: '', ids: [] },
    always: list(data && data.always) };
}

// 編號（或名:犬名）→ 'today'／'always'；「今天」過了日期就不算
function loadHidden(today = new Date()) {
  const data = readHidden();
  const map = new Map();
  for (const id of data.always) map.set(id, 'always');
  if (data.today.date === localDateKey(today)) for (const id of data.today.ids) if (!map.has(id)) map.set(id, 'today');
  return map;
}

function saveHidden(map, today = new Date()) {
  const pick = mode => [...map].filter(([, m]) => m === mode).map(([id]) => id);
  hiddenMemory = { today: { date: localDateKey(today), ids: pick('today') }, always: pick('always') };
  try {
    if (walkedStorage) walkedStorage.setItem(HIDDEN_KEY, JSON.stringify(hiddenMemory));
  } catch (e) { /* 存不了就只記在記憶體 */ }
}

// mode：'today'／'always' 收起，null 放回。跳提示條可以復原
function setHidden(dog, mode) {
  const key = dog && walkKey(dog);
  if (!key) return;
  const today = new Date();
  const before = loadHidden(today);
  const map = new Map(before);
  if (mode) map.set(key, mode); else map.delete(key);
  saveHidden(map, today);
  render();
  renderDetail();
  showToast(mode === 'today' ? `${dog.name} 今天先收起，明天會回到溜狗表`
    : mode === 'always' ? `${dog.name} 已收起，要自己放回`
    : `${dog.name} 放回溜狗表`, () => {
    saveHidden(before, today);
    render();
    renderDetail();
  });
}

// 詳細資訊的收起按鈕（照片下方）：收起中就顯示狀態和「放回」
function hideActions(dog) {
  if (!walkKey(dog)) return '';
  const mode = loadHidden().get(walkKey(dog));
  if (mode) {
    return `<div class="hide-bar is-hidden">${icon('eyeoff')}<span>${mode === 'today' ? '今天先收起了（明天自動回來）' : '一直收起中'}</span>
      <button type="button" class="hide-btn" data-hide="">放回溜狗表</button></div>`;
  }
  return `<div class="hide-bar"><span class="hide-q">${icon('eyeoff')}收起</span>
    <button type="button" class="hide-btn" data-hide="today">今天先收起</button>
    <button type="button" class="hide-btn" data-hide="always">一直收起</button></div>`;
}

// 溜狗表最下面的「已收起 N 隻」：點開列出，每隻可以放回
function hiddenBoxHtml(list, hidden) {
  if (!list.length) return '';
  return `<div class="hidden-box${hiddenOpen ? ' open' : ''}">
    <button type="button" class="hidden-toggle" id="hiddenToggle" aria-expanded="${hiddenOpen}">${icon('eyeoff')}<span>已收起 ${list.length} 隻</span>${icon('chevron')}</button>
    ${hiddenOpen ? `<div class="hidden-list">${list.map(d => `
      <div class="hidden-row">
        <button type="button" class="hidden-name" data-hidden-dog="${allDogs.indexOf(d)}">${esc(d.name)}<small>${hidden.get(walkKey(d)) === 'today' ? '今天' : '一直'}</small></button>
        <button type="button" class="hide-btn" data-unhide="${allDogs.indexOf(d)}">放回</button>
      </div>`).join('')}</div>` : ''}
  </div>`;
}

let toastTimer = null;
let toastUndo = null;
function showToast(text, undo) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `<span class="toast-text"></span><button type="button" class="toast-undo">復原</button>`;
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
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}

function hideToast() {
  clearTimeout(toastTimer);
  toastUndo = null;
  const el = document.getElementById('toast');
  if (el) el.hidden = true;
}

// 狗卡右側的「已遛」（溜狗表）／「移回」（今天已溜）按鈕；連犬名都沒有的狗記不了，照舊顯示箭頭
function walkButton(dog, walkedTab) {
  if (!walkKey(dog)) return `<span class="more">${icon('chevron')}</span>`;
  return walkedTab
    ? `<button type="button" class="walk-btn back" data-walk="back" aria-label="把 ${esc(dog.name)} 移回溜狗表">移回</button>`
    : `<button type="button" class="walk-btn" data-walk="add" aria-label="記下今天已遛 ${esc(dog.name)}">已遛</button>`;
}

// 所有分頁、搜尋、籠位共用這張卡片。第一層只放照片、犬名、天數、籠位｜編號，
// 備註命中警示關鍵字才把原文放上來；一般備註、可一起遛、狗卡資訊點卡片看詳細資訊
// eager：第一屏的卡片（#91），照片不等延後載入、優先下載
function dogCard(dog, today, walkedTab = false, eager = false) {
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
          ${walkButton(dog, walkedTab)}
        </div>
      </div>
      ${flag ? warnNote(dog.note, flag) : ''}
    </div>
  `;
}

// 詳細資訊：備註（志工後續補充，試算表備註欄）／可以一起溜的狗／狗卡資訊（dogs/{編號}.md 的入所原始介紹，同步時已寫進 dogs.json）
function detailHtml(dog, today) {
  const flag = specialFlag(dog.note);
  const buddies = [...(groupMap[dog.name] || [])];
  const byName = new Map(allDogs.map(d => [d.name, d]));
  const intro = dog.intro;
  const walked = walkedToday(today);
  return `
    <div class="detail-head">
      <div class="photo-wrap">${photoThumb(dog, 84, true)}${photoPickButton(dog)}</div>
      <div class="info">
        ${statusBadge(dog, today)}
        <div class="name" id="detailName">${esc(dog.name)}${sexMark(dog)}</div>
        ${metaLine(dog)}
      </div>
      <button class="detail-close" id="detailClose" aria-label="關閉">${icon('close')}</button>
    </div>
    ${photoUploadHtml(dog)}
    ${hideActions(dog)}
    <section class="detail-section" data-section="note">
      <h3>${icon('note')}Google 遛狗表備註</h3>
      ${!dog.note ? `<div class="empty">目前沒有備註</div>`
        : flag ? warnNote(dog.note, flag)
        : `<div class="content note-text">${esc(dog.note)}</div>`}
    </section>
    ${myNoteSection(dog)}
    <section class="detail-section" data-section="group">
      <h3>${icon('group')}可以一起溜的狗</h3>
      ${buddies.length
        ? `<div class="buddies">${buddies.map(n => {
            const d = byName.get(n) || { name: n, id: '' };
            return buddyTile(d, n, walked);
          }).join('')}</div>`
        : `<div class="empty">沒有登記可以一起溜的狗</div>`}
      ${groupWalkButton(dog, walked)}
    </section>
    ${walkHistorySection(dog, today)}
    <section class="detail-section" data-section="intro">
      <h3>${icon('card')}狗卡資訊<span class="sub">入所時的原始狗卡</span></h3>
      ${intro ? `<div class="content">${esc(intro)}</div>` : `<div class="empty">還沒有狗卡資訊</div>`}
    </section>
    ${gallerySection(dog)}
  `;
}

// 相簿（狗卡資訊下方）：主照片＋另外上傳的照片排成縮圖格，點了用燈箱看大圖、左右滑換張；最後一格「新增」。
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
    ...list.map((p, i) => tile(galleryThumbSrc(dog, p.file), gallerySrc(dog, p.file), `data-g-file="${esc(p.file)}" aria-label="放大 ${esc(dog.name)} 的相簿照片（第 ${i + 1} 張）"`)),
  ];
  const note = galleryState === 'loading' ? '讀取中…' : galleryState === 'error' ? '相簿清單暫時讀不到' : '';
  return `
    <section class="detail-section" data-section="gallery">
      <h3>${icon('photos')}相簿<span class="sub">${list.length ? `另外 ${list.length} 張，` : ''}點照片看大圖</span></h3>
      <div class="gallery-grid">
        ${tiles.join('')}
        ${canAdd && !up ? `<button type="button" class="g-add" id="galleryAdd" aria-label="新增 ${esc(dog.name)} 的相簿照片">${icon('plus')}<span>新增</span></button>` : ''}
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
  if (detailDog && !(noteEdit && noteEdit.dog === detailDog)) renderDetail();
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

// 「可以一起溜」下方的按鈕：把目前這隻連同勾選的狗一次記進今天已溜。
// 目前這隻已溜又沒勾選時，就顯示目前這隻今天已溜，不放按鈕
function groupWalkButton(dog, walked) {
  const self = !!walkKey(dog) && !walked.has(dog);
  const n = [...pickedBuddies].length;
  if (!self && !n) {
    return walked.has(dog) ? `<div class="self-walked">${icon('tick')}${esc(dog.name)} 今天已溜（這支手機的紀錄）</div>` : '';
  }
  const label = !n ? `${esc(dog.name)} 溜了`
    : self ? `${esc(dog.name)} 和勾選的 ${n} 隻都溜了`
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

// 選好照片後，詳細資訊上方出現的預覽與「確認上傳」
function photoUploadHtml(dog) {
  if (!UPLOAD_URL || !dog.id) return '';
  const up = photoUpload && photoUpload.dog === dog ? photoUpload : null;
  if (!up) return '';
  const busy = up.phase === 'uploading';
  return `
    <div class="photo-upload preview">
      <div class="photo-preview-hint">預覽（${esc(dog.name)}，編號 ${esc(dog.id)}）</div>
      <img class="photo-preview" src="${esc(up.url)}" alt="${esc(dog.name)} 的新照片預覽">
      ${up.phase === 'error' ? `<div class="photo-error" role="alert">${icon('alert')}<span>${esc(up.error)}</span></div>` : ''}
      ${busy ? '' : `<button type="button" class="photo-crop" id="photoCrop">${icon('crop')}裁切</button>`}
      <button type="button" class="photo-confirm" id="photoConfirm"${busy ? ' disabled' : ''}>${busy ? '上傳中…' : '確認上傳'}</button>
      ${busy ? '' : `<button type="button" class="photo-cancel" id="photoCancel">取消</button>`}
    </div>`;
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
  showToast(`${up.dog.name} 的照片已更新（其他志工幾分鐘內會看到）`);
}

// ── 相簿一次加好幾張：選照片 → 每張壓成 JPEG、排成預覽格（可拿掉幾張）→ 「上傳 N 張」一張一張依序送 ──

// 相簿還能放幾張（滿 30 張就是 0）
function galleryRoom(dog) {
  return Math.max(0, GALLERY_MAX - (gallery[dog.id] || []).length);
}

function galleryBatchHtml(batch) {
  const { dog, items } = batch;
  const busy = batch.phase === 'uploading';
  const left = items.filter(it => it.state !== 'done');
  const doneCount = items.length - left.length;
  const badge = it => it.state === 'uploading' ? `<span class="gb-state busy">上傳中</span>`
    : it.state === 'done' ? `<span class="gb-state ok">${icon('tick')}</span>`
    : it.state === 'error' ? `<span class="gb-state bad">${icon('alert')}</span>` : '';
  const firstError = (items.find(it => it.state === 'error') || {}).error;
  const label = busy ? `上傳中 ${Math.min(doneCount + 1, items.length)} / ${items.length}…`
    : batch.phase === 'error' ? `重新上傳沒傳成的 ${left.length} 張` : `上傳 ${items.length} 張`;
  return `
    <div class="photo-upload preview in-gallery gallery-batch">
      <div class="photo-preview-hint">加進相簿：${items.length} 張（${esc(dog.name)}，編號 ${esc(dog.id)}）</div>
      <div class="gb-grid">
        ${items.map((it, i) => `
          <div class="gb-item ${it.state}">
            <img src="${esc(it.url)}" alt="第 ${i + 1} 張預覽">
            ${badge(it)}
            ${!busy && it.state !== 'done' ? `<button type="button" class="gb-crop" data-gb-crop="${i}" aria-label="裁切第 ${i + 1} 張">${icon('crop')}</button>` : ''}
            ${!busy && it.state !== 'done' && left.length > 1 ? `<button type="button" class="gb-remove" data-gb-remove="${i}" aria-label="不要傳第 ${i + 1} 張">${icon('close')}</button>` : ''}
          </div>`).join('')}
      </div>
      ${firstError ? `<div class="photo-error" role="alert">${icon('alert')}<span>${doneCount ? `已傳 ${doneCount} 張，另外 ${left.length} 張沒傳成：` : ''}${esc(firstError)}</span></div>` : ''}
      <button type="button" class="photo-confirm" id="galleryUpload"${busy ? ' disabled' : ''}>${label}</button>
      ${busy ? '' : `<button type="button" class="photo-cancel" id="galleryBatchCancel">${doneCount ? '不傳了' : '取消'}</button>`}
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
// 被頻率限制或相簿滿了就停下來，剩下的留著可以重傳
async function uploadGalleryBatch() {
  const batch = galleryBatch;
  if (!batch || batch.phase === 'uploading') return;
  batch.phase = 'uploading';
  batch.items.forEach(it => { if (it.state === 'error') { it.state = 'ready'; it.error = ''; } });
  const shown = () => detailDog === batch.dog && galleryBatch === batch;
  if (shown()) renderDetail();
  const id = batch.dog.id;
  for (const it of batch.items) {
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
    showToast(`已加進 ${done} 張到 ${batch.dog.name} 的相簿（其他志工幾分鐘內會看到）`);
    return;
  }
  batch.phase = 'error';
  if (shown()) { renderDetail(); return; }
  // 上傳途中關掉或換看別隻：用提示條告訴結果，沒傳成的丟掉
  const error = (batch.items.find(it => it.state === 'error') || {}).error;
  clearGalleryBatch();
  showToast(`${batch.dog.name} 的相簿${done ? `已加進 ${done} 張，` : ''}${left} 張沒有上傳成功：${error}`);
}

// 讀一個「編號 → 內容」的 JSON（我的備註、相簿清單共用）；pick 從回應挑出要的物件，不是物件就算失敗
async function readJsonObject(url, pick) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = pick(await res.json());
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('格式不對');
  return data;
}

// ── 我的備註（#62）：溜狗表備註下方的獨立區塊，存在 Git（經 Worker），不參與警示關鍵字、不上狗卡 ──

// 開網頁時讀最新的我的備註：先問 Worker（直接讀 GitHub，不用等網站更新），不行再讀網站上的 data/my-notes.json
async function loadMyNotes() {
  myNotesState = 'loading';
  let notes = null;
  if (UPLOAD_URL) {
    try {
      notes = await readJsonObject(`${UPLOAD_URL}/notes`, d => d && d.ok ? d.notes : null);
      myNotesState = 'worker';
    } catch (e) { notes = null; }
  }
  if (!notes) {
    try {
      notes = await readJsonObject(MY_NOTES_URL, d => d);
      myNotesState = 'site';
    } catch (e) {
      notes = {};
      myNotesState = 'error';
    }
  }
  myNotes = {};
  for (const [id, n] of Object.entries(notes)) {
    if (n && typeof n.text === 'string' && n.text.trim()) myNotes[id] = { text: n.text, updatedAt: n.updatedAt || '' };
  }
  if (detailDog && !(noteEdit && noteEdit.dog === detailDog)) renderDetail();
}

function noteTime(iso) {
  const t = new Date(iso);
  if (!iso || isNaN(t)) return '';
  return `${t.getFullYear()}/${t.getMonth() + 1}/${t.getDate()} ${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
}

function myNoteSection(dog) {
  const note = dog.id ? myNotes[dog.id] : null;
  const canEdit = !!(UPLOAD_URL && dog.id);
  const edit = noteEdit && noteEdit.dog === dog ? noteEdit : null;
  const head = `<h3>${icon('write')}我的備註</h3>`;
  if (edit) return `<section class="detail-section" data-section="mynote">${head}${myNoteForm(dog, edit)}</section>`;
  const body = note
    ? `<div class="content note-text my-note-text">${esc(note.text)}</div>${noteTime(note.updatedAt) ? `<div class="my-note-time">更新於 ${noteTime(note.updatedAt)}</div>` : ''}`
    : `<div class="empty">${myNotesState === 'loading' ? '讀取中…' : myNotesState === 'error' ? '我的備註暫時讀不到' : '還沒有我的備註'}</div>`;
  const btn = canEdit && myNotesState !== 'loading'
    ? `<button type="button" class="my-note-edit" id="myNoteEdit">${icon('write')}${note ? '修改' : '新增'}</button>` : '';
  return `<section class="detail-section" data-section="mynote">${head}${body}${btn}</section>`;
}

// 編輯表單。通關碼欄位是真的密碼欄位（放在 form 裡、配一個隱藏的帳號欄位），
// iPhone 會問要不要存進鑰匙圈，之後用 Face ID 自動填入（K 2026-09-25 同意）
function myNoteForm(dog, edit) {
  const busy = edit.phase === 'saving';
  const count = [...edit.text].length;
  return `
    <form class="my-note-form" id="myNoteForm" autocomplete="on">
      <textarea id="myNoteText" rows="4" maxlength="${MY_NOTE_MAX_CHARS * 2}" aria-label="${esc(dog.name)} 的我的備註"
        placeholder="寫給自己看的備註，例如怎麼牽比較好走"${busy ? ' disabled' : ''}>${esc(edit.text)}</textarea>
      <div class="my-note-count${count > MY_NOTE_MAX_CHARS ? ' over' : ''}" id="myNoteCount">${count} / ${MY_NOTE_MAX_CHARS} 字</div>
      ${edit.needPass ? `
        <input type="text" name="username" autocomplete="username" value="板收志工溜狗表" hidden readonly>
        <label class="my-note-pass-label" for="myNotePass">通關碼（第一次儲存要輸入，之後這支手機會記住）</label>
        <input type="password" id="myNotePass" name="password" autocomplete="current-password" value="${esc(edit.pass)}"${busy ? ' disabled' : ''}>` : ''}
      ${edit.phase === 'error' ? `<div class="photo-error" role="alert">${icon('alert')}<span>${esc(edit.error)}</span></div>` : ''}
      <div class="my-note-actions">
        <button type="submit" class="my-note-save" id="myNoteSave"${busy ? ' disabled' : ''}>${busy ? '儲存中…' : '儲存'}</button>
        ${busy ? '' : `<button type="button" class="photo-cancel" id="myNoteCancel">取消</button>`}
      </div>
    </form>`;
}

function startNoteEdit(dog) {
  const note = myNotes[dog.id];
  noteEdit = { dog, text: note ? note.text : '', pass: '', needPass: !loadNotesPass(), phase: 'edit', error: '' };
  renderDetail();
  const ta = document.getElementById('myNoteText');
  if (ta) {
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(ta.value.length, ta.value.length);
    if (ta.scrollIntoView) ta.scrollIntoView({ block: 'nearest' });
  }
}

// 儲存：送到 Worker；成功顯示「已存到 Git」，失敗保留輸入的內容並顯示原因
async function saveMyNote() {
  const edit = noteEdit;
  if (!edit || edit.phase === 'saving') return;
  const text = edit.text.trim();
  if ([...text].length > MY_NOTE_MAX_CHARS) {
    edit.phase = 'error'; edit.error = `我的備註最多 ${MY_NOTE_MAX_CHARS} 字`; renderDetail(); return;
  }
  const pass = edit.needPass ? edit.pass : loadNotesPass();
  if (!pass) {
    edit.needPass = true; edit.phase = 'error'; edit.error = '請輸入通關碼'; renderDetail();
    const input = document.getElementById('myNotePass');
    if (input) input.focus({ preventScroll: true });
    return;
  }
  edit.phase = 'saving';
  edit.error = '';
  renderDetail();
  let out = null, status = 0, error = '';
  try {
    const res = await fetch(`${UPLOAD_URL}/notes/${encodeURIComponent(edit.dog.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, passcode: pass }),
    });
    status = res.status;
    out = await res.json().catch(() => null);
    if (!res.ok || !out || !out.ok) error = (out && out.error) || `沒有存進去（${res.status}），原本的備註不受影響`;
  } catch (e) {
    error = '沒有存進去，請確認網路後再試；原本的備註不受影響';
  }
  if (noteEdit !== edit) return;
  const shown = detailDog === edit.dog;
  if (error) {
    // 通關碼錯（或錯太多次）：清掉這支手機記的通關碼，下次重問
    if (out && out.code === 'passcode') { saveNotesPass(''); edit.needPass = true; edit.pass = ''; }
    edit.phase = 'error';
    edit.error = error;
    if (shown) renderDetail();
    else showToast(`${edit.dog.name} 的我的備註沒有存進去：${error}`);
    return;
  }
  saveNotesPass(pass);
  if (out.note && out.note.text) myNotes[edit.dog.id] = { text: out.note.text, updatedAt: out.note.updatedAt || '' };
  else delete myNotes[edit.dog.id];
  noteEdit = null;
  if (shown) renderDetail();
  showToast(`${edit.dog.name} 的我的備註已存到 Git`);
  const btn = shown && document.getElementById('myNoteEdit');
  if (btn) btn.focus({ preventScroll: true });
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
  ['.pick', el => {
    const id = el.dataset.pick;
    if (pickedBuddies.has(id)) pickedBuddies.delete(id); else pickedBuddies.add(id);
    renderDetail();
  }],
  ['[data-hide]', el => setHidden(detailDog, el.dataset.hide || null)],
  ['#myNoteEdit', () => startNoteEdit(detailDog)],
  ['#myNoteCancel', () => {
    noteEdit = null; renderDetail();
    const b = document.getElementById('myNoteEdit');
    if (b) b.focus({ preventScroll: true });
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
  // 我的備註：打字時更新字數與暫存內容；按儲存（或在輸入框按 Enter 送出）就存
  box.addEventListener('input', e => {
    if (!noteEdit) return;
    if (e.target.id === 'myNoteText') {
      noteEdit.text = e.target.value;
      const n = [...e.target.value].length;
      const counter = box.querySelector('#myNoteCount');
      counter.textContent = `${n} / ${MY_NOTE_MAX_CHARS} 字`;
      counter.classList.toggle('over', n > MY_NOTE_MAX_CHARS);
    } else if (e.target.id === 'myNotePass') {
      noteEdit.pass = e.target.value;
    }
  });
  box.addEventListener('submit', e => {
    if (e.target.id !== 'myNoteForm') return;
    e.preventDefault();
    saveMyNote();
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
    (replacement || box.querySelector('#detailClose')).focus({ preventScroll: true });
  }
}

// 在詳細資訊裡點「可以一起溜的狗」會直接換成那隻，不多疊一層
function showDetail(dog) {
  const wasOpen = !!detailDog;
  if (!wasOpen) detailOpener = { element: document.activeElement, index: allDogs.indexOf(dog) };
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
  document.getElementById('detailClose').focus({ preventScroll: true });
}

function hideDetail() {
  if (!detailDog) return;
  detailDog = null;
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
  if (cropOpen()) hideCropper();
  else if (lightboxOpen()) hideLightbox();
  else if (detailDog) hideDetail();
  else if (analysisOpen) hideAnalysis();
});
document.getElementById('detailBackdrop').addEventListener('click', e => {
  if (e.target.id === 'detailBackdrop') closeDetail();
});
document.addEventListener('keydown', e => {
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
  const card = e.target.closest('#main .card[data-dog]');
  return card && allDogs[card.dataset.dog];
}
// 點「已遛／移回」只記錄，不開詳細資訊；點照片開燈箱（#46，沒照片就照舊開詳細資訊）；點卡片其他地方開詳細資訊
document.getElementById('main').addEventListener('click', e => {
  // 溜狗表最下面「已收起」（#79）：展開／收合、點狗名開詳細資訊、放回
  if (e.target.closest('#hiddenToggle')) { hiddenOpen = !hiddenOpen; render(); return; }
  const unhide = e.target.closest('[data-unhide]');
  if (unhide) { setHidden(allDogs[unhide.dataset.unhide], null); return; }
  const hiddenName = e.target.closest('[data-hidden-dog]');
  if (hiddenName) { showDetail(allDogs[hiddenName.dataset.hiddenDog]); return; }
  const dog = cardFromEvent(e);
  if (!dog) return;
  const btn = e.target.closest('[data-walk]');
  const thumb = e.target.closest('.thumb');
  if (btn) setWalked([dog], btn.dataset.walk === 'add');
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
  { id: 'walk', label: '溜狗表' },
  { id: 'today', label: '今天已溜' },
  { id: 'mine', label: '我溜過' }, // #58 取代原本的「相關資訊（編輯中）」
];

// counts：各分類要顯示的數字；沒有數字的分類留白
function buildTabs(counts) {
  const tabsEl = document.getElementById('tabs');
  tabsEl.innerHTML = TABS.map(t => {
    const n = counts[t.id] != null ? counts[t.id] : t.note || '';
    return `<button data-tab="${t.id}" class="${activeTab === t.id ? 'active' : ''}"><span class="t">${t.label}</span><span class="n">${n}</span></button>`;
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
  return `<div class="status-msg sr-only" role="status">讀取狗狗資料中…</div>` + card.repeat(6);
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

function renderMain() {
  const today = new Date();
  document.getElementById('dateLabel').textContent =
    `${today.getMonth() + 1}月${today.getDate()}日 (${'日一二三四五六'[today.getDay()]})`;

  const main = document.getElementById('main');

  // 分析頁（#59）：頁首右上角的圖示打開，蓋住分類清單；統計與畫面在 js/analysis.js
  if (analysisOpen) {
    main.innerHTML = analysisPageHtml(today);
    return;
  }

  // 資料還沒好時標題、搜尋框、分類照樣能用，只有內容區顯示讀取中或失敗
  if (loadState !== 'ready') {
    buildTabs({});
    main.innerHTML = loadState === 'error'
      ? `<div class="status-msg">資料載入失敗，請稍後重新整理。<br><button class="retry-btn" id="retryBtn">重新讀取</button></div>`
      : skeletonHtml();
    const retry = document.getElementById('retryBtn');
    if (retry) retry.addEventListener('click', init);
    return;
  }

  // 搜尋時只篩選目前分類的內容，分類上的數字也改成各分類符合的隻數；清空就回到原本的內容
  const q = searchQuery.trim();
  const hit = d => matchesSearch(d, q);
  // 記進今天已溜的狗就從溜狗表移出，移回後回到原本的排序位置
  const walked = walkedToday(today);
  // 收起的狗（#79）不在溜狗表，排在最下面「已收起」；已經記進今天已溜的就算在今天已溜
  const hidden = loadHidden(today);
  const notWalked = allDogs.filter(d => !walked.has(d));
  const walkList = dueDogs(notWalked.filter(d => !hidden.has(walkKey(d))), today).filter(hit);
  const hiddenList = dueDogs(notWalked.filter(d => hidden.has(walkKey(d))), today).filter(hit);
  const todayList = walked.dogs(allDogs).filter(hit);
  const mineCount = myWalksState === 'ready'
    ? myWalkGroups(myWalks, q).reduce((n, g) => n + g.walks.length, 0) : null;
  buildTabs({ walk: walkList.length, today: todayList.length, mine: mineCount });
  if (activeTab === 'mine') {
    main.innerHTML = myWalksHtml(today, q);
    return;
  }
  const inToday = activeTab === 'today';
  const list = inToday ? todayList : walkList;
  const cards = list.map((d, i) => dogCard(d, today, inToday, i < FIRST_SCREEN_CARDS)).join('');
  const hiddenBox = inToday ? '' : hiddenBoxHtml(hiddenList, hidden);

  if (q) {
    main.innerHTML = (list.length
      ? `<div class="section-hint">${icon('search')}搜尋「${esc(q)}」：${list.length} 隻</div>` + cards
      : `<div class="status-msg">${activeTab === 'today' ? '今天已溜裡' : ''}找不到「${esc(q)}」</div>`) + hiddenBox;
  } else if (activeTab === 'today') {
    main.innerHTML = cards
      ? `<div class="section-hint">${icon('tick')}你今天在這支手機記下溜過的狗（只存在這支手機，其他志工看不到）</div>` + cards
      : `<div class="status-msg">這裡會列出你今天用這支手機記下已溜的狗。<br>在溜狗表按狗卡右邊的「已遛」就會記到這裡。</div>`;
  } else {
    main.innerHTML = `<div class="section-hint">${icon('pin')}依久沒遛排序（由久到近）</div>` +
      (cards || `<div class="status-msg">${hiddenList.length ? '全部都收起了' : '目前沒有狗狗資料'}</div>`) + hiddenBox;
  }
}

// 我溜過：點照片開詳細資訊、讀取失敗時重新讀取（內容區每次重畫，所以用事件委派）
mainEl.addEventListener('click', e => {
  const tile = e.target.closest('[data-mine-dog]');
  if (tile) showDetail(allDogs[tile.dataset.mineDog]);
  else if (e.target.closest('#mineRetry')) loadMyWalks();
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

// 先畫出分類列與內容區的讀取中（標題、搜尋框本來就在 index.html），再背景讀 dogs.json
async function init() {
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
  allDogs = data.dogs;
  groupMap = data.groups || {};
  if (!data.groups) loadWarning = '「可以一起溜」的資料讀取失敗，詳細資訊暫時不會顯示可以一起溜的狗。';
  // 顯示試算表最後同步的時間（不是打開網頁的時間），志工才知道資料有多新
  const t = data.syncedAt;
  document.getElementById('updatedLabel').textContent = t
    ? `資料更新 ${t.getMonth() + 1}/${t.getDate()} ${pad2(t.getHours())}:${pad2(t.getMinutes())}` : '';
  loadState = 'ready';
  render();
  loadMyNotes();
  loadGallery();
  loadMyWalks();
}

// tests/index.html 會設定 __BQ_TEST__，只載入函式、不去讀 dogs.json
if (!window.__BQ_TEST__) init();
