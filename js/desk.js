// 電腦版溜狗表（K 2026-10-10，選「簡報＋全表」，全表可切「最近 30 天」）：寬螢幕（≥1100px）時溜狗表改成
// 上面今天的簡報（紅黃綠各幾隻、各區狀況），下面像試算表的全表（勾好幾隻一次登記溜了），右邊異動紀錄和休養中。
// 志工原本在試算表看整體狀況，電腦版要一樣一眼看完；手機照舊是 js/app.js 的狗卡／列表。
// 登記一樣走 setWalked（只寫「遛狗日期」「誰遛的」兩欄），這裡不另外寫試算表。

const DESK_MEDIA = typeof matchMedia === 'function' ? matchMedia('(min-width: 1100px)') : null;
function deskOn() {
  return !!(DESK_MEDIA && DESK_MEDIA.matches);
}

// 區域：照籠位開頭分；跟找狗的分區一樣大的分法，簡報一行一區
const DESK_ZONES = [
  { key: 'new', name: '新犬舍', test: c => /^新/.test(c) },
  { key: 'old', name: '舊犬舍', test: c => /^舊/.test(c) },
  { key: 'mom', name: '幼母', test: c => /^母幼/.test(c) },
  { key: 'c', name: 'C 區', test: c => /^C/i.test(c) },
  { key: 'ward', name: '住院區', test: c => /^住院/.test(c) },
];
function deskZoneOf(dog) {
  const c = String(dog.cage || '').replace(/\s/g, '');
  return (DESK_ZONES.find(z => z.test(c)) || { key: 'other' }).key;
}

// 一隻狗在簡報、色條裡算哪一種：red、amber、sage（含固定有人照顧）、none（沒紀錄）、rest（休養中）
function deskBucket(s) {
  if (s.kind === 'rest') return 'rest';
  if (s.kind === 'covered') return 'sage';
  if (s.kind === 'dated') return s.days < 0 ? 'none' : s.level;
  return 'none';
}

// 異動紀錄（試算表狗清單下面那段）：新的在上面；開頭的日期拆出來加粗
function deskNoteParts(text) {
  const m = String(text || '').match(/^\s*((?:\d{4}\/)?\d{1,2}\/\d{1,2})\s*/);
  return m ? { date: m[1], rest: text.slice(m[0].length) } : { date: '', rest: String(text || '') };
}

let deskZone = 'all';
let deskSort = 'days'; // days（跟手機溜狗表同一個順序）、cage、name
let deskView = 'sheet'; // sheet（全表）、days30（最近 30 天）、fill（補資料：照片、入所介紹）
let deskFill = 'all'; // 補資料要看哪些：all、photo（沒照片）、intro（沒介紹）
let deskNotesAll = false;
const deskChecked = new Set(); // 勾起來要一起登記的狗（walkKey）
let deskWalkDays = null; // walkKey → Set(yyyy-mm-dd)，最近 30 天用；第一次切過去才讀 walks.json
let deskWalkFirst = '';
let deskWalksLoading = false;

