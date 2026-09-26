// 找狗（#99）：照片圖鑑＋全域搜尋＋平面圖分區。K 2026-09-26 看過原型後同意。
// 溜狗表是決定「接下來遛誰」；找狗是現場「眼前這隻是誰、在哪」，所以不顯示未遛天數、沒有「已遛」按鈕。
// 會用到 js/app.js 的 allDogs、groupMap、searchQuery、searchKey、esc、icon、sexMark、specialFlag、photoThumb、
// showDetail、closeDetail、switchTab、render、activeTab，所以要在 app.js 之後載入。

// 籠位 → 平面圖分區（K 2026-09-26 確認：新A／新B／新獨＝新犬舍區，舊A／舊B＝舊犬舍區，母幼＝幼母犬舍區，
// C區＝幼犬舍區，住院區＝隔離區）。對不到的籠位歸「其他籠位」（沒有 rect），放在圖下方的提示框。
// rect 是平面圖上的位置 [x, y, 寬, 高]，照所內看板重畫（viewBox 380×600）；順序＝照片分段的順序（圖上由上到下）
const FIND_ZONES = [
  { key: 'new', name: '新犬舍區', short: '新犬舍', test: c => /^新/.test(c), rect: [230, 0, 150, 240] },
  { key: 'iso', name: '隔離區', short: '隔離', test: c => /^住院/.test(c), rect: [140, 40, 90, 200] },
  { key: 'mom', name: '幼母犬舍區', short: '幼母犬舍', test: c => /^母幼/.test(c), rect: [0, 270, 250, 80] },
  { key: 'pup', name: '幼犬舍區', short: '幼犬舍', test: c => /^C/.test(c), rect: [250, 270, 130, 80] },
  { key: 'old', name: '舊犬舍區', short: '舊犬舍', test: c => /^舊/.test(c), rect: [0, 350, 250, 250] },
];
const FIND_FACILITIES = [
  { name: '醫療室', rect: [250, 350, 130, 60] },
  { name: '辦公室', rect: [250, 410, 130, 190] },
];

// K 2026-09-26：平面圖轉 90 度變橫的（手機上比較不佔高度）。rect 照看板直的座標寫，畫的時候再轉；
// 'cw' 順時針、'ccw' 逆時針、'' 不轉
const FIND_MAP_TURN = 'cw';
const FIND_MAP_W = 380, FIND_MAP_H = 600; // 看板直的時候的寬高
let findTurnNow = FIND_MAP_TURN; // 這次畫圖用的方向：全螢幕放大（#102）改畫直的，比較貼合手機直立的螢幕
function findTurn([x, y, w, h]) {
  if (findTurnNow === 'ccw') return [y, FIND_MAP_W - x - w, h, w];
  if (findTurnNow === 'cw') return [FIND_MAP_H - y - h, x, h, w];
  return [x, y, w, h];
}
// 區名：放得下就橫排、放不下就直排（一個字一行）；sub 是隻數，底下畫一條短線（K 2026-09-26 給的看板樣式）
function findLabel(cls, name, sub, [x, y, w, h], small) {
  const cx = x + w / 2, cy = y + h / 2;
  const chars = [...name];
  const fs = small ? 14 : w > 180 ? 18 : 16;
  const gap = fs * 0.3;
  const count = ty => `<text class="fm-n" x="${cx}" y="${ty}" text-anchor="middle">${sub}<tspan class="fm-unit" dx="3">隻</tspan></text>`
    + `<line class="fm-u" x1="${cx - 22}" x2="${cx + 22}" y1="${ty + 7}" y2="${ty + 7}"/>`;
  if (chars.length * (fs + gap) < w - 18) {
    return `<text class="${cls}" x="${cx}" y="${sub !== '' ? cy - 4 : cy + fs * 0.35}" text-anchor="middle" font-size="${fs}" letter-spacing="${gap}">${name}</text>`
      + (sub !== '' ? count(cy + 22) : '');
  }
  const lh = fs + 4;
  const top = cy - (chars.length * lh + (sub !== '' ? 30 : 0)) / 2 + fs;
  return chars.map((ch, i) => `<text class="${cls}" x="${cx}" y="${top + i * lh}" text-anchor="middle" font-size="${fs}">${ch}</text>`).join('')
    + (sub !== '' ? count(top + chars.length * lh + 14) : '');
}

