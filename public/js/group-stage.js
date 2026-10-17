// #374：命名群用試算表欄號識別；登記與今日紀錄共用 app.js 的能力。
let groupStageData = null;
let groupColumn = null;
let groupExcept = false;
const groupExcluded = new Set();
let groupBusy = false;
let groupFeedback = '';
let groupForm = null;
let groupManage = false;
let groupSearchSeen = '';

function namedGroups() { return (groupStageData?.groups || []).filter(g => g.label); }
function currentGroup() { return namedGroups().find(g => g.column === groupColumn) || namedGroups()[0]; }
function groupDogs(group) {
  return (group?.names || []).map(name => {
    const matches = allDogs.filter(d => d.name === name);
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
  const ymd = localDateKey(date);
  // 用台灣日曆日計算，避免不同時區與日光節約差異。
  const taiwan = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const day = Math.round((Date.parse(taiwan) - Date.parse(ymd)) / 86400000);
  return day === 0 ? '今天溜過' : day === 1 ? '昨天溜過' : day === 2 ? '前天溜過' : day > 2 ? `${ymd.replaceAll('-', '/')} 溜過` : '日期無法確認';
}
function groupSummary(dogs) {
  if (!dogs.length) return '這一群還沒有狗';
  const dates = dogs.map(d => groupDateLabel(d));
  return dates.every(d => d === dates[0]) && /溜過$/.test(dates[0]) ? `${dogs.length} 隻${dates[0].replace('溜過', '都溜過')}` : dogs.map((d, i) => `${d.name}${dates[i]}`).join('；');
}
async function loadGroupStage(retry = false) {
  if (groupStageData && !retry) return;
  groupStageData = { state: 'loading', groups: [] };
  try {
    const res = await fetch('api/dogs', { cache: 'no-cache' });
    const out = await res.json();
    if (!res.ok || !Array.isArray(out.groupColumns)) throw new Error('讀不到狗群');
    const groups = out.groupColumns;
    if (groups.some(g => !Number.isInteger(g.column) || !Array.isArray(g.names)) || new Set(groups.map(g => g.column)).size !== groups.length) throw new Error('狗群欄號無法確認');
    groupStageData = { state: 'ready', groups };
    if (!currentGroup()) groupColumn = null;
    else groupColumn = currentGroup().column;
  } catch (e) { groupStageData = { state: 'error', groups: [] }; }
  if (activeTab === 'groups') render();
}
function groupTile(dog, index, rear) {
  const blocked = groupBlocked(dog);
  const excluded = groupExcluded.has(dog.name);
  return `<button type="button" class="gw-dog${excluded ? ' excluded' : ''}${searchQuery.trim() && !matchesSearch(dog, searchQuery.trim()) ? ' miss' : ''}" data-gw-dog="${index}" ${rear ? 'tabindex="-1"' : ''} ${!rear && groupExcept ? `aria-pressed="${excluded}"` : ''} aria-label="${esc(dog.name)}，${esc(blocked || groupDateLabel(dog))}${groupExcept ? excluded ? '，已排除，點選恢復' : '，點選排除' : '，查看精確日期'}"><span class="gw-tile"><span class="gw-cage">${esc(dog.cage || '待確認')}</span><span class="gw-photo">${dog.id ? `<img src="${esc(photoThumbSrc(dog))}" alt="" draggable="false" onerror="this.hidden=true">` : ''}</span><strong>${esc(dog.name)}</strong></span></button>`;
}
function groupStageHtml() {
  if (!groupStageData) loadGroupStage();
  const data = groupStageData;
  if (data.state !== 'ready' || loadState !== 'ready') return `<div class="status-msg">${data.state === 'error' || loadState === 'error' ? '讀不到狗群，請重新讀取。<button type="button" data-gw-action="retry">重新讀取</button>' : '狗群讀取中…'}</div>`;
  const groups = namedGroups();
  // 搜尋狗名（K 2026-10-17）：跳到有這隻狗的群，其他狗變淡；目前這群就有的話不換群
  const query = searchQuery.trim();
  const hits = query ? groups.filter(g => g.names.some(n => matchesSearch({ name: n }, query))) : [];
  // 只在搜尋字改變時跳群，之後用箭頭切到別群不會被拉回來
  if (query !== groupSearchSeen) { groupSearchSeen = query; if (hits.length && !hits.includes(currentGroup())) { groupColumn = hits[0].column; resetGroupSelection(); } }
  const searchNote = !query ? '' : hits.length ? (hits.length > 1 ? `有 ${hits.length} 群有「${query}」，用下方箭頭切換` : '') : `沒有狗群有「${query}」`;
  const group = currentGroup();
  const dogs = groupDogs(group);
  const index = groups.indexOf(group);
  const selected = dogs.filter(d => !groupExcluded.has(d.name) && !groupBlocked(d));
  // 比照溜狗表的「溜了／已溜」：這群可登記的狗今天都溜了，按鈕就變「已溜」，再按一次復原（只撤這支手機寫的）
  const walkable = dogs.filter(d => !groupBlocked(d));
  const done = !groupExcept && walkable.length > 0 && walkable.every(d => walkedNow(d));
  const undoable = done ? walkable.filter(d => sheetUndoable(d)) : [];
  const walkBtn = done
    ? `<button type="button" id="gwWalk" class="done" data-gw-action="undo" aria-label="這群今天已溜，按一下取消" ${!undoable.length || groupBusy ? 'disabled' : ''}>${icon('tick')}${groupBusy ? '處理中…' : `已溜 · ${walkable.length} 隻`}</button>`
    : `<button type="button" id="gwWalk" ${!selected.length || groupBusy ? 'disabled' : ''}>${groupBusy ? '登記中…' : groupExcept ? `登記其餘 ${selected.length} 隻` : `整群溜了 · ${selected.length} 隻`}</button><button type="button" data-gw-action="except" aria-pressed="${groupExcept}">${groupExcept ? '取消' : '有狗沒溜'}</button>`;
  const layers = group ? `<div class="gw-layer front" data-column="${group.column}"><div class="gw-cards">${dogs.map((d, i) => groupTile(d, i, false)).join('')}<button type="button" class="gw-dog gw-add" data-gw-action="add" aria-label="加入狗"><span class="gw-tile">＋</span></button></div></div>` : '';
  return `<section id="groupPage" data-navigation-scope aria-busy="${groupBusy}">
    <div class="gw-heading"><h2>${esc(group?.label || '還沒有狗群')}<small>${dogs.length} 隻</small></h2><button type="button" data-gw-action="manage" aria-expanded="${groupManage}" aria-controls="gwManage">管理</button></div>
    ${searchNote ? `<p class="gw-search-note" role="status">${esc(searchNote)}</p>` : ''}
    <div id="gwManage" class="gw-manage" ${groupManage ? '' : 'hidden'}><button type="button" data-gw-action="create">＋狗群</button>${dogs.map(d => `<button type="button" data-gw-remove="${esc(d.name)}">移出 ${esc(d.name)}</button>`).join('')}</div>

    <div id="groupStage" class="gw-stage" style="--rows:${Math.max(1, Math.ceil((dogs.length + 2) / 4))}" aria-label="目前狗群">${layers}</div>
    <div class="gw-pages"><button type="button" data-gw-step="-1" aria-label="上一群" ${index <= 0 ? 'disabled' : ''}>${icon('back')}</button><span>${groups.length ? index + 1 : 0} / ${groups.length}</span><button type="button" data-gw-step="1" aria-label="下一群" ${index >= groups.length - 1 ? 'disabled' : ''}>${icon('chevron')}</button></div>
    <p id="gwFeedback" role="status">${esc(groupBusy ? '處理中…' : groupFeedback)}</p>
    ${group ? `<div class="gw-actions">${walkBtn}</div><p class="gw-restrictions">${dogs.some(groupBlocked) ? `不登記：${dogs.filter(groupBlocked).map(d => `${esc(d.name)}（${esc(groupBlocked(d))}）`).join('、')}` : ''}</p>` : ''}
    ${groupFormHtml()}
  </section>`;
}
function groupFormHtml() {
  if (!groupForm) return '';
  return `<form id="gwForm" class="gw-form"><h3>${groupForm.op === 'create' ? '建立狗群' : '加入狗'}</h3>${groupForm.op === 'create' ? `<label>群名<input name="label" required maxlength="20" value="${esc(groupForm.label || '')}"></label>` : ''}<label>狗名<input name="name" required maxlength="30" list="gwNames" value="${esc(groupForm.name || '')}"></label><datalist id="gwNames">${allDogs.map(d => `<option value="${esc(d.name)}">`).join('')}</datalist><button type="submit">${groupBusy ? '寫入中…' : '儲存'}</button><button type="button" data-gw-action="cancel-form">取消</button></form>`;
}
function resetGroupSelection() { groupManage = false; groupExcept = false; groupExcluded.clear(); groupForm = null; groupFeedback = ''; }
function changeGroup(step) {
  if (groupBusy) return;
  const groups = namedGroups();
  const next = groups[groups.indexOf(currentGroup()) + step];
  if (!next) return;
  const previous = new Map([...document.querySelectorAll('.gw-layer')].map(el => [el.dataset.column, { transform: getComputedStyle(el).transform, opacity: getComputedStyle(el).opacity }]));
  groupColumn = next.column; resetGroupSelection(); render();
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) document.querySelectorAll('.gw-layer').forEach(el => {
    const before = previous.get(el.dataset.column);
    if (before) el.animate([before, { transform: getComputedStyle(el).transform, opacity: getComputedStyle(el).opacity }], { duration: 320, easing: 'cubic-bezier(.16,1,.3,1)' });
  });
  document.querySelector('#groupPage h2')?.setAttribute('tabindex', '-1');
  document.querySelector('#groupPage h2')?.focus({ preventScroll: true });
}
async function registerGroupWalk() {
  if (groupBusy) return;
  if (!loadWalkerName()) { groupFeedback = '請先在「我溜過」選好你的名字再登記'; render(); return; }
  if (!sheetWillWrite()) { groupFeedback = '目前無法寫入試算表，請稍後再試；尚未登記'; render(); return; }
  const dogs = groupDogs(currentGroup()).filter(d => !groupExcluded.has(d.name) && !groupBlocked(d));
  if (!dogs.length || dogs.some(walkPendingNow)) return;
  const beforeWrites = new Map(dogs.map(d => [walkKey(d), sheetWrittenAt.get(walkKey(d))]));
  groupBusy = true;
  dogs.forEach(d => walkPending.add(walkKey(d)));
  render();
  try {
    const ok = await queueSheetWrite(dogs, true);
    const confirmed = dogs.every(d => sheetWrittenAt.has(walkKey(d)) && sheetWrittenAt.get(walkKey(d)) !== beforeWrites.get(walkKey(d))); 
    groupFeedback = ok === true && confirmed ? `已登記 ${dogs.length} 隻` : ok === null ? '目前無法寫入試算表，尚未登記' : `未全部登記成功。${sheetWriteFailText || '請重試'}；請核對各狗日期後重試`;
    if (ok === true && confirmed) { groupExcept = false; groupExcluded.clear(); }
  } catch (e) { groupFeedback = '登記失敗，請重試；尚未確認成功'; }
  finally { dogs.forEach(d => walkPending.delete(walkKey(d))); groupBusy = false; render(); document.getElementById('gwWalk')?.focus({ preventScroll: true }); }
}
// 誤觸「整群溜了」：撤銷這一群今天由這支手機寫進試算表的紀錄（結果以試算表回應為準）
async function undoGroupWalk() {
  if (groupBusy) return;
  const dogs = groupDogs(currentGroup()).filter(d => !groupBlocked(d) && sheetUndoable(d));
  if (!dogs.length) return;
  groupBusy = true; groupFeedback = ''; render();
  try { groupFeedback = await undoSheetWalks(dogs); }
  catch (e) { groupFeedback = '復原失敗，請重試；尚未確認復原'; }
  finally { groupBusy = false; render(); document.getElementById('gwWalk')?.focus({ preventScroll: true }); }
}
async function writeGroup(body) {
  if (groupBusy) return false;
  const editor = loadWalkerName();
  if (!editor) { groupFeedback = '請先在「我溜過」選好你的名字再編輯'; render(); return false; }
  groupBusy = true; render();
  try {
    const res = await fetch('api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, editor }) });
    const out = await res.json();
    if (!res.ok || !out.ok || !Number.isInteger(out.group?.column) || !Array.isArray(out.group.names)) throw new Error(out.error || '寫入失敗');
    // 使用既有 API 從試算表讀回的群，不以送出內容樂觀修改。
    const groups = groupStageData.groups;
    const i = groups.findIndex(g => g.column === out.group.column);
    if (i < 0) groups.push(out.group); else groups[i] = out.group;
    groups.sort((a, b) => a.column - b.column);
    groupColumn = out.group.column;
    resetGroupSelection(); groupFeedback = out.status === 'already' ? '這隻狗本來就在這一群' : '狗群已更新';
    return true;
  } catch (e) { groupFeedback = `${e.message || '寫入失敗'}，請重試`; return false; }
  finally { groupBusy = false; render(); }
}
const groupMain = document.getElementById('main');
groupMain.addEventListener('click', e => {
  if (activeTab !== 'groups' || analysisOpen || groupBusy) return;
  if (e.target.closest('[data-gw-action="retry"]')) {
    if (loadState === 'error') init();
    return loadGroupStage(true);
  }
  if (!e.target.closest('#groupPage')) return;
  const step = e.target.closest('[data-gw-step]');
  if (step) return changeGroup(Number(step.dataset.gwStep));
  const dogButton = e.target.closest('[data-gw-dog]');
  if (dogButton) {
    const dog = groupDogs(currentGroup())[Number(dogButton.dataset.gwDog)];
    if (groupExcept) {
      groupExcluded.has(dog.name) ? groupExcluded.delete(dog.name) : groupExcluded.add(dog.name);
      render(); document.querySelector(`.front [data-gw-dog="${dogButton.dataset.gwDog}"]`)?.focus({ preventScroll: true });
    } else if (!dog.unavailable) showDetail(dog);
    return;
  }
  const remove = e.target.closest('[data-gw-remove]');
  if (remove && confirm(`把「${remove.dataset.gwRemove}」移出「${currentGroup().label}」？`)) return writeGroup({ op: 'remove', column: groupColumn, name: remove.dataset.gwRemove });
  const action = e.target.closest('[data-gw-action]')?.dataset.gwAction;
  if (action === 'undo') return undoGroupWalk();
  if (e.target.closest('#gwWalk')) return registerGroupWalk();
  if (action === 'manage') { groupManage = !groupManage; render(); document.querySelector('[data-gw-action="manage"]')?.focus({ preventScroll: true }); }
  if (action === 'except') { groupExcept = !groupExcept; groupExcluded.clear(); groupFeedback = ''; render(); document.querySelector('[data-gw-action="except"]')?.focus(); }
  if (action === 'add' || action === 'create') { groupManage = false; groupForm = { op: action, column: groupColumn }; render(); document.querySelector('#gwForm input')?.focus(); }
  if (action === 'cancel-form') { groupForm = null; render(); document.querySelector('[data-gw-action="manage"]')?.focus({ preventScroll: true }); }
});
groupMain.addEventListener('input', e => {
  if (e.target.closest('#gwForm') && groupForm) groupForm[e.target.name] = e.target.value;
});
groupMain.addEventListener('submit', e => {
  if (e.target.id !== 'gwForm' || !groupForm) return;
  e.preventDefault();
  const form = e.target;
  groupForm.name = form.elements.name.value.trim();
  if (form.elements.label) groupForm.label = form.elements.label.value.trim();
  if (allDogs.filter(d => d.name === groupForm.name).length !== 1) { groupFeedback = '請選擇主清單中可唯一對應的狗名'; render(); return; }
  writeGroup({ ...groupForm });
});
groupMain.addEventListener('keydown', e => {
  if (!e.target.closest('#groupPage') || e.target.matches('input')) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); changeGroup(e.key === 'ArrowRight' ? 1 : -1); }
});