const deskNatural = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
function deskSorted(list) {
  if (deskSort === 'cage') return [...list].sort((a, b) => deskNatural(a.cage, b.cage) || deskNatural(a.name, b.name));
  if (deskSort === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  return list;
}

function deskBriefHtml(today) {
  const all = allDogs.map(d => ({ d, b: deskBucket(computeStatus(d, today)), s: computeStatus(d, today) }));
  const n = b => all.filter(x => x.b === b).length;
  const tile = (b, label, cls) => `<div class="db-count ${cls}${n(b) ? '' : ' zero'}"><span class="db-tag ${cls}">${label}</span><span class="db-n"><b class="num">${n(b)}</b>隻</span></div>`;
  const zones = DESK_ZONES.map(z => {
    const list = all.filter(x => deskZoneOf(x.d) === z.key);
    if (!list.length) return '';
    const pct = b => `${(list.filter(x => x.b === b).length / list.length * 100).toFixed(2)}%`;
    const longest = list.filter(x => x.s.kind === 'dated' && x.s.days >= 0).sort((a, b) => b.s.days - a.s.days)[0];
    const red = list.filter(x => x.b === 'red').length, amber = list.filter(x => x.b === 'amber').length;
    return `<button type="button" class="db-zone${deskZone === z.key ? ' on' : ''}" data-desk-zone="${z.key}" aria-pressed="${deskZone === z.key}">
      <span class="db-zn">${z.name}<small class="num">${list.length}</small></span>
      <span class="db-bar" aria-hidden="true"><i class="red" style="width:${pct('red')}"></i><i class="amber" style="width:${pct('amber')}"></i><i class="none" style="width:${pct('none')}"></i><i class="sage" style="width:${pct('sage')}"></i></span>
      <span class="db-zs num">${red ? `<span class="r">紅 ${red}</span>` : ''}${amber ? `<span class="a">黃 ${amber}</span>` : ''}${!red && !amber ? '<span class="g">都在 3 天內</span>' : ''}</span>
      <span class="db-long">${longest ? `最久 <b>${esc(longest.d.name)}</b> <span class="lv-${longest.s.level}">${longest.s.days} 天</span>` : ''}</span>
    </button>`;
  }).join('');
  return `<section class="desk-brief" aria-label="今天的狀況">
    <div class="db-counts">${tile('red', `${RED_DAYS} 天以上`, 'red')}${tile('amber', `${AMBER_DAYS}–${RED_DAYS - 1} 天`, 'amber')}${tile('none', '沒紀錄', 'none')}${tile('sage', `0–${AMBER_DAYS - 1} 天`, 'sage')}${n('rest') ? tile('rest', '休養中', 'rest') : ''}</div>
    <div class="db-zones">${zones}</div>
  </section>`;
}

function deskToolsHtml(shown, total) {
  const chips = [['all', '全部', total], ...DESK_ZONES.map(z => [z.key, z.name, allDogs.filter(d => deskZoneOf(d) === z.key).length])]
    .filter(([, , n]) => n)
    .map(([k, t, n]) => `<button type="button" class="dt-chip${deskZone === k ? ' on' : ''}" data-desk-zone="${k}" aria-pressed="${deskZone === k}">${t}<small class="num">${n}</small></button>`).join('');
  return `<div class="desk-tools">
    <div class="dt-chips" role="group" aria-label="區域">${chips}</div>
    <span class="dt-hint">${shown === total ? '' : `<b class="num">${shown}</b> / ${total} 隻・`}${deskView === 'fill' ? '' : '勾左邊的格子可以一次登記好幾隻'}</span>
    <div class="dt-view" role="group" aria-label="表格">
      ${[['sheet', '全表'], ['days30', '最近 30 天'], ['fill', '補資料']].map(([k, t]) => `<button type="button" data-desk-view="${k}" class="${deskView === k ? 'on' : ''}" aria-pressed="${deskView === k}">${t}</button>`).join('')}
    </div>
  </div>`;
}

// 最近 30 天：今天往前 29 天
function deskDays(today) {
  return Array.from({ length: 30 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29 + i));
}
function deskWalkedOn(dog, key, today) {
  if (localDateKey(today) === key && walkedNow(dog, today)) return true;
  const date = effectiveWalkDate(dog, today);
  if (date && localDateKey(date) === key) return true;
  const set = deskWalkDays && deskWalkDays.get(walkKey(dog));
  return !!(set && set.has(key));
}
async function deskLoadWalks() {
  if (deskWalkDays || deskWalksLoading) return;
  deskWalksLoading = true;
  try {
    const data = walksData || await fetch(WALKS_URL, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null));
    const map = new Map();
    for (const w of (data && data.walks) || []) {
      const key = w.id ? w.id : `名:${w.name}`;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(w.date);
      if (!deskWalkFirst || w.date < deskWalkFirst) deskWalkFirst = w.date;
    }
    deskWalkDays = map;
  } catch (e) {
    console.error(e);
    deskWalkDays = new Map();
  }
  deskWalksLoading = false;
  if (activeTab === 'walk' && deskOn()) render();
}

