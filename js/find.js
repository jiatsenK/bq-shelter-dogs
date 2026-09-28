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
let findCage = null;    // 平面圖上點選的籠子（findCageOf 的 id）；null＝看整區

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

// ── 逐籠位置（K 2026-09-27 手繪標註看板）──
// 籠子一樣大，只有新獨比較窄。座標用「橫的看板」寫（跟 K 的圖同方向），再換回直的座標、交給 findTurn 轉。
// 舊犬舍（由左到右）：舊A11–A21、舊A1–A10、舊B1–B10、舊B11–B21，每排都是下面 1 號、往上數；
// 中間兩排上面留一條放區名。新犬舍（由上到下）：新B01–10、新A01–10、新獨01–12，都是左到右。
function findFromLand([x, y, w, h]) { return [y, FIND_MAP_H - x - w, h, w]; }
function findToLand([x, y, w, h]) { return [FIND_MAP_H - y - h, x, h, w]; }
function findCageLayout() {
  const cages = [];
  const add = (zone, id, label, land) => cages.push({ zone, id, label, rect: findFromLand(land) });
  const zoneLand = key => findToLand(FIND_ZONES.find(z => z.key === key).rect);
  const bands = {};
  {
    const [zx, zy, zw, zh] = zoneLand('old');
    const pad = FIND_MAP_GAP + 8, x0 = zx + pad, y0 = zy + pad, w = zw - pad * 2, h = zh - pad * 2;
    const col = 34, band = 26, bottom = y0 + h;
    const side = h / 11, mid = (h - band) / 10, cx = x0 + w / 2;
    for (let n = 1; n <= 10; n++) {
      add('old', `舊A${n}`, `A${n}`, [cx - col, bottom - n * mid, col, mid]);
      add('old', `舊B${n}`, `B${n}`, [cx, bottom - n * mid, col, mid]);
    }
    for (let n = 11; n <= 21; n++) {
      add('old', `舊A${n}`, `A${n}`, [x0, bottom - (n - 10) * side, col, side]);
      add('old', `舊B${n}`, `B${n}`, [x0 + w - col, bottom - (n - 10) * side, col, side]);
    }
    bands.old = findFromLand([x0 + col, y0, w - col * 2, band]);
  }
  {
    const [zx, zy, zw, zh] = zoneLand('new');
    const pad = FIND_MAP_GAP + 7, x0 = zx + pad, y0 = zy + pad, w = zw - pad * 2, h = zh - pad * 2;
    const band = 24, row = 34, small = 22, cw = w / 10, sw = w / 12;
    for (let n = 1; n <= 10; n++) {
      add('new', `新B${n}`, `B${n}`, [x0 + (n - 1) * cw, y0 + band, cw, row]);
      add('new', `新A${n}`, `A${n}`, [x0 + (n - 1) * cw, y0 + band + row, cw, row]);
    }
    for (let n = 1; n <= 12; n++) add('new', `新獨${n}`, `${n}`, [x0 + (n - 1) * sw, y0 + h - small, sw, small]);
    bands.new = findFromLand([x0, y0, w, band]);
  }
  return { cages, bands };
}
const FIND_CAGES = findCageLayout();

// 狗的籠位 → 圖上的籠子 id（新A03 → 新A3）；住院區、C區、母幼這些不分籠的回傳 null
function findCageOf(dog) {
  const m = searchKey(dog.cage).toUpperCase().match(/^(舊|新)(A|B|獨)0*(\d+)$/);
  if (!m) return null;
  const id = m[1] + m[2] + Number(m[3]);
  return FIND_CAGES.cages.some(c => c.id === id) ? id : null;
}

// 有逐籠的區：區名和隻數擠成一行，放在籠子上方留白那條
function findBandLabel(name, n, r) {
  const [x, y, w, h] = r;
  return `<text class="fm-t" x="${x + w / 2}" y="${y + h / 2 + 5}" text-anchor="middle" font-size="14" letter-spacing="2">${name}`
    + `<tspan class="fm-n fm-n-s" dx="8">${n}</tspan><tspan class="fm-unit" dx="2">隻</tspan></text>`;
}

