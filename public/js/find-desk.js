import { appState, findState } from './page-state.js';
import { computeStatus, render, sexMark } from './app.js';
import { showDetail } from './detail.js';
import { esc, highlightNote, icon, searchKey } from './ui-kit.js';
import { AMBER_DAYS, specialFlag } from './dog-status.js';
import { deskDayTag, deskOn } from './desk.js';
import { FIND_MAP_TURN, FIND_ZONES, findCageOf, findList, findLongUnwalked, findMapCardHtml, findMapSvg, findMark, findMatches, findQueryStart, findZoneInfo, findZoneOf, whereKnown, whereOpen } from './find.js';

// 電腦版找狗（≥1100px，critique 2026-10-28 P1，K 2026-10-29 解除 480 單欄）：
// 上面一排工具列（平面圖／列表／★ 我的常溜，跟溜狗表「全表／最近 30 天」同一種文字分頁、放同一個位置），
// 平面圖撐滿主內容，右欄 300px 列出選中那一區（或那一籠、搜尋找到）的狗；列表是溜狗表那種 46px 一列的表格。
// 電腦版不放「溜了」：找狗是「在哪」，要登記在籠位小卡（在哪）、詳細資訊或溜狗表。手機照舊是 js/find.js 的 findPageHtml。

// 天數色籤：跟溜狗表全表同一套（desk.js deskDayTag）
const findDeskDayTag = (dog, today) => deskDayTag(computeStatus(dog, today));

// 籠位：平面圖上有的籠位是黑框標籤，點了開在哪小卡；對不到圖上的只寫字
function findDeskCage(dog, query) {
  const idx = appState.allDogs.indexOf(dog);
  return whereKnown(dog)
    ? `<button type="button" class="dr-cage" data-where data-dog-i="${idx}" aria-label="${esc(dog.name)} 在哪：${esc(dog.cage)}">${findMark(dog.cage, query)}</button>`
    : `<span class="dr-cage plain">${findMark(dog.cage, query) || '—'}</span>`;
}

function findDeskName(dog, query) {
  const flag = specialFlag(dog.note);
  return `<button type="button" class="df-name" data-df-open="${appState.allDogs.indexOf(dog)}" aria-haspopup="dialog">${findMark(dog.name, query)}</button>${sexMark(dog)}`
    + `${appState.favorites.isFav(dog) ? '<i class="fav-mark" role="img" aria-label="我的常溜">★</i>' : ''}`
    + `${flag ? `<span class="dr-warn" title="${esc(flag.keywords.join('、'))}">注意</span>` : ''}`;
}

// 右欄一隻狗一列：籠位｜狗名｜天數
function findDeskSideRow(dog, query, today) {
  return `<li class="df-row" data-df-dog="${appState.allDogs.indexOf(dog)}"><span class="df-cage">${findDeskCage(dog, query)}</span><span class="dr-name df-who">${findDeskName(dog, query)}</span>${findDeskDayTag(dog, today)}</li>`;
}

function findDeskSideList(title, sub, dogs, query, today, empty) {
  return `<section class="ds-panel df-panel" aria-labelledby="dfSideTitle">
    <h2 id="dfSideTitle">${title}<small>${sub}</small></h2>
    ${dogs.length ? `<ul class="df-rows">${dogs.map(d => findDeskSideRow(d, query, today)).join('')}</ul>` : `<p class="ds-empty">${empty}</p>`}
  </section>`;
}

