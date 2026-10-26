import { readSiteLinks } from './api.js';
import { byId, element } from './dom.js';

// 網站連結頁：正式版／測試版的志工網站與 GAS 網址，唯讀；值由部署時的 GitHub Secret 帶入（worker/src/admin/links.js）。
const ROWS = [
  { name: '正式版', site: 'site', gas: 'gas', siteSecret: 'WORKERS_SUBDOMAIN', gasSecret: 'GAS_URL' },
  { name: '測試版', site: 'testSite', gas: 'testGas', siteSecret: 'WORKERS_SUBDOMAIN', gasSecret: 'TEST_GAS_URL', test: true },
];

function linkCell(label, url, secret) {
  const cell = element('td');
  cell.dataset.label = label;
  if (!url) {
    cell.append(element('span', '還沒設定', 'text-secondary'), element('small', `GitHub Secret ${secret}`, 'link-hint'));
    return cell;
  }
  const a = element('a', new URL(url).host, 'link-url');
  a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  cell.append(a, element('small', url, 'link-hint'));
  return cell;
}

async function loadLinks() {
  const status = byId('links-status');
  const result = await readSiteLinks();
  const links = result.ok && result.data && typeof result.data === 'object' ? result.data : null;
  if (!links) {
    status.dataset.error = 'true';
    status.textContent = '網址讀取失敗，請重新讀取。';
    byId('links').replaceChildren();
    return;
  }
  status.removeAttribute('data-error');
  const missing = Object.values(links).filter(v => !v).length;
  status.textContent = missing ? `有 ${missing} 個網址還沒設定。` : '四個網址都設定好了，點了在新分頁開。';
  byId('links').replaceChildren(...ROWS.map(row => {
    const tr = element('tr');
    const th = element('th', row.name);
    th.scope = 'row';
    if (row.test) th.append(element('span', '測試資料', 'state-label link-test'));
    tr.append(th, linkCell('志工網站', links[row.site], row.siteSecret), linkCell('Apps Script（GAS）', links[row.gas], row.gasSecret));
    return tr;
  }));
}

byId('reload').addEventListener('click', async () => {
  byId('reload').disabled = true;
  await loadLinks();
  byId('reload').disabled = false;
});
loadLinks();
