const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 管理網站系統架構圖頁（K 2026-10-28）：六張圖在正式 CSP 下顯示、字型自架、箭頭指到同一張圖自己的 marker。
module.exports = async (browser, base) => {
  const { ADMIN_CSP } = await import('../worker/src/admin/index.js');
  const { DIAGRAMS } = await import('../scripts/admin-diagrams.mjs');
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
  await context.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(`${event.effectiveDirective}: ${event.blockedURI}`));
  });
  let jsonCode = 200;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/admin/public/diagrams.html') return route.fulfill({ body: fs.readFileSync(path.join(__dirname, '../admin/public/diagrams.html')), headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': ADMIN_CSP } });
    if (url.pathname === '/admin/public/shared/diagrams.json' && jsonCode !== 200) return route.fulfill({ status: jsonCode, body: '' });
    return route.continue();
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${base}/admin/public/diagrams.html`);
    await page.waitForFunction(n => document.querySelectorAll('#diagrams svg').length === n, DIAGRAMS.length);
    assert.deepEqual(await page.locator('#diagrams section').evaluateAll(s => s.map(x => x.id)), DIAGRAMS.map(n => `diagram-${n}`), '順序：整體 → 資料路線 → 排程與環境');
    assert.deepEqual(await page.locator('#diagram-jump a').evaluateAll(a => a.map(x => x.getAttribute('href'))), DIAGRAMS.map(n => `#diagram-${n}`));
    assert.equal(await page.locator('#diagram-jump a').first().textContent(), '志工溜狗表 系統架構');
    assert.match(await page.locator('#diagram-status').textContent(), /共 6 張/);
    for (const text of await page.locator('.diagram-version').allTextContents()) assert.match(text, /^(第 \d+ 版 · \d{4}\/\d{2}\/\d{2} 更新|版本與日期要正式部署後才看得到)$/);
    assert.equal(await page.locator('#diagrams .data-note').count(), DIAGRAMS.length);

    // 拆出去的 CSS 有套上、自架字型有載入
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('#diagram-architecture text.n').first().evaluate(t => getComputedStyle(t).fontWeight), '600');
    assert.ok(await page.evaluate(() => ['600 13px Geist', '9px "Geist Mono"', 'italic 15px "Instrument Serif"'].every(f => document.fonts.check(f))), '字型載入');
    // 每個 marker-end 都指到同一張圖裡的 marker
    const broken = await page.evaluate(() => [...document.querySelectorAll('#diagrams [marker-end]')].filter(el => {
      const id = el.getAttribute('marker-end').match(/url\(#(.+)\)/)[1];
      return !el.closest('section').querySelector(`marker[id="${id}"]`);
    }).length);
    assert.equal(broken, 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '1440px 不溢出');
    const shots = path.join(__dirname, '../.impeccable/review');
    fs.mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, 'diagrams-1440.png'), fullPage: true });

    // 讀不到就說讀取失敗
    jsonCode = 500;
    await page.reload();
    await page.waitForFunction(() => document.getElementById('diagram-status').dataset.error === 'true');
    assert.equal(await page.locator('#diagrams svg').count(), 0);

    assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
    assert.deepEqual(errors, []);
    console.log('系統架構圖：六張圖照順序、正式 CSP 下樣式與字型生效、marker 不串圖、讀取失敗提示');
  } finally {
    await context.close();
  }
};
