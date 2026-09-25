// 用無頭瀏覽器打開 tests/index.html，全部通過才算成功（#84，PR 自動跑測試用）
// 本機：npm install --no-save playwright && npx playwright install chromium，再 node scripts/run-browser-tests.cjs
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

// 簡單的靜態檔案伺服器：測試頁要用網址開，直接開檔案讀不到 js/app.js
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const browser = await chromium.launch();
  let ok = false;
  try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.error('頁面錯誤（不影響結果，只供參考）：', e.message));
    await page.goto(`http://localhost:${server.address().port}/tests/index.html`);
    await page.waitForFunction(() => /通過|失敗/.test(document.getElementById('summary').textContent), null, { timeout: 120000 });
    const summary = await page.textContent('#summary');
    const failed = await page.$$eval('li.fail', lis => lis.map(li => li.innerText));
    console.log(summary);
    failed.forEach(f => console.log(`✗ ${f.replace(/^✗\s*/, '')}`));
    ok = !failed.length && /^全部 \d+ 項通過$/.test(summary.trim());
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
