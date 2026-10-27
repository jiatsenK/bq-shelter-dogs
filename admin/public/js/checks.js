import { readDogs, readDataChecks, readCronStatus } from './api.js';
import { parseManageDogs, statusText, shownNumber } from './dog-table.js';
import { completeness, careLink, parseSheetGaps, gapStatus, SHEET_LABELS, CRON_LABELS, parseCronStatus, cronStatus, parseStoppedWalks, stoppedStatus } from './data-checks.js';
import { showVolunteerState } from './volunteer-state.js';
import { possibleDuplicates } from './dog-merge.js';
import { byId, element } from './dom.js';

// #567 待補清單（原資料檢查）頁：每個區塊各自讀取、各自顯示失敗；讀不到時明說「無法判斷」，不當成沒有缺漏。
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
    return null;
  }
  const { total, items } = completeness(dogs);
  status.textContent = `主清單上共 ${total} 隻；展開項目看是哪幾隻，點狗名直接編輯。`;
  list.append(...items.map(item => {
    if (!item.dogs.length) {
      const ok = element('div', undefined, 'check-item ok');
      ok.append(element('span', item.label), element('b', '0 隻'));
      return ok;
    }
    const details = element('details', undefined, 'check-item');
    const summary = element('summary');
    summary.append(element('span', item.label), element('b', `${item.dogs.length} 隻`));
    // #624 項目連到已篩選的狗資料表，狗名直接開那隻狗的編輯抽屜
    const filtered = element('a', `在狗資料表看這 ${item.dogs.length} 隻`, 'check-filter-link');
    filtered.href = careLink(item.care);
    const names = element('ul', undefined, 'check-dogs');
    names.append(...item.dogs.map(d => {
      const li = element('li'), link = element('a', d.name || '未命名');
      link.href = careLink(item.care, d.dogId);
      li.append(link, ` ${d.number ? `（${d.number}）` : '（無編號）'}`);
      return li;
    }));
    details.append(summary, filtered, names);
    return details;
  }));
  return dogs;
}

// 可能重複（K 2026-10-26，#621）：同名、一隻在所一隻不在所；連到狗資料表直接開不在所那隻的抽屜，在抽屜底下合併
function renderDuplicates(dogs) {
  const status = byId('dup-status'), region = byId('dup-region');
  status.removeAttribute('data-error'); region.hidden = true;
  if (!dogs) { failed(status, '狗資料讀取失敗。這不代表沒有重複，請重新讀取。'); return; }
  const pairs = possibleDuplicates(dogs);
  status.textContent = pairs.length ? `${pairs.length} 組名字一樣、一隻在所一隻不在所。` : '沒有名字一樣、一隻在所一隻不在所的狗。';
  const dog = d => `${d.name || '未命名'}（${shownNumber(d) || '無編號'}）`;
  byId('dups').replaceChildren(...pairs.map(({ main, extra }) => {
    const row = document.createElement('tr');
    const link = element('a', '打開合併');
    link.href = `./?${new URLSearchParams({ query: main.name, status: 'all', dog: extra.dogId })}`;
    const action = element('td');
    action.append(link);
    row.append(element('td', dog(main), 'dog-name'), element('td', `${dog(extra)}・${statusText(extra)}`, 'dog-name'), action);
    return row;
  }));
  region.hidden = !pairs.length;
}

// 稽核第 5 項：排程最後一次跑完的時間；讀不到不當成有在跑
function renderCron(result) {
  const status = byId('cron-status'), region = byId('cron-region');
  status.removeAttribute('data-error'); status.removeAttribute('data-stale'); region.hidden = true;
  let jobs;
  try {
    if (!result.ok) throw Error(result.data?.error);
    jobs = parseCronStatus(result.data);
  } catch (error) {
    failed(status, `${error.message || '排程紀錄讀取失敗'}。這不代表排程有在跑，請重新讀取。`);
    byId('stopped-region').hidden = true;
    failed(byId('stopped-status'), '讀不到停止重試的狗，不能當成沒有，請重新讀取。');
    return;
  }
  const rows = jobs.map(j => ({ j, s: cronStatus(j) }));
  const bad = rows.filter(r => r.s.bad).length;
  status.textContent = bad ? `${bad} 件排程需要注意。` : '排程都有按時跑完。';
  if (bad) status.dataset.stale = 'true';
  byId('cron-jobs').replaceChildren(...rows.map(({ j, s }) => {
    const row = document.createElement('tr');
    const problem = element('td', s.problem);
    if (s.bad) problem.dataset.stale = 'true';
    row.append(element('td', CRON_LABELS[j.job].name), element('td', CRON_LABELS[j.job].every), element('td', s.last), problem);
    return row;
  }));
  region.hidden = false;
  renderStopped(result.data);
}

// #684 寫回停止重試的狗，放在排程下面；格式不對只說讀不懂，不當成沒有
function renderStopped(data) {
  const status = byId('stopped-status'), region = byId('stopped-region');
  status.removeAttribute('data-error'); region.hidden = true;
  let list;
  try { list = parseStoppedWalks(data); } catch (error) { failed(status, `${error.message}，不能當成沒有停住的狗。`); return; }
  status.textContent = stoppedStatus(list);
  if (list.length) status.dataset.stale = 'true'; else status.removeAttribute('data-stale');
  byId('stopped-dogs').replaceChildren(...list.map(d => {
    const row = document.createElement('tr');
    row.append(element('td', d.number ? `${d.number} ${d.name}` : d.name, 'dog-name'), element('td', d.date),
      element('td', `${d.failures} 次`), element('td', d.reason));
    return row;
  }));
  region.hidden = !list.length;
}

async function load() {
  byId('reload').disabled = true;
  byId('gap-status').textContent = '正在讀取掃描清單…';
  byId('complete-status').textContent = '正在讀取狗資料…';
  byId('dup-status').textContent = '正在讀取狗資料…';
  byId('cron-status').textContent = '正在讀取排程紀錄…';
  byId('stopped-status').textContent = '正在讀取停止重試的狗…';
  const [gaps, dogs, cron] = await Promise.all([readDataChecks(), readDogs(), readCronStatus()]);
  renderGaps(gaps);
  renderDuplicates(renderCompleteness(dogs));
  renderCron(cron);
  byId('reload').disabled = false;
}
byId('reload').addEventListener('click', load);
showVolunteerState(byId('volunteer-state'), [['showQuality', '資料檢查顯示中', '資料檢查已隱藏']]);
load();
