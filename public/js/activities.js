import { activitiesState, analysisState, appState } from './page-state.js';
import { BQApi } from './api.js';
import { NEED_EDITOR, apiData, editorName, esc, isoDay, render, searchKey, ymdText } from './app.js';
import { BQDates } from './dates.js';
import { loadDepartures, section } from './analysis.js';
import { BQWalkUI } from './walk-ui.js';

// 活動紀錄頁（#270，ADR 0002）：資訊 → 活動紀錄。分析頁（analysis.js）只讀資料，會寫入的活動放這個檔。
// 會用到 js/dates.js 的日期工具及 js/app.js 的 esc、ymdText、isoDay、searchKey、editorName、NEED_EDITOR、UPLOAD_URL、BQWalkUI.showToast、allDogs、analysisOpen，
// 和 js/analysis.js 的 section、render、infoPage、departuresData、loadDepartures，所以要在兩個之後載入。

// 動保小小兵、認養會每場出席的狗，存 D1（Worker 的 api/activities）。
// 每場以日期＋類型當標題，下面直接列出席的狗；誰都能新增、修改、刪除（先選好名字，記編輯紀錄）。狗卡上不顯示活動。
// 新增、修改就地展開（DESIGN_GUIDE「新增或編輯就地展開」）；改、刪帶打開時的 revision，別人剛改過會被擋下
const ACTIVITY_KINDS = { kids: '動保小小兵', adoption: '認養會' };
const ACTIVITY_MAX_DOGS = 60;
const ACTIVITY_PICKS = 8;

activitiesState.activitiesData = null; // { state: 'loading' | 'ready' | 'error', list: [{ id, date, kind, revision, dogs: [{ dogId, number, name }] }] }
activitiesState.activityEdit = null; // { id（新增是 ''）, revision, date, kind, dogs, query, phase: 'edit' | 'saving' | 'error', error, confirmDelete }
function loadActivities(force = false) {
  if (activitiesState.activitiesData && !force) return;
  activitiesState.activitiesData = { state: 'loading', list: activitiesState.activitiesData ? activitiesState.activitiesData.list : [] };
  BQApi.activities()
    .then(apiData)
    .then(data => {
      if (!data || !Array.isArray(data.activities)) throw new Error('格式不對');
      activitiesState.activitiesData = { state: 'ready', list: data.activities };
    })
    .catch(() => { activitiesState.activitiesData = { state: 'error', list: [] }; })
    .then(() => { if (appState.analysisOpen) render(); });
}

// 2026-10-11 → 2026/10/11（六）
function activityDateText(ymd) {
  const d = BQDates.parseYmd(ymd);
  return d ? `${ymdText(d)}（${'日一二三四五六'[d.getDay()]}）` : ymd;
}
const activityTitle = a => `${activityDateText(a.date)} ${ACTIVITY_KINDS[a.kind] || a.kind}`;
// 出席的狗送給 Worker 的樣子：有編號送編號，沒編號的狗送永久 ID，都沒有是只有名字。同一隻狗也用它比對
const activityDogRef = d => (d.number ? { number: d.number } : d.dogId ? { dogId: d.dogId } : { name: d.name });
const activityDogKey = d => JSON.stringify(activityDogRef(d));

// 可以選的狗：在所的加上離所名冊的；有編號用編號送，沒編號的用永久 ID
function activityCandidates() {
  const out = new Map();
  const add = (dog, departed) => {
    const pick = dog.id ? { number: dog.id, name: dog.name } : dog.dogId ? { dogId: dog.dogId, name: dog.name } : null;
    if (pick && !out.has(activityDogKey(pick))) out.set(activityDogKey(pick), { ...pick, departed, formerIds: dog.formerIds || [] });
  };
  for (const dog of appState.allDogs) add(dog, false);
  if (analysisState.departuresData && analysisState.departuresData.state === 'ready') for (const dog of analysisState.departuresData.list) add(dog, true);
  return [...out.values()];
}

