import { appState, deskState } from './page-state.js';
import { SITE } from './site-config.js';
import { apiData, canonicalWalker, computeStatus, effectiveWalkDate, render, restOf, walkedNow, walkerList } from './app.js';
import { sheetAppendHtml } from './sheet-append.js';
import { showDetail } from './detail.js';
import { esc, highlightNote, icon, monthDay } from './ui-kit.js';
import { AMBER_DAYS, RED_DAYS, specialFlag, walkKey } from './dog-status.js';
import { BQDates } from './dates.js';
import { BQApi } from './api.js';
import { BQWalkUI } from './walk-ui.js';
import { whereKnown, whereOpen } from './find.js';

// 電腦版溜狗表（K 2026-10-10，選「簡報＋全表」，全表可切「最近 30 天」）：寬螢幕（≥1100px）時溜狗表改成
// 上面今天的簡報（紅黃綠各幾隻、各區狀況），下面像試算表的全表（勾好幾隻一次登記溜了），右邊異動紀錄和休養中。
// 志工原本在試算表看整體狀況，電腦版要一樣一眼看完；手機照舊是 js/app.js 的狗卡／列表。
// 登記一樣走 BQWalkUI.setWalked（D1 接受後由 Worker 寫回試算表），這裡不另外寫試算表；登記狀態（登記中、沒登記到、寫回中）跟手機同一份。

const DESK_MEDIA = typeof matchMedia === 'function' ? matchMedia('(min-width: 1100px)') : null;
function deskOn() {
  return deskState.deskStarted && !!(DESK_MEDIA && DESK_MEDIA.matches);
}

// 區域：照籠位開頭分；跟找狗的分區一樣大的分法，簡報一行一區
const DESK_ZONES = SITE.zones; // js/site-config.js
function deskZoneOf(dog) {
  const c = String(dog.cage || '').replace(/\s/g, '');
  return (DESK_ZONES.find(z => z.test(c)) || { key: 'other' }).key;
}

// 一隻狗在簡報、色條裡算哪一種：red、amber、sage（0–2 天）、covered（有人固定照顧）、none（沒紀錄）、rest（休養中）。
// 固定照顧不算進「0–2 天」（GLOSSARY：固定照顧不是最近溜過），簡報另一格；色條仍跟 0–2 天同色（都不用急著溜）
function deskBucket(s) {
  if (s.kind === 'rest') return 'rest';
  if (s.kind === 'covered') return 'covered';
  if (s.kind === 'dated') return s.days < 0 ? 'none' : s.level;
  return 'none';
}

// 異動紀錄（試算表狗清單下面那段）：新的在上面；開頭的日期拆出來加粗
function deskNoteParts(text) {
  const m = String(text || '').match(/^\s*((?:\d{4}\/)?\d{1,2}\/\d{1,2})\s*/);
  return m ? { date: m[1], rest: text.slice(m[0].length) } : { date: '', rest: String(text || '') };
}

 deskState.deskZone = 'all';
 deskState.deskSort = 'days'; // days（跟手機溜狗表同一個順序）、cage、name
 deskState.deskSortRev = false; // 同一欄再點一次就反過來排（K 2026-10-10：有三角形但不能切換）
 deskState.deskView = 'sheet'; // sheet（全表）、days30（最近 30 天）；補資料由管理網站取代（#568）
 deskState.deskNotesAll = false;
const deskChecked = new Set(); // 勾起來要一起登記的狗（walkKey）
 deskState.deskWalkDays = null; // walkKey → Map(yyyy-mm-dd → Set(代號))，最近 30 天用；第一次切過去才讀 api/walks
 deskState.deskWalkFirst = '';
 deskState.deskWalksLoading = false;
 deskState.deskDaysScroll = null; // 最近 30 天捲到哪裡（{ left, top }）；重畫後放回原位，只有第一次打開捲到今天

