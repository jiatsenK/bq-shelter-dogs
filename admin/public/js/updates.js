import { searchEdits, readDog, unmergeDog } from './api.js';
import { FILTERS, editQuery, parseEditPage, formatWhen, sourceLabel, valueText } from './edit-log.js';
import { showVolunteerState } from './volunteer-state.js';
import { byId, element } from './dom.js';

// #567 修改紀錄頁（#624 起網站更新拆到 releases.html）：每次換條件都交給伺服器查全部紀錄（不在前端過濾最近幾筆）。
// 分頁用伺服器給的游標：cursors[i] 是第 i+1 頁的起點（第 1 頁 null），上一頁照記下來的游標重查。
// #671 隱藏測試紀錄（K 2026-10-27）：只記在這台電腦的瀏覽器，後端不知道。被藏的列在畫面上過濾，所以某頁可能少於每頁筆數，不從下一頁補。
const HIDDEN_KEY = 'bq-admin-hidden-edits';
let storageFailed = false; // 無痕或封鎖網站資料時讀寫會丟錯：頁面照常，只是記不住
const state = { cursors: [null], next: null, size: 25, seq: 0, kindsLoaded: false, edits: [], hidden: readHidden(), selected: new Set(), showHidden: false };
let typingTimer;
const page = () => state.cursors.length;
const filters = () => ({ ...Object.fromEntries(FILTERS.map(k => [k, byId(k).value])), cursor: state.cursors.at(-1), size: state.size });

function readHidden() {
  try {
    const ids = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]');
    return new Set(Array.isArray(ids) ? ids.filter(Number.isSafeInteger) : []);
  } catch { storageFailed = true; return new Set(); }
}
function saveHidden() {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...state.hidden])); } catch { storageFailed = true; }
}

function renderRow(e) {
  const row = document.createElement('tr');
  const hidden = state.hidden.has(e.id);
  if (hidden) row.dataset.hidden = 'true';
  const pick = element('input', undefined, 'form-check-input');
  pick.type = 'checkbox';
  pick.checked = state.selected.has(e.id);
  pick.setAttribute('aria-label', `選取 ${formatWhen(e.at)} ${e.kindLabel || e.kind}`);
  pick.addEventListener('change', () => { pick.checked ? state.selected.add(e.id) : state.selected.delete(e.id); updateHideBar(); });
  const select = element('td', undefined, 'select-cell');
  select.append(pick);
  const when = element('td', formatWhen(e.at), 'dog-number');
  if (hidden) when.append(document.createElement('br'), element('span', '已隱藏', 'state-label'));
  const dog = e.dogName || e.dogNumber ? `${e.dogName}${e.dogNumber ? ` ${e.dogNumber}` : ''}`.trim() : '—';
  const who = element('td', undefined, 'edit-actor');
  who.append(element('div', e.editorName), element('span', sourceLabel(e.source), 'state-label'));
  if (e.actorEmail) who.append(element('div', e.actorEmail, 'identity'));
  const value = v => { const cell = element('td', undefined, 'edit-value'); cell.append(element('pre', valueText(e.kind, v))); return cell; };
  const after = value(e.after);
  if (e.kind === 'merge' && e.dogId) after.append(unmergeButton(e));
  row.append(select, when, element('td', e.kindLabel || e.kind), element('td', dog), who, value(e.before), after);
  return row;
}
// 取消合併（K 2026-10-26）：按兩次才送；伺服器照這筆的快照拆回來，已取消過或之後又合併過會說明原因
function unmergeButton(e) {
  const wrap = element('div', undefined, 'unmerge-actions');
  const button = element('button', '取消合併', 'btn btn-outline-danger');
  button.type = 'button';
  const note = element('span');
  note.setAttribute('role', 'status');
  let armed = false;
  const disarm = () => { armed = false; button.textContent = '取消合併'; button.className = 'btn btn-outline-danger'; };
  button.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      button.textContent = `確定取消：拆回「${e.before?.name || '未命名'}」`;
      button.className = 'btn btn-danger';
      return;
    }
    button.disabled = true;
    note.textContent = '正在取消合併…';
    const dog = await readDog(e.dogId);
    const result = dog.ok ? await unmergeDog(e.dogId, { logId: e.id, revision: dog.data.revision }) : dog;
    button.disabled = false;
    if (!result.ok) {
      disarm();
      note.textContent = result.data?.error || '未能取消合併，資料沒有改；請重新讀取再試';
      return;
    }
    note.textContent = '已取消合併。';
    restart();
  });
  wrap.append(button, note);
  return wrap;
}