// 搜尋要加的狗：狗名、編號、舊編號部分符合；已在名單上的不再列
function activityMatches(query, picked) {
  const q = searchKey(query);
  if (!q) return [];
  const have = new Set(picked.map(activityDogKey));
  return activityCandidates()
    .filter(c => !have.has(activityDogKey(c)) && [c.name, c.number, ...c.formerIds].some(v => searchKey(v).includes(q)))
    .sort((a, b) => (searchKey(a.name) === q ? 0 : 1) - (searchKey(b.name) === q ? 0 : 1) || a.departed - b.departed || a.name.localeCompare(b.name, 'zh-Hant'))
    .slice(0, ACTIVITY_PICKS);
}

function activityDogsHtml(dogs) {
  if (!dogs.length) return '<p class="act-none">沒有記出席的狗</p>';
  return `<ul class="act-dogs">${dogs.map(d => `<li${d.dogId ? '' : ' class="act-unmatched"'}>${esc(d.name)}${d.dogId ? '' : '<small>（還沒對上狗）</small>'}</li>`).join('')}</ul>`;
}

function activityPicksHtml(e) {
  const query = e.query.trim();
  if (!query) return '';
  const picks = activityMatches(query, e.dogs);
  // 有同名的狗就不給「只記名字」，免得記成沒對上的
  const named = e.dogs.some(d => !d.dogId && !d.number && d.name === query) || activityCandidates().some(c => searchKey(c.name) === searchKey(query));
  return picks.map(c => `<button type="button" class="act-pick" data-act-pick="${esc(activityDogKey(c))}">${esc(c.name)}<small>${esc(c.number || '沒有編號')}${c.departed ? '・已離所' : ''}</small></button>`).join('')
    + (named || [...query].length > 20 ? '' : `<button type="button" class="act-pick" data-act-name>只記名字「${esc(query)}」<small>找不到這隻狗時用，之後再對上</small></button>`);
}

function activityFormHtml(e) {
  const busy = e.phase === 'saving';
  const max = `${new Date().getFullYear() + 1}${isoDay(new Date()).slice(4)}`; // Worker 最多收一年後的活動
  return `<form class="rest-form act-form" id="actForm" autocomplete="off" aria-label="${e.id ? '修改活動' : '新增活動'}">
    <label>日期<input type="date" id="actDate" value="${esc(e.date)}" max="${max}" required ${busy ? 'disabled' : ''}></label>
    <div class="act-kinds" role="group" aria-label="活動類型">${Object.entries(ACTIVITY_KINDS).map(([k, label]) => `<button type="button" data-act-kind="${k}" aria-pressed="${e.kind === k}" ${busy ? 'disabled' : ''}>${label}</button>`).join('')}</div>
    <p class="act-count" id="actCount">出席的狗（${e.dogs.length} 隻）</p>
    <div class="act-picked" aria-labelledby="actCount">${e.dogs.length ? e.dogs.map((d, i) => `<span class="act-chip">${esc(d.name)}${d.dogId || d.number ? '' : '<small>只有名字</small>'}<button type="button" data-act-remove="${i}" aria-label="拿掉 ${esc(d.name)}" ${busy ? 'disabled' : ''}>×</button></span>`).join('') : '<span class="act-none">還沒選出席的狗</span>'}</div>
    <label>加入出席的狗<input type="search" id="actSearch" value="${esc(e.query)}" placeholder="狗名或編號" enterkeyhint="search" ${busy ? 'disabled' : ''}></label>
    <div class="act-picks" id="actPicks">${activityPicksHtml(e)}</div>
    ${e.phase === 'error' ? `<div class="photo-error" role="alert">${esc(e.error)}</div>` : ''}
    <div class="act-buttons">
      <button type="submit" class="act-save" ${busy ? 'disabled' : ''}>${busy ? '存檔中…' : '存好'}</button>
      <button type="button" id="actCancel" ${busy ? 'disabled' : ''}>取消</button>
      ${e.id ? `<button type="button" id="actDelete" class="act-delete" ${busy ? 'disabled' : ''}>${e.confirmDelete ? '確定刪除這場' : '刪除這場'}</button>` : ''}
    </div>
  </form>`;
}