// cage：要標出來的籠子（詳細資訊的小地圖、從小地圖開的全螢幕），用 findCageOf 的 id
function findMapSvg(selected, query = '', mini = false, turn = FIND_MAP_TURN, cage = null) {
  findTurnNow = turn;
  try { return findMapSvgNow(selected, query, mini, cage); } finally { findTurnNow = FIND_MAP_TURN; }
}
function findMapSvgNow(selected, query, mini, cage) {
  const count = key => allDogs.filter(d => findZoneOf(d) === key && findMatches(d, query)).length;
  const lit = new Set(allDogs.filter(d => findMatches(d, query)).map(findCageOf)); // 有狗（搜尋時只算找到的）的籠子
  const dogsIn = id => allDogs.filter(d => findCageOf(d) === id && findMatches(d, query)).length;
  const searching = !!searchKey(query);
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
    const band = FIND_CAGES.bands[z.key];
    for (const c of FIND_CAGES.cages.filter(c => c.zone === z.key && (!mini || c.id === cage))) {
      const [x, y, w, h] = findTurn(c.rect);
      // 常見的籠位圖做法：有狗實心、空籠虛線；點選的籠子（或搜尋找到的）用橘色，其他籠子淡掉
      const on = c.id === cage || (searching && lit.has(c.id));
      const fade = (searching || cage) && !on ? ' fade' : '';
      const cls = `fm-cage${lit.has(c.id) ? ' has' : ''}${on ? ' on' : ''}${fade}`;
      const rect = `<rect class="${cls}" x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${h - 2}" rx="1.5"/>`;
      if (mini) { s += rect; continue; }
      s += `<g class="fm-cg" data-find-cage="${c.id}" role="button" tabindex="0" aria-pressed="${c.id === cage}" aria-label="${c.id} ${dogsIn(c.id)} 隻">${rect}`
        + `<text class="fm-cn${on ? ' on' : ''}${fade}" x="${x + w / 2}" y="${y + h / 2 + 3}" text-anchor="middle">${c.label}</text></g>`;
    }
    if (!mini) s += band ? findBandLabel(z.name, n, findTurn(band)) : findLabel('fm-t', z.name, n, r);
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
  const box = findMapBox(selected);
  const from = findMapShown || findMapBox(null); // 從上一次看到的範圍開始，畫好後動畫移到這次的範圍
  let svg = findMapSvg(selected, query, false, FIND_MAP_TURN, findCage)
    .replace(/viewBox="[^"]*"/, `viewBox="${from.join(' ')}" data-to="${box.join(' ')}"`);
  findMapShown = box;
  requestAnimationFrame(findMapAnimate);
  let html = `<div class="find-map-card">
    ${svg}
    <div class="find-map-foot">
      ${selected ? `<button type="button" class="find-map-all" data-find-zone="all">${icon('map')}看全圖</button>`
        : '<p class="find-map-hint">點一區放大，點籠子看那籠的狗。</p>'}
      <button type="button" class="find-zoom-btn" id="findZoomOpen" aria-label="全螢幕放大平面圖">${icon('zoom')}放大</button>
    </div>
    ${unmapped.length ? `<div class="find-unmapped">這些籠位還不知道在圖上哪裡：${unmapped.map(z =>
      `<button type="button" data-find-zone="${z.key}" aria-pressed="${findZone === z.key}">${esc(z.name)} ${allDogs.filter(d => findZoneOf(d) === z.key && findMatches(d, query)).length} 隻</button>`).join('')}</div>` : ''}
  </div>`;
  if (selected) {
    const list = findList(query).filter(d => !findCage || findCageOf(d) === findCage);
    const z = findZoneInfo(selected);
    const title = findCage ? `${z.name}・${findCage}` : z.name;
    const where = findCage ? '這籠' : '這區';
    html += `<div class="find-zone-head"><i class="find-dot z-${z.key}"></i><h2>${esc(title)}</h2><span>${list.length} 隻</span></div>`;
    html += list.length ? `<div class="find-grid">${list.map((d, i) => findCard(d, query, i < 6)).join('')}</div>`
      : `<div class="status-msg">${query ? `${where}找不到「${esc(query)}」` : findCage ? '這籠目前沒有狗' : '這區目前沒有對應的籠位'}</div>`;
  }
  return html;
}