const deskNatural = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
function deskSorted(list) {
  const out = deskState.deskSort === 'cage' ? [...list].sort((a, b) => deskNatural(a.cage, b.cage) || deskNatural(a.name, b.name))
    : deskState.deskSort === 'name' ? [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
    : list;
  return deskState.deskSortRev ? [...out].reverse() : out;
}
// 現在這一欄是由大到小（▼）還是由小到大（▲）：天數預設最久沒溜的在上面，籠位、狗名預設由小到大
const deskSortDir = () => ((deskState.deskSort === 'days') !== deskState.deskSortRev ? 'descending' : 'ascending');

function deskBriefHtml(today) {
  const all = appState.allDogs.map(d => ({ d, b: deskBucket(computeStatus(d, today)), s: computeStatus(d, today) }));
  const n = b => all.filter(x => x.b === b).length;
  const tile = (b, label, cls) => `<div class="db-count ${cls}${n(b) ? '' : ' zero'}"><span class="db-tag ${cls}">${label}</span><span class="db-n"><b class="num">${n(b)}</b>隻</span></div>`;
  const zones = DESK_ZONES.map(z => {
    const list = all.filter(x => deskZoneOf(x.d) === z.key);
    if (!list.length) return '';
    const pct = (...bs) => `${(list.filter(x => bs.includes(x.b)).length / list.length * 100).toFixed(2)}%`;
    const longest = list.filter(x => x.s.kind === 'dated' && x.s.days >= 0).sort((a, b) => b.s.days - a.s.days)[0];
    const red = list.filter(x => x.b === 'red').length, amber = list.filter(x => x.b === 'amber').length;
    return `<button type="button" class="db-zone${deskState.deskZone === z.key ? ' on' : ''}" data-desk-zone="${z.key}" aria-pressed="${deskState.deskZone === z.key}">
      <span class="db-zn">${z.name}<small class="num">${list.length}</small></span>
      <span class="db-bar" aria-hidden="true"><i class="red" style="width:${pct('red')}"></i><i class="amber" style="width:${pct('amber')}"></i><i class="none" style="width:${pct('none')}"></i><i class="sage" style="width:${pct('sage', 'covered')}"></i></span>
      <span class="db-zs num">${red ? `<span class="r">紅 ${red}</span>` : ''}${amber ? `<span class="a">黃 ${amber}</span>` : ''}${!red && !amber ? '<span class="g">都在 3 天內</span>' : ''}</span>
      <span class="db-long">${longest ? `最久 <b>${esc(longest.d.name)}</b> <span class="lv-${longest.s.level}">${longest.s.days} 天</span>` : ''}</span>
    </button>`;
  }).join('');
  return `<section class="desk-brief" aria-label="今天的狀況">
    <div class="db-counts">${tile('red', `${RED_DAYS} 天以上`, 'red')}${tile('amber', `${AMBER_DAYS}–${RED_DAYS - 1} 天`, 'amber')}${tile('none', '沒紀錄', 'none')}${tile('sage', `0–${AMBER_DAYS - 1} 天`, 'sage')}${n('covered') ? tile('covered', '固定照顧', 'covered') : ''}${n('rest') ? tile('rest', '休養中', 'rest') : ''}</div>
    <div class="db-zones">${zones}</div>
  </section>`;
}

function deskToolsHtml(shown, total) {
  const chips = [['all', '全部', total], ...DESK_ZONES.map(z => [z.key, z.name, appState.allDogs.filter(d => deskZoneOf(d) === z.key).length])]
    .filter(([, , n]) => n)
    .map(([k, t, n]) => `<button type="button" class="dt-chip${deskState.deskZone === k ? ' on' : ''}" data-desk-zone="${k}" aria-pressed="${deskState.deskZone === k}">${t}<small class="num">${n}</small></button>`).join('');
  return `<div class="desk-tools">
    <div class="dt-chips" role="group" aria-label="區域">${chips}</div>
    <span class="dt-hint">${shown === total ? '' : `<b class="num">${shown}</b> / ${total} 隻・`}<span class="dt-tip">勾左邊的格子可以一次登記好幾隻</span></span>
    <div class="dt-view" role="group" aria-label="表格">
      ${[['sheet', '全表'], ['days30', '最近 30 天']].map(([k, t]) => `<button type="button" data-desk-view="${k}" class="${deskState.deskView === k ? 'on' : ''}" aria-pressed="${deskState.deskView === k}">${t}</button>`).join('')}
    </div>
  </div>`;
}

// 最近 30 天：今天往前 29 天
function deskDays(today) {
  return Array.from({ length: 30 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29 + i));
}
// 那天有沒有溜、誰遛的（K 2026-10-12：電腦版最近 30 天要看到是誰遛的）。
// 溜狗紀錄只有代號，用 Worker 給的「代號 → 名字」換回來；今天和上次溜那天再加上試算表「誰遛的」。換不到名字就只有綠格
function deskDayWalk(dog, key, today) {
  const names = [];
  let on = false;
  const sheetDay = (BQDates.localDateKey(today) === key && walkedNow(dog, today)) || (() => { const d = effectiveWalkDate(dog, today); return !!(d && BQDates.localDateKey(d) === key); })();
  if (sheetDay) { on = true; names.push(...walkerList(dog, today)); }
  const codes = deskState.deskWalkDays && deskState.deskWalkDays.get(walkKey(dog)) && deskState.deskWalkDays.get(walkKey(dog)).get(key);
  if (codes) {
    on = true;
    for (const c of codes) if (appState.walkerCodeNames[c]) names.push(canonicalWalker(appState.walkerCodeNames[c]));
  }
  return { on, names: [...new Set(names.filter(n => n && n !== '你'))] };
}
async function deskLoadWalks() {
  if (deskState.deskWalkDays || deskState.deskWalksLoading) return;
  deskState.deskWalksLoading = true;
  try {
    const data = appState.walksData || await BQApi.walks().then(r => (r.error === 'http' ? null : apiData(r)));
    const map = new Map();
    for (const w of (data && data.walks) || []) {
      const key = w.id ? w.id : `名:${w.name}`;
      if (!map.has(key)) map.set(key, new Map());
      const day = map.get(key);
      if (!day.has(w.date)) day.set(w.date, new Set());
      for (const c of Array.isArray(w.walkers) ? w.walkers : []) day.get(w.date).add(c);
      if (!deskState.deskWalkFirst || w.date < deskState.deskWalkFirst) deskState.deskWalkFirst = w.date;
    }
    deskState.deskWalkDays = map;
  } catch (e) {
    console.error(e);
    deskState.deskWalkDays = new Map();
  }
  deskState.deskWalksLoading = false;
  // 常溜狗群電腦版的右欄也用這份紀錄（近 30 天溜了幾天）
  if ((appState.activeTab === 'walk' || appState.activeTab === 'groups') && deskOn()) render();
}

function deskRowHtml(dog, today, days) {
  const s = computeStatus(dog, today);
  const key = walkKey(dog);
  const idx = appState.allDogs.indexOf(dog);
  const flag = specialFlag(dog.note);
  const rest = s.kind === 'rest';
  const done = walkedNow(dog, today);
  const pending = BQWalkUI.walkPendingNow(dog);
  const tag = s.kind === 'rest' ? `<span class="dr-day rest">休養</span>`
    : s.kind === 'covered' ? `<span class="dr-day sage">固定</span>`
    : s.kind === 'dated' ? (s.days < 0 ? '<span class="dr-day none">？</span>' : `<span class="dr-day ${s.level}">${s.days === 0 ? '今天' : `<b class="num">${s.days}</b>天`}</span>`)
    : '<span class="dr-day none">沒紀錄</span>';
  // 跟手機「溜了」按鈕同一份登記狀態（walk-ui.js 的 walkButton）：#643 沒登記到留紅字到成功或再按，寫回試算表中／失敗也標出來
  const failed = !pending && BQWalkUI.walkFailure(dog);
  const check = pending ? '<span class="dr-state">登記中</span>'
    : done ? `<span class="dr-state done" title="今天已溜；要取消請點狗名">${icon('tick')}</span>`
    : rest ? `<span class="dr-state" title="休養中，暫停帶出">—</span>`
    : `<input type="checkbox" data-desk-check="${esc(key)}" ${deskChecked.has(key) ? 'checked' : ''} aria-label="勾 ${esc(dog.name)}，等一下一起登記溜了" aria-describedby="deskCheckHint">`;
  const status = failed
    ? `<button type="button" class="dr-fail" data-desk-retry="${idx}" aria-label="${esc(failed.aria)}">${failed.label}・再登記</button>`
    : BQWalkUI.walkSyncHtml(dog);
  const date = effectiveWalkDate(dog, today);
  const who = walkerList(dog, today).join('、');
  const cage = typeof whereKnown === 'function' && whereKnown(dog)
    ? `<button type="button" class="dr-cage" data-where data-dog-i="${idx}" aria-label="${esc(dog.name)} 在哪：${esc(dog.cage)}">${esc(dog.cage)}</button>`
    : `<span class="dr-cage plain">${esc(dog.cage)}</span>`;
  const note = dog.note ? (flag ? highlightNote(dog.note, flag.terms) : esc(dog.note)) : '';
  const cells = days
    ? days.map(d => {
      const k = BQDates.localDateKey(d);
      const { on, names } = deskDayWalk(dog, k, today);
      const pre = !on && deskState.deskWalkFirst && k < deskState.deskWalkFirst;
      // 格子裡寫第一個人名字的第一個字，好幾個人右上角加一點；滑過去看全名
      const tip = on ? `${d.getMonth() + 1}/${d.getDate()} ${names.length ? names.join('、') : '有溜'}` : '';
      const mark = names.length ? esc([...names[0]][0]) : '';
      return `<td class="dr-d${k === BQDates.localDateKey(today) ? ' today' : ''}"${tip ? ` title="${esc(tip)}"` : ''}><i class="${on ? 'on' : pre ? 'pre' : ''}${names.length > 1 ? ' multi' : ''}">${mark}</i></td>`;
    }).join('')
    : '';
  return `<tr class="dr${deskChecked.has(key) ? ' checked' : ''}${flag ? ' flagged' : ''}" data-desk-dog="${idx}">
    <td class="dr-ck">${check}</td>
    <td class="dr-dayc">${tag}</td>
    <td class="dr-name"><button type="button" data-desk-open="${idx}" aria-haspopup="dialog">${esc(dog.name)}</button>${flag ? `<span class="dr-warn" title="${esc(flag.keywords.join('、'))}">注意</span>` : ''}${dog.homeCage ? '<small>暫住</small>' : ''}${status ? `<span class="dr-sub">${status}</span>` : ''}</td>
    <td class="dr-cagec">${cage}</td>
    <td class="dr-date num">${date ? `${date.getMonth() + 1}/${date.getDate()}` : ''}</td>
    <td class="dr-who">${esc(who)}</td>
    ${cells}
    <td class="dr-note"${dog.note ? ` title="${esc(dog.note)}"` : ''}><div>${note}</div></td>
  </tr>`;
}

function deskTableHtml(list, today) {
  const days = deskState.deskView === 'days30' ? deskDays(today) : null;
  if (days && !deskState.deskWalkDays) deskLoadWalks();
  const th = (k, t, cls) => `<th class="${cls}${deskState.deskSort === k ? ` sorted ${deskSortDir() === 'ascending' ? 'asc' : 'desc'}` : ''}" aria-sort="${deskState.deskSort === k ? deskSortDir() : 'none'}"><button type="button" data-desk-sort="${k}" title="${deskState.deskSort === k ? '再點一次反過來排' : `照${t}排`}">${t}</button></th>`;
  const eligible = list.filter(d => walkKey(d) && !walkedNow(d, today) && !BQWalkUI.walkPendingNow(d) && computeStatus(d, today).kind !== 'rest');
  const allOn = eligible.length && eligible.every(d => deskChecked.has(walkKey(d)));
  const dayHead = days ? days.map(d => `<th class="dr-d${BQDates.localDateKey(d) === BQDates.localDateKey(today) ? ' today' : ''}${d.getDay() % 6 === 0 ? ' we' : ''}" scope="col"><span class="num">${d.getDate()}</span><span>${'日一二三四五六'[d.getDay()]}</span></th>`).join('') : '';
  return `<div class="desk-sheet${days ? ' days30' : ''}">
    <table class="desk-table">
      <thead><tr>
        <th class="dr-ck"><input type="checkbox" data-desk-all ${allOn ? 'checked' : ''} aria-label="勾選這裡全部可以登記的狗"></th>
        ${th('days', '天數', 'dr-dayc')}${th('name', '狗名', 'dr-name')}${th('cage', '籠位', 'dr-cagec')}
        <th class="dr-date">上次溜</th><th class="dr-who">誰遛的</th>${dayHead}<th class="dr-note">備註（試算表）</th>
      </tr></thead>
      <tbody>${list.map(d => deskRowHtml(d, today, days)).join('')}</tbody>
    </table>
    ${days ? `<p class="desk-foot">綠格是那天有溜，格子裡是誰遛的（名字第一個字，右上角有點是不只一個人；滑過去看全名）${deskState.deskWalkFirst ? `；溜狗紀錄從 ${+deskState.deskWalkFirst.slice(5, 7)}/${+deskState.deskWalkFirst.slice(8)} 開始，之前是斜線` : ''}。</p>` : ''}
  </div>`;
}

function deskSideHtml(today) {
  const notes = [...(typeof appState.sheetNotes !== 'undefined' ? appState.sheetNotes : [])].reverse();
  const shown = deskState.deskNotesAll ? notes : notes.slice(0, 8);
  const resting = appState.allDogs.filter(d => restOf(d, today));
  return `<aside class="desk-side">
    <section class="ds-panel" aria-labelledby="dsNotes">
      <h2 id="dsNotes">異動紀錄<small>試算表狗清單下面</small></h2>
      ${notes.length ? `<ol class="ds-notes">${shown.map(n => { const p = deskNoteParts(n.text); return `<li>${p.date ? `<b class="num">${esc(p.date)}</b>` : ''}<span>${esc(p.rest)}</span></li>`; }).join('')}</ol>
        ${notes.length > 8 ? `<button type="button" class="ds-more" data-desk-notes>${deskState.deskNotesAll ? '收起' : `看全部 ${notes.length} 則`}</button>` : ''}`
        : '<p class="ds-empty">還沒有紀錄（同步試算表後會出現）。</p>'}
      ${sheetAppendHtml('log')}
    </section>
    ${resting.length ? `<section class="ds-panel" aria-labelledby="dsRest"><h2 id="dsRest">休養中<small>${resting.length} 隻</small></h2>
      <ul class="ds-rest">${resting.map(d => { const r = restOf(d, today); return `<li><button type="button" data-desk-open="${appState.allDogs.indexOf(d)}">${esc(d.name)}</button><span>${esc(d.cage)}・${esc(r.reason || '休養')}，${monthDay(r.until)} 前暫停帶出</span></li>`; }).join('')}</ul></section>` : ''}
  </aside>`;
}

function deskBatchHtml() {
  const dogs = [...deskChecked].map(k => appState.allDogs.find(d => walkKey(d) === k)).filter(Boolean);
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
  const list = deskSorted(deskState.deskZone === 'all' ? walkList : walkList.filter(d => deskZoneOf(d) === deskState.deskZone));
  // 勾了之後狗不在畫面上（搜尋、換區、資料更新、已經溜了）就拿掉：看不到的狗不能跟著「今天 溜了」一起登記
  const shown = new Set(list.map(walkKey));
  for (const k of [...deskChecked]) {
    const d = appState.allDogs.find(x => walkKey(x) === k);
    if (!d || !shown.has(k) || walkedNow(d, today) || BQWalkUI.walkPendingNow(d)) deskChecked.delete(k);
  }
  const empty = !list.length ? `<div class="status-msg">${query ? `找不到「${esc(query)}」` : '這一區沒有狗'}</div>` : '';
  // 登記列畫面上浮在最下面，DOM 放在表格前面：用鍵盤勾完按 Enter 跳過去，不用 Tab 過每一列（critique 2026-10-28 #14）
  return `<h2 class="sr-only">溜狗表（電腦版）</h2><div class="desk">
    <div class="desk-main">${query ? '' : deskBriefHtml(today)}${deskToolsHtml(list.length, walkList.length)}<div class="desk-batch-slot">${deskBatchHtml()}</div><span id="deskCheckHint" class="sr-only">勾好後按 Enter 跳到「今天 溜了」</span>${empty || deskTableHtml(list, today)}</div>
    ${deskSideHtml(today)}
  </div>`;
}
// 換分頁就清掉勾選（critique 2026-10-28 #2）：回來時不會留著先前勾的狗、一按就登記下去
function deskClearChecked() { deskChecked.clear(); }

// 頁首：寬螢幕時分類從畫面最下面搬到頁首（站名和搜尋框中間），變回一般網站的分頁
function deskPlaceTabs() {
  const bar = document.getElementById('bottomBar');
  const head = document.querySelector('header.app .header-inner');
  const search = document.getElementById('searchInput')?.closest('.search');
  const page = document.getElementById('pageSearch');
  if (!bar || !head || !search) return;
  // 搜尋框（K 2026-10-17）：桌機在表頭；手機搬到表頭下面，表頭四頁同高
  if (deskOn()) {
    if (search.parentElement !== head) head.insertBefore(search, head.querySelector('.zukan-link'));
  } else if (page && search.parentElement !== page) page.append(search);
  if (deskOn()) {
    if (bar.parentElement !== head) head.insertBefore(bar, search);
  } else if (bar.parentElement === head) {
    document.body.insertBefore(bar, document.getElementById('main').nextSibling);
  }
  document.documentElement.classList.toggle('desk-on', deskOn());
}

 deskState.deskStarted = false;
function startDesk() {
  deskState.deskStarted = true;
if (typeof document !== 'undefined' && document.getElementById('main')) {
  deskPlaceTabs();
  if (DESK_MEDIA) DESK_MEDIA.addEventListener('change', () => { deskPlaceTabs(); if (appState.loadState === 'ready') render(); });
  const main = document.getElementById('main');
  // 最近 30 天放不下時第一次捲到最右邊（今天那一格）；之後重畫（全選、排序、背景更新）放回使用者捲到的位置
  new MutationObserver(() => {
    const sheet = main.querySelector('.desk-sheet.days30');
    if (!sheet || sheet.dataset.scrolled) return;
    sheet.dataset.scrolled = '1';
    const at = deskState.deskDaysScroll;
    sheet.scrollLeft = at ? at.left : sheet.scrollWidth;
    if (at) sheet.scrollTop = at.top;
  }).observe(main, { childList: true });
  main.addEventListener('scroll', e => {
    if (e.target.matches?.('.desk-sheet.days30[data-scrolled]')) deskState.deskDaysScroll = { left: e.target.scrollLeft, top: e.target.scrollTop };
  }, true);
  main.addEventListener('click', e => {
    if (!deskOn() || appState.activeTab !== 'walk') return;
    const t = e.target;
    const zone = t.closest('[data-desk-zone]');
    if (zone) { deskState.deskZone = deskState.deskZone === zone.dataset.deskZone && zone.classList.contains('db-zone') ? 'all' : zone.dataset.deskZone; render(); return; }
    const view = t.closest('[data-desk-view]');
    // 每次切到「最近 30 天」都從今天那一格開始；之後重畫才留在捲到的位置
    if (view) { if (deskState.deskView !== view.dataset.deskView) deskState.deskDaysScroll = null; deskState.deskView = view.dataset.deskView; render(); return; }
    const sort = t.closest('[data-desk-sort]');
    if (sort) {
      // 同一欄再點一次反過來排；換一欄從那一欄的預設方向開始
      if (deskState.deskSort === sort.dataset.deskSort) deskState.deskSortRev = !deskState.deskSortRev; else { deskState.deskSort = sort.dataset.deskSort; deskState.deskSortRev = false; }
      render();
      const again = main.querySelector(`[data-desk-sort="${deskState.deskSort}"]`);
      if (again) again.focus({ preventScroll: true });
      return;
    }
    const retry = t.closest('[data-desk-retry]');
    if (retry) { BQWalkUI.setWalked([appState.allDogs[Number(retry.dataset.deskRetry)]], true); return; }
    const open = t.closest('[data-desk-open]');
    if (open) { showDetail(appState.allDogs[Number(open.dataset.deskOpen)]); return; }
    const where = t.closest('[data-where][data-dog-i]');
    if (where) { whereOpen(appState.allDogs[Number(where.dataset.dogI)], where); return; }
    // 點這一列任何地方都開這隻狗的詳細資訊（K 2026-10-10：不用對準狗名）；勾選那一格、按鈕、正在選字不算
    const row = t.closest('tr[data-desk-dog]');
    if (row && !t.closest('button, input, a, label, .dr-ck') && !String(window.getSelection ? window.getSelection() : '').trim()) { showDetail(appState.allDogs[Number(row.dataset.deskDog)]); return; }
    if (t.closest('[data-desk-notes]')) { deskState.deskNotesAll = !deskState.deskNotesAll; render(); return; }
    if (t.closest('[data-desk-clear]')) { deskChecked.clear(); render(); return; }
    if (t.closest('[data-desk-go]')) {
      const dogs = [...deskChecked].map(k => appState.allDogs.find(d => walkKey(d) === k)).filter(Boolean);
      deskChecked.clear();
      if (dogs.length) BQWalkUI.setWalked(dogs, true);
      render();
    }
  });
  main.addEventListener('change', e => {
    if (!deskOn() || appState.activeTab !== 'walk') return;
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
    const slot = main.querySelector('.desk-batch-slot');
    if (slot) slot.innerHTML = deskBatchHtml();
    const all = main.querySelector('[data-desk-all]');
    if (all) { const boxes = [...main.querySelectorAll('[data-desk-check]')]; all.checked = boxes.length > 0 && boxes.every(b => b.checked); }
  });
  main.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !deskOn() || appState.activeTab !== 'walk' || !e.target.matches('[data-desk-check], [data-desk-all]')) return;
    const go = main.querySelector('[data-desk-go]');
    if (go) { e.preventDefault(); go.focus(); }
  });
}
}

export { DESK_MEDIA, deskOn, DESK_ZONES, deskZoneOf, deskBucket, deskNoteParts, deskChecked, deskNatural, deskSorted, deskSortDir, deskBriefHtml, deskToolsHtml, deskDays, deskDayWalk, deskLoadWalks, deskRowHtml, deskTableHtml, deskSideHtml, deskBatchHtml, deskWalkHtml, deskClearChecked, deskPlaceTabs, startDesk };
export { deskState } from './page-state.js';
