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
function findTurn([x, y, w, h]) {
  if (FIND_MAP_TURN === 'cw') return [FIND_MAP_H - y - h, x, h, w];
  if (FIND_MAP_TURN === 'ccw') return [y, FIND_MAP_W - x - w, h, w];
  return [x, y, w, h];
}
// 區名：窄的區域直排（一個字一行），寬的橫排；n 是第二行的隻數文字
function findLabel(cls, name, sub, [x, y, w, h], big) {
  if (w < 100) {
    const top = y + h / 2 - ([...name].length - 1) * 11 - (sub ? 10 : 0);
    return [...name].map((ch, i) => `<text class="${cls}" x="${x + w / 2}" y="${top + i * 22 + 6}" text-anchor="middle">${ch}</text>`).join('')
      + (sub ? `<text class="fm-n" x="${x + w / 2}" y="${y + h - 10}" text-anchor="middle">${sub}</text>` : '');
  }
  return `<text class="${cls}${big ? ' big' : ''}" x="${x + w / 2}" y="${y + h / 2 + (sub ? -2 : 5)}" text-anchor="middle">${name}</text>`
    + (sub ? `<text class="fm-n" x="${x + w / 2}" y="${y + h / 2 + 20}" text-anchor="middle">${sub}</text>` : '');
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

// 平面圖：mini＝詳細資訊裡的小地圖（不寫字、不能點，選到的區放紅點）
function findMapSvg(selected, query = '', mini = false) {
  const count = key => allDogs.filter(d => findZoneOf(d) === key && findMatches(d, query)).length;
  const [, , vw, vh] = findTurn([0, 0, FIND_MAP_W, FIND_MAP_H]);
  let s = `<svg class="find-map${mini ? ' mini' : ''}" viewBox="-4 -4 ${vw + 8} ${vh + 8}" ${mini ? 'aria-hidden="true"' : 'role="group" aria-label="收容所平面圖"'}>`;
  s += `<rect class="fm-bg" x="-2" y="-2" width="${vw + 4}" height="${vh + 4}" rx="10"/>`;
  for (const f of FIND_FACILITIES) {
    const r = findTurn(f.rect);
    s += `<rect class="fm-fac" x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" rx="4"/>`;
    if (!mini) s += findLabel('fm-fac-t', f.name, '', r);
  }
  for (const z of FIND_ZONES.filter(x => x.rect)) {
    const r = findTurn(z.rect);
    const n = count(z.key);
    const cls = `fm-zone z-${z.key}${selected && selected !== z.key ? ' dim' : ''}${selected === z.key ? ' sel' : ''}`;
    s += mini ? `<g class="${cls}">` : `<g class="${cls}" data-find-zone="${z.key}" role="button" tabindex="0" aria-pressed="${selected === z.key}" aria-label="${z.name} ${n} 隻">`;
    s += `<rect x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" rx="4"/>`;
    if (!mini) s += findLabel('fm-t', z.name, n ? `${n} 隻` : '0 隻', r, r[2] > 140);
    s += `</g>`;
  }
  if (mini && selected) {
    const z = FIND_ZONES.find(x => x.key === selected && x.rect);
    if (z) {
      const [x, y, w, h] = findTurn(z.rect);
      s += `<circle class="fm-pin" cx="${x + w / 2}" cy="${y + h / 2}" r="30"/><circle class="fm-pin-in" cx="${x + w / 2}" cy="${y + h / 2}" r="11"/>`;
    }
  }
  return s + '</svg>';
}

function findMapHtml(query) {
  const unmapped = allDogs.some(d => findZoneOf(d) === 'other') ? [findZoneInfo('other')] : [];
  const selected = findZone === 'all' ? null : findZone;
  let html = `<div class="find-map-card">${findMapSvg(selected, query)}
    <p class="find-map-hint">點一個區域，下面列出那區的狗。圖是照所內看板重畫的相對位置。</p>
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
      ${findMapSvg(z.key, '', true)}
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