// 選了一區就把平面圖放大到那一區（K 2026-09-28：選位置之後動畫放大）。
// 範圍補成跟整張圖一樣的長寬比，地圖框大小不變、只有裡面放大；超出整張圖的部分往回推。
let findMapShown = null; // 上一次畫面上的範圍 [x, y, w, h]
let findMapAnim = 0;
function findMapBox(selected) {
  const P = FIND_MAP_PAD;
  const [, , vw, vh] = findTurn([0, 0, FIND_MAP_W, FIND_MAP_H]);
  const full = [-P, -P, vw + P * 2, vh + P * 2];
  const zone = selected && FIND_ZONES.find(z => z.key === selected && z.rect);
  if (!zone) return full;
  const [zx, zy, zw, zh] = findTurn(zone.rect);
  let w = zw + 24, h = zh + 24;
  const ratio = full[2] / full[3];
  if (w / h < ratio) w = h * ratio; else h = w / ratio;
  w = Math.min(w, full[2]); h = Math.min(h, full[3]);
  const fit = (c, size, lo, span) => Math.max(lo, Math.min(lo + span - size, c - size / 2));
  const r = n => Math.round(n * 10) / 10;
  return [r(fit(zx + zw / 2, w, full[0], full[2])), r(fit(zy + zh / 2, h, full[1], full[3])), r(w), r(h)];
}
function findMapAnimate() {
  const svg = document.querySelector('#main svg.find-map[data-to]');
  if (!svg) return;
  const from = svg.getAttribute('viewBox').split(' ').map(Number);
  const to = svg.dataset.to.split(' ').map(Number);
  const id = ++findMapAnim;
  const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still || from.every((v, i) => v === to[i])) { svg.setAttribute('viewBox', to.join(' ')); return; }
  const start = performance.now(), ms = 420;
  const step = now => {
    if (id !== findMapAnim || !svg.isConnected) return;
    const t = Math.min(1, (now - start) / ms);
    const e = 1 - Math.pow(1 - t, 3); // 先快後慢
    svg.setAttribute('viewBox', from.map((v, i) => (v + (to[i] - v) * e).toFixed(1)).join(' '));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function findPageHtml(query) {
  const bar = findChipsHtml(query);
  if (findView === 'map') return bar + findMapHtml(query);
  findMapShown = null; // 下次切回平面圖，從整張圖放大過去
  const list = findList(query);
  if (!list.length) {
    return bar + `<div class="status-msg">${query
      ? `找不到「${esc(query)}」<br>試試狗名的一個字、編號後四碼，或籠位（例：新A03）。`
      : '這區目前沒有狗'}</div>`;
  }
  const hint = query ? `<div class="section-hint">${icon('search')}「${esc(query)}」找到 ${list.length} 隻（含今天已溜、已收起）</div>` : '';
  return bar + hint + findGridHtml(list, query);
}

// 詳細資訊的「在哪裡」：小地圖標出所在的區，按鈕跳到找狗的平面圖、選好那一區
function findLocationSection(dog) {
  const z = findZoneInfo(findZoneOf(dog));
  if (!z.rect) return '';
  return `<section class="detail-section" data-section="where">
    <h3>${icon('pin')}在哪裡</h3>
    <div class="find-where">
      <button type="button" class="find-where-map" id="findMiniZoom" aria-label="放大平面圖，看${esc(z.name)}在哪裡">${findMapSvg(z.key, '', true, FIND_MAP_TURN, findCageOf(dog))}</button>
      <div><b>${esc(z.name)}</b>・${esc(dog.cage)}
        <div class="find-where-how">${esc(whereDirections(dog).how)}</div>
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
  findCage = null;
  const input = document.getElementById('searchInput');
  if (input) { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
  switchTab('find');
  window.scrollTo(0, 0);
}

// 找狗頁的點擊（內容區每次重畫，所以用事件委派）
document.getElementById('main').addEventListener('click', e => {
  if (activeTab !== 'find') return;
  if (e.target.closest('#findZoomOpen')) { findZoomShow(findZone === 'all' ? null : findZone, findCage); return; }
  const view = e.target.closest('[data-find-view]');
  if (view) { findView = view.dataset.findView; render(); return; }
  const cageEl = e.target.closest('[data-find-cage]');
  if (cageEl) { findPickCage(cageEl.dataset.findCage); return; }
  const zone = e.target.closest('[data-find-zone]');
  if (zone) {
    const key = zone.dataset.findZone;
    // 再點一次取消；平面圖放大後整個框都是那一區，點圖上的區不取消，用「看全圖」回去
    const onMap = zone.tagName.toLowerCase() === 'g';
    findZone = key !== 'all' && findZone === key && !findCage && !onMap ? 'all' : key;
    findCage = null;
    render();
    return;
  }
  const card = e.target.closest('.find-dog[data-dog]');
  if (card && allDogs[card.dataset.dog]) showDetail(allDogs[card.dataset.dog]);
});
// 點籠子：選那一籠（再點一次回到整區），下面只列那籠的狗
function findPickCage(id) {
  const c = FIND_CAGES.cages.find(x => x.id === id);
  if (!c) return;
  findZone = c.zone;
  findCage = findCage === id ? null : id;
  render();
}
document.getElementById('main').addEventListener('keydown', e => {
  if (activeTab !== 'find' || (e.key !== 'Enter' && e.key !== ' ')) return;
  const cageEl = e.target.closest('g[data-find-cage]');
  if (cageEl) {
    e.preventDefault();
    findPickCage(cageEl.dataset.findCage);
    const again = document.querySelector(`#main g[data-find-cage="${cageEl.dataset.findCage}"]`);
    if (again) again.focus({ preventScroll: true });
    return;
  }
  const zone = e.target.closest('g[data-find-zone]');
  if (!zone) return;
  e.preventDefault();
  findZone = zone.dataset.findZone;
  findCage = null;
  render();
  const again = document.querySelector(`#main g[data-find-zone="${zone.dataset.findZone}"]`);
  if (again) again.focus({ preventScroll: true });
});