let findView = 'photo'; // photo：照片圖鑑；map：平面圖
let findZone = 'all';   // 篩選的區域 key；all＝全部

function findZoneOf(dog) {
  const cage = searchKey(dog.cage).toUpperCase();
  const z = FIND_ZONES.find(x => x.test(cage));
  return z ? z.key : 'other';
}
function findZoneInfo(key) {
  return FIND_ZONES.find(z => z.key === key) || { key: 'other', name: '其他籠位', short: '其他' };
}

// 找狗的搜尋：犬名、編號（完整或部分，含再次入所的舊編號）、籠位都算；範圍是全部的狗，不管今天已溜或收起
function findMatches(dog, query) {
  const q = searchKey(query);
  if (!q) return true;
  return [dog.name, dog.id, dog.cage, ...(dog.formerIds || [])].some(v => searchKey(v).includes(q));
}

// 依區域（FIND_ZONES 的順序）→ 籠位 → 犬名排；籠位數字照數字大小（新A2 在 新A10 前面）
function findSorted(dogs) {
  const order = key => { const i = FIND_ZONES.findIndex(z => z.key === key); return i < 0 ? 99 : i; };
  const natural = (a, b) => a.localeCompare(b, 'en', { numeric: true }); // 英文字母排在中文前：新A、新B、新獨
  return dogs
    .map(d => ({ d, z: findZoneOf(d) }))
    .sort((a, b) => order(a.z) - order(b.z) || natural(a.d.cage, b.d.cage) || natural(a.d.name, b.d.name))
    .map(x => x.d);
}

function findList(query, zone = findZone) {
  return findSorted(allDogs.filter(d => findMatches(d, query) && (zone === 'all' || findZoneOf(d) === zone)));
}

// 搜尋命中的字標黃；比對時忽略空白、全形半形，對不回原文位置時就不標
function findMark(text, query) {
  const q = searchKey(query);
  const s = String(text || '');
  if (!q) return esc(s);
  const i = s.toLowerCase().indexOf(q);
  if (i < 0) return esc(s);
  return `${esc(s.slice(0, i))}<mark>${esc(s.slice(i, i + q.length))}</mark>${esc(s.slice(i + q.length))}`;
}

function findCard(dog, query, eager) {
  const flag = specialFlag(dog.note);
  return `<button type="button" class="find-dog" data-dog="${allDogs.indexOf(dog)}" aria-haspopup="dialog">
    <span class="find-photo">${photoThumb(dog, 160, false, eager)}${flag ? `<span class="find-warn">${icon('warn')}注意</span>` : ''}</span>
    <span class="find-name"><span class="n">${findMark(dog.name, query)}</span>${sexMark(dog)}</span>
    <span class="find-meta"><b>${findMark(dog.cage, query)}</b>${dog.id ? `<span>${findMark(dog.id, query)}</span>` : ''}</span>
  </button>`;
}