// 平面圖時的右欄：選了區（或籠）列那裡的狗；搜尋列找到的狗；都沒有就列最久沒溜的狗
function findDeskSideHtml(query, today) {
  const selected = findState.findZone === 'all' ? null : findState.findZone;
  if (selected) {
    const z = findZoneInfo(selected);
    const list = findList(query).filter(d => !findState.findCage || findCageOf(d) === findState.findCage);
    const where = findState.findCage ? '這籠' : '這區';
    return findDeskSideList(`<i class="find-dot z-${z.key}"></i>${esc(findState.findCage ? `${z.name}・${findState.findCage}` : z.name)}`, `${list.length} 隻`, list, query, today,
      query ? `${where}找不到「${esc(query)}」` : findState.findCage ? '這籠目前沒有狗' : '這區目前沒有對應的籠位');
  }
  if (searchKey(query)) {
    const hits = findList(query, 'all');
    return findDeskSideList(`${icon('search')}「${esc(query)}」`, `找到 ${hits.length} 隻`, hits, query, today,
      '找不到。試試狗名的一個字、編號後四碼，或籠位（例：新A03）。');
  }
  return findDeskSideList('最久沒溜的狗', '點籠位看在哪', findLongUnwalked(today).slice(0, 10), query, today, `每隻狗都在 ${AMBER_DAYS} 天內溜過。`);
}

// 列表：照區分段的表格，一列 46px（溜狗表全表同一套），整列點了開詳細資訊、籠位點了開在哪
function findDeskTableHtml(query, today) {
  const fav = findState.findZone === 'fav';
  const list = findList(query);
  if (!list.length) {
    const where = findState.findZone === 'all' ? '' : '這區';
    return `<div class="status-msg">${!fav ? (query ? `${where}找不到「${esc(query)}」` : '這區目前沒有狗')
      : searchKey(query) ? `我的常溜裡找不到「${esc(query)}」`
      : '還沒有常溜的狗。<br>點狗名打開詳細資訊，按名字旁的「☆ 常溜」加進來。'}</div>`;
  }
  const groups = [];
  for (const d of list) {
    const z = findZoneOf(d);
    const last = groups[groups.length - 1];
    if (last && last.z === z) last.items.push(d); else groups.push({ z, items: [d] });
  }
  const row = d => {
    const flag = specialFlag(d.note);
    return `<tr class="dr" data-df-dog="${appState.allDogs.indexOf(d)}">
      <td class="dr-cagec">${findDeskCage(d, query)}</td>
      <td class="dr-name">${findDeskName(d, query)}</td>
      <td class="df-id num">${findMark(d.id, query)}</td>
      <td class="dr-dayc">${findDeskDayTag(d, today)}</td>
      <td class="dr-note"${d.note ? ` title="${esc(d.note)}"` : ''}><div>${d.note ? (flag ? highlightNote(d.note, flag.terms) : esc(d.note)) : ''}</div></td>
    </tr>`;
  };
  return `<div class="desk-sheet df-sheet"><table class="desk-table df-table">
    <thead><tr><th class="dr-cagec" scope="col">籠位</th><th class="dr-name" scope="col">狗名</th><th class="df-id" scope="col">編號</th><th class="dr-dayc" scope="col">天數</th><th class="dr-note" scope="col">備註（試算表）</th></tr></thead>
    ${groups.map(g => `<tbody><tr class="df-zone"><th colspan="5" scope="colgroup"><i class="find-dot z-${g.z}"></i>${esc(findZoneInfo(g.z).name)}<small>${g.items.length} 隻</small></th></tr>${g.items.map(row).join('')}</tbody>`).join('')}
  </table></div>`;
}