function deskRowHtml(dog, today, days) {
  const s = computeStatus(dog, today);
  const key = walkKey(dog);
  const idx = allDogs.indexOf(dog);
  const flag = specialFlag(dog.note);
  const rest = s.kind === 'rest';
  const done = walkedNow(dog, today);
  const pending = walkPendingNow(dog);
  const tag = s.kind === 'rest' ? `<span class="dr-day rest">休養</span>`
    : s.kind === 'covered' ? `<span class="dr-day sage">固定</span>`
    : s.kind === 'dated' ? (s.days < 0 ? '<span class="dr-day none">？</span>' : `<span class="dr-day ${s.level}">${s.days === 0 ? '今天' : `<b class="num">${s.days}</b>天`}</span>`)
    : '<span class="dr-day none">沒紀錄</span>';
  const check = pending ? '<span class="dr-state">登記中</span>'
    : done ? `<span class="dr-state done" title="今天已溜；要取消請點狗名">${icon('tick')}</span>`
    : rest ? `<span class="dr-state" title="休養中，暫停帶出">—</span>`
    : `<input type="checkbox" data-desk-check="${esc(key)}" ${deskChecked.has(key) ? 'checked' : ''} aria-label="勾 ${esc(dog.name)}，等一下一起登記溜了">`;
  const date = effectiveWalkDate(dog, today);
  const who = walkerList(dog, today).join('、');
  const cage = typeof whereKnown === 'function' && whereKnown(dog)
    ? `<button type="button" class="dr-cage" data-where data-dog-i="${idx}" aria-label="${esc(dog.name)} 在哪：${esc(dog.cage)}">${esc(dog.cage)}</button>`
    : `<span class="dr-cage plain">${esc(dog.cage)}</span>`;
  const note = dog.note ? (flag ? highlightNote(dog.note, flag.terms) : esc(dog.note)) : '';
  const cells = days
    ? days.map(d => { const k = localDateKey(d); const on = deskWalkedOn(dog, k, today); const pre = !on && deskWalkFirst && k < deskWalkFirst; return `<td class="dr-d${localDateKey(d) === localDateKey(today) ? ' today' : ''}"><i class="${on ? 'on' : pre ? 'pre' : ''}"></i></td>`; }).join('')
    : '';
  return `<tr class="dr${deskChecked.has(key) ? ' checked' : ''}${flag ? ' flagged' : ''}" data-desk-dog="${idx}">
    <td class="dr-ck">${check}</td>
    <td class="dr-dayc">${tag}</td>
    <td class="dr-name"><button type="button" data-desk-open="${idx}" aria-haspopup="dialog">${esc(dog.name)}</button>${flag ? `<span class="dr-warn" title="${esc(flag.keywords.join('、'))}">注意</span>` : ''}${dog.homeCage ? '<small>暫住</small>' : ''}</td>
    <td class="dr-cagec">${cage}</td>
    <td class="dr-date num">${date ? `${date.getMonth() + 1}/${date.getDate()}` : ''}</td>
    <td class="dr-who">${esc(who)}</td>
    ${cells}
    <td class="dr-note"${dog.note ? ` title="${esc(dog.note)}"` : ''}><div>${note}</div></td>
  </tr>`;
}

function deskTableHtml(list, today) {
  const days = deskView === 'days30' ? deskDays(today) : null;
  if (days && !deskWalkDays) deskLoadWalks();
  const th = (k, t, cls) => `<th class="${cls}${deskSort === k ? ' sorted' : ''}" aria-sort="${deskSort === k ? 'descending' : 'none'}"><button type="button" data-desk-sort="${k}">${t}</button></th>`;
  const eligible = list.filter(d => walkKey(d) && !walkedNow(d, today) && !walkPendingNow(d) && computeStatus(d, today).kind !== 'rest');
  const allOn = eligible.length && eligible.every(d => deskChecked.has(walkKey(d)));
  const dayHead = days ? days.map(d => `<th class="dr-d${localDateKey(d) === localDateKey(today) ? ' today' : ''}${d.getDay() % 6 === 0 ? ' we' : ''}" scope="col"><span class="num">${d.getDate()}</span><span>${'日一二三四五六'[d.getDay()]}</span></th>`).join('') : '';
  return `<div class="desk-sheet${days ? ' days30' : ''}">
    <table class="desk-table">
      <thead><tr>
        <th class="dr-ck"><input type="checkbox" data-desk-all ${allOn ? 'checked' : ''} aria-label="勾選這裡全部可以登記的狗"></th>
        ${th('days', '天數', 'dr-dayc')}${th('name', '狗名', 'dr-name')}${th('cage', '籠位', 'dr-cagec')}
        <th class="dr-date">上次溜</th><th class="dr-who">誰遛的</th>${dayHead}<th class="dr-note">備註（試算表）</th>
      </tr></thead>
      <tbody>${list.map(d => deskRowHtml(d, today, days)).join('')}</tbody>
    </table>
    ${days ? `<p class="desk-foot">綠格是那天有溜${deskWalkFirst ? `；溜狗紀錄從 ${+deskWalkFirst.slice(5, 7)}/${+deskWalkFirst.slice(8)} 開始，之前是斜線` : ''}。</p>` : ''}
  </div>`;
}