function findChipsHtml(query) {
  const inQuery = allDogs.filter(d => findMatches(d, query));
  const count = key => inQuery.filter(d => findZoneOf(d) === key).length;
  const zones = FIND_ZONES.filter(z => allDogs.some(d => findZoneOf(d) === z.key));
  if (allDogs.some(d => findZoneOf(d) === 'other')) zones.push(findZoneInfo('other'));
  const chip = (key, label, n) =>
    `<button type="button" class="find-chip${findZone === key ? ' on' : ''}" data-find-zone="${key}" aria-pressed="${findZone === key}">${label}<small>${n}</small></button>`;
  return `<div class="find-bar">
    <div class="find-view" role="group" aria-label="顯示方式">
      <button type="button" data-find-view="photo" class="${findView === 'photo' ? 'on' : ''}" aria-pressed="${findView === 'photo'}">${icon('grid')}照片</button>
      <button type="button" data-find-view="map" class="${findView === 'map' ? 'on' : ''}" aria-pressed="${findView === 'map'}">${icon('map')}平面圖</button>
    </div>
    <div class="find-chips">${chip('all', '全部', inQuery.length)}${zones.map(z => chip(z.key, z.short, count(z.key))).join('')}</div>
  </div>`;
}

// 照片分段：每個區域一段，段落標題寫區名與隻數
function findGridHtml(list, query) {
  const groups = [];
  for (const d of list) {
    const z = findZoneOf(d);
    const last = groups[groups.length - 1];
    if (last && last.z === z) last.items.push(d); else groups.push({ z, items: [d] });
  }
  let n = 0;
  return groups.map(g => `
    <div class="find-zone-head"><i class="find-dot z-${g.z}"></i><h2>${esc(findZoneInfo(g.z).name)}</h2><span>${g.items.length} 隻</span></div>
    <div class="find-grid">${g.items.map(d => findCard(d, query, n++ < 6)).join('')}</div>`).join('');
}

// 平面圖：墨藍底、米白線的看板樣式（K 2026-09-26 給參考圖，選 A 墨藍看板、橫的）。
// 建築外框是 L 形（左上角空出來，放「園區平面圖」標題），畫兩條線；每區往內縮一點，區與區之間留縫。
// mini＝詳細資訊裡的小地圖：不寫字、不能點，所在的區塗成米白
const FIND_MAP_GAP = 6;
const FIND_MAP_PAD = 22;
const FIND_OUTLINE = [[140, 0], [380, 0], [380, 600], [0, 600], [0, 270], [140, 270]]; // 看板直的時候的建築外框
function findMapSvg(selected, query = '', mini = false, turn = FIND_MAP_TURN) {
  findTurnNow = turn;
  try { return findMapSvgNow(selected, query, mini); } finally { findTurnNow = FIND_MAP_TURN; }
}
function findMapSvgNow(selected, query, mini) {
  const count = key => allDogs.filter(d => findZoneOf(d) === key && findMatches(d, query)).length;
  const [, , vw, vh] = findTurn([0, 0, FIND_MAP_W, FIND_MAP_H]);
  const P = FIND_MAP_PAD, G = FIND_MAP_GAP;
  const box = ([x, y, w, h]) => `<rect x="${x + G}" y="${y + G}" width="${w - G * 2}" height="${h - G * 2}"/>`;
  // 外框往外推 off：x＝0／380、y＝0／600 的點往外，轉角（140、270）往內角推，轉向後再換座標
  const outline = (off, cls) => {
    const pts = FIND_OUTLINE.map(([x, y]) => {
      const nx = x === 0 ? -off : x === FIND_MAP_W ? x + off : x - off;
      const ny = y === 0 ? -off : y === FIND_MAP_H ? y + off : y - off;
      const [tx, ty] = findTurn([nx, ny, 0, 0]);
      return `${tx},${ty}`;
    });
    return `<polygon class="${cls}" points="${pts.join(' ')}"/>`;
  };
  let s = `<svg class="find-map${mini ? ' mini' : ''}" viewBox="${-P} ${-P} ${vw + P * 2} ${vh + P * 2}" ${mini ? 'aria-hidden="true"' : 'role="group" aria-label="收容所平面圖"'}>`;
  s += `<rect class="fm-bg" x="${-P}" y="${-P}" width="${vw + P * 2}" height="${vh + P * 2}" rx="${mini ? 30 : 16}"/>`;
  s += outline(8, 'fm-frame2') + outline(2, 'fm-frame');
  if (!mini) s += findMapTitle();
  for (const f of FIND_FACILITIES) {
    const r = findTurn(f.rect);
    s += `<g class="fm-fac">${box(r)}${mini ? '' : findLabel('fm-fac-t', f.name, '', r, true)}</g>`;
  }
  for (const z of FIND_ZONES.filter(x => x.rect)) {
    const r = findTurn(z.rect);
    const n = count(z.key);
    const cls = `fm-zone${selected && selected !== z.key ? ' dim' : ''}${selected === z.key ? ' sel' : ''}`;
    s += mini ? `<g class="${cls}">` : `<g class="${cls}" data-find-zone="${z.key}" role="button" tabindex="0" aria-pressed="${selected === z.key}" aria-label="${z.name} ${n} 隻">`;
    s += box(r);
    if (!mini) s += findLabel('fm-t', z.name, n, r);
    s += `</g>`;
  }
  return s + '</svg>';
}