function activityItemHtml(a) {
  if (activitiesState.activityEdit && activitiesState.activityEdit.id === a.id) return `<article class="act-item editing"><h3>${esc(activityTitle(a))}</h3>${activityFormHtml(activitiesState.activityEdit)}</article>`;
  return `<article class="act-item"><div class="act-head"><h3>${esc(activityTitle(a))}</h3><button type="button" class="act-edit" data-act-edit="${esc(a.id)}" aria-label="修改 ${esc(activityTitle(a))}">修改</button></div>${activityDogsHtml(a.dogs)}</article>`;
}

function activitySectionHtml() {
  loadActivities();
  loadDepartures();
  const data = activitiesState.activitiesData;
  const adding = activitiesState.activityEdit && !activitiesState.activityEdit.id;
  const top = adding ? activityFormHtml(activitiesState.activityEdit) : '<button type="button" class="dep-open" id="actNew">＋ 新增活動</button>';
  let body;
  if (data.state === 'loading' && !data.list.length) body = '<p class="a-empty" role="status">讀取中…</p>';
  else if (data.state === 'error') body = '<p class="a-empty" role="alert">活動紀錄讀不到</p><button type="button" class="dep-open" id="retryActivities">重新讀取</button>';
  else body = data.list.length ? `<div class="act-list">${data.list.map(activityItemHtml).join('')}</div>` : '<p class="a-empty">還沒有活動紀錄</p>';
  return section('活動紀錄', '動保小小兵、認養會每場出席的狗；先選好名字就能新增、修改', (data.state === 'error' ? '' : top) + body, 'paw');
}

function startActivityEdit(id) {
  const a = id ? activitiesState.activitiesData.list.find(x => x.id === id) : null;
  if (id && !a) return;
  activitiesState.activityEdit = a
    ? { id: a.id, revision: a.revision, date: a.date, kind: a.kind, dogs: a.dogs.map(d => ({ ...d })), query: '', phase: 'edit', error: '', confirmDelete: false }
    : { id: '', revision: 0, date: isoDay(new Date()), kind: 'kids', dogs: [], query: '', phase: 'edit', error: '', confirmDelete: false };
  render();
  document.getElementById('actDate')?.focus({ preventScroll: true });
}

function endActivityEdit(focusId) {
  const back = focusId ?? (activitiesState.activityEdit && activitiesState.activityEdit.id);
  activitiesState.activityEdit = null;
  render();
  (back ? document.querySelector(`[data-act-edit="${back}"]`) : document.getElementById('actNew'))?.focus({ preventScroll: true });
}

function activityFail(e, msg) {
  e.phase = 'error'; e.error = msg; e.confirmDelete = false;
  render();
}

async function saveActivity(remove = false) {
  const e = activitiesState.activityEdit;
  if (!e || e.phase === 'saving') return;
  const editor = editorName();
  if (!editor) return activityFail(e, NEED_EDITOR);
  if (!remove && !BQDates.parseYmd(e.date)) return activityFail(e, '請選活動日期');
  if (!remove && e.dogs.length > ACTIVITY_MAX_DOGS) return activityFail(e, `一場最多 ${ACTIVITY_MAX_DOGS} 隻`);
  e.phase = 'saving'; e.error = '';
  render();
  const dogs = e.dogs.map(activityDogRef);
  const body = remove ? { editor, revision: e.revision } : { editor, ...(e.id ? { revision: e.revision } : {}), date: e.date, kind: e.kind, dogs };
  let out = null, error = '';
  const r = await BQApi.saveActivity(e.id, remove ? 'DELETE' : e.id ? 'PUT' : 'POST', body);
  out = r.data;
  if (r.error === 'network') error = '沒有存進去，請確認網路後再試';
  else {
    if (!r.ok || !out || !out.ok || (!remove && !out.activity)) error = (out && out.error) || `沒有存進去（${r.status}），請稍後再試`;
    // 別人剛改過或刪掉：重讀名單，讓畫面跟伺服器一樣
    if (r.status === 409 || r.status === 404) loadActivities(true);
  }
  if (activitiesState.activityEdit !== e) return;
  if (error) return activityFail(e, error);
  const list = activitiesState.activitiesData.list.filter(a => a.id !== e.id);
  if (!remove) list.push(out.activity);
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  activitiesState.activitiesData = { state: 'ready', list };
  endActivityEdit(remove || !e.id ? '' : out.activity.id); // 焦點回到打開表單的按鈕；刪掉了就回到新增
  BQWalkUI.showToast(remove ? `已刪除 ${activityTitle(e)}` : `${activityTitle(out.activity)} 已存好`);
}

