// 網站連結頁：正式版／測試版的志工網站、試算表與 Apps Script 網址。
// repo 公開（#493），網址不寫在檔案裡：deploy-admin.yml 用 --var 從 GitHub Secret 帶進來（WORKERS_SUBDOMAIN 組網站網址、SHEET_URL／TEST_SHEET_URL、GAS_URL／TEST_GAS_URL）。
// 沒設或格式不對就回 null，頁面寫「還沒設定」，不猜網址。
const GAS_HOSTS = new Set(['script.google.com', 'docs.google.com']);
const SHEET_HOSTS = new Set(['docs.google.com']);
export const SITE_LINKS = [
  { key: 'site', env: 'SITE_URL', label: '正式版網址' },
  { key: 'testSite', env: 'TEST_SITE_URL', label: '測試版網址' },
  { key: 'sheet', env: 'SHEET_URL', label: '正式版試算表', hosts: SHEET_HOSTS },
  { key: 'testSheet', env: 'TEST_SHEET_URL', label: '測試版試算表', hosts: SHEET_HOSTS },
  { key: 'gas', env: 'GAS_URL', label: '正式版 GAS', hosts: GAS_HOSTS },
  { key: 'testGas', env: 'TEST_GAS_URL', label: '測試版 GAS', hosts: GAS_HOSTS },
];

function httpsUrl(value, hosts) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (hosts && !hosts.has(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

export function readSiteLinks(env) {
  return Object.fromEntries(SITE_LINKS.map(link => [link.key, httpsUrl(env[link.env], link.hosts)]));
}
