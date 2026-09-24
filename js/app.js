// 狗狗資料：試算表由 GitHub Action 每天同步成這個檔（#31），前端只讀它、不直接連試算表（#32）
const DATA_URL = 'data/dogs.json';
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
let detailMap = {};
let activeTab = 'walk';
let detailDog = null; // 詳細資訊正在看的狗
let detailOpener = null;
let pickedBuddies = new Set(); // 詳細資訊「可以一起溜」勾選的狗（編號）
let searchQuery = '';
let loadWarning = '';
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
    walker: text(d.walker),
    note: text(d.note),
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

// 去掉開頭的 YAML frontmatter（--- 到 ---），沒有就原樣回傳
function parseFrontmatterBody(text) {
  const m = text.replace(/^\uFEFF/, '').match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/);
  return (m ? m[1] : text).trim();
}

// 把 Markdown 轉成純文字，卡片上不要露出 **、#、[]() 這些符號
function markdownToText(md) {
  return md
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/%%[\s\S]*?%%/g, '')                            // Obsidian 註解
    .split(/\r?\n/)
    .map(line => line
      .replace(/^\s*(```|~~~).*$/, '')                        // 程式碼區塊的框線
      .replace(/^\s*([-*_])(\s*\1){2,}\s*$/, '')              // 分隔線
      .replace(/^\s{0,3}#{1,6}\s+/, '')                       // 標題
      .replace(/^\s*(>\s*)+/, '')                             // 引用
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, '')                // 待辦清單
      .replace(/^\s*([-*+]|\d+[.)])\s+/, '')                  // 清單符號
      .replace(/^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-*:?\s*$/, '')    // 表格分隔列
      .replace(/!\[\[[^\]]*\]\]/g, '')                        // Obsidian 嵌入圖片
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '')                  // 圖片
      .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')           // [[頁面|顯示文字]]
      .replace(/\[\[([^\]]*)\]\]/g, '$1')                      // [[頁面]]
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')                 // [文字](網址)
      .replace(/<[^>]+>/g, '')                                // HTML 標籤
      .replace(/(\*\*|__)(.+?)\1/g, '$2')                      // 粗體
      .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1$2')     // 斜體 *
      .replace(/(^|[^_\w])_(?!\s)(.+?)_(?![\w])/g, '$1$2')      // 斜體 _
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/==(.+?)==/g, '$1')
      .replace(/`+([^`]*)`+/g, '$1')
      .replace(/^\s*\||\|\s*$/g, '')                          // 表格左右框線
      .replace(/\s*\|\s*/g, ' ')
      .trim())
    .filter(Boolean)
    .join(' ');
}

async function fetchAllDetails(dogs) {
  const map = {};
  // 同一個編號只抓一次；沒有編號的狗不抓，也不改用犬名配對
  const ids = [...new Set(dogs.map(d => d.id).filter(Boolean))];
  await Promise.allSettled(ids.map(async id => {
    try {
      const res = await fetch(`dogs/${encodeURIComponent(id)}.md`);
      if (!res.ok) return;
      const text = markdownToText(parseFrontmatterBody(await res.text()));
      if (text) map[id] = text;
    } catch (e) { /* 沒有這隻狗的介紹檔，略過即可 */ }
  }));
  return map;
}

function computeStatus(dog, today) {
  if (dog.walkedDate) {
    const days = Math.floor((today - dog.walkedDate) / 86400000);
    let level = 'sage';
    if (days >= RED_DAYS) level = 'red';
    else if (days >= AMBER_DAYS) level = 'amber';
    return { kind: 'dated', days, level };
  }
  if (dog.walker) return { kind: 'covered' };
  return { kind: 'unknown' };
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function icon(id) {
  return `<svg class="icon"><use href="#i-${id}"/></svg>`;
}

function photoThumb(dog, size = 56) {
  // 沒有編號就直接顯示腳掌圖示，不去抓 photos/.jpg
  if (!dog.id) {
    return `<div class="thumb"><div class="thumb-fallback" style="display:flex">${icon('paw')}</div></div>`;
  }
  return `
    <div class="thumb">
      <img src="photos/${encodeURIComponent(dog.id)}.jpg" alt="" width="${size}" height="${size}" loading="lazy" decoding="async"
           onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
      <div class="thumb-fallback">${icon('paw')}</div>
    </div>
  `;
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
  } else if (s.kind === 'covered') { text = '有人固定照顧'; level = 'sage'; small = true; }
  return `<div class="last"><span class="lbl">上次遛狗</span><span class="val ${level}${small ? ' small' : ''}">${text}</span></div>`;
}

// 卡片用「編號｜籠位」（照 K 的參考圖）；詳細資訊沿用 metaLine
function cardMeta(dog) {
  return `<div class="meta">${dog.id ? `${esc(dog.id)}<span class="sep">|</span>` : ''}${esc(dog.cage)}</div>`;
}

function metaLine(dog) {
  return `<div class="meta">${esc(dog.cage)}${dog.id ? `<span class="sep">|</span>${esc(dog.id)}` : ''}</div>`;
}

// 性別：主清單目前沒有這欄，先留位置；之後有資料就顯示 ♂／♀ 符號
function sexMark(dog) {
  return `<span class="sex">${esc(dog.sex || '')}</span>`;
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

function isWalkedToday(dog, ids) {
  return !!dog.id && ids.includes(dog.id);
}

// 加入（on=true）或移回（on=false）今天已溜；沒有編號的狗記不了，直接略過。
// 新加入的排在今天已溜最上面。記完底部跳提示條，可以按「復原」回到記之前的樣子
function setWalked(dogs, on) {
  const today = new Date();
  const before = loadWalkedIds(today);
  const ids = [...before];
  const changed = [];
  for (const dog of dogs) {
    if (!dog || !dog.id || ids.includes(dog.id) === on || changed.includes(dog)) continue;
    if (on) ids.unshift(dog.id);
    else ids.splice(ids.indexOf(dog.id), 1);
    changed.push(dog);
  }
  if (!changed.length) return;
  saveWalkedIds(ids, today);
  pickedBuddies.clear();
  render();
  renderDetail();
  const names = changed.map(d => d.name).join('、');
  showToast(on ? `已記下今天溜了：${names}` : `${names} 移回溜狗表`, () => {
    saveWalkedIds(before, today);
    render();
    renderDetail();
  });
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

// 狗卡右側的「溜了」（溜狗表）／「移回」（今天已溜）按鈕；沒有編號的狗記不了，照舊顯示箭頭
function walkButton(dog, walkedTab) {
  if (!dog.id) return `<span class="more">${icon('chevron')}</span>`;
  return walkedTab
    ? `<button type="button" class="walk-btn back" data-walk="back" aria-label="把 ${esc(dog.name)} 移回溜狗表">移回</button>`
    : `<button type="button" class="walk-btn" data-walk="add" aria-label="記下今天溜了 ${esc(dog.name)}">${icon('tick')}溜了</button>`;
}

// 所有分頁、搜尋、籠位共用這張卡片。第一層只放照片、犬名、天數、籠位｜編號，
// 備註命中警示關鍵字才把原文放上來；一般備註、可一起遛、狗卡資訊點卡片看詳細資訊
function dogCard(dog, today, walkedTab = false) {
  const flag = specialFlag(dog.note);
  return `
    <div class="card${flag ? ' flagged' : ''}" data-dog="${allDogs.indexOf(dog)}" role="button" tabindex="0" aria-haspopup="dialog">
      ${photoThumb(dog)}
      <div class="body">
        <div class="row">
          <div class="who">
            <div class="name">${esc(dog.name)}${sexMark(dog)}${dog.note && !flag ? `<svg class="icon has-note" role="img" aria-label="有備註"><use href="#i-memo"/></svg>` : ''}</div>
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

// 詳細資訊：備註（志工後續補充，試算表備註欄）／可以一起溜的狗／狗卡資訊（dogs/{編號}.md 的入所原始介紹）
function detailHtml(dog, today) {
  const flag = specialFlag(dog.note);
  const buddies = [...(groupMap[dog.name] || [])];
  const byName = new Map(allDogs.map(d => [d.name, d]));
  const intro = dog.id && detailMap[dog.id];
  const walkedIds = loadWalkedIds(today);
  return `
    <div class="detail-head">
      ${photoThumb(dog, 84)}
      <div class="info">
        ${statusBadge(dog, today)}
        <div class="name" id="detailName">${esc(dog.name)}${sexMark(dog)}</div>
        ${metaLine(dog)}
      </div>
      <button class="detail-close" id="detailClose" aria-label="關閉">${icon('close')}</button>
    </div>
    <section class="detail-section" data-section="note">
      <h3>${icon('note')}備註<span class="sub">志工補充的個性、互動與觀察</span></h3>
      ${!dog.note ? `<div class="empty">目前沒有備註</div>`
        : flag ? warnNote(dog.note, flag)
        : `<div class="content note-text">${esc(dog.note)}</div>`}
    </section>
    <section class="detail-section" data-section="group">
      <h3>${icon('group')}可以一起溜的狗</h3>
      ${buddies.length
        ? `<div class="buddies">${buddies.map(n => {
            const d = byName.get(n) || { name: n, id: '' };
            return buddyTile(d, n, walkedIds);
          }).join('')}</div>`
        : `<div class="empty">沒有登記可以一起溜的狗</div>`}
      ${groupWalkButton(dog, walkedIds)}
    </section>
    <section class="detail-section" data-section="intro">
      <h3>${icon('card')}狗卡資訊<span class="sub">入所時的原始狗卡</span></h3>
      ${intro ? `<div class="content">${esc(intro)}</div>` : `<div class="empty">還沒有狗卡資訊</div>`}
    </section>
  `;
}

// 可以一起溜的每一隻：輕點照片換看那隻；右上角圓圈勾選，之後用下方按鈕一起記（#35，K 選 C）。
// 今天已溜的不顯示圓圈，改標「今天已溜」；沒有編號的記不了，也不顯示圓圈
function buddyTile(d, name, walkedIds) {
  const walked = isWalkedToday(d, walkedIds);
  const canPick = d.id && !walked && allDogs.includes(d);
  const picked = canPick && pickedBuddies.has(d.id);
  return `<div class="buddy-tile">
    <button class="buddy" data-dog="${allDogs.indexOf(d)}">${photoThumb(d, 64)}<span class="bname">${esc(name)}</span></button>
    ${walked ? `<span class="walked-tag">今天已溜</span>` : ''}
    ${canPick ? `<button type="button" class="pick${picked ? ' on' : ''}" data-pick="${esc(d.id)}" aria-pressed="${picked}" aria-label="勾選 ${esc(name)} 一起記">${icon('tick')}</button>` : ''}
  </div>`;
}

// 「可以一起溜」下方的按鈕：把目前這隻連同勾選的狗一次記進今天已溜。
// 目前這隻已溜（或沒有編號）又沒勾選時，就顯示目前這隻今天已溜，不放按鈕
function groupWalkButton(dog, walkedIds) {
  const self = !!dog.id && !isWalkedToday(dog, walkedIds);
  const n = [...pickedBuddies].length;
  if (!self && !n) {
    return isWalkedToday(dog, walkedIds) ? `<div class="self-walked">${icon('tick')}${esc(dog.name)} 今天已溜（這支手機的紀錄）</div>` : '';
  }
  const label = !n ? `${esc(dog.name)} 溜了`
    : self ? `${esc(dog.name)} 和勾選的 ${n} 隻都溜了`
    : `勾選的 ${n} 隻都溜了`;
  return `<button type="button" class="group-walk" id="groupWalk">${icon('tick')}${label}</button>`;
}

function renderDetail() {
  if (!detailDog) return;
  const box = document.getElementById('detail');
  const focused = box.contains(document.activeElement) ? document.activeElement : null;
  box.innerHTML = detailHtml(detailDog, new Date());
  box.querySelector('#detailClose').addEventListener('click', closeDetail);
  box.querySelectorAll('.buddy').forEach(btn => {
    const d = allDogs[btn.dataset.dog];
    if (d) btn.addEventListener('click', () => showDetail(d));
    else btn.disabled = true;
  });
  box.querySelectorAll('.pick').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.pick;
      if (pickedBuddies.has(id)) pickedBuddies.delete(id); else pickedBuddies.add(id);
      renderDetail();
    });
  });
  const group = box.querySelector('#groupWalk');
  if (group) group.addEventListener('click', () => {
    const picked = [...pickedBuddies].map(id => allDogs.find(d => d.id === id));
    setWalked([detailDog, ...picked], true);
  });
  if (focused) {
    const replacement = [...box.querySelectorAll('button')].find(btn =>
      (focused.id && btn.id === focused.id) ||
      (focused.dataset.pick && btn.dataset.pick === focused.dataset.pick) ||
      (focused.classList.contains('buddy') && btn.classList.contains('buddy') && btn.dataset.dog === focused.dataset.dog));
    (replacement || box.querySelector('#detailClose')).focus({ preventScroll: true });
  }
}

// 在詳細資訊裡點「可以一起溜的狗」會直接換成那隻，不多疊一層
function showDetail(dog) {
  const wasOpen = !!detailDog;
  if (!wasOpen) detailOpener = { element: document.activeElement, index: allDogs.indexOf(dog) };
  if (dog !== detailDog) pickedBuddies.clear();
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

window.addEventListener('popstate', hideDetail);
document.getElementById('detailBackdrop').addEventListener('click', e => {
  if (e.target.id === 'detailBackdrop') closeDetail();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && detailDog) closeDetail();
  if (e.key !== 'Tab' || !detailDog) return;
  const buttons = [...document.querySelectorAll('#detail button:not(:disabled), #toast:not([hidden]) button:not([hidden])')];
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
// 點「溜了／移回」只記錄，不開詳細資訊；點卡片其他地方才開
document.getElementById('main').addEventListener('click', e => {
  const dog = cardFromEvent(e);
  if (!dog) return;
  const btn = e.target.closest('[data-walk]');
  if (btn) setWalked([dog], btn.dataset.walk === 'add');
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
  { id: 'info', label: '相關資訊', note: '編輯中' },
];

// counts：各分類要顯示的隻數；沒有數字的分類（相關資訊）顯示 note
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
  if (!swipeStart) return;
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

// 溜狗表（沿用原待巡房）：所有狗依幾天沒遛由久到近；沒有遛狗紀錄的排最前，有人固定照顧的排最後
function dueDogs(dogs, today) {
  const key = s => s.kind === 'unknown' ? Infinity : s.kind === 'dated' ? s.days : -Infinity;
  return dogs
    .map(d => ({ d, k: key(computeStatus(d, today)) }))
    .sort((a, b) => (b.k === a.k ? 0 : b.k > a.k ? 1 : -1))
    .map(x => x.d);
}

// 今天已溜：這支手機今天自己記下溜過的狗，最近記的排最上面
function walkedTodayDogs(dogs, today) {
  const ids = loadWalkedIds(today);
  return dogs
    .filter(d => isWalkedToday(d, ids))
    .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
}

function renderMain() {
  const today = new Date();
  document.getElementById('dateLabel').textContent =
    `${today.getMonth() + 1}月${today.getDate()}日 (${'日一二三四五六'[today.getDay()]})`;

  const main = document.getElementById('main');

  if (activeTab === 'info') {
    buildTabs({});
    main.innerHTML = `<div class="status-msg">相關資訊編輯中，之後會放在這裡。</div>`;
    return;
  }

  // 資料還沒好時標題、搜尋框、分類照樣能用，只有內容區顯示讀取中或失敗
  if (loadState !== 'ready') {
    buildTabs({});
    main.innerHTML = loadState === 'error'
      ? `<div class="status-msg">資料載入失敗，請稍後重新整理。<br><button class="retry-btn" id="retryBtn">重新讀取</button></div>`
      : `<div class="status-msg">讀取狗狗資料中…</div>`;
    const retry = document.getElementById('retryBtn');
    if (retry) retry.addEventListener('click', init);
    return;
  }

  // 搜尋時只篩選目前分類的內容，分類上的數字也改成各分類符合的隻數；清空就回到原本的內容
  const q = searchQuery.trim();
  const hit = d => matchesSearch(d, q);
  // 記進今天已溜的狗就從溜狗表移出，移回後回到原本的排序位置
  const walkedIds = loadWalkedIds(today);
  const walkList = dueDogs(allDogs.filter(d => !isWalkedToday(d, walkedIds)), today).filter(hit);
  const todayList = walkedTodayDogs(allDogs, today).filter(hit);
  buildTabs({ walk: walkList.length, today: todayList.length });
  const inToday = activeTab === 'today';
  const list = inToday ? todayList : walkList;
  const cards = list.map(d => dogCard(d, today, inToday)).join('');

  if (q) {
    main.innerHTML = list.length
      ? `<div class="section-hint">${icon('search')}搜尋「${esc(q)}」：${list.length} 隻</div>` + cards
      : `<div class="status-msg">${activeTab === 'today' ? '今天已溜裡' : ''}找不到「${esc(q)}」</div>`;
  } else if (activeTab === 'today') {
    main.innerHTML = cards
      ? `<div class="section-hint">${icon('tick')}你今天在這支手機記下溜過的狗（只存在這支手機，其他志工看不到）</div>` + cards
      : `<div class="status-msg">這裡會列出你今天用這支手機記下已溜的狗。<br>在溜狗表按狗卡右邊的「溜了」就會記到這裡。</div>`;
  } else {
    main.innerHTML = `<div class="section-hint">${icon('pin')}依久沒遛排序（由久到近）</div>` +
      (cards || `<div class="status-msg">目前沒有狗狗資料</div>`);
  }
}

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
  fetchAllDetails(allDogs).then(map => { detailMap = map; render(); renderDetail(); });
}

// tests/index.html 會設定 __BQ_TEST__，只載入函式、不去讀 dogs.json
if (!window.__BQ_TEST__) init();
