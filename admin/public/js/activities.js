import { readActivities, readDogs, createActivity, updateActivity, deleteActivity } from './api.js';
import { KIND_LABELS, parseActivities, filterActivities, sameActivity, activityPayload, describeActivity, dogLabel, dogText, matchDog } from './activity-model.js';
import { parseManageDogs } from './dog-table.js';
import { showVolunteerState } from './volunteer-state.js';
import { byId, element } from './dom.js';
import { BQDates } from '../shared/dates.js';

// #567 活動紀錄頁：清單只在讀取時打 API；搜尋、篩選在已載入的資料上做。一次只編一場，儲存帶打開時的 revision。
const state = { list: [], dogs: null, loaded: false, busy: false, editor: null };
// editor：{ saved: 活動或 null（新增）, draft: { date, kind, dogs }, conflict, gone, confirmDelete }
function dogsCell(dogs) {
  const cell = element('td', undefined, 'activity-dog-cell');
  if (!dogs.length) cell.append(element('span', '沒有記出席的狗', 'text-secondary'));
  for (const d of dogs) {
    const item = element('span', dogText(d), 'activity-dog');
    if (!d.dogId) item.append(element('span', '未對應', 'state-label'));
    cell.append(item);
  }
  return cell;
}
function renderTable() {
  const rows = filterActivities(state.list, { kind: byId('kind').value, query: byId('query').value });
  byId('activities').replaceChildren(...rows.map(a => {
    const row = document.createElement('tr');
    const edit = element('button', '編輯', 'btn btn-sm');
    edit.type = 'button'; edit.dataset.edit = a.id; edit.disabled = state.busy;
    edit.setAttribute('aria-label', `編輯 ${a.date} ${KIND_LABELS[a.kind]}`);
    const action = element('td'); action.append(edit);
    row.append(element('td', a.date, 'dog-number'), element('td', KIND_LABELS[a.kind]), dogsCell(a.dogs), element('td', String(a.dogs.length)), action);
    return row;
  }));
  const unmatched = state.list.reduce((n, a) => n + a.dogs.filter(d => !d.dogId).length, 0);
  byId('table-region').hidden = !state.loaded || !rows.length;
  if (state.loaded) byId('status').textContent = !state.list.length ? '還沒有活動紀錄。'
    : !rows.length ? '沒有符合條件的活動，請清除或調整搜尋條件。'
    : `共 ${state.list.length} 場${rows.length < state.list.length ? `，符合 ${rows.length} 場` : ''}${unmatched ? `；${unmatched} 筆出席只有名字（未對應）` : ''}。`;
}
function renderDogs() {
  const list = byId('activity-dogs');
  const { draft } = state.editor;
  list.replaceChildren(...draft.dogs.map((d, i) => {
    const item = element('li', undefined, 'activity-dog-row');
    item.append(element('span', dogText(d)));
    if (!d.dogId) item.append(element('span', '未對應狗身分，原樣保留', 'state-label'));
    const remove = element('button', '移除', 'btn btn-sm');
    remove.type = 'button'; remove.dataset.remove = String(i); remove.setAttribute('aria-label', `移除 ${d.name}`);
    item.append(remove);
    return item;
  }));
  if (!draft.dogs.length) list.append(element('li', '還沒有加入狗', 'text-secondary'));
}
function renderEditor() {
  const ed = state.editor;
  byId('activity-editor').hidden = !ed;
  byId('new-activity').disabled = state.busy || !state.loaded;
  renderTable();
  if (!ed) return;
  byId('editor-title').textContent = ed.saved ? `修改活動（${ed.saved.date}）` : '新增活動';
  byId('activity-date').value = ed.draft.date;
  byId('activity-kind').value = ed.draft.kind;
  renderDogs();
  byId('diff-before').textContent = ed.saved ? describeActivity(ed.saved) : '（新的一場）';
  byId('diff-after').textContent = ed.draft.date ? describeActivity(ed.draft) : '（請選日期）';
  const unchanged = ed.saved && sameActivity(ed.saved, ed.draft);
  for (const id of ['activity-date', 'activity-kind', 'dog-input', 'add-dog']) byId(id).disabled = state.busy || ed.gone;
  byId('add-dog').disabled ||= !state.dogs;
  byId('save-activity').disabled = state.busy || ed.conflict || ed.gone || !ed.draft.date || Boolean(unchanged);
  byId('delete-activity').hidden = !ed.saved || ed.confirmDelete;
  byId('delete-activity').disabled = state.busy || ed.conflict || ed.gone;
  byId('confirm-delete').hidden = !ed.confirmDelete;
  byId('confirm-delete').disabled = state.busy;
  byId('cancel-activity').disabled = state.busy;
}
const editorStatus = text => { byId('editor-status').textContent = text; };
function openEditor(activity) {
  state.editor = { saved: activity, draft: activity ? { date: activity.date, kind: activity.kind, dogs: activity.dogs.map(d => ({ ...d })) } : { date: BQDates.taipeiToday(), kind: 'kids', dogs: [] }, conflict: false, gone: false, confirmDelete: false };
  byId('dog-input').value = ''; byId('dog-hint').textContent = state.dogs ? '' : '狗清單讀不到，暫時只能移除或保留原本的狗；請重新讀取。';
  editorStatus(activity ? '修改後確認改前／改後，再按儲存。' : '選日期、類型並加入出席的狗。');
  renderEditor();
  byId('activity-date').focus();
}
function closeEditor() { state.editor = null; renderEditor(); byId('new-activity').focus(); }

