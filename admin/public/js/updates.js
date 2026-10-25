import { searchEdits, readWebsiteUpdates } from './api.js';
import { FILTERS, editQuery, parseEditPage, formatWhen, sourceLabel, valueText } from './edit-log.js';
import { showVolunteerState } from './volunteer-state.js';
import { byId, element } from './dom.js';

// #567 更新紀錄頁：資料編輯每次換條件都交給伺服器查全部紀錄（不在前端過濾最近幾筆）；網站更新讀同一份版本紀錄檔。
// 分頁用伺服器給的游標：cursors[i] 是第 i+1 頁的起點（第 1 頁 null），上一頁照記下來的游標重查。
const state = { cursors: [null], next: null, size: 25, seq: 0, kindsLoaded: false };
let typingTimer;
const page = () => state.cursors.length;
const filters = () => ({ ...Object.fromEntries(FILTERS.map(k => [k, byId(k).value])), cursor: state.cursors.at(-1), size: state.size });

function renderRow(e) {
  const row = document.createElement('tr');
  const dog = e.dogName || e.dogNumber ? `${e.dogName}${e.dogNumber ? ` ${e.dogNumber}` : ''}`.trim() : '—';
  const who = element('td', undefined, 'edit-actor');
  who.append(element('div', e.editorName), element('span', sourceLabel(e.source), 'state-label'));
  if (e.actorEmail) who.append(element('div', e.actorEmail, 'identity'));
  const value = v => { const cell = element('td', undefined, 'edit-value'); cell.append(element('pre', valueText(e.kind, v))); return cell; };
  row.append(element('td', formatWhen(e.at), 'dog-number'), element('td', e.kindLabel || e.kind), element('td', dog), who, value(e.before), value(e.after));
  return row;
}

async function load() {
  const seq = ++state.seq;
  const status = byId('status');
  status.removeAttribute('data-error'); status.textContent = '正在搜尋全部紀錄…';
  byId('reload').disabled = true;
  const result = await searchEdits(editQuery(filters()));
  if (seq !== state.seq) return; // 條件又換了，只顯示最後一次
  byId('reload').disabled = false;
  let data;
  try {
    if (!result.ok) throw Error(result.data?.error || '資料編輯紀錄讀取失敗，請重新讀取。');
    data = parseEditPage(result.data);
  } catch (error) {
    status.dataset.error = 'true'; status.textContent = error.message;
    byId('table-region').hidden = true; byId('pagination').hidden = true;
    return;
  }
  if (!state.kindsLoaded) {
    byId('kind').append(...data.kinds.map(k => { const o = element('option', k.label); o.value = k.value; return o; }));
    state.kindsLoaded = true;
  }
  state.next = data.next;
  byId('edits').replaceChildren(...data.edits.map(renderRow));
  byId('table-region').hidden = !data.edits.length;
  byId('pagination').hidden = !data.edits.length && page() === 1;
  status.textContent = data.edits.length ? '搜尋範圍是全部紀錄（不算總筆數，換頁接著往下找）。時間為台灣時間。' : page() > 1 ? '後面沒有更多符合的紀錄。' : '沒有符合條件的紀錄，請清除或調整條件。';
  const first = (page() - 1) * data.pageSize + 1;
  byId('count').textContent = data.edits.length ? `第 ${first}–${first + data.edits.length - 1} 筆${data.next ? '' : '（已到最後）'}` : '';
  byId('page-number').textContent = `第 ${page()} 頁`;
  byId('previous').disabled = page() <= 1;
  byId('next').disabled = !data.next;
}
const restart = () => { state.cursors = [null]; load(); };

async function loadReleases() {
  const status = byId('release-status'), list = byId('releases');
  const result = await readWebsiteUpdates();
  const entries = result.ok && Array.isArray(result.data) && result.data.every(e => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && typeof e.text === 'string') ? result.data : null;
  if (!entries) { status.dataset.error = 'true'; status.textContent = '網站更新讀取失敗，請重新讀取。'; return; }
  status.removeAttribute('data-error');
  status.textContent = entries.length ? `共 ${entries.length} 則，新到舊。` : '還沒有網站更新紀錄。';
  list.replaceChildren(...entries.map(e => {
    const item = element('li');
    item.append(element('time', e.version ? `${e.version} · ${e.date}` : e.date), element('p', e.text));
    return item;
  }));
}

byId('filters').addEventListener('input', e => {
  if (e.target.type === 'search' || e.target.type === 'text' || !e.target.type) { clearTimeout(typingTimer); typingTimer = setTimeout(restart, 300); }
});
byId('filters').addEventListener('change', e => { if (e.target.tagName === 'SELECT' || e.target.type === 'date') restart(); });
byId('filters').addEventListener('reset', () => setTimeout(restart));
byId('filters').addEventListener('submit', e => { e.preventDefault(); clearTimeout(typingTimer); restart(); });
byId('page-size').addEventListener('change', e => { state.size = Number(e.target.value); restart(); });
byId('previous').addEventListener('click', () => { if (page() > 1) { state.cursors.pop(); load(); } });
byId('next').addEventListener('click', () => { if (state.next) { state.cursors.push(state.next); load(); } });
byId('reload').addEventListener('click', () => { load(); loadReleases(); });
showVolunteerState(byId('volunteer-state'), [['showUpdates', '更新紀錄顯示中', '更新紀錄已隱藏']]);
load();
loadReleases();
