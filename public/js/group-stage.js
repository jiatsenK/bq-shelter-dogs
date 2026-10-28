import { appState, deskState, groupStageState } from './page-state.js';
import { applyDogsData, dayChip, effectiveWalkDate, init, loadDogsData, loadWalkerName, photoThumbSrc, render, restOf, sexMark, walkRegistration, walkedNow } from './app.js';
import { showDetail } from './detail.js';
import { esc, highlightNote, icon, matchesSearch } from './ui-kit.js';
import { specialFlag, walkKey } from './dog-status.js';
import { BQDates } from './dates.js';
import { BQWalkUI } from './walk-ui.js';
import { deskDayWalk, deskDays, deskLoadWalks, deskOn } from './desk.js';
// #474：狗群名單只在試算表改；網站保留查看與整群溜狗登記。

// #374：命名群用試算表欄號識別；登記與今日紀錄共用 app.js 的能力。

groupStageState.groupStageData = null;
groupStageState.groupRead = null;
groupStageState.groupReadError = false;
groupStageState.groupRegistrationIdentity = '';
groupStageState.groupColumn = null;
groupStageState.groupExcept = false;
const groupExcluded = new Set();

groupStageState.groupBusy = false;
groupStageState.groupFeedback = '';
groupStageState.groupSearchSeen = '';
const groupRegistrations = new Map();