// 「園區平面圖」標題：放在建築外框空出來的角落；直的時候直排、橫的時候橫排
function findMapTitle() {
  const [x, y, w, h] = findTurn([0, 0, 140, 270]);
  let s = '';
  if (w < h) {
    const cx = x + 44;
    [...'園區平面圖'].forEach((ch, i) => { s += `<text class="fm-title" x="${cx}" y="${y + 40 + i * 34}" text-anchor="middle">${ch}</text>`; });
    s += `<line class="fm-title-line" x1="${cx + 30}" x2="${cx + 30}" y1="${y + 14}" y2="${y + 190}"/>`;
    ['SHELTER', 'FLOOR', 'PLAN'].forEach((word, i) => { s += `<text class="fm-sub" x="${cx - 16}" y="${y + 214 + i * 13}">${word}</text>`; });
  } else {
    const right = x + w - 12;
    s += `<text class="fm-title" x="${right}" y="${y + 44}" text-anchor="end" letter-spacing="6">園區平面圖</text>`;
    s += `<line class="fm-title-line" x1="${right - 170}" x2="${right}" y1="${y + 58}" y2="${y + 58}"/>`;
    s += `<text class="fm-sub" x="${right}" y="${y + 78}" text-anchor="end">SHELTER FLOOR PLAN</text>`;
  }
  return s;
}

function findMapHtml(query) {
  const unmapped = allDogs.some(d => findZoneOf(d) === 'other') ? [findZoneInfo('other')] : [];
  const selected = findZone === 'all' ? null : findZone;
  let html = `<div class="find-map-card">
    ${findMapSvg(selected, query)}
    <div class="find-map-foot">
      <p class="find-map-hint">點一個區域，下面列出那區的狗。圖是照所內看板重畫的相對位置。</p>
      <button type="button" class="find-zoom-btn" id="findZoomOpen" aria-label="全螢幕放大平面圖">${icon('zoom')}放大</button>
    </div>
    ${unmapped.length ? `<div class="find-unmapped">這些籠位還不知道在圖上哪裡：${unmapped.map(z =>
      `<button type="button" data-find-zone="${z.key}" aria-pressed="${findZone === z.key}">${esc(z.name)} ${allDogs.filter(d => findZoneOf(d) === z.key && findMatches(d, query)).length} 隻</button>`).join('')}</div>` : ''}
  </div>`;
  if (selected) {
    const list = findList(query);
    const z = findZoneInfo(selected);
    html += `<div class="find-zone-head"><i class="find-dot z-${z.key}"></i><h2>${esc(z.name)}</h2><span>${list.length} 隻</span></div>`;
    html += list.length ? `<div class="find-grid">${list.map((d, i) => findCard(d, query, i < 6)).join('')}</div>`
      : `<div class="status-msg">${query ? `這區找不到「${esc(query)}」` : '這區目前沒有對應的籠位'}</div>`;
  }
  return html;
}

