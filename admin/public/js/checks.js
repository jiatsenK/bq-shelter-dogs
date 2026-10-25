import { readDogs, readDataChecks } from './api.js';
import { parseManageDogs } from './dog-table.js';
import { completeness, parseSheetGaps, gapStatus, SHEET_LABELS } from './data-checks.js';
import { showVolunteerState } from './volunteer-state.js';

// #567 資料檢查頁：兩個區塊各自讀取、各自顯示失敗；讀不到時明說「無法判斷」，不當成沒有缺漏。
const byId = id => document.getElementById(id);
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
const failed = (node, text) => { node.dataset.error = 'true'; node.textContent = text; };

function renderGaps(result) {
  const status = byId('gap-status'), region = byId('gap-region');
  status.removeAttribute('data-error'); region.hidden = true;
  let gaps;
  try {
    if (!result.ok) throw Error(result.data?.error);
    gaps = parseSheetGaps(result.data);
  } catch (error) {
    failed(status, `${error.message || '掃描清單讀取失敗'}。這不代表沒有差異，請重新讀取。`);
    return;
  }
  if (gaps.state === 'error') failed(status, gapStatus(gaps));
  else status.textContent = gaps.state === 'ok'
    ? `${gaps.total ? `共 ${gaps.total} 筆${gaps.total > gaps.items.length ? `（只顯示前 ${gaps.items.length} 筆）` : ''}` : '目前沒有網站有、試算表沒有的資料'}。${gapStatus(gaps)}`
    : gapStatus(gaps);
  if (gaps.stale) status.dataset.stale = 'true'; else status.removeAttribute('data-stale');
  byId('gaps').replaceChildren(...gaps.items.map(item => {
    const row = document.createElement('tr');
    row.append(element('td', SHEET_LABELS[item.sheet] || item.sheet), element('td', item.number || '—', 'dog-number'),
      element('td', item.name || '—', 'dog-name'), element('td', item.cage || '—'), element('td', item.dogId || 'D1 已找不到這筆', 'identity'));
    return row;
  }));
  region.hidden = !gaps.items.length;
}

function renderCompleteness(result) {
  const status = byId('complete-status'), list = byId('complete-list');
  status.removeAttribute('data-error'); list.replaceChildren();
  let dogs;
  try {
    if (!result.ok) throw Error(result.data?.error);
    dogs = parseManageDogs(result.data);
  } catch (error) {
    failed(status, `${error.message || '狗資料讀取失敗'}。以下項目暫時無法判斷，不代表沒有缺漏。`);
    return;
  }
  const { total, items } = completeness(dogs);
  status.textContent = `主清單上共 ${total} 隻；點項目看是哪幾隻。`;
  list.append(...items.map(item => {
    if (!item.dogs.length) {
      const ok = element('div', undefined, 'check-item ok');
      ok.append(element('span', item.label), element('b', '0 隻'));
      return ok;
    }
    const details = element('details', undefined, 'check-item');
    const summary = element('summary');
    summary.append(element('span', item.label), element('b', `${item.dogs.length} 隻`));
    const names = element('ul', undefined, 'check-dogs');
    names.append(...item.dogs.map(d => element('li', d.number ? `${d.name}（${d.number}）` : `${d.name}（無編號）`)));
    details.append(summary, names);
    return details;
  }));
}

async function load() {
  byId('reload').disabled = true;
  byId('gap-status').textContent = '正在讀取掃描清單…';
  byId('complete-status').textContent = '正在讀取狗資料…';
  const [gaps, dogs] = await Promise.all([readDataChecks(), readDogs()]);
  renderGaps(gaps);
  renderCompleteness(dogs);
  byId('reload').disabled = false;
}
byId('reload').addEventListener('click', load);
showVolunteerState(byId('volunteer-state'), [['showQuality', '資料檢查顯示中', '資料檢查已隱藏']]);
load();
