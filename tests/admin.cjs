const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async (browser, base) => {
  const { ADMIN_CSP } = await import('../worker/src/admin/index.js');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(`${event.effectiveDirective}: ${event.blockedURI}`));
  });
  const dogs = Array.from({ length: 63 }, (_, i) => ({ dogId: (i + 1).toString(16).padStart(32, '0'),
    number: String(2026010101 + i), name: i ? `測試狗 ${i + 1}` : '阿福', cage: i % 2 ? 'B2' : 'A1',
    intro: i % 3 ? '親人，喜歡散步。牽繩時請放慢腳步，給牠一點時間。' : '', note: i ? '' : '<img src=x onerror=alert(1)>',
    sex: i % 4 ? 'male' : '', onMain: i !== 62, fixedCare: i === 2,
    rest: i === 1 ? { until: '2099-01-01', reason: '術後休養' } : null, photoUrl: i === 2 ? '/photos/missing.jpg' : null }));
  let result = { dogs }, code = 200, apiCalls = 0;
  const methods = [];
  const errors = [];
  await ctx.route('**/*', route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/api/manage/dogs') {
      apiCalls++; methods.push(req.method());
      return route.fulfill({ status: code, json: result });
    }
    if (url.pathname.startsWith('/photos/')) return route.fulfill({ status: 404 });
    if (url.pathname === '/admin/public/index.html') return route.fulfill({
      body: fs.readFileSync(path.join(__dirname, '../admin/public/index.html')),
      headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': ADMIN_CSP },
    });
    return route.continue();
  });
  const page = await ctx.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const rows = page.locator('#dogs tr');
  const loaded = () => page.waitForFunction(() => !document.getElementById('refresh').disabled);
  try {
    await page.goto(`${base}/admin/public/index.html`);
    await loaded();
    assert.equal(await rows.count(), 25);
    // #624 側欄分「資料」「志工網站」兩組；重新讀取是次要按鈕
    assert.deepEqual(await page.locator('.nav-heading').allTextContents(), ['資料', '志工網站']);
    assert.deepEqual(await page.locator('.nav-group').evaluateAll(groups => groups.map(g => [...g.querySelectorAll('a')].map(a => a.textContent))),
      [['狗資料', '活動紀錄', '待補清單'], ['志工網站設定', '修改紀錄', '網站更新']]);
    assert.equal(await page.locator('#refresh.btn-primary').count(), 0);
    assert.equal(await page.locator('#next').isEnabled(), true);
    assert.equal(await page.locator('#previous').isDisabled(), true);
    assert.equal(await page.locator('#dogs img[src="x"]').count(), 0);
    await page.getByText('照片讀不到', { exact: true }).waitFor();
    await page.locator('#next').click();
    assert.equal(await page.locator('#page-number').textContent(), '2 / 3');
    await page.locator('#page-size').selectOption('50');
    assert.equal(await rows.count(), 50);
    await page.locator('#query').fill('阿福');
    await page.waitForFunction(() => document.querySelectorAll('#dogs tr').length === 1);
    assert.match(await rows.first().textContent(), /阿福/);
    await page.locator('#clear').click();
    await page.waitForFunction(() => document.querySelectorAll('#dogs tr').length === 50);
    await page.locator('#presence').selectOption('other');
    assert.equal(await rows.count(), 1);
    await page.locator('#clear').click();
    await page.locator('#care').selectOption('rest');
    assert.equal(await rows.count(), 1);
    assert.match(await rows.first().textContent(), /術後休養/);
    await page.locator('#clear').click();
    await page.waitForFunction(() => document.querySelectorAll('#dogs tr').length === 50);
    await page.locator('[data-sort="number"]').click();
    assert.match(await rows.first().textContent(), /2026010163/);
    assert.equal(await page.locator('th[aria-sort="descending"]').count(), 1);
    assert.equal(apiCalls, 1, 'search/filter/sort/page must not request D1 again');
    await page.locator('#query').fill('找不到的狗');
    await page.getByText('沒有符合條件的狗，請清除或調整搜尋條件。', { exact: true }).waitFor();
    await page.locator('#clear').click();
    await page.waitForFunction(() => document.querySelectorAll('#dogs tr').length === 50);
    await page.locator('#page-size').selectOption('25');
    await page.locator('[data-sort="number"]').click();
    const contrast = async selector => page.locator(selector).evaluate(node => {
      const css = getComputedStyle(node);
      const luminance = color => {
        const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      const a = luminance(css.color), b = luminance(css.backgroundColor);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    });
    await page.locator('#refresh').hover();
    assert.ok(await contrast('#refresh') >= 4.5, 'reload hover contrast meets AA');
    await page.locator('.skip-link').focus();
    await page.locator('.skip-link').hover();
    assert.ok(await contrast('.skip-link') >= 4.5, 'skip-link hover contrast meets AA');
    await page.locator('#query').focus();
    fs.mkdirSync(path.join(__dirname, '../.impeccable/review'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, '../.impeccable/review/desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('.admin-sidebar nav a[href="./releases.html"]').isVisible(), true, '#624 導覽六項都可進入');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'only table/nav regions may scroll horizontally');
    await page.screenshot({ path: path.join(__dirname, '../.impeccable/review/mobile.png'), fullPage: true });
    code = 401;
    await page.locator('#refresh').click();
    await loaded();
    assert.match(await page.locator('#status').textContent(), /登入已失效/);
    assert.equal(await rows.count(), 0, 'stale data cleared on authorization loss');
    code = 503;
    await page.locator('#refresh').click();
    await loaded();
    assert.match(await page.locator('#status').textContent(), /暫時無法讀取/);
    code = 200; result = {};
    await page.locator('#refresh').click();
    await loaded();
    assert.match(await page.locator('#status').textContent(), /格式不正確/);
    result = { dogs: [] };
    await page.locator('#refresh').click();
    await loaded();
    assert.match(await page.locator('#status').textContent(), /目前沒有狗資料/);
    result = { dogs };
    await page.locator('#refresh').click();
    await loaded();
    assert.equal(await rows.count(), 25);
    assert.equal(await page.locator('[contenteditable],textarea').count(), 0);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).length), 0);
    assert.equal(methods.every(method => method === 'GET'), true);
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => window.cspViolations), [], 'shipped CSP permits the real admin controls without violations');
    console.log('#564 管理表格：搜尋／篩選／排序／分頁、空白／錯誤／登入失效、XSS、重試、手機溢出與截圖通過');
  } finally { await ctx.close(); }
};
