const assert = require('node:assert/strict');
const fixture = require('./fixtures/dogs.json');

// 驗證真實頁面的讀取邊界，不綁 fetch 的個數或 helper 寫法。
module.exports = async (browser, base) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    localStorage.setItem('bq-onboarded', '1');
    localStorage.setItem('bq-name-later', '1');
  });
  const violations = [];
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base) { violations.push(`外部來源 ${url.origin}`); return route.abort(); }
    if (!url.pathname.includes('/api/')) return route.continue();
    const endpoint = url.pathname.split('/api/')[1];
    if (request.method() !== 'GET' || !['dogs', 'walks', 'walkers', 'rest', 'today'].includes(endpoint)) violations.push(`${request.method()} ${endpoint}`);
    const body = endpoint === 'dogs' ? fixture : endpoint === 'rest' ? { rest: {} }
      : endpoint === 'walkers' ? { walkers: {}, names: [] } : { date: '2026-10-19', walks: [] };
    return route.fulfill({ json: body });
  });
  try {
    const page = await context.newPage();
    await page.goto(base + '/public/index.html', { waitUntil: 'networkidle' });
    await page.locator('#main .card[data-dog]').first().waitFor();
    assert.deepEqual(violations, [], '初次讀取只走網站既有的唯讀 API，不直接連試算表或 GitHub');
    console.log('頁面讀取來源與 GET 方法通過');
  } finally { await context.close(); }
};