async function load() {
  const seq = ++state.seq;
  const status = byId('status');
  status.removeAttribute('data-error'); status.textContent = '正在搜尋全部紀錄…';
  byId('reload').disabled = true;
  const result = await searchEdits(editQuery(filters()));
  if (seq !== state.seq) return; // 條件又換了，只顯示最後一次
  byId('reload').disabled = false;
  state.selected.clear();
  let data;
  try {
    if (!result.ok) throw Error(result.data?.error || '資料編輯紀錄讀取失敗，請重新讀取。');
    data = parseEditPage(result.data);
  } catch (error) {
    status.dataset.error = 'true'; status.textContent = error.message;
    byId('table-region').hidden = true; byId('pagination').hidden = true; byId('hide-bar').hidden = true;
    return;
  }
  if (!state.kindsLoaded) {
    byId('kind').append(...data.kinds.map(k => { const o = element('option', k.label); o.value = k.value; return o; }));
    state.kindsLoaded = true;
  }
  state.next = data.next;
  state.edits = data.edits;
  render();
  byId('pagination').hidden = !data.edits.length && page() === 1;
  const first = (page() - 1) * data.pageSize + 1;
  byId('count').textContent = data.edits.length ? `第 ${first}–${first + data.edits.length - 1} 筆${data.next ? '' : '（已到最後）'}` : '';
  byId('page-number').textContent = `第 ${page()} 頁`;
  byId('previous').disabled = page() <= 1;
  byId('next').disabled = !data.next;
}
function render() {
  const shown = state.edits.filter(e => state.showHidden || !state.hidden.has(e.id));
  const tucked = state.edits.filter(e => state.hidden.has(e.id)).length;
  for (const id of state.selected) if (!shown.some(e => e.id === id)) state.selected.delete(id);
  byId('edits').replaceChildren(...shown.map(renderRow));
  byId('table-region').hidden = !shown.length;
  byId('hide-bar').hidden = !state.edits.length;
  byId('status').textContent = !state.edits.length ? (page() > 1 ? '後面沒有更多符合的紀錄。' : '沒有符合條件的紀錄，請清除或調整條件。')
    : !shown.length ? '這一頁的紀錄都已隱藏；打開「顯示已隱藏」可以看到，或換下一頁。'
    : `搜尋範圍是全部紀錄（不算總筆數，換頁接著往下找）。時間為台灣時間。${tucked && !state.showHidden ? `這頁藏了 ${tucked} 筆。` : ''}`;
  updateHideBar();
}
function updateHideBar() {
  const picked = [...state.selected];
  const toHide = picked.filter(id => !state.hidden.has(id)).length, toShow = picked.length - toHide;
  byId('hide-selected').disabled = !toHide;
  byId('hide-selected').textContent = toHide ? `隱藏所選（${toHide} 筆）` : '隱藏所選';
  byId('unhide-selected').hidden = !state.showHidden;
  byId('unhide-selected').disabled = !toShow;
  byId('unhide-selected').textContent = toShow ? `取消隱藏所選（${toShow} 筆）` : '取消隱藏所選';
  byId('show-hidden-label').textContent = `顯示已隱藏（${state.hidden.size} 筆）`;
  const rows = byId('edits').querySelectorAll('.select-cell input');
  const checked = [...rows].filter(r => r.checked).length;
  byId('select-page').checked = rows.length > 0 && checked === rows.length;
  byId('select-page').indeterminate = checked > 0 && checked < rows.length;
}
function setHidden(hide) {
  const ids = [...state.selected].filter(id => state.hidden.has(id) !== hide);
  for (const id of ids) hide ? state.hidden.add(id) : state.hidden.delete(id);
  saveHidden();
  state.selected.clear();
  render();
  byId('hide-note').textContent = `${hide ? '已隱藏' : '已取消隱藏'} ${ids.length} 筆，${storageFailed ? '這個瀏覽器記不住，重新整理後會恢復原狀。' : '只記在這台電腦的瀏覽器。'}`;
}
const restart = () => { state.cursors = [null]; load(); };

byId('filters').addEventListener('input', e => {
  if (e.target.type === 'search' || e.target.type === 'text' || !e.target.type) { clearTimeout(typingTimer); typingTimer = setTimeout(restart, 300); }
});
byId('filters').addEventListener('change', e => { if (e.target.tagName === 'SELECT' || e.target.type === 'date') restart(); });
byId('filters').addEventListener('reset', () => setTimeout(restart));
byId('filters').addEventListener('submit', e => { e.preventDefault(); clearTimeout(typingTimer); restart(); });
byId('page-size').addEventListener('change', e => { state.size = Number(e.target.value); restart(); });
byId('previous').addEventListener('click', () => { if (page() > 1) { state.cursors.pop(); load(); } });
byId('next').addEventListener('click', () => { if (state.next) { state.cursors.push(state.next); load(); } });
byId('reload').addEventListener('click', load);
byId('select-page').addEventListener('change', e => {
  const shown = state.edits.filter(x => state.showHidden || !state.hidden.has(x.id));
  state.selected = e.target.checked ? new Set(shown.map(x => x.id)) : new Set();
  render();
});
byId('hide-selected').addEventListener('click', () => setHidden(true));
byId('unhide-selected').addEventListener('click', () => setHidden(false));
byId('show-hidden').addEventListener('change', e => { state.showHidden = e.target.checked; if (!storageFailed) byId('hide-note').textContent = ''; render(); });
if (storageFailed) byId('hide-note').textContent = '這個瀏覽器記不住隱藏，重新整理後會恢復原狀。';
showVolunteerState(byId('volunteer-state'), [['showUpdates', '更新紀錄顯示中', '更新紀錄已隱藏']]);
load();