// ── 平面圖全螢幕放大（#102，K 2026-09-27「平面圖應該要可以放大」）──
// 找狗平面圖的「放大」、詳細資訊的小地圖都能開。全螢幕跟頁面一樣畫橫的（K 2026-09-27「點開是橫的」），
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
  const { selected, step, cage } = findZoomState;
  const scale = FIND_ZOOM_STEPS[step];
  box.querySelector('.find-zoom-scroll').innerHTML =
    `<div class="find-zoom-map" style="width:${scale * 100}%">${findMapSvg(selected, '', false, FIND_MAP_TURN, cage)}</div>`;
  box.querySelector('[data-zoom-step="-1"]').disabled = step === 0;
  box.querySelector('[data-zoom-step="1"]').disabled = step === FIND_ZOOM_STEPS.length - 1;
  box.querySelector('.find-zoom-pct').textContent = `${Math.round(scale * 100)}%`;
}

function findZoomShow(selected, cage = null) {
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
        <span class="find-zoom-title">點區域或籠子看狗</span>
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
      const cageEl = e.target.closest('g[data-find-cage]');
      if (cageEl) { findZoomPick(null, cageEl.dataset.findCage); return; }
      const zone = e.target.closest('g[data-find-zone]');
      if (zone) findZoomPick(zone.dataset.findZone);
    });
    box.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const cageEl = e.target.closest('g[data-find-cage]');
      const zone = e.target.closest('g[data-find-zone]');
      if (cageEl) { e.preventDefault(); findZoomPick(null, cageEl.dataset.findCage); }
      else if (zone) { e.preventDefault(); findZoomPick(zone.dataset.findZone); }
    });
  }
  findZoomState = { selected, cage, step: 0, opener: document.activeElement };
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

