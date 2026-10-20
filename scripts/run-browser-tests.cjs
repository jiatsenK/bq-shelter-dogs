// 用無頭瀏覽器打開 tests/index.html，全部通過才算成功（#84，PR 自動跑測試用）
// 本機：npm install --no-save playwright && npx playwright install chromium，再 node scripts/run-browser-tests.cjs
const http = require('http');
const fs = require('fs');
const path = require('path');
const SUITES = ['read-policy', 'startup-stability', 'walker-editing', 'intake-presentation', 'info-page', 'fixed-care',
  'group-cache', 'group-walks', 'large-text', 'navigation', 'keyboard-viewport', 'index', 'detail-editing'];

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
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--list') { console.log(SUITES.join('\n')); return; }
  if (args.length === 1 && args[0] === '--help') {
    console.log('node scripts/run-browser-tests.cjs [--list | --only suite[,suite]]\n未指定參數時跑全部套件。'); return;
  }
  let selected = SUITES;
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--only') throw new Error('請用 --list、--help 或 --only suite[,suite]');
    const names = args[1].split(',');
    if (names.some(n => !SUITES.includes(n))) throw new Error(`未知套件：${names.filter(n => !SUITES.includes(n)).join(',')}；用 --list 查看`);
    selected = SUITES.filter(n => names.includes(n));
  }
  const { chromium } = require('playwright'); // --list／參數檢查不需要安裝瀏覽器
  let browser;
  let ok = true;
  try {
    await new Promise(r => server.listen(0, r));
    browser = await chromium.launch();
    const base = `http://localhost:${server.address().port}`;
    for (const suite of selected) {
      if (suite !== 'index') { await require(`../tests/${suite}.cjs`)(browser, base); continue; }
      const page = await browser.newPage();
      page.on('pageerror', e => console.error('頁面錯誤（不影響結果，只供參考）：', e.message));
      await page.goto(`${base}/tests/index.html`);
      await page.waitForFunction(() => /通過|失敗/.test(document.getElementById('summary').textContent), null, { timeout: 120000 });
      const summary = await page.textContent('#summary');
      const failed = await page.$$eval('li.fail', lis => lis.map(li => li.innerText));
      console.log(summary);
      failed.forEach(f => console.log(`✗ ${f.replace(/^✗\s*/, '')}`));
      ok = !failed.length && /^全部 \d+ 項通過$/.test(summary.trim());
      await page.close();
      if (!ok) break;
    }
  } finally {
    await browser?.close();
    server.close();
  }
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