function namedGroups() { return (groupStageState.groupStageData?.groups || []).filter(g => g.label); }
function currentGroup() { return namedGroups().find(g => g.column === groupStageState.groupColumn) || namedGroups()[0]; }
function groupDogs(group) {
  return (group?.names || []).map(name => {
    const matches = appState.allDogs.filter(d => d.name === name);
    return matches.length === 1 ? matches[0] : { name, unavailable: true };
  });
}
// 只擋對不到的狗和休養中；備註寫勿溜等警示字照樣登記、只顯示警示（K 2026-10-29：溜狗表、電腦版、常溜狗群同一個規則）
function groupBlocked(dog) {
  return dog.unavailable ? '主清單無法唯一對應' : restOf(dog) ? '休養中' : '';
}
function groupDateLabel(dog, now = new Date()) {
  if (dog.unavailable) return '資料無法確認';
  if (groupBlocked(dog)) return groupBlocked(dog);
  const date = effectiveWalkDate(dog, now);
  if (!date) return '沒有溜狗紀錄';
  const ymd = BQDates.localDateKey(date);
  // 用台灣日曆日計算，避免不同時區與日光節約差異。
  const taiwan = BQDates.taipeiToday(now);
  const day = Math.round((Date.parse(taiwan) - Date.parse(ymd)) / 86400000);
  return day === 0 ? '今天溜過' : day === 1 ? '昨天溜過' : day === 2 ? '前天溜過' : day > 2 ? `${ymd.replaceAll('-', '/')} 溜過` : '日期無法確認';
}
function receiveGroupData(data) {
  const groups = data.groupColumns;
  if (!Array.isArray(groups) || groups.some(g => !g || !Number.isInteger(g.column) || typeof g.label !== 'string' || !Array.isArray(g.names) || g.names.some(n => typeof n !== 'string')) || new Set(groups.map(g => g.column)).size !== groups.length) {
    groupStageState.groupReadError = true;
    if (groupStageState.groupStageData?.state !== 'ready') groupStageState.groupStageData = { state: 'error', groups: [] };
    return false;
  }
  groupStageState.groupStageData = { state: 'ready', groups, checkedAt: Date.now(), syncedAt: data.syncedAt };
  groupStageState.groupReadError = false;
  groupStageState.groupColumn = currentGroup()?.column ?? null;
  return true;
}
async function loadGroupStage(retry = false) {
  // 首次由 init 讀回同一份資料；切頁不再另向 api/dogs 抓一次。
  if (!retry) { groupStageState.groupStageData ||= { state: 'loading', groups: [] }; return; }
  if (groupStageState.groupRead) return groupStageState.groupRead;
  groupStageState.groupRead = (async () => {
    try {
      const data = await loadDogsData();
      if (!receiveGroupData(data)) throw new Error('狗群格式無法確認');
      applyDogsData(data, { groupCheck: true });
      return true;
    } catch (e) {
      groupStageState.groupReadError = true;
      if (groupStageState.groupStageData?.state !== 'ready') groupStageState.groupStageData = { state: 'error', groups: [] };
      return false;
    } finally {
      groupStageState.groupRead = null;
      if (appState.activeTab === 'groups') render();
    }
  })();
  if (appState.activeTab === 'groups') render();
  return groupStageState.groupRead;
}
function refreshGroupStage() {
  if (groupStageState.groupStageData?.state === 'ready' && Date.now() - groupStageState.groupStageData.checkedAt >= 30000 && !groupStageState.groupBusy) loadGroupStage(true);
}
// #738：一列一隻：天數色籤（同溜狗表列表）｜照片｜名字＋性別、下一行籠位；整列點開詳細資訊。
// 按「有狗沒溜」後才在右邊出現勾（K 2026-10-28）：預設全勾，點一隻拿掉勾＝這隻沒溜、不登記
function groupTile(dog, index, today) {
  const blocked = groupBlocked(dog);
  const excluded = groupExcluded.has(dog.name);
  // 警示備註（勿溜、攻擊…）跟溜狗表一樣放原文、命中字標紅；不擋登記，按「有狗沒溜」可以拿掉這隻
  const flag = dog.unavailable ? null : specialFlag(dog.note);
  return `<button type="button" class="gw-dog${excluded ? ' excluded' : ''}${flag ? ' flagged' : ''}${appState.searchQuery.trim() && !matchesSearch(dog, appState.searchQuery.trim()) ? ' miss' : ''}" data-gw-dog="${index}" ${groupStageState.groupExcept ? `aria-pressed="${excluded}"` : ''} aria-label="${esc(dog.name)}，${esc(blocked || groupDateLabel(dog))}${flag ? `，注意：${esc(dog.note)}` : ''}${groupStageState.groupExcept ? excluded ? '，已排除，點選恢復' : '，點選排除' : '，查看精確日期'}">${dayChip(dog, today)}<span class="gw-photo">${dog.id ? `<img src="${esc(photoThumbSrc(dog))}" alt="" draggable="false" onerror="this.hidden=true">` : ''}</span><span class="gw-who"><strong class="gw-name">${esc(dog.name)}${dog.unavailable ? '' : sexMark(dog)}</strong><span class="gw-cage">${esc(dog.cage || '待確認')}</span>${flag ? `<span class="gw-warn">${icon('warn')}<span>${highlightNote(dog.note, flag.terms)}</span></span>` : ''}${dog.unavailable ? '' : BQWalkUI.walkSyncHtml(dog)}</span>${groupStageState.groupExcept && !blocked ? `<span class="gw-check${excluded ? '' : ' on'}" aria-hidden="true"></span>` : ''}</button>`;
}
function groupStageHtml() {
  const identity = loadWalkerName();
  if (identity !== groupStageState.groupRegistrationIdentity) { groupRegistrations.clear(); groupStageState.groupRegistrationIdentity = identity; }
  if (!groupStageState.groupStageData) loadGroupStage();
  const data = groupStageState.groupStageData;
  if (data.state !== 'ready' || appState.loadState !== 'ready') return `<div class="status-msg">${data.state === 'error' || appState.loadState === 'error' ? '讀不到狗群，請重新讀取。<button type="button" data-gw-action="retry">重新讀取</button>' : '狗群讀取中…'}</div>`;
  const groups = namedGroups();
  // 搜尋狗名（K 2026-10-17）：跳到有這隻狗的群，其他狗變淡；目前這群就有的話不換群
  const query = appState.searchQuery.trim();
  const hits = query ? groups.filter(g => g.names.some(n => matchesSearch({ name: n }, query))) : [];
  // 只在搜尋字改變時跳群，之後用箭頭切到別群不會被拉回來
  if (query !== groupStageState.groupSearchSeen) { groupStageState.groupSearchSeen = query; if (hits.length && !hits.includes(currentGroup())) { groupStageState.groupColumn = hits[0].column; resetGroupSelection(); } }
  if (deskOn()) return groupDeskHtml(groups, hits, query);
  const searchNote = !query ? '' : hits.length ? (hits.length > 1 ? `有 ${hits.length} 群有「${query}」，用群名旁的箭頭切換` : '') : `沒有狗群有「${query}」`;
  const group = currentGroup();
  const dogs = groupDogs(group);
  const today = new Date();
  const index = groups.indexOf(group);
  const { walkDogs: selected, done, undoable } = groupWalkState(dogs, groupStageState.groupExcept);
  const walkBtn = done
    ? `<button type="button" id="gwWalk" class="done" data-gw-action="undo" aria-label="這群今天已溜，按一下取消" ${!undoable.length || groupStageState.groupBusy ? 'disabled' : ''}>${icon('tick')}${groupStageState.groupBusy ? '處理中…' : '已溜'}</button>`
    : `<button type="button" id="gwWalk" ${!selected.length || groupStageState.groupBusy ? 'disabled' : ''}>${groupStageState.groupBusy ? '登記中…' : groupStageState.groupExcept ? `溜了 ${selected.length} 隻` : '整群溜了'}</button><button type="button" data-gw-action="except" aria-pressed="${groupStageState.groupExcept}">${groupStageState.groupExcept ? '取消' : '有狗沒溜'}</button>`;
  // .gw-layer.front 的 data-column 標出目前這群（換群、測試靠它確認）；沒有另外的樣式
  const layers = group ? `<div class="gw-layer front" data-column="${group.column}"><div class="gw-cards">${dogs.map((d, i) => groupTile(d, i, today)).join('')}</div></div>` : '';
  // D 版（K 2026-10-28）：換群箭頭在群名兩側，位置固定、不隨狗數移動（#443）；
  // 「整群溜了」接在最後一隻狗下面，狗多到超出畫面時手機黏在底部分類列上方
  return `<section id="groupPage" data-navigation-scope aria-busy="${groupStageState.groupBusy}">
    <div class="gw-heading">${group ? `<button type="button" class="gw-side prev" data-gw-step="-1" aria-label="上一群" ${groups.length < 2 ? 'disabled' : ''}>${icon('back')}</button>` : ''}<h2>${esc(group?.label || '還沒有狗群')}<small>${dogs.length} 隻 · 第 ${groups.length ? index + 1 : 0}／${groups.length} 群</small></h2>${group ? `<button type="button" class="gw-side next" data-gw-step="1" aria-label="下一群" ${groups.length < 2 ? 'disabled' : ''}>${icon('chevron')}</button>` : ''}</div>
    ${searchNote ? `<p class="gw-search-note" role="status">${esc(searchNote)}</p>` : ''}
    <p class="section-hint">要改請到試算表「常遛狗群」分頁</p>

    <div id="groupStage" class="gw-stage" aria-label="目前狗群">${layers}</div>
    ${group ? `<div class="gw-walkbar"><div class="gw-actions">${walkBtn}</div></div>` : ''}
    <p id="gwFeedback" role="status">${esc(groupStageState.groupBusy ? '處理中…' : groupStageState.groupFeedback)}</p>
    ${group ? `<p class="gw-restrictions">${dogs.some(groupBlocked) ? `不登記：${dogs.filter(groupBlocked).map(d => `${esc(d.name)}（${esc(groupBlocked(d))}）`).join('、')}` : ''}</p>` : ''}
    <div class="gw-secondary-actions">
    ${groupRegistrations.get(groupStageState.groupColumn)?.successful.length ? `<button type="button" class="bar-btn" data-gw-action="companions" ${groupStageState.groupBusy ? 'disabled' : ''}>＋一起溜的人</button>` : ''}
    ${groupRegistrations.get(groupStageState.groupColumn)?.result.retryDogs.length ? `<button type="button" class="bar-btn" data-gw-action="retry-walk" ${groupStageState.groupBusy ? 'disabled' : ''}>再試一次</button>` : ''}
    </div>
    ${groupSourceHtml()}
  </section>`;
}
// 比照溜狗表的「溜了／已溜」：這群可登記的狗今天都溜了，按鈕就變「已溜」，再按一次復原（只撤這支手機寫的）。手機、電腦版共用
// （有狗沒溜以外 groupExcluded 一定是空的：切換、換群、登記成功都會清掉）
function groupWalkState(dogs, except) {
  const walkable = dogs.filter(d => !groupBlocked(d));
  const done = !except && walkable.length > 0 && walkable.every(d => walkedNow(d));
  return { walkDogs: walkable.filter(d => !groupExcluded.has(d.name)), done, undoable: done ? walkable.filter(d => BQWalkUI.sheetUndoable(d)) : [] };
}
function groupSourceHtml() {
  return `<p id="gwSource" class="section-hint" role="status">${/* 讀取時間只留頁首右上角（#444）；這裡只說背景檢查的狀態 */ groupStageState.groupRead ? '檢查中…' : groupStageState.groupReadError ? '檢查失敗，保留先前內容' : ''}${groupStageState.groupReadError ? '<button type="button" data-gw-action="retry">重新讀取</button>' : ''}</p>`;
}
// 電腦版（≥1100px，K 2026-10-29）：所有群並排成群卡、右欄 300px 放選中那一群；選中＝groupColumn，登記、復原、有狗沒溜跟手機同一套。
// 每張群卡都有「整群溜了」；只有選中那一群帶 #gwWalk、能「有狗沒溜」、顯示登記中
function groupWalkButtons(dogs, selectedGroup) {
  const except = selectedGroup && groupStageState.groupExcept;
  const busyHere = selectedGroup && groupStageState.groupBusy; // 按鈕字只在選中的群換成登記中；登記中時每一群的按鈕都停用
  const { walkDogs, done, undoable } = groupWalkState(dogs, except);
  const id = selectedGroup ? ' id="gwWalk"' : '';
  return done
    ? `<button type="button"${id} class="gw-walk done" data-gw-action="undo" aria-label="這群今天已溜，按一下取消" ${!undoable.length || groupStageState.groupBusy ? 'disabled' : ''}>${icon('tick')}${busyHere ? '處理中…' : '已溜'}</button>`
    : `<button type="button"${id} class="gw-walk" data-gw-action="walk" ${!walkDogs.length || groupStageState.groupBusy ? 'disabled' : ''}>${busyHere ? '登記中…' : except ? `溜了 ${walkDogs.length} 隻` : '整群溜了'}</button><button type="button" data-gw-action="except" aria-pressed="${!!except}" ${groupStageState.groupBusy ? 'disabled' : ''}>${except ? '取消' : '有狗沒溜'}</button>`;
}
function focusSelectedGroup() { document.querySelector('#groupPage .gw-group.selected [data-gw-pick]')?.focus({ preventScroll: true }); }
// 電腦版一列一隻（40～46px）：天數色籤｜籠位｜狗名＋性別，警示原文在名字下面；選中的群按「有狗沒溜」才出現勾
function groupDeskRow(dog, index, today, selectedGroup) {
  const blocked = groupBlocked(dog);
  const except = selectedGroup && groupStageState.groupExcept;
  const excluded = except && groupExcluded.has(dog.name);
  const flag = dog.unavailable ? null : specialFlag(dog.note);
  const query = appState.searchQuery.trim();
  return `<button type="button" class="gw-dog${excluded ? ' excluded' : ''}${flag ? ' flagged' : ''}${query && !matchesSearch(dog, query) ? ' miss' : ''}" data-gw-dog="${index}" ${except ? `aria-pressed="${excluded}"` : ''} aria-label="${esc(dog.name)}，${esc(blocked || groupDateLabel(dog))}${flag ? `，注意：${esc(dog.note)}` : ''}${except ? excluded ? '，已排除，點選恢復' : '，點選排除' : '，查看詳細資訊'}">${dayChip(dog, today)}<span class="gw-cage">${esc(dog.cage || '待確認')}</span><span class="gw-who"><strong class="gw-name">${esc(dog.name)}${dog.unavailable ? '' : sexMark(dog)}</strong>${flag ? `<span class="gw-warn">${icon('warn')}<span>${highlightNote(dog.note, flag.terms)}</span></span>` : ''}${dog.unavailable ? '' : BQWalkUI.walkSyncHtml(dog)}</span>${except && !blocked ? `<span class="gw-check${excluded ? '' : ' on'}" aria-hidden="true"></span>` : ''}</button>`;
}
function groupDeskCard(group, today, selectedGroup, hit) {
  const dogs = groupDogs(group);
  const reg = selectedGroup ? groupRegistrations.get(group.column) : null;
  const blocked = dogs.filter(groupBlocked);
  // .gw-layer.front 的 data-column 標出選中的群，跟手機同一個記號（測試、焦點靠它）
  return `<article class="gw-group${selectedGroup ? ' selected' : ''}${hit === false ? ' miss' : ''}" data-gw-column="${group.column}">
    <h3 class="gw-group-head"><button type="button" data-gw-pick aria-pressed="${selectedGroup}"><span>${esc(group.label)}</span><small>${dogs.length} 隻</small></button></h3>
    <div class="gw-layer${selectedGroup ? ' front' : ''}" data-column="${group.column}"><div class="gw-cards">${dogs.map((d, i) => groupDeskRow(d, i, today, selectedGroup)).join('')}</div></div>
    <div class="gw-actions">${groupWalkButtons(dogs, selectedGroup)}</div>
    ${selectedGroup ? `<p id="gwFeedback" role="status">${esc(groupStageState.groupBusy ? '處理中…' : groupStageState.groupFeedback)}</p>` : ''}
    ${blocked.length ? `<p class="gw-restrictions">不登記：${blocked.map(d => `${esc(d.name)}（${esc(groupBlocked(d))}）`).join('、')}</p>` : ''}
    ${reg?.successful.length || reg?.result.retryDogs.length ? `<div class="gw-secondary-actions">${reg.successful.length ? `<button type="button" class="bar-btn" data-gw-action="companions" ${groupStageState.groupBusy ? 'disabled' : ''}>＋一起溜的人</button>` : ''}${reg.result.retryDogs.length ? `<button type="button" class="bar-btn" data-gw-action="retry-walk" ${groupStageState.groupBusy ? 'disabled' : ''}>再試一次</button>` : ''}</div>` : ''}
  </article>`;
}
// 右欄：選中那一群近 30 天有幾天溜過、每隻各幾天（溜狗表「最近 30 天」同一份紀錄）、有警示的狗、名單在哪改
function groupDeskSideHtml(group, today) {
  if (!group) return '';
  const dogs = groupDogs(group).filter(d => !d.unavailable);
  const days = deskDays(today).map(d => BQDates.localDateKey(d));
  deskLoadWalks();
  const ready = !!deskState.deskWalkDays;
  // 每隻溜過的日子各算一次；「幾天有溜這群」是這些日子合起來
  const counts = ready ? dogs.map(d => ({ dog: d, on: days.filter(k => deskDayWalk(d, k, today).on) })) : [];
  const anyDays = new Set(counts.flatMap(c => c.on)).size;
  const first = ready && deskState.deskWalkFirst > days[0] ? deskState.deskWalkFirst : '';
  // 日期寫法同溜狗表「最近 30 天」頁尾（10/5）
  const since = first ? `${+first.slice(5, 7)}/${+first.slice(8)}` : '';
  const flagged = dogs.filter(d => specialFlag(d.note));
  return `<aside class="desk-side gw-side-col" aria-label="選中的群：${esc(group.label)}">
    <section class="ds-panel" aria-labelledby="gwsWalks">
      <h2 id="gwsWalks">${esc(group.label)}<small>近 30 天</small></h2>
      ${ready ? `<p class="gws-total"><b class="num">${anyDays}</b> 天有溜這群的狗${since ? `<small>紀錄從 ${since} 開始</small>` : ''}</p>
        <ol class="gws-counts">${counts.map(({ dog, on }) => `<li><button type="button" data-gw-open="${appState.allDogs.indexOf(dog)}">${esc(dog.name)}</button><span class="num">${on.length} 天</span></li>`).join('')}</ol>`
        : '<p class="ds-empty">溜狗紀錄讀取中…</p>'}
    </section>
    ${flagged.length ? `<section class="ds-panel" aria-labelledby="gwsWarn"><h2 id="gwsWarn">有警示的狗<small>${flagged.length} 隻</small></h2>
      <ul class="ds-rest gws-warn">${flagged.map(d => `<li><button type="button" data-gw-open="${appState.allDogs.indexOf(d)}">${esc(d.name)}</button><span>${highlightNote(d.note, specialFlag(d.note).terms)}</span></li>`).join('')}</ul></section>` : ''}
    <section class="ds-panel" aria-labelledby="gwsEdit"><h2 id="gwsEdit">狗群名單</h2><p class="ds-empty">要改請到試算表「常遛狗群」分頁</p></section>
  </aside>`;
}
function groupDeskHtml(groups, hits, query) {
  const today = new Date();
  const group = currentGroup();
  const note = !query ? '' : hits.length ? `有 ${hits.length} 群有「${query}」` : `沒有狗群有「${query}」`;
  return `<section id="groupPage" class="gw-desk" data-navigation-scope aria-busy="${groupStageState.groupBusy}">
    <div class="gw-desk-main">
      <div class="gw-desk-head"><h2>常溜狗群<small>${groups.length} 群</small></h2>${note ? `<p class="gw-search-note" role="status">${esc(note)}</p>` : ''}</div>
      ${groups.length ? `<div id="groupStage" class="gw-grid" aria-label="全部狗群">${groups.map(g => groupDeskCard(g, today, g === group, query ? hits.includes(g) : null)).join('')}</div>` : '<div class="status-msg">還沒有狗群</div>'}
      ${groupSourceHtml()}
    </div>
    ${groupDeskSideHtml(group, today)}
  </section>`;
}
// 從詳細資訊「看全部狗群」進來：停在有這隻狗的第一群（沒有就維持目前這群）
function focusGroupOf(name) {
  const hit = namedGroups().find(g => g.names.includes(name));
  if (hit && groupStageState.groupColumn !== hit.column) { groupStageState.groupColumn = hit.column; resetGroupSelection(); }
}
function resetGroupSelection() { groupStageState.groupExcept = false; groupExcluded.clear(); groupStageState.groupFeedback = ''; }
function changeGroup(step) {
  if (groupStageState.groupBusy) return;
  const groups = namedGroups();
  // 頭尾相接（K 2026-10-17）：最後一群再按下一群回到第一群，反之亦然
  if (groups.length < 2) return;
  const next = groups[(groups.indexOf(currentGroup()) + step + groups.length) % groups.length];
  groupStageState.groupColumn = next.column; resetGroupSelection(); render();
  if (deskOn()) return focusSelectedGroup();
  document.querySelector('#groupPage h2')?.setAttribute('tabindex', '-1');
  document.querySelector('#groupPage h2')?.focus({ preventScroll: true });
}
async function registerGroupWalk(retry = false) {
  if (groupStageState.groupBusy) return;
  if (!loadWalkerName()) { groupStageState.groupFeedback = '請先在「我溜過」選好你的名字再登記'; render(); return; }
  if (!BQWalkUI.sheetWillWrite()) { groupStageState.groupFeedback = '目前無法寫入試算表，請稍後再試；尚未登記'; render(); return; }
  const identity = loadWalkerName();
  const before = JSON.stringify(currentGroup());
  const columnBefore = groupStageState.groupColumn;
  groupStageState.groupBusy = true; render();
  const verified = await loadGroupStage(true);
  groupStageState.groupBusy = false;
  if (identity !== loadWalkerName()) {
    groupRegistrations.clear(); groupStageState.groupFeedback = '登記名字已變更，請確認後再登記'; render(); return;
  }
  if (!verified) { groupStageState.groupFeedback = '無法確認最新狗群，尚未登記，請重試'; render(); return; }
  if (columnBefore !== groupStageState.groupColumn || before !== JSON.stringify(currentGroup())) {
    groupRegistrations.delete(columnBefore);
    groupExcluded.clear(); groupStageState.groupExcept = false;
    groupStageState.groupFeedback = '狗群名單已變更，請確認後再登記'; render(); return;
  }
  const previous = groupRegistrations.get(groupStageState.groupColumn);
  const last = retry || previous?.result.retryDogs.length ? previous : null;
  const currentDogs = groupDogs(currentGroup());
  const retryDogs = last?.result.retryDogs.map(old => currentDogs.find(d => !d.unavailable && walkKey(d) === walkKey(old) && d.name === old.name));
  if (retryDogs?.some(d => !d || groupBlocked(d))) {
    groupStageState.groupFeedback = '待重試的狗目前無法登記，請確認狗群狀態'; render(); return;
  }
  const dogs = retryDogs || currentDogs.filter(d => !groupExcluded.has(d.name) && !groupBlocked(d));
  if (!dogs.length || dogs.some(BQWalkUI.walkPendingNow)) { render(); return; }
  const column = groupStageState.groupColumn;
  groupStageState.groupBusy = true;
  const pending = walkRegistration.register(dogs);
  appState.sheetQueue = pending;
  render();
  try {
    const result = await pending;
    const successful = [...new Set([...(last?.successful || []), ...result.successful])];
    groupRegistrations.set(column, { result, successful });
    groupStageState.groupFeedback = BQWalkUI.registrationText({ ...result, successful });
    if (result.successful.length === result.rows.length && !result.off) { groupStageState.groupExcept = false; groupExcluded.clear(); }
  } catch (e) { groupStageState.groupFeedback = '尚未確認登記結果，請重試'; }
  finally { groupStageState.groupBusy = false; render(); document.getElementById('gwWalk')?.focus({ preventScroll: true }); }
}
// 誤觸「整群溜了」：撤銷這一群今天由這支手機寫進試算表的紀錄（結果以試算表回應為準）
async function undoGroupWalk() {
  if (groupStageState.groupBusy) return;
  const dogs = groupDogs(currentGroup()).filter(d => !groupBlocked(d) && BQWalkUI.sheetUndoable(d));
  if (!dogs.length) return;
  groupStageState.groupBusy = true; groupStageState.groupFeedback = ''; render();
  try { groupStageState.groupFeedback = await BQWalkUI.undoSheetWalks(dogs); groupRegistrations.delete(groupStageState.groupColumn); }
  catch (e) { groupStageState.groupFeedback = '復原失敗，請重試；尚未確認復原'; }
  finally { groupStageState.groupBusy = false; render(); document.getElementById('gwWalk')?.focus({ preventScroll: true }); }
}
const groupMain = document.getElementById('main');

