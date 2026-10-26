// 測試網站換裝（worker/src/test-site.js）：網頁經過同一個換裝函式後，頁首是測試紫、標題旁有「測試版」，
// 正式版（沒換裝）照舊深綠、沒有標籤；手機與電腦寬度都不橫向溢出。截圖放 .impeccable/review/test-site-*.png 供人工比對。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PURPLE = 'rgb(90, 42, 94)';
module.exports = async function verifyTestSite(browser, baseUrl) {
  const { testSiteHtml } = await import('../worker/src/test-site.js');
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/dogs.json'), 'utf8'));
  const shots = path.join(__dirname, '../.impeccable/review');
  fs.mkdirSync(shots, { recursive: true });
  const open = async (width, test) => {
    const context = await browser.newContext({ viewport: { width, height: width < 800 ? 844 : 900 }, serviceWorkers: 'block' });
    await context.addInitScript(() => { localStorage.setItem('bq-onboarded', '1'); localStorage.setItem('bq-name-later', '1'); });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== baseUrl) return route.abort();
      if (url.pathname.includes('/api/')) {
        const endpoint = url.pathname.split('/api/')[1];
        return route.fulfill({ json: endpoint === 'dogs' ? fixture : endpoint === 'rest' ? { rest: {} } : endpoint === 'walkers' ? { walkers: [] } : endpoint === 'edits' ? { edits: [] } : { source: 'd1', walks: [], departures: [] } });
      }
      if (!test || !url.pathname.endsWith('.html')) return route.continue();
      const res = await route.fetch();
      return route.fulfill({ response: res, body: testSiteHtml(await res.text()) });
    });
    return context;
  };
  // groups.html 直接轉回溜狗表（常溜狗群在溜狗表裡），不另外檢查
  const headerOf = { index: 'header.app', edits: 'header', cards: '.bq-mast h1' };
  const tagOf = { index: '.brand h1', edits: 'header h1', cards: '.bq-mast' };
  for (const width of [390, 1440]) {
    for (const test of [true, false]) {
      const context = await open(width, test);
      const page = await context.newPage();
      try {
        for (const name of ['index', 'edits', 'cards']) {
          await page.goto(`${baseUrl}/public/${name}.html`);
          await page.locator(headerOf[name]).first().waitFor();
          if (name === 'index') await page.locator('#main .card, #main .desk-table, #main tr').first().waitFor();
          const tag = await page.locator(tagOf[name]).first().evaluate(e => getComputedStyle(e, '::after').content);
          assert.equal(tag, test ? '"測試版"' : 'none', `${name} ${width}px 測試版標籤`);
          assert.equal((await page.title()).startsWith('測試｜'), test, `${name} 分頁標題`);
          if (name !== 'cards') {
            const bg = await page.locator(headerOf[name]).first().evaluate(e => getComputedStyle(e).backgroundColor);
            assert.equal(bg === PURPLE, test, `${name} ${width}px 頁首顏色 ${bg}`);
          }
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          assert.ok(overflow <= 0, `${name} ${width}px 橫向溢出 ${overflow}px`);
          if (name === 'index' && test) {
            const icons = await page.locator('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]').evaluateAll(ls => ls.map(l => l.getAttribute('href')));
            assert.ok(icons.length && icons.every(h => /test/.test(h)), `圖示換成測試版：${icons}`);
            const bar = await page.locator('#bottomBar').evaluate(e => getComputedStyle(e).backgroundColor);
            if (width < 800) assert.equal(bar, PURPLE, '底部分類列也是測試紫');
          }
          if (name !== 'edits') await page.screenshot({ path: path.join(shots, `test-site-${name}-${width}-${test ? 'test' : 'prod'}.png`) });
        }
      } finally { await context.close(); }
    }
  }
};