// 在全螢幕點區域或籠子：關掉放大（從詳細資訊開的也一起關），到找狗平面圖選那一區／那一籠
function findZoomPick(key, cage = null) {
  if (cage) key = FIND_CAGES.cages.find(c => c.id === cage).zone;
  findZoomHide();
  if (history.state && history.state.bqFindZoom) history.replaceState(null, '');
  if (detailDog) closeDetail();
  findView = 'map';
  findZone = key;
  findCage = cage;
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
  findZoomShow(findZoneOf(detailDog), findCageOf(detailDog));
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && findZoomState) { e.stopImmediatePropagation(); findZoomClose(); }
}, true);

// ── 在哪（V7 #111）：狗卡上的籠位點了，從下面跳出這一區的平面圖、那一籠橘框、找路的話 ──
// 志工一手牽狗，要馬上知道狗在哪；面板在畫面下半部，按鈕大拇指搆得到。
let whereDog = null;    // 面板正在看的狗
let whereOpener = null; // 關掉後焦點回到哪個按鈕

// index.html 已經放好面板；沒有的話（例：測試頁）就自己補一個
function whereBackdropEl() {
  let el = document.getElementById('whereBackdrop');
  if (!el) {
    document.body.insertAdjacentHTML('beforeend', '<div class="where-backdrop" id="whereBackdrop" hidden><div class="where-sheet" id="whereSheet" role="dialog" aria-modal="true" aria-labelledby="whereTitle"></div></div>');
    el = document.getElementById('whereBackdrop');
  }
  return el;
}

// 平面圖上有這一區才開得了面板（「其他籠位」不在圖上）
function whereKnown(dog) {
  return !!(dog && dog.cage && findZoneInfo(findZoneOf(dog)).rect);
}

// 找路的話（K 2026-09-27 手繪標註）：舊犬舍四排由下往上數、新犬舍三排由左往右數；不分籠的區只說進去找
function whereDirections(dog) {
  const z = findZoneInfo(findZoneOf(dog));
  const m = searchKey(dog.cage).toUpperCase().match(/^(舊|新)(A|B|獨)0*(\d+)$/);
  if (!m || !findCageOf(dog)) return { title: `${z.name}・${dog.cage}`, how: `${z.name}不分籠，進去找「${dog.cage}」` };
  const n = Number(m[3]);
  if (m[1] === '舊') {
    const col = m[2] === 'A' ? (n > 10 ? '最左排' : '左邊第二排') : (n > 10 ? '最右排' : '右邊第二排');
    return { title: `${z.name}・${dog.cage}`, how: `進舊犬舍走${col}，從下面數第 ${n > 10 ? n - 10 : n} 籠` };
  }
  const row = m[2] === 'B' ? '上排' : m[2] === 'A' ? '中間排' : '下排小籠';
  return { title: `${z.name}・${dog.cage}`, how: `新犬舍${row}，從左邊數第 ${n} 籠` };
}

// 放大到那一區的平面圖：沿用 findMapSvg 畫整張，再把 viewBox 縮到那一區，那一籠外面加橘框
function whereMapSvg(dog) {
  const key = findZoneOf(dog), cage = findCageOf(dog);
  let s = findMapSvg(key, '', false, FIND_MAP_TURN, cage);
  const [x, y, w, h] = findTurn(FIND_ZONES.find(z => z.key === key).rect);
  s = s.replace(/viewBox="[^"]*"/, `viewBox="${x - 8} ${y - 8} ${w + 16} ${h + 16}"`)
    .replace(/ role="(group|button)"| tabindex="0"| aria-pressed="[^"]*"| aria-label="[^"]*"/g, '');
  const c = cage && FIND_CAGES.cages.find(v => v.id === cage);
  if (c) {
    const [cx, cy, cw, ch] = findTurn(c.rect);
    s = s.replace(/<\/svg>$/, `<rect class="where-ring" x="${cx - 4}" y="${cy - 4}" width="${cw + 8}" height="${ch + 8}" rx="4"/></svg>`);
  }
  return s;
}