export { groupExcluded, groupRegistrations, namedGroups, currentGroup, groupDogs, groupBlocked, groupDateLabel, receiveGroupData, loadGroupStage, refreshGroupStage, groupTile, groupStageHtml, focusGroupOf, resetGroupSelection, changeGroup, registerGroupWalk, undoGroupWalk, groupMain };
export { groupStageState } from './page-state.js';

export function bindGroups() {
  groupMain.addEventListener('click', e => {
    if (appState.activeTab !== 'groups' || appState.analysisOpen || groupStageState.groupBusy) return;
    if (e.target.closest('[data-gw-action="retry"]')) {
      if (appState.loadState === 'error') init();
      return loadGroupStage(true);
    }
    if (!e.target.closest('#groupPage')) return;
    // 電腦版：點另一張群卡（群名、狗、按鈕都算）先選中那一群，再照手機的動作做
    const card = deskOn() && e.target.closest('[data-gw-column]');
    const switched = !!card && Number(card.dataset.gwColumn) !== groupStageState.groupColumn;
    if (switched) { groupStageState.groupColumn = Number(card.dataset.gwColumn); resetGroupSelection(); }
    if (switched && !e.target.closest('[data-gw-dog], [data-gw-action]')) { render(); return focusSelectedGroup(); }
    const open = e.target.closest('[data-gw-open]');
    if (open) return showDetail(appState.allDogs[Number(open.dataset.gwOpen)]);
    const step = e.target.closest('[data-gw-step]');
    if (step) return changeGroup(Number(step.dataset.gwStep));
    const dogButton = e.target.closest('[data-gw-dog]');
    if (dogButton) {
      const dog = groupDogs(currentGroup())[Number(dogButton.dataset.gwDog)];
      if (groupStageState.groupExcept) {
        groupExcluded.has(dog.name) ? groupExcluded.delete(dog.name) : groupExcluded.add(dog.name);
        render(); document.querySelector(`.front [data-gw-dog="${dogButton.dataset.gwDog}"]`)?.focus({ preventScroll: true });
      } else {
        if (switched) render();
        if (!dog.unavailable) showDetail(dog);
      }
      return;
    }
    const action = e.target.closest('[data-gw-action]')?.dataset.gwAction;
    if (action === 'companions') return BQWalkUI.openWithSheet(groupRegistrations.get(groupStageState.groupColumn)?.successful || []);
    if (action === 'retry-walk') return registerGroupWalk(true);
    if (action === 'undo') return undoGroupWalk();
    if (e.target.closest('#gwWalk') || action === 'walk') return registerGroupWalk();
    if (action === 'except') { groupStageState.groupExcept = !groupStageState.groupExcept; groupExcluded.clear(); groupStageState.groupFeedback = ''; render(); (document.querySelector('.gw-group.selected [data-gw-action="except"]') || document.querySelector('[data-gw-action="except"]'))?.focus(); }
  });
  groupMain.addEventListener('keydown', e => {
    if (!e.target.closest('#groupPage') || e.target.matches('input')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); changeGroup(e.key === 'ArrowRight' ? 1 : -1); }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && appState.activeTab === 'groups') refreshGroupStage();
  });
  window.addEventListener('online', () => { if (appState.activeTab === 'groups') refreshGroupStage(); });
  window.addEventListener('popstate', () => { if (appState.activeTab === 'groups') refreshGroupStage(); });
}