async function load() {
  state.busy = true; byId('reload').disabled = true; renderEditor();
  byId('status').removeAttribute('data-error');
  byId('status').textContent = '正在讀取活動紀錄…';
  const [acts, dogs] = await Promise.all([readActivities(), readDogs()]);
  try {
    if (!acts.ok) throw Error(acts.data?.error || '活動紀錄讀取失敗，請重新讀取。');
    state.list = parseActivities(acts.data); state.loaded = true;
  } catch (error) {
    state.loaded = false; state.list = [];
    byId('status').dataset.error = 'true';
    byId('status').textContent = `${error.message}`;
  }
  try { state.dogs = dogs.ok ? parseManageDogs(dogs.data) : null; } catch { state.dogs = null; }
  byId('dog-options').replaceChildren(...(state.dogs || []).map(d => { const o = document.createElement('option'); o.value = dogLabel(d); return o; }));
  const ed = state.editor;
  if (ed?.saved) {
    // 重新讀取後保留草稿，換成最新版本；要使用者重新確認改前／改後
    const latest = state.list.find(a => a.id === ed.saved.id);
    if (latest) { ed.saved = latest; ed.conflict = false; editorStatus(`已取得最新版本（第 ${latest.revision} 版），草稿保留，請重新確認改前／改後再儲存。`); }
    else if (state.loaded) { ed.gone = true; editorStatus('這場活動已經被刪除，無法儲存修改。'); }
  }
  state.busy = false; byId('reload').disabled = false; renderEditor();
}

async function save(event) {
  event.preventDefault();
  const ed = state.editor;
  if (!ed || byId('save-activity').disabled) return;
  state.busy = true; renderEditor(); editorStatus('正在儲存…');
  const result = ed.saved ? await updateActivity(ed.saved.id, activityPayload(ed.draft, ed.saved.revision)) : await createActivity(activityPayload(ed.draft));
  state.busy = false;
  if (result.ok && result.data?.activity) {
    const [saved] = parseActivities({ activities: [result.data.activity] });
    state.list = [saved, ...state.list.filter(a => a.id !== saved.id)].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    state.editor = { saved, draft: { date: saved.date, kind: saved.kind, dogs: saved.dogs.map(d => ({ ...d })) }, conflict: false, gone: false, confirmDelete: false };
    editorStatus(`已儲存（第 ${saved.revision} 版），修改紀錄已一併記下。`);
  } else {
    ed.conflict = result.status === 409;
    editorStatus(`${result.data?.error || '儲存失敗，草稿已保留，請重試。'}${ed.conflict ? '請按「重新讀取」取得最新版本，草稿會保留。' : ''}`);
  }
  renderEditor();
}