function refreshActivityPicks() {
  const box = document.getElementById('actPicks');
  if (box && activitiesState.activityEdit) box.innerHTML = activityPicksHtml(activitiesState.activityEdit);
}

function addActivityDog(dog) {
  const e = activitiesState.activityEdit;
  if (!e || e.dogs.some(d => activityDogKey(d) === activityDogKey(dog))) return;
  e.dogs.push(dog);
  e.query = '';
  e.confirmDelete = false;
  render();
  document.getElementById('actSearch')?.focus({ preventScroll: true });
}

export { ACTIVITY_KINDS, ACTIVITY_MAX_DOGS, ACTIVITY_PICKS, loadActivities, activityDateText, activityTitle, activityDogRef, activityDogKey, activityCandidates, activityMatches, activityDogsHtml, activityPicksHtml, activityFormHtml, activityItemHtml, activitySectionHtml, startActivityEdit, endActivityEdit, activityFail, saveActivity, refreshActivityPicks, addActivityDog };
export { activitiesState } from './page-state.js';

export function bindActivities() {
  document.getElementById('main').addEventListener('click', e => {
    if (!appState.analysisOpen || analysisState.infoPage !== 'activities' || !e.target.closest) return;
    if (e.target.closest('#retryActivities')) { loadActivities(true); render(); return; }
    if (e.target.closest('#actNew')) { startActivityEdit(''); return; }
    const edit = e.target.closest('[data-act-edit]');
    if (edit) { startActivityEdit(edit.dataset.actEdit); return; }
    const ae = activitiesState.activityEdit;
    if (!ae || ae.phase === 'saving') return;
    const kind = e.target.closest('[data-act-kind]');
    if (kind) { ae.kind = kind.dataset.actKind; render(); document.querySelector(`[data-act-kind="${ae.kind}"]`)?.focus({ preventScroll: true }); return; }
    const remove = e.target.closest('[data-act-remove]');
    if (remove) { ae.dogs.splice(Number(remove.dataset.actRemove), 1); ae.confirmDelete = false; render(); document.getElementById('actSearch')?.focus({ preventScroll: true }); return; }
    const pick = e.target.closest('[data-act-pick]');
    if (pick) {
      const c = activityCandidates().find(x => activityDogKey(x) === pick.dataset.actPick);
      if (c) addActivityDog(c.number ? { dogId: null, number: c.number, name: c.name } : { dogId: c.dogId, number: '', name: c.name });
      return;
    }
    if (e.target.closest('[data-act-name]')) { addActivityDog({ dogId: null, number: '', name: ae.query.trim() }); return; }
    if (e.target.closest('#actCancel')) { endActivityEdit(); return; }
    if (e.target.closest('#actDelete')) {
      if (!ae.confirmDelete) { ae.confirmDelete = true; render(); document.getElementById('actDelete')?.focus({ preventScroll: true }); return; }
      saveActivity(true);
    }
  });
  document.getElementById('main').addEventListener('input', e => {
    if (!activitiesState.activityEdit) return;
    if (e.target.id === 'actSearch') { activitiesState.activityEdit.query = e.target.value; refreshActivityPicks(); }
    if (e.target.id === 'actDate') activitiesState.activityEdit.date = e.target.value;
  });
  document.getElementById('main').addEventListener('submit', e => {
    if (e.target.id !== 'actForm') return;
    e.preventDefault();
    saveActivity();
  });
}
