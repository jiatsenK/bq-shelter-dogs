import { appState, groupStageState } from './page-state.js';
import { applyDogsData, effectiveWalkDate, esc, icon, init, loadDogsData, loadWalkerName, matchesSearch, photoThumbSrc, render, restOf, showDetail, walkKey, walkRegistration, walkedNow } from './app.js';
import { BQDates } from './dates.js';
import { BQWalkUI } from './walk-ui.js';
import { BQApi } from './api.js';

// #374：命名群用試算表欄號識別；登記與今日紀錄共用 app.js 的能力。

groupStageState.groupStageData = null;
groupStageState.groupRead = null;
groupStageState.groupReadError = false;
groupStageState.groupRevision = 0; // 寫群組前開始的讀取，不得覆蓋試算表寫入後讀回的內容。
groupStageState.groupRegistrationIdentity = '';
groupStageState.groupColumn = null;
groupStageState.groupExcept = false;
const groupExcluded = new Set();

groupStageState.groupBusy = false;
groupStageState.groupFeedback = '';
groupStageState.groupForm = null;
groupStageState.groupManage = false;
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
function groupBlocked(dog) {
  return dog.unavailable ? '主清單無法唯一對應' : restOf(dog) ? '休養中' : /勿[溜遛蹓]|不可帶出|不要[溜遛蹓]|禁止[溜遛蹓]/.test(dog.note || '') ? '暫停帶出' : '';
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
function groupSummary(dogs) {
  if (!dogs.length) return '這一群還沒有狗';
  const dates = dogs.map(d => groupDateLabel(d));
  return dates.every(d => d === dates[0]) && /溜過$/.test(dates[0]) ? `${dogs.length} 隻${dates[0].replace('溜過', '都溜過')}` : dogs.map((d, i) => `${d.name}${dates[i]}`).join('；');
}
function receiveGroupData(data) {
  if (data.groupReadRevision !== undefined && data.groupReadRevision !== groupStageState.groupRevision) return false;
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
      applyDogsData(data);
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
function groupTile(dog, index, rear) {
  const blocked = groupBlocked(dog);
  const excluded = groupExcluded.has(dog.name);
  return `<button type="button" class="gw-dog${excluded ? ' excluded' : ''}${appState.searchQuery.trim() && !matchesSearch(dog, appState.searchQuery.trim()) ? ' miss' : ''}" data-gw-dog="${index}" ${rear ? 'tabindex="-1"' : ''} ${!rear && groupStageState.groupExcept ? `aria-pressed="${excluded}"` : ''} aria-label="${esc(dog.name)}，${esc(blocked || groupDateLabel(dog))}${groupStageState.groupExcept ? excluded ? '，已排除，點選恢復' : '，點選排除' : '，查看精確日期'}"><span class="gw-tile"><span class="gw-cage">${esc(dog.cage || '待確認')}</span><span class="gw-photo">${dog.id ? `<img src="${esc(photoThumbSrc(dog))}" alt="" draggable="false" onerror="this.hidden=true">` : ''}</span><strong>${esc(dog.name)}</strong></span>${dog.unavailable ? '' : BQWalkUI.walkSyncHtml(dog)}</button>`;
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
  const searchNote = !query ? '' : hits.length ? (hits.length > 1 ? `有 ${hits.length} 群有「${query}」，用下方箭頭切換` : '') : `沒有狗群有「${query}」`;
  const group = currentGroup();
  const dogs = groupDogs(group);
  const index = groups.indexOf(group);
  const selected = dogs.filter(d => !groupExcluded.has(d.name) && !groupBlocked(d));
  // 比照溜狗表的「溜了／已溜」：這群可登記的狗今天都溜了，按鈕就變「已溜」，再按一次復原（只撤這支手機寫的）
  const walkable = dogs.filter(d => !groupBlocked(d));
  const done = !groupStageState.groupExcept && walkable.length > 0 && walkable.every(d => walkedNow(d));
  const undoable = done ? walkable.filter(d => BQWalkUI.sheetUndoable(d)) : [];
  const walkBtn = done
    ? `<button type="button" id="gwWalk" class="done" data-gw-action="undo" aria-label="這群今天已溜，按一下取消" ${!undoable.length || groupStageState.groupBusy ? 'disabled' : ''}>${icon('tick')}${groupStageState.groupBusy ? '處理中…' : `已溜 · ${walkable.length} 隻`}</button>`
    : `<button type="button" id="gwWalk" ${!selected.length || groupStageState.groupBusy ? 'disabled' : ''}>${groupStageState.groupBusy ? '登記中…' : groupStageState.groupExcept ? `登記其餘 ${selected.length} 隻` : `整群溜了 · ${selected.length} 隻`}</button><button type="button" data-gw-action="except" aria-pressed="${groupStageState.groupExcept}">${groupStageState.groupExcept ? '取消' : '有狗沒溜'}</button>`;
  const layers = group ? `<div class="gw-layer front" data-column="${group.column}"><div class="gw-cards">${dogs.map((d, i) => groupTile(d, i, false)).join('')}<button type="button" class="gw-dog gw-add" data-gw-action="add" aria-label="加入狗"><span class="gw-tile">＋</span></button></div></div>` : '';
  return `<section id="groupPage" data-navigation-scope aria-busy="${groupStageState.groupBusy}">
    <div class="gw-heading"><h2>${esc(group?.label || '還沒有狗群')}<small>${dogs.length} 隻</small></h2><button type="button" data-gw-action="manage" aria-expanded="${groupStageState.groupManage}" aria-controls="gwManage">管理</button></div>
    ${searchNote ? `<p class="gw-search-note" role="status">${esc(searchNote)}</p>` : ''}
    <div id="gwManage" class="gw-manage" ${groupStageState.groupManage ? '' : 'hidden'}><button type="button" data-gw-action="create">＋狗群</button>${dogs.map(d => `<button type="button" data-gw-remove="${esc(d.name)}">移出 ${esc(d.name)}</button>`).join('')}</div>
    ${groupFormHtml() /* 輸入框開在按鈕所在的群組上方，不把人帶到頁面下方（#388） */}

    <div class="gw-stage-wrap"><div id="groupStage" class="gw-stage" style="--rows:${Math.max(1, Math.ceil((dogs.length + 2) / 4))}" aria-label="目前狗群">${layers}</div></div>
    <div class="gw-pages"><span>${groups.length ? index + 1 : 0} / ${groups.length}</span></div>
    <p id="gwFeedback" role="status">${esc(groupStageState.groupBusy ? '處理中…' : groupStageState.groupFeedback)}</p>
    ${group ? `<p class="gw-restrictions">${dogs.some(groupBlocked) ? `不登記：${dogs.filter(groupBlocked).map(d => `${esc(d.name)}（${esc(groupBlocked(d))}）`).join('、')}` : ''}</p>` : ''}
    <div class="gw-secondary-actions">
    ${groupRegistrations.get(groupStageState.groupColumn)?.successful.length ? `<button type="button" class="bar-btn" data-gw-action="companions" ${groupStageState.groupBusy ? 'disabled' : ''}>＋一起溜的人</button>` : ''}
    ${groupRegistrations.get(groupStageState.groupColumn)?.result.retryDogs.length ? `<button type="button" class="bar-btn" data-gw-action="retry-walk" ${groupStageState.groupBusy ? 'disabled' : ''}>再試一次</button>` : ''}
    </div>
    <p id="gwSource" class="section-hint" role="status">${/* 讀取時間只留頁首右上角（#444）；這裡只說背景檢查的狀態 */ groupStageState.groupRead ? '檢查中…' : groupStageState.groupReadError ? '檢查失敗，保留先前內容' : ''}${groupStageState.groupReadError ? '<button type="button" data-gw-action="retry">重新讀取</button>' : ''}</p>
    ${group ? `<div class="gw-walkbar"><button type="button" class="gw-side prev" data-gw-step="-1" aria-label="上一群" ${groups.length < 2 ? 'disabled' : ''}>${icon('back')}</button><div class="gw-actions">${walkBtn}</div><button type="button" class="gw-side next" data-gw-step="1" aria-label="下一群" ${groups.length < 2 ? 'disabled' : ''}>${icon('chevron')}</button></div>` : '' /* 「溜了」那排放最後、手機黏在底部分類列上方，換群箭頭不隨狗數移動（#443） */}
  </section>`;
}
function groupFormHtml() {
  if (!groupStageState.groupForm) return '';
  return `<form id="gwForm" class="gw-form"><h3>${groupStageState.groupForm.op === 'create' ? '建立狗群' : '加入狗'}</h3>${groupStageState.groupForm.op === 'create' ? `<label>群名<input name="label" required maxlength="20" value="${esc(groupStageState.groupForm.label || '')}"></label>` : ''}<label>狗名<input name="name" required maxlength="30" list="gwNames" value="${esc(groupStageState.groupForm.name || '')}"></label><datalist id="gwNames">${appState.allDogs.map(d => `<option value="${esc(d.name)}">`).join('')}</datalist><button type="submit">${groupStageState.groupBusy ? '寫入中…' : '儲存'}</button><button type="button" data-gw-action="cancel-form">取消</button></form>`;
}
function resetGroupSelection() { groupStageState.groupManage = false; groupStageState.groupExcept = false; groupExcluded.clear(); groupStageState.groupForm = null; groupStageState.groupFeedback = ''; }
function changeGroup(step) {
  if (groupStageState.groupBusy) return;
  const groups = namedGroups();
  // 頭尾相接（K 2026-10-17）：最後一群再按下一群回到第一群，反之亦然
  if (groups.length < 2) return;
  const next = groups[(groups.indexOf(currentGroup()) + step + groups.length) % groups.length];
  const previous = new Map([...document.querySelectorAll('.gw-layer')].map(el => [el.dataset.column, { transform: getComputedStyle(el).transform, opacity: getComputedStyle(el).opacity }]));
  groupStageState.groupColumn = next.column; resetGroupSelection(); render();
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) document.querySelectorAll('.gw-layer').forEach(el => {
    const before = previous.get(el.dataset.column);
    if (before) el.animate([before, { transform: getComputedStyle(el).transform, opacity: getComputedStyle(el).opacity }], { duration: 320, easing: 'cubic-bezier(.16,1,.3,1)' });
  });
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
async function writeGroup(body) {
  if (groupStageState.groupBusy) return false;
  const editor = loadWalkerName();
  if (!editor) { groupStageState.groupFeedback = '請先在「我溜過」選好你的名字再編輯'; render(); return false; }
  groupStageState.groupRevision++;
  groupStageState.groupBusy = true; render();
  try {
    const r = await BQApi.saveGroup({ ...body, editor });
    if (r.error === 'network' || !r.data) throw new Error(r.message);
    const out = r.data;
    if (!r.ok || !out.ok || !Number.isInteger(out.group?.column) || !Array.isArray(out.group.names)) throw new Error(out.error || '寫入失敗');
    // 使用既有 API 從試算表讀回的群，不以送出內容樂觀修改。
    const groups = groupStageState.groupStageData.groups;
    const i = groups.findIndex(g => g.column === out.group.column);
    if (i < 0) groups.push(out.group); else groups[i] = out.group;
    groups.sort((a, b) => a.column - b.column);
    groupStageState.groupRevision++;
    groupStageState.groupStageData.checkedAt = Date.now();
    groupStageState.groupReadError = false;
    groupStageState.groupColumn = out.group.column;
    resetGroupSelection(); groupStageState.groupFeedback = out.status === 'already' ? '這隻狗本來就在這一群' : '狗群已更新';
    return true;
  } catch (e) { groupStageState.groupFeedback = `${e.message || '寫入失敗'}，請重試`; return false; }
  finally { groupStageState.groupBusy = false; render(); }
}
const groupMain = document.getElementById('main');

export { groupExcluded, groupRegistrations, namedGroups, currentGroup, groupDogs, groupBlocked, groupDateLabel, groupSummary, receiveGroupData, loadGroupStage, refreshGroupStage, groupTile, groupStageHtml, groupFormHtml, resetGroupSelection, changeGroup, registerGroupWalk, undoGroupWalk, writeGroup, groupMain };
export { groupStageState } from './page-state.js';

export function bindGroups() {
  groupMain.addEventListener('click', e => {
    if (appState.activeTab !== 'groups' || appState.analysisOpen || groupStageState.groupBusy) return;
    if (e.target.closest('[data-gw-action="retry"]')) {
      if (appState.loadState === 'error') init();
      return loadGroupStage(true);
    }
    if (!e.target.closest('#groupPage')) return;
    const step = e.target.closest('[data-gw-step]');
    if (step) return changeGroup(Number(step.dataset.gwStep));
    const dogButton = e.target.closest('[data-gw-dog]');
    if (dogButton) {
      const dog = groupDogs(currentGroup())[Number(dogButton.dataset.gwDog)];
      if (groupStageState.groupExcept) {
        groupExcluded.has(dog.name) ? groupExcluded.delete(dog.name) : groupExcluded.add(dog.name);
        render(); document.querySelector(`.front [data-gw-dog="${dogButton.dataset.gwDog}"]`)?.focus({ preventScroll: true });
      } else if (!dog.unavailable) showDetail(dog);
      return;
    }
    const remove = e.target.closest('[data-gw-remove]');
    if (remove && confirm(`把「${remove.dataset.gwRemove}」移出「${currentGroup().label}」？`)) return writeGroup({ op: 'remove', column: groupStageState.groupColumn, name: remove.dataset.gwRemove });
    const action = e.target.closest('[data-gw-action]')?.dataset.gwAction;
    if (action === 'companions') return BQWalkUI.openWithSheet(groupRegistrations.get(groupStageState.groupColumn)?.successful || []);
    if (action === 'retry-walk') return registerGroupWalk(true);
    if (action === 'undo') return undoGroupWalk();
    if (e.target.closest('#gwWalk')) return registerGroupWalk();
    if (action === 'manage') { groupStageState.groupManage = !groupStageState.groupManage; render(); document.querySelector('[data-gw-action="manage"]')?.focus({ preventScroll: true }); }
    if (action === 'except') { groupStageState.groupExcept = !groupStageState.groupExcept; groupExcluded.clear(); groupStageState.groupFeedback = ''; render(); document.querySelector('[data-gw-action="except"]')?.focus(); }
    if (action === 'add' || action === 'create') { groupStageState.groupManage = false; groupStageState.groupForm = { op: action, column: groupStageState.groupColumn }; render(); document.querySelector('#gwForm input')?.focus(); }
    if (action === 'cancel-form') { groupStageState.groupForm = null; render(); document.querySelector('.front [data-gw-action="add"]')?.focus({ preventScroll: true }); }
  });
  groupMain.addEventListener('input', e => {
    if (e.target.closest('#gwForm') && groupStageState.groupForm) groupStageState.groupForm[e.target.name] = e.target.value;
  });
  groupMain.addEventListener('submit', e => {
    if (e.target.id !== 'gwForm' || !groupStageState.groupForm) return;
    e.preventDefault();
    const form = e.target;
    groupStageState.groupForm.name = form.elements.name.value.trim();
    if (form.elements.label) groupStageState.groupForm.label = form.elements.label.value.trim();
    if (appState.allDogs.filter(d => d.name === groupStageState.groupForm.name).length !== 1) { groupStageState.groupFeedback = '請選擇主清單中可唯一對應的狗名'; render(); return; }
    writeGroup({ ...groupStageState.groupForm }).then(() => document.querySelector('#gwForm input, .front [data-gw-action="add"]')?.focus({ preventScroll: true }));
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