// 工具列：列表才有區域分頁（站在表格上緣那條線上）；右邊是顯示方式，跟溜狗表的「全表／最近 30 天」同一個位置
function findDeskToolsHtml(query, map) {
  const fav = findState.findZone === 'fav';
  const inQuery = appState.allDogs.filter(d => findMatches(d, query));
  const zones = FIND_ZONES.filter(z => appState.allDogs.some(d => findZoneOf(d) === z.key)).map(z => [z.key, z.short]);
  if (appState.allDogs.some(d => findZoneOf(d) === 'other')) zones.push(['other', '其他']);
  const chips = map || fav ? '' : `<div class="dt-chips" role="group" aria-label="區域">${[['all', '全部'], ...zones].map(([k, t]) => {
    const n = k === 'all' ? inQuery.length : inQuery.filter(d => findZoneOf(d) === k).length;
    return `<button type="button" class="dt-chip${findState.findZone === k ? ' on' : ''}" data-find-zone="${k}" aria-pressed="${findState.findZone === k}">${t}<small class="num">${n}</small></button>`;
  }).join('')}</div>`;
  const view = (k, t, on, n = '') => `<button type="button" data-df-view="${k}" class="${on ? 'on' : ''}" aria-pressed="${on}">${t}${n}</button>`;
  const hint = map ? (findState.findZone === 'all' ? '點一區放大看籠子，點籠子看那籠的狗' : '點籠子看那籠的狗，點狗名看詳細資訊')
    : fav ? '你標成常溜的狗' : '點一列看詳細資訊，點籠位看在哪';
  return `<div class="desk-tools df-tools">
    ${chips}<span class="dt-hint">${hint}</span>
    <div class="dt-view" role="group" aria-label="顯示方式">
      ${view('map', '平面圖', map)}${view('list', '列表', !map && !fav)}${view('fav', '★ 我的常溜', fav, `<small class="num">${inQuery.filter(appState.favorites.isFav).length}</small>`)}
    </div>
  </div>`;
}

// 列表時的右欄：小平面圖當區域選單（點一區只看那一區）
function findDeskZonesHtml(query) {
  const selected = FIND_ZONES.some(z => z.key === findState.findZone) ? findState.findZone : null;
  return `<section class="ds-panel df-panel" aria-labelledby="dfSideTitle">
    <h2 id="dfSideTitle">區域<small>點一區只看那一區</small></h2>
    <div class="df-minimap">${findMapSvg(selected, query, false, FIND_MAP_TURN, null, true)}</div>
  </section>`;
}

// js/app.js 的 renderMain 在寬螢幕、找狗時叫這個
function findDeskHtml(query) {
  findQueryStart(query);
  const today = new Date();
  const map = findState.findView === 'map' && findState.findZone !== 'fav';
  if (!map) findState.findMapShown = null; // 下次切回平面圖，從整張圖放大過去
  return `<h2 class="sr-only">找狗（電腦版）</h2><div class="desk-find ${map ? 'df-map' : 'df-list'}">
    <div class="df-main">${findDeskToolsHtml(query, map)}${map ? findMapCardHtml(query) : findDeskTableHtml(query, today)}</div>
    <aside class="desk-side df-side" aria-label="${map ? '這區的狗' : '區域'}">${map ? findDeskSideHtml(query, today) : findDeskZonesHtml(query)}</aside>
  </div>`;
}

// 找狗電腦版的點擊：區域分頁、平面圖的區和籠子照舊由 find.js bindFind 處理，這裡只管工具列、籠位、狗名
function bindFindDesk() {
  const main = document.getElementById('main');
  main.addEventListener('click', e => {
    if (appState.activeTab !== 'find' || !deskOn()) return;
    const t = e.target;
    const view = t.closest('[data-df-view]');
    if (view) {
      const k = view.dataset.dfView;
      if (view.classList.contains('on')) return; // 已經是這個檢視：不清掉選好的籠子
      findState.findView = k === 'map' ? 'map' : 'list';
      findState.findCage = null;
      if (k === 'fav') findState.findZone = 'fav';
      else if (findState.findZone === 'fav') findState.findZone = 'all';
      render();
      main.querySelector(`[data-df-view="${k}"]`)?.focus({ preventScroll: true });
      return;
    }
    const where = t.closest('[data-where][data-dog-i]');
    if (where) { whereOpen(appState.allDogs[Number(where.dataset.dogI)], where); return; }
    const open = t.closest('[data-df-open]');
    if (open) { showDetail(appState.allDogs[Number(open.dataset.dfOpen)]); return; }
    // 點這一列其他地方也開詳細資訊（跟溜狗表全表一樣）；正在選字不算
    const row = t.closest('[data-df-dog]');
    if (row && !t.closest('button, a, input') && !String(window.getSelection ? window.getSelection() : '').trim()) showDetail(appState.allDogs[Number(row.dataset.dfDog)]);
  });
}

export { findDeskHtml, bindFindDesk };
