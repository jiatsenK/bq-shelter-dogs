import { openDogEditor } from './dog-editor.js';
import { readDogs } from './api.js';
import { parseManageDogs, selectDogs, maintenance, sexLabel } from './dog-table.js';

const byId = id => document.getElementById(id);
const state = { dogs: [], loaded: false, page: 1, pageSize: 25, sort: 'number', direction: 'asc' };
const status = byId('status');
let searchTimer;
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function renderRow(dog) {
  const row = document.createElement('tr');
  const photo = element('td', undefined, 'photo-cell');
  if (dog.photoUrl) {
    const img = element('img', undefined, 'dog-photo');
    img.src = dog.photoUrl;
    img.alt = `${dog.name}的照片`;
    img.width = 56; img.height = 56; img.loading = 'lazy';
    img.addEventListener('error', () => photo.replaceChildren(element('span', '照片讀不到', 'photo-unavailable')), { once: true });
    photo.append(img);
  } else photo.append(element('span', '無照片紀錄', 'photo-unavailable'));
  const name = element('td', undefined, 'dog-name');
  name.append(element('div', dog.name || '未命名'));
  if (!dog.onMain) name.append(element('small', '未列主清單', 'text-secondary'));
  const intro = element('td', undefined, 'intro-cell');
  if (dog.intro) {
    const detail = element('details');
    detail.append(element('summary', '查看介紹'), element('p', dog.intro));
    intro.append(detail);
  } else intro.append(element('span', '尚無介紹', 'text-secondary'));
  if (dog.note) intro.append(element('p', `試算表備註：${dog.note}`, 'sheet-note'));
  const care = element('td', undefined, 'maintenance');
  const labels = maintenance(dog);
  for (const label of labels) care.append(element('span', label, 'state-label'));
  if (!labels.length) care.append(element('span', '無待補項目', 'text-secondary'));
  if (dog.rest) care.append(element('p', `休養至 ${dog.rest.until}${dog.rest.reason ? ` · ${dog.rest.reason}` : ''}`, 'sheet-note'));
  const edit=document.createElement('button');edit.type='button';edit.className='btn';edit.textContent='編輯';edit.setAttribute('aria-label','編輯'+dog.name);edit.onclick=()=>openDogEditor(dog,byId('dog-editor'),load);
  const identity=element('td',dog.dogId,'identity');identity.append(edit);
  row.append(photo, element('td', dog.number || '未編號', 'dog-number'), name,
    element('td', dog.cage || '—'), element('td', sexLabel(dog.sex)), intro, care,
    identity);
  return row;
}
function render() {
  if (!state.loaded) return;
  const result = selectDogs(state.dogs, { ...state, query: byId('query').value,
    presence: byId('presence').value, sex: byId('sex').value, care: byId('care').value });
  state.page = result.page;
  byId('dogs').replaceChildren(...result.rows.map(renderRow));
  byId('table-region').hidden = !result.total;
  byId('pagination').hidden = !result.total;
  status.dataset.error = 'false';
  status.textContent = !state.dogs.length ? '目前沒有狗資料。可按「重新讀取」再確認。'
    : !result.total ? '沒有符合條件的狗，請清除或調整搜尋條件。'
    : `找到 ${result.total} 隻狗，共 ${state.dogs.length} 隻。`;
  const start = (result.page - 1) * result.pageSize + 1;
  byId('count').textContent = `${start}–${Math.min(start + result.pageSize - 1, result.total)} / ${result.total} 隻`;
  byId('page-number').textContent = `${result.page} / ${result.pages}`;
  byId('previous').disabled = result.page === 1;
  byId('next').disabled = result.page === result.pages;
  for (const button of document.querySelectorAll('[data-sort]')) {
    const th = button.closest('th');
    if (button.dataset.sort === state.sort) th.setAttribute('aria-sort', state.direction === 'asc' ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  }
}
async function load() {
  state.loaded = false;
  state.dogs = [];
  byId('dogs').replaceChildren();
  byId('table-region').hidden = true;
  byId('pagination').hidden = true;
  byId('refresh').disabled = true;
  status.dataset.error = 'false';
  status.textContent = '正在讀取狗資料…';
  const response = await readDogs();
  try {
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw Error('管理登入已失效，請重新整理頁面以登入。');
      throw Error('狗資料暫時無法讀取，請按「重新讀取」再試；若仍失敗，請重新整理頁面確認登入。');
    }
    state.dogs = parseManageDogs(response.data);
    state.loaded = true;
    render();
  } catch (error) {
    status.dataset.error = 'true';
    status.textContent = error.message;
  } finally { byId('refresh').disabled = false; }
}
byId('refresh').addEventListener('click', load);
byId('filters').addEventListener('submit', event => event.preventDefault());
byId('query').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.page = 1; render(); }, 180);
});
for (const id of ['presence', 'sex', 'care']) byId(id).addEventListener('change', () => { state.page = 1; render(); });
byId('filters').addEventListener('reset', () => { clearTimeout(searchTimer); state.page = 1; setTimeout(render, 0); });
byId('page-size').addEventListener('change', event => { state.pageSize = Number(event.target.value); state.page = 1; render(); });
for (const button of document.querySelectorAll('[data-sort]')) button.addEventListener('click', () => {
  state.direction = state.sort === button.dataset.sort && state.direction === 'asc' ? 'desc' : 'asc';
  state.sort = button.dataset.sort; state.page = 1; render();
});
byId('previous').addEventListener('click', () => { state.page--; render(); });
byId('next').addEventListener('click', () => { state.page++; render(); });
load();
