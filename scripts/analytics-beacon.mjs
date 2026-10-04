// 瀏覽統計（#128）：部署到 Cloudflare 前，把 Cloudflare Web Analytics 的 beacon 插進要上傳的 index.html
// - *.workers.dev 不能在 Cloudflare 後台自動開，要在網頁放官方 beacon；它不放 cookie、不收個資，只算人數和手機種類
// - token 放 GitHub Secret CF_ANALYTICS_TOKEN，只有正式部署（deploy-cloudflare.yml）會插，
//   所以舊網址 github.io 和 PR 預覽版都不會載入；沒設 Secret 就不插
// - 只改部署用的那份（GitHub Action 裡 checkout 出來的檔案），不提交回 repo
// 用法：CF_ANALYTICS_TOKEN=... node scripts/analytics-beacon.mjs [repo 根目錄]
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARK = 'data-cf-beacon';

export function isBeaconToken(token) {
  return typeof token === 'string' && /^[0-9a-f]{32}$/i.test(token);
}

// 在 </body> 前插入 beacon；token 不對或已經有 beacon 就原樣回傳
export function insertBeacon(html, token) {
  if (!isBeaconToken(token) || html.includes(MARK)) return html;
  const tag = `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${token}"}'></script>\n`;
  const i = html.lastIndexOf('</body>');
  if (i < 0) return html;
  return html.slice(0, i) + tag + html.slice(i);
}

export async function writeBeacon(root, token) {
  const path = join(root, 'index.html');
  const html = await readFile(path, 'utf8');
  const out = insertBeacon(html, token);
  if (out === html) return false;
  await writeFile(path, out);
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const token = (process.env.CF_ANALYTICS_TOKEN || '').trim();
  if (!token) {
    console.log('還沒設 GitHub Secret CF_ANALYTICS_TOKEN，這次不放瀏覽統計（步驟見 docs/CLOUDFLARE_SETUP.md）。');
  } else if (!isBeaconToken(token)) {
    console.log('CF_ANALYTICS_TOKEN 格式不對（應該是 32 個英數字），這次不放瀏覽統計。');
  } else {
    const done = await writeBeacon(process.argv[2] || '.', token);
    console.log(done ? '瀏覽統計：已放進 index.html（只給這次部署用，不提交）' : '瀏覽統計：index.html 已經有了');
  }
}