function findPageHtml(query) {
  const bar = findChipsHtml(query);
  if (findView === 'map') return bar + findMapHtml(query);
  const list = findList(query);
  if (!list.length) {
    return bar + `<div class="status-msg">${query
      ? `找不到「${esc(query)}」<br>試試犬名的一個字、編號後四碼，或籠位（例：新A03）。`
      : '這區目前沒有狗'}</div>`;
  }
  const hint = query ? `<div class="section-hint">${icon('search')}搜尋「${esc(query)}」：${list.length} 隻（找全部的狗，包含今天已溜和收起的）</div>` : '';
  return bar + hint + findGridHtml(list, query);
}

// 詳細資訊的「在哪裡」：小地圖標出所在的區，按鈕跳到找狗的平面圖、選好那一區
function findLocationSection(dog) {
  const z = findZoneInfo(findZoneOf(dog));
  if (!z.rect) return '';
  return `<section class="detail-section" data-section="where">
    <h3>${icon('pin')}在哪裡</h3>
    <div class="find-where">
      <button type="button" class="find-where-map" id="findMiniZoom" aria-label="放大平面圖，看${esc(z.name)}在哪裡">${findMapSvg(z.key, '', true)}</button>
      <div><b>${esc(z.name)}</b>・${esc(dog.cage)}
        <button type="button" class="find-where-btn" id="findWhere">${icon('map')}看同區的狗</button>
      </div>
    </div>
  </section>`;
}

// 從詳細資訊跳到平面圖：關掉詳細資訊、切到找狗、選那一區、清掉搜尋
function findShowZone(dog) {
  const key = findZoneOf(dog);
  closeDetail();
  findView = 'map';
  findZone = key;
  const input = document.getElementById('searchInput');
  if (input) { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
  switchTab('find');
  window.scrollTo(0, 0);
}

// 找狗頁的點擊（內容區每次重畫，所以用事件委派）
document.getElementById('main').addEventListener('click', e => {
  if (activeTab !== 'find') return;
  if (e.target.closest('#findZoomOpen')) { findZoomShow(findZone === 'all' ? null : findZone); return; }
  const view = e.target.closest('[data-find-view]');
  if (view) { findView = view.dataset.findView; render(); return; }
  const zone = e.target.closest('[data-find-zone]');
  if (zone) {
    const key = zone.dataset.findZone;
    findZone = key !== 'all' && findZone === key ? 'all' : key; // 再點一次取消
    render();
    return;
  }
  const card = e.target.closest('.find-dog[data-dog]');
  if (card && allDogs[card.dataset.dog]) showDetail(allDogs[card.dataset.dog]);
});
document.getElementById('main').addEventListener('keydown', e => {
  if (activeTab !== 'find' || (e.key !== 'Enter' && e.key !== ' ')) return;
  const zone = e.target.closest('g[data-find-zone]');
  if (!zone) return;
  e.preventDefault();
  findZone = findZone === zone.dataset.findZone ? 'all' : zone.dataset.findZone;
  render();
  const again = document.querySelector(`#main g[data-find-zone="${zone.dataset.findZone}"]`);
  if (again) again.focus({ preventScroll: true });
});

// ── 平面圖全螢幕放大（#102，K 2026-09-27「平面圖應該要可以放大」）──
// 找狗平面圖的「放大」、詳細資訊的小地圖都能開。全螢幕改畫直的（貼合手機直立螢幕），
// 右上角 －／＋ 調大小（100%～300%），放大後上下左右捲動；點區域就關掉、到找狗平面圖選那一區。
// 手機「返回」、Esc、右上角 X 都能關（app.js 的 popstate 先處理這層）。
const FIND_ZOOM_STEPS = [1, 1.5, 2, 3];
let findZoomState = null; // { selected, step, opener }

function findZoomOpen() {
  return !!findZoomState;
}

function findZoomRender() {
  const box = document.getElementById('findZoom');
  if (!box || !findZoomState) return;
  const { selected, step } = findZoomState;
  const scale = FIND_ZOOM_STEPS[step];
  box.querySelector('.find-zoom-scroll').innerHTML =
    `<div class="find-zoom-map" style="width:${scale * 100}%">${findMapSvg(selected, '', false, '')}</div>`;
  box.querySelector('[data-zoom-step="-1"]').disabled = step === 0;
  box.querySelector('[data-zoom-step="1"]').disabled = step === FIND_ZOOM_STEPS.length - 1;
  box.querySelector('.find-zoom-pct').textContent = `${Math.round(scale * 100)}%`;
}

function findZoomShow(selected) {
  let box = document.getElementById('findZoom');
  if (!box) {
    box = document.createElement('div');
    box.id = 'findZoom';
    box.className = 'find-zoom';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', '園區平面圖');
    box.innerHTML = `
      <div class="find-zoom-bar">
        <span class="find-zoom-title">點區域看那區的狗</span>
        <button type="button" data-zoom-step="-1" aria-label="縮小">－</button>
        <span class="find-zoom-pct"></span>
        <button type="button" data-zoom-step="1" aria-label="放大">＋</button>
        <button type="button" class="find-zoom-close" aria-label="關閉平面圖">${icon('close')}</button>
      </div>
      <div class="find-zoom-scroll"></div>`;
    document.body.appendChild(box);
    box.addEventListener('click', e => {
      if (e.target.closest('.find-zoom-close')) { findZoomClose(); return; }
      const stepBtn = e.target.closest('[data-zoom-step]');
      if (stepBtn) {
        findZoomState.step = Math.max(0, Math.min(FIND_ZOOM_STEPS.length - 1, findZoomState.step + Number(stepBtn.dataset.zoomStep)));
        findZoomRender();
        return;
      }
      const zone = e.target.closest('g[data-find-zone]');
      if (zone) findZoomPick(zone.dataset.findZone);
    });
    box.addEventListener('keydown', e => {
      const zone = e.target.closest('g[data-find-zone]');
      if (zone && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); findZoomPick(zone.dataset.findZone); }
    });
  }
  findZoomState = { selected, step: 0, opener: document.activeElement };
  findZoomRender();
  box.hidden = false;
  document.documentElement.classList.add('find-zoom-open');
  history.pushState({ bqFindZoom: true }, '');
  box.querySelector('.find-zoom-close').focus({ preventScroll: true });
}