function whereHtml(dog) {
  const d = whereDirections(dog);
  const mates = cageMates(dog);
  const walked = walkedToday().has(dog);
  const status = computeStatus(dog, new Date());
  const days = walked ? '今天已溜'
    : status.kind === 'dated' && status.days >= 0 ? (status.days === 0 ? '今天有人溜' : `${status.days} 天沒溜`)
    : status.kind === 'covered' ? '有人固定照顧' : '沒有紀錄';
  const tone = walked ? 'sage' : status.kind === 'dated' && status.days >= 0 ? status.level : status.kind === 'covered' ? 'sage' : 'muted';
  const walkBtn = !walkKey(dog) ? ''
    : walked ? `<button type="button" class="where-btn" data-where-walk="back">放回</button>`
    : `<button type="button" class="where-btn primary" data-where-walk="add">${icon('tick')}溜了</button>`;
  return `<div class="where-grab" aria-hidden="true"></div>
    <div class="where-head">
      <h2 id="whereTitle">${icon('pin')}${esc(d.title)}</h2>
      <button type="button" class="where-close" id="whereClose" aria-label="關閉">${icon('close')}</button>
    </div>
    <div class="where-map" aria-hidden="true" inert>${whereMapSvg(dog)}</div>
    <p class="where-how">${esc(d.how)}</p>
    <div class="where-dog">
      ${photoThumb(dog, 48)}
      <div class="who">
        <div class="name">${esc(dog.name)}${sexMark(dog)}</div>
        <div class="mates">${mates.length ? `同籠還有 ${mates.map(m => esc(m.name)).join('、')}` : findCageOf(dog) ? '這籠只有牠' : ''}</div>
      </div>
      <span class="where-days ${tone}">${days}</span>
    </div>
    <div class="where-actions">
      <button type="button" class="where-btn" id="whereDetail">詳細資訊</button>
      ${walkBtn}
    </div>`;
}

function whereRender() {
  if (whereDog) whereBackdropEl().querySelector('.where-sheet').innerHTML = whereHtml(whereDog);
}

function whereOpen(dog, opener) {
  if (!whereKnown(dog)) return;
  whereDog = dog;
  whereOpener = opener || null;
  whereRender();
  whereBackdropEl().hidden = false;
  document.documentElement.classList.add('where-open');
  history.pushState({ bqWhere: true }, '');
  const first = document.querySelector('#whereSheet .where-btn.primary') || document.getElementById('whereDetail');
  if (first) first.focus({ preventScroll: true });
}

function whereHide() {
  if (!whereDog) return;
  const dog = whereDog;
  whereDog = null;
  const box = whereBackdropEl();
  box.hidden = true;
  box.querySelector('.where-sheet').innerHTML = '';
  document.documentElement.classList.remove('where-open');
  const card = document.querySelector(`#main .card[data-dog="${allDogs.indexOf(dog)}"] [data-where]`);
  const back = whereOpener && whereOpener.isConnected ? whereOpener : card;
  if (back) back.focus({ preventScroll: true });
  whereOpener = null;
}

function whereClose() {
  if (history.state && history.state.bqWhere) history.back(); // popstate 會接著 whereHide
  else whereHide();
}

whereBackdropEl().addEventListener('click', e => {
  if (e.target.id === 'whereBackdrop') { whereClose(); return; }
  const dog = whereDog;
  if (!dog) return;
  if (e.target.closest('#whereClose')) { whereClose(); return; }
  if (e.target.closest('#whereDetail')) {
    // 先換掉在哪的歷史紀錄再開詳細資訊，按返回直接回到清單
    whereHide();
    if (history.state && history.state.bqWhere) history.replaceState(null, '');
    showDetail(dog);
    return;
  }
  const walk = e.target.closest('[data-where-walk]');
  if (walk) {
    whereClose();
    setWalked([dog], walk.dataset.whereWalk === 'add');
  }
});
document.addEventListener('keydown', e => {
  if (!whereDog) return;
  if (e.key === 'Escape') { whereClose(); return; }
  if (e.key !== 'Tab') return;
  const items = [...document.querySelectorAll('#whereSheet button')];
  const at = items.indexOf(document.activeElement);
  e.preventDefault();
  items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus({ preventScroll: true });
});