async function remove() {
  const ed = state.editor;
  state.busy = true; renderEditor(); editorStatus('正在刪除…');
  const result = await deleteActivity(ed.saved.id, ed.saved.revision);
  state.busy = false;
  if (result.ok) {
    state.list = state.list.filter(a => a.id !== ed.saved.id);
    state.editor = null; renderEditor();
    byId('status').textContent = `已刪除 ${ed.saved.date} ${KIND_LABELS[ed.saved.kind]}，紀錄已一併記下。`;
    byId('new-activity').focus();
    return;
  }
  ed.confirmDelete = false; ed.conflict = result.status === 409; ed.gone = result.status === 404;
  editorStatus(`${result.data?.error || '刪除失敗，請重試。'}${ed.conflict ? '請按「重新讀取」取得最新版本。' : ''}`);
  renderEditor();
}

function addDog() {
  const ed = state.editor, input = byId('dog-input');
  const dog = state.dogs && matchDog(state.dogs, input.value);
  if (!dog) { byId('dog-hint').textContent = '對不上狗，請從清單選擇，或輸入完整編號。同名的狗請用編號。'; input.focus(); return; }
  if (ed.draft.dogs.some(d => d.dogId === dog.dogId)) { byId('dog-hint').textContent = `${dog.name} 已經在名單上。`; return; }
  ed.draft.dogs.push({ dogId: dog.dogId, number: dog.number, name: dog.name });
  input.value = ''; byId('dog-hint').textContent = `已加入 ${dog.name}，草稿尚未儲存。`;
  renderEditor(); input.focus();
}

byId('activity-form').addEventListener('submit', save);
byId('activity-date').addEventListener('input', e => { state.editor.draft.date = e.target.value; renderEditor(); });
byId('activity-kind').addEventListener('change', e => { state.editor.draft.kind = e.target.value; renderEditor(); });
byId('add-dog').addEventListener('click', addDog);
byId('dog-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addDog(); } });
byId('activity-dogs').addEventListener('click', e => {
  const button = e.target.closest('[data-remove]');
  if (!button || state.busy) return;
  const [gone] = state.editor.draft.dogs.splice(Number(button.dataset.remove), 1);
  byId('dog-hint').textContent = `已移除 ${gone.name}，草稿尚未儲存。`;
  renderEditor(); byId('dog-input').focus();
});
byId('cancel-activity').addEventListener('click', closeEditor);
byId('delete-activity').addEventListener('click', () => { state.editor.confirmDelete = true; editorStatus('刪除後出席紀錄一起移除；確定請按「確定刪除」。'); renderEditor(); byId('confirm-delete').focus(); });
byId('confirm-delete').addEventListener('click', remove);
byId('new-activity').addEventListener('click', () => openEditor(null));
byId('activities').addEventListener('click', e => {
  const button = e.target.closest('[data-edit]');
  const activity = button && state.list.find(a => a.id === button.dataset.edit);
  if (activity) openEditor(activity);
});
byId('query').addEventListener('input', renderTable);
byId('kind').addEventListener('change', renderTable);
byId('filters').addEventListener('reset', () => setTimeout(renderTable));
byId('filters').addEventListener('submit', e => e.preventDefault());
byId('reload').addEventListener('click', load);
showVolunteerState(byId('volunteer-state'), [['showActivities', '活動紀錄顯示中', '活動紀錄已隱藏'], ['editActivity', '志工可編輯活動', '志工不能編輯活動']]);
load();
