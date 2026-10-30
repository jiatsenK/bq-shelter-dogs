import { createDogDrawer } from './dog-editor.js';
import { readDogs, readPairs, rejectPair, searchEdits } from './api.js';
import { parsePairs, pairText } from './dog-merge.js';
import { parseEditPage } from './edit-log.js';
import { JUDGE, judgeQuery } from './judgements.js';
import { judgeItem } from './judge-item.js';
import { parseManageDogs, selectDogs, orderDogs, maintenance, sexLabel, CARE_FILTERS, STATUS_LABELS, STATUS_TABS, statusCounts, statusText, shownNumber } from './dog-table.js';

const byId = id => document.getElementById(id);
// 狀態分頁預設在所（K 2026-10-26）；清除條件不換分頁
const state = { dogs: [], loaded: false, status: 'main', page: 1, pageSize: 25, sort: 'number', direction: 'asc', pairs: new Map(), pairCount: null };
// #775「系統自動判斷」不是狗的狀態：按下去換成判斷紀錄列表（修改紀錄裡系統判斷的那幾種），一次 50 筆，「載入更早的紀錄」接著讀
const judge = { edits: [], next: null, loaded: false, failed: '', seq: 0 };
const status = byId('status');
const FILTER_IDS = ['query', 'sex', 'care'];
let searchTimer;
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
// #624 編輯在右側抽屜：表格不動、只更新存過的那一列，關閉後焦點回到原列的「編輯」
const drawer = createDogDrawer(byId('dog-drawer'), {
  onSaved: dog => {
    state.dogs = state.dogs.map(old => (old.dogId === dog.dogId ? dog : old));
    const row = rowOf(dog.dogId);
    if (row) row.replaceWith(renderRow(dog));
  },
  onNext: (dogId, notice) => openNext(dogId, notice),
  onClose: dogId => {
    markSelected(null);
    (editButton(dogId) || byId('content')).focus();
  },
  // 合併要從整張狗表挑另一隻；合併完被併的那隻消失，整張重讀
  dogs: () => state.dogs,
  onMerged: message => reloadWith(message),
  // 記成已出所：那隻狗換到已出所分頁，整張重讀
  onDeparted: message => reloadWith(message),
});
// 整張狗表重讀，結果訊息排在讀完的狀態前面
const reloadWith = message => load().then(() => { status.textContent = `${message} ${status.textContent}`; });
const rowOf = dogId => [...byId('dogs').rows].find(row => row.dataset.dogId === dogId);
const editButton = dogId => rowOf(dogId)?.querySelector('.edit-button');
function markSelected(dogId) {
  for (const row of byId('dogs').rows) {
    const on = row.dataset.dogId === dogId;
    row.classList.toggle('is-selected', on);
    row.querySelector('.edit-button')?.setAttribute('aria-expanded', String(on));
  }
}
// 開抽屜時記下當時的篩選＋排序順序；「存並開下一隻」照這份順序往後走，
// 不在存檔後重算（剛補完的狗會掉出篩選，重算會跳回開頭）
let queue = [];
// 開抽屜會讓表格切精簡欄、內容讓位，列高跟著變：把被點的列留在原本的螢幕位置，看不到時才捲進來
function openDog(dog, { keepQueue = false, ...options } = {}) {
  const top = rowOf(dog.dogId)?.getBoundingClientRect().top;
  if (!drawer.open(dog, options)) return;
  if (!keepQueue) queue = orderDogs(state.dogs, filters()).map(d => d.dogId);
  markSelected(dog.dogId);
  const row = rowOf(dog.dogId);
  if (!row) return;
  if (top !== undefined) scrollBy({ top: row.getBoundingClientRect().top - top, behavior: 'instant' });
  row.scrollIntoView({ block: 'nearest', behavior: 'instant' });
}
function filters() {
  return { ...state, query: byId('query').value, sex: byId('sex').value, care: byId('care').value };
}
// 從記下的順序裡這隻的下一個開始找，跳過已經不符合目前篩選的（例如別人剛補好）
function openNext(dogId, notice) {
  const ordered = orderDogs(state.dogs, filters());
  const position = new Map(ordered.map((dog, i) => [dog.dogId, i]));
  const next = queue.slice(queue.indexOf(dogId) + 1).find(id => position.has(id));
  if (!next) {
    drawer.close();
    status.textContent = `${notice}這份清單處理完了。`;
    return;
  }
  const page = Math.floor(position.get(next) / state.pageSize) + 1;
  if (page !== state.page) { state.page = page; render(); }
  openDog(ordered[position.get(next)], { notice, force: true, keepQueue: true });
}
function renderRow(dog) {
  const row = document.createElement('tr');
  row.dataset.dogId = dog.dogId;
  if (drawer.dogId === dog.dogId) row.classList.add('is-selected');
  const editCell = element('td', undefined, 'edit-cell');
  const edit = element('button', '編輯', 'btn btn-sm edit-button');
  edit.type = 'button';
  edit.setAttribute('aria-label', '編輯' + (dog.name || '未命名'));
  edit.setAttribute('aria-controls', 'dog-drawer');
  edit.setAttribute('aria-expanded', String(drawer.dogId === dog.dogId));
  edit.addEventListener('click', () => openDog(state.dogs.find(d => d.dogId === dog.dogId)));
  editCell.append(edit);
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
  if (dog.status !== 'main') name.append(element('small', statusText(dog), 'text-secondary'));
  for (const pair of state.pairs.get(dog.dogId) || []) name.append(pairLine(dog, pair));
  if (dog.status === 'unknown') name.append(departLine(dog));
  const intro = element('td', undefined, 'intro-cell col-wide');
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
  const number = element('td', shownNumber(dog) || '未編號', 'dog-number');
  if (!dog.number && dog.formerNumber) number.append(element('small', '舊編號', 'text-secondary'));
  row.append(editCell, photo, number, name,
    element('td', dog.cage || '—', 'col-wide'), element('td', sexLabel(dog.sex), 'col-wide'), intro, care,
    element('td', dog.dogId, 'identity col-wide'));
  return row;
}
// #774 待核對的狗名下：系統配的「可能是同一隻」。合併開抽屜、先選好那一隻預覽（照現有合併，按兩次才寫入）；
// 不是同一隻按兩次才送，這一組之後不再出現
function pairLine(dog, pair) {
  const line = element('div', undefined, 'pair-line');
  const merge = element('button', '合併', 'btn btn-sm');
  merge.type = 'button';
  merge.setAttribute('aria-label', `${pairText(pair)}：合併`);
  merge.addEventListener('click', () => openDog(state.dogs.find(d => d.dogId === dog.dogId), { mergeWith: pair.dogId }));
  const reject = element('button', '不是同一隻', 'btn btn-sm');
  reject.type = 'button';
  reject.setAttribute('aria-label', `${pairText(pair)}：不是同一隻`);
  let armed = false;
  reject.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      reject.textContent = '確定不是同一隻';
      reject.setAttribute('aria-label', `${pairText(pair)}：確定不是同一隻`);
      reject.className = 'btn btn-sm btn-danger';
      return;
    }
    reject.disabled = merge.disabled = true;
    const response = await rejectPair(pair.goneDogId, pair.dogId);
    status.dataset.error = String(!response.ok);
    if (!response.ok) {
      reject.disabled = merge.disabled = false;
      status.textContent = response.data?.error || '沒有記成不是同一隻，請重新讀取再試。';
      return;
    }
    const left = state.pairs.get(dog.dogId).filter(p => p !== pair);
    if (left.length) state.pairs.set(dog.dogId, left); else state.pairs.delete(dog.dogId);
    if (state.pairCount) state.pairCount--;
    render();
    status.textContent = `已記下：${dog.name || '未命名'}跟 ${pair.name || '未命名'}（${pair.cage}）不是同一隻，之後不再列出。`;
  });
  line.append(element('span', pairText(pair)), merge, reject);
  return line;
}
// 待核對的狗名下：不是重複、是出所沒記到的，開抽屜填離所日與原因（K 2026-10-30）
function departLine(dog) {
  const line = element('div', undefined, 'pair-line');
  const depart = element('button', '記成已出所', 'btn btn-sm');
  depart.type = 'button';
  depart.setAttribute('aria-label', `${dog.name || '未命名'}：記成已出所`);
  depart.addEventListener('click', () => openDog(state.dogs.find(d => d.dogId === dog.dogId), { departing: true }));
  line.append(depart);
  return line;
}
async function loadJudgements(more = false) {
  const seq = ++judge.seq;
  if (!more) Object.assign(judge, { edits: [], next: null, loaded: false, failed: '' });
  byId('judge-more').disabled = true;
  render();
  const result = await searchEdits(judgeQuery({ cursor: more ? judge.next : null, size: 50 }));
  if (seq !== judge.seq) return;
  byId('judge-more').disabled = false;
  try {
    if (!result.ok) throw Error(result.data?.error || '系統自動判斷的紀錄讀不到，請按「重新讀取」再試。');
    const page = parseEditPage(result.data);
    Object.assign(judge, { edits: [...judge.edits, ...page.edits], next: page.next, failed: '' });
  } catch (error) { judge.failed = error.message; }
  judge.loaded = true;
  render();
}
function renderJudgements() {
  byId('table-region').hidden = true;
  byId('pagination').hidden = true;
  // 自動合併判斷錯了直接取消合併，拆回來之後狗表與紀錄一起重讀
  byId('judgements').replaceChildren(...judge.edits.map(e => judgeItem(e, { onUnmerged: () => load() })));
  byId('judge-more').hidden = !judge.next;
  const pairs = state.pairCount === null ? '' : `等確認的可能是同一隻 ${state.pairCount} 組。`;
  status.dataset.error = String(Boolean(judge.failed));
  status.textContent = judge.failed || (!judge.loaded ? '正在讀取系統自動判斷的紀錄…'
    : `${judge.edits.length ? `系統自動判斷 ${judge.edits.length} 筆${judge.next ? '，還有更早的' : ''}。` : '還沒有系統自動判斷的紀錄。'}${pairs}時間為台灣時間。`);
}
// 篩選條件放進網址（待補清單連過來、重新整理都保留）；dog 參數只在進頁時用來開抽屜
function syncUrl() {
  const params = new URLSearchParams();
  for (const id of FILTER_IDS) {
    const value = byId(id).value.trim();
    if (value) params.set(id, value);
  }
  if (state.status !== 'main') params.set('status', state.status);
  const search = params.toString();
  history.replaceState(null, '', search ? `?${search}` : location.pathname);
}
function readUrl() {
  const params = new URLSearchParams(location.search);
  if ([...STATUS_TABS, JUDGE].includes(params.get('status'))) state.status = params.get('status');
  const allowed = { sex: ['', 'male', 'female', 'unknown'], care: ['', ...Object.keys(CARE_FILTERS)] };
  if (params.has('query')) byId('query').value = params.get('query').slice(0, 200);
  for (const [id, values] of Object.entries(allowed)) if (values.includes(params.get(id))) byId(id).value = params.get(id);
  return params.get('dog');
}
function render() {
  if (!state.loaded) return;
  // 系統自動判斷的數字只算等確認的配對；配對讀不到就不寫數字
  const counts = { ...statusCounts(state.dogs), [JUDGE]: state.pairCount ?? '' };
  for (const button of document.querySelectorAll('[data-status]')) {
    const active = button.dataset.status === state.status;
    button.setAttribute('aria-pressed', String(active));
    button.classList.toggle('btn-primary', active);
    button.querySelector('[data-count]').textContent = counts[button.dataset.status];
  }
  const judging = state.status === JUDGE;
  byId('filters').hidden = judging;
  byId('judge-region').hidden = !judging;
  if (judging) return renderJudgements();
  const result = selectDogs(state.dogs, filters());
  state.page = result.page;
  byId('dogs').replaceChildren(...result.rows.map(renderRow));
  byId('table-region').hidden = !result.total;
  byId('pagination').hidden = !result.total;
  status.dataset.error = 'false';
  const care = byId('care').value;
  status.textContent = !state.dogs.length ? '目前沒有狗資料。可按「重新讀取」再確認。'
    : !result.total ? '沒有符合條件的狗，請清除或調整搜尋條件。'
    : `${STATUS_LABELS[state.status] || '全部'}找到 ${result.total} 隻狗${care ? `（${CARE_FILTERS[care]}）` : ''}，資料庫共 ${state.dogs.length} 隻。`;
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
async function load(openId) {
  state.loaded = false;
  state.dogs = [];
  byId('dogs').replaceChildren();
  byId('table-region').hidden = true;
  byId('pagination').hidden = true;
  byId('refresh').disabled = true;
  status.dataset.error = 'false';
  status.textContent = '正在讀取狗資料…';
  const [response, pairs] = await Promise.all([readDogs(), readPairs()]);
  try {
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw Error('管理登入已失效，請重新整理頁面以登入。');
      throw Error('狗資料暫時無法讀取，請按「重新讀取」再試；若仍失敗，請重新整理頁面確認登入。');
    }
    state.dogs = parseManageDogs(response.data);
    // 配對讀不到不擋狗資料表，另外說一聲
    try {
      if (!pairs.ok) throw Error();
      ({ byGone: state.pairs, count: state.pairCount } = parsePairs(pairs.data));
      byId('pair-note').hidden = true;
    } catch {
      state.pairs = new Map();
      state.pairCount = null;
      byId('pair-note').hidden = false;
    }
    state.loaded = true;
    if (openId) {
      const index = orderDogs(state.dogs, filters()).findIndex(dog => dog.dogId === openId);
      if (index >= 0) state.page = Math.floor(index / state.pageSize) + 1;
    }
    render();
    if (state.status === JUDGE) loadJudgements();
    const target = openId && state.dogs.find(dog => dog.dogId === openId);
    if (target) openDog(target);
    else if (openId) status.textContent += ' 找不到網址指定的那隻狗。';
  } catch (error) {
    status.dataset.error = 'true';
    status.textContent = error.message;
  } finally { byId('refresh').disabled = false; }
}
const filtersChanged = () => { state.page = 1; syncUrl(); render(); };
// 重新讀取只換表格；抽屜裡的草稿不動，選取底色由 renderRow 依抽屜目前的狗補回
byId('refresh').addEventListener('click', () => load());
byId('filters').addEventListener('submit', event => event.preventDefault());
byId('query').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(filtersChanged, 180);
});
for (const id of ['sex', 'care']) byId(id).addEventListener('change', filtersChanged);
for (const button of document.querySelectorAll('[data-status]')) button.addEventListener('click', () => {
  state.status = button.dataset.status;
  filtersChanged();
  if (state.status === JUDGE) loadJudgements();
});
byId('judge-more').addEventListener('click', () => loadJudgements(true));
byId('filters').addEventListener('reset', () => { clearTimeout(searchTimer); setTimeout(filtersChanged, 0); });
byId('page-size').addEventListener('change', event => { state.pageSize = Number(event.target.value); state.page = 1; render(); });
for (const button of document.querySelectorAll('[data-sort]')) button.addEventListener('click', () => {
  state.direction = state.sort === button.dataset.sort && state.direction === 'asc' ? 'desc' : 'asc';
  state.sort = button.dataset.sort; state.page = 1; render();
});
byId('previous').addEventListener('click', () => { state.page--; render(); });
byId('next').addEventListener('click', () => { state.page++; render(); });
load(readUrl());