// ── 補資料（K 2026-10-10：電腦上比較好補資料）：沒照片、沒入所介紹的狗一列一隻；
// 照片拖到那一列（或按「上傳照片」）、介紹按「補介紹」，都打開詳細資訊走原本的預覽、確認（照片匿名上傳；介紹要通關碼，存 repo，不寫試算表）
function deskHasPhoto(dog) {
  if (!dog.id) return false;
  if (photoOverrides[dog.id]) return true;
  if (!Object.keys(photoVersions).length) return null; // 沒有版本號（本機）就不知道，照樣去抓
  return !!photoVersions[`photos/${dog.id}.jpg`];
}
function deskFillNeeds(dog) {
  const intro = typeof introOf === 'function' ? introOf(dog) : dog.intro;
  return { photo: deskHasPhoto(dog) === false, intro: !intro };
}
function deskFillHtml(list) {
  const rows = list.map(d => ({ d, need: deskFillNeeds(d) }));
  const known = Object.keys(photoVersions).length > 0; // 沒有照片清單（本機、讀不到）就不知道誰沒照片
  const nPhoto = rows.filter(r => r.d.id && r.need.photo).length, nIntro = rows.filter(r => r.d.id && r.need.intro).length;
  const shown = rows.filter(r => deskFill === 'photo' ? r.need.photo : deskFill === 'intro' ? r.need.intro : true)
    // 兩樣都缺的排最前面，再照籠位；沒編號的放最後
    .sort((a, b) => !a.d.id - !b.d.id || (b.need.photo + b.need.intro) - (a.need.photo + a.need.intro) || deskNatural(a.d.cage, b.d.cage)); // 沒編號的排最後（補不了）
  const chip = (k, t, n, off) => `<button type="button" class="df-chip${deskFill === k ? ' on' : ''}" data-desk-fill="${k}" aria-pressed="${deskFill === k}"${off ? ' disabled title="還不知道哪些狗沒照片"' : ''}>${t}<b class="num">${off ? '—' : n}</b></button>`;
  return `<div class="desk-fill">
    <div class="df-bar">
      <div class="df-chips" role="group" aria-label="要補什麼">${chip('photo', '沒照片', nPhoto, !known)}${chip('intro', '沒介紹', nIntro)}${chip('all', '全部', rows.length)}</div>
      <p class="df-note">照片拖到那一列或按上傳（所有人都能傳，會先預覽）・介紹要通關碼，存在網站，不寫試算表。</p>
    </div>
    ${shown.length ? `<table class="desk-table df-table">
      <thead><tr><th class="df-ph">照片</th><th class="df-name">狗名・籠位</th><th class="df-intro">入所介紹</th><th class="df-act"><span class="sr-only">補資料</span></th></tr></thead>
      <tbody>${shown.map(({ d, need }) => {
        const idx = allDogs.indexOf(d);
        const intro = typeof introOf === 'function' ? introOf(d) : d.intro;
        const off = d.id ? '' : ' disabled';
        const photoLabel = need.photo || deskHasPhoto(d) === null ? '上傳照片' : '換照片';
        return `<tr class="df-row" ${d.id ? `data-fill-dog="${idx}"` : ''}>
          <td class="df-ph">${need.photo ? `<span class="df-drop">${icon('camera')}<span>拖照片<br>到這裡</span></span>` : photoThumb(d, 64)}</td>
          <td class="df-name"><button type="button" data-desk-open="${idx}" aria-haspopup="dialog">${esc(d.name)}</button><span class="df-cage">${icon('pin')}${esc(d.cage)}</span></td>
          <td class="df-intro">${!d.id ? '<span class="df-missing">沒有編號，試算表補上編號後才能補</span>' : intro ? `<div>${esc(intro)}</div>` : '<span class="df-missing">還沒有入所介紹</span>'}</td>
          <td class="df-act">
            <button type="button" class="df-btn${need.photo ? ' need' : ''}" data-fill-photo="${idx}"${off}>${icon('camera')}${photoLabel}</button>
            <button type="button" class="df-btn${need.intro && d.id ? ' need' : ''}" data-fill-intro="${idx}"${off}>${icon('card')}${need.intro ? '補介紹' : '改介紹'}</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>` : `<div class="status-msg">${deskFill === 'photo' ? '這裡的狗都有照片了' : deskFill === 'intro' ? '這裡的狗都有介紹了' : '這一區沒有狗'}</div>`}
  </div>`;
}

function deskSideHtml(today) {
  const notes = [...(typeof sheetNotes !== 'undefined' ? sheetNotes : [])].reverse();
  const shown = deskNotesAll ? notes : notes.slice(0, 8);
  const resting = allDogs.filter(d => restOf(d, today));
  return `<aside class="desk-side">
    <section class="ds-panel" aria-labelledby="dsNotes">
      <h2 id="dsNotes">異動紀錄<small>試算表狗清單下面</small></h2>
      ${notes.length ? `<ol class="ds-notes">${shown.map(n => { const p = deskNoteParts(n.text); return `<li>${p.date ? `<b class="num">${esc(p.date)}</b>` : ''}<span>${esc(p.rest)}</span></li>`; }).join('')}</ol>
        ${notes.length > 8 ? `<button type="button" class="ds-more" data-desk-notes>${deskNotesAll ? '收起' : `看全部 ${notes.length} 則`}</button>` : ''}`
        : '<p class="ds-empty">還沒有紀錄（同步試算表後會出現）。</p>'}
    </section>
    ${resting.length ? `<section class="ds-panel" aria-labelledby="dsRest"><h2 id="dsRest">休養中<small>${resting.length} 隻</small></h2>
      <ul class="ds-rest">${resting.map(d => { const r = restOf(d, today); return `<li><button type="button" data-desk-open="${allDogs.indexOf(d)}">${esc(d.name)}</button><span>${esc(d.cage)}・${esc(r.reason || '休養')}，${monthDay(r.until)} 前暫停帶出</span></li>`; }).join('')}</ul></section>` : ''}
  </aside>`;
}

function deskBatchHtml() {
  const dogs = [...deskChecked].map(k => allDogs.find(d => walkKey(d) === k)).filter(Boolean);
  if (!dogs.length) return '';
  return `<div class="desk-batch" role="region" aria-label="一起登記">
    <span class="dbx-n">已勾 <b class="num">${dogs.length}</b> 隻</span>
    <span class="dbx-names">${esc(dogs.map(d => d.name).join('、'))}</span>
    <button type="button" class="dbx-clear" data-desk-clear>清掉</button>
    <button type="button" class="dbx-go" data-desk-go>今天 溜了</button>
  </div>`;
}

// js/app.js 的 renderMain 在寬螢幕、溜狗表時叫這個；walkList 已經照手機溜狗表排好、套過搜尋
function deskWalkHtml(today, query, walkList) {
  // 勾了之後狗不見了（搜尋、資料更新、已經溜了）就拿掉
  for (const k of [...deskChecked]) {
    const d = allDogs.find(x => walkKey(x) === k);
    if (!d || walkedNow(d, today) || walkPendingNow(d)) deskChecked.delete(k);
  }
  const list = deskSorted(deskZone === 'all' ? walkList : walkList.filter(d => deskZoneOf(d) === deskZone));
  const empty = !list.length ? `<div class="status-msg">${query ? `找不到「${esc(query)}」` : '這一區沒有狗'}</div>` : '';
  return `<h2 class="sr-only">溜狗表（電腦版）</h2><div class="desk${deskView === 'fill' ? ' filling' : ''}">
    <div class="desk-main">${query || deskView === 'fill' ? '' : deskBriefHtml(today)}${deskToolsHtml(list.length, walkList.length)}${empty || (deskView === 'fill' ? deskFillHtml(list) : deskTableHtml(list, today))}</div>
    ${deskSideHtml(today)}
  </div>${deskBatchHtml()}`;
}

// 頁首：寬螢幕時分類從畫面最下面搬到頁首（站名和搜尋框中間），變回一般網站的分頁
function deskPlaceTabs() {
  const bar = document.getElementById('bottomBar');
  const head = document.querySelector('header.app .header-inner');
  const search = head && head.querySelector('.search');
  if (!bar || !head || !search) return;
  if (deskOn()) {
    if (bar.parentElement !== head) head.insertBefore(bar, search);
  } else if (bar.parentElement === head) {
    document.body.insertBefore(bar, document.getElementById('main').nextSibling);
  }
  document.documentElement.classList.toggle('desk-on', deskOn());
}

if (typeof document !== 'undefined' && document.getElementById('main')) {
  deskPlaceTabs();
  if (DESK_MEDIA) DESK_MEDIA.addEventListener('change', () => { deskPlaceTabs(); if (loadState === 'ready') render(); });
  const main = document.getElementById('main');
  // 最近 30 天放不下時捲到最右邊（今天那一格）
  new MutationObserver(() => { const sheet = main.querySelector('.desk-sheet.days30'); if (sheet && !sheet.dataset.scrolled) { sheet.dataset.scrolled = '1'; sheet.scrollLeft = sheet.scrollWidth; } }).observe(main, { childList: true });
  main.addEventListener('click', e => {
    if (!deskOn() || activeTab !== 'walk') return;
    const t = e.target;
    const zone = t.closest('[data-desk-zone]');
    if (zone) { deskZone = deskZone === zone.dataset.deskZone && zone.classList.contains('db-zone') ? 'all' : zone.dataset.deskZone; render(); return; }
    const view = t.closest('[data-desk-view]');
    if (view) { deskView = view.dataset.deskView; render(); return; }
    const sort = t.closest('[data-desk-sort]');
    if (sort) { deskSort = sort.dataset.deskSort; render(); return; }
    const open = t.closest('[data-desk-open]');
    if (open) { showDetail(allDogs[Number(open.dataset.deskOpen)]); return; }
    const where = t.closest('[data-where][data-dog-i]');
    if (where) { whereOpen(allDogs[Number(where.dataset.dogI)], where); return; }
    if (t.closest('[data-desk-notes]')) { deskNotesAll = !deskNotesAll; render(); return; }
    const fill = t.closest('[data-desk-fill]');
    if (fill) { deskFill = fill.dataset.deskFill; render(); return; }
    const addPhoto = t.closest('[data-fill-photo]');
    if (addPhoto) { showDetail(allDogs[Number(addPhoto.dataset.fillPhoto)]); pickPhotoFile(); return; }
    const addIntro = t.closest('[data-fill-intro]');
    if (addIntro) { const d = allDogs[Number(addIntro.dataset.fillIntro)]; showDetail(d); openIntroEdit(d); return; }
    if (t.closest('[data-desk-clear]')) { deskChecked.clear(); render(); return; }
    if (t.closest('[data-desk-go]')) {
      const dogs = [...deskChecked].map(k => allDogs.find(d => walkKey(d) === k)).filter(Boolean);
      deskChecked.clear();
      if (dogs.length) setWalked(dogs, true);
      render();
    }
  });
  // 補資料：照片檔拖到那一列 → 打開那隻的詳細資訊、直接預覽（按確認才上傳）
  const fillRow = e => (deskOn() && activeTab === 'walk' && deskView === 'fill' && e.dataTransfer && [...e.dataTransfer.types].includes('Files') ? e.target.closest('[data-fill-dog]') : null);
  main.addEventListener('dragover', e => {
    const row = fillRow(e);
    if (!row) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    main.querySelectorAll('.df-row.drop').forEach(r => { if (r !== row) r.classList.remove('drop'); });
    row.classList.add('drop');
  });
  main.addEventListener('dragleave', e => { const row = e.target.closest && e.target.closest('.df-row'); if (row && !row.contains(e.relatedTarget)) row.classList.remove('drop'); });
  main.addEventListener('drop', e => {
    const row = fillRow(e);
    if (!row) return;
    e.preventDefault();
    row.classList.remove('drop');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    const dog = allDogs[Number(row.dataset.fillDog)];
    if (!file || !dog) return;
    showDetail(dog);
    preparePhoto(dog, file);
  });
  main.addEventListener('change', e => {
    if (!deskOn() || activeTab !== 'walk') return;
    if (e.target.matches('[data-desk-all]')) {
      main.querySelectorAll('[data-desk-check]').forEach(box => { if (e.target.checked) deskChecked.add(box.dataset.deskCheck); else deskChecked.delete(box.dataset.deskCheck); });
      render();
      return;
    }
    const key = e.target.dataset.deskCheck;
    if (!key) return;
    if (e.target.checked) deskChecked.add(key); else deskChecked.delete(key);
    // 只換這一列和下面的登記列，不整頁重畫（勾很多隻時不跳）
    const row = e.target.closest('tr');
    if (row) row.classList.toggle('checked', e.target.checked);
    const old = main.querySelector('.desk-batch');
    if (old) old.remove();
    main.insertAdjacentHTML('beforeend', deskBatchHtml());
    const all = main.querySelector('[data-desk-all]');
    if (all) { const boxes = [...main.querySelectorAll('[data-desk-check]')]; all.checked = boxes.length > 0 && boxes.every(b => b.checked); }
  });
}