// 關掉全螢幕（popstate 呼叫，或 findZoomClose 經由 history.back 間接呼叫）
function findZoomHide() {
  if (!findZoomState) return;
  const { opener } = findZoomState;
  findZoomState = null;
  const box = document.getElementById('findZoom');
  if (box) { box.hidden = true; box.querySelector('.find-zoom-scroll').innerHTML = ''; }
  document.documentElement.classList.remove('find-zoom-open');
  if (opener && opener.isConnected) opener.focus({ preventScroll: true });
}

function findZoomClose() {
  if (history.state && history.state.bqFindZoom) history.back(); // popstate 會接著 findZoomHide
  else findZoomHide();
}

// 在全螢幕點區域：關掉放大（從詳細資訊開的也一起關），到找狗平面圖選那一區
function findZoomPick(key) {
  findZoomHide();
  if (history.state && history.state.bqFindZoom) history.replaceState(null, '');
  if (detailDog) closeDetail();
  findView = 'map';
  findZone = key;
  if (searchQuery) {
    const input = document.getElementById('searchInput');
    if (input) { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
  }
  switchTab('find');
  render();
  window.scrollTo(0, 0);
}

// 詳細資訊的小地圖：點了全螢幕放大，選好這隻狗那一區
document.addEventListener('click', e => {
  if (!e.target.closest || !e.target.closest('#findMiniZoom') || !detailDog) return;
  findZoomShow(findZoneOf(detailDog));
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && findZoomState) { e.stopImmediatePropagation(); findZoomClose(); }
}, true);
