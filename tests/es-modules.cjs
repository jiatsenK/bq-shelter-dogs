const assert = require('node:assert/strict');
const fs = require('node:fs');
const fixture = require('./fixtures/dogs.json');

// Run shipped entry points without the compatibility adapter used by older assertions.
module.exports = async (browser, base) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    localStorage.setItem('bq-onboarded', '1');
    localStorage.setItem('bq-name-later', '1');
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (url.pathname.endsWith('/js/main.js')) return route.fulfill({ contentType: 'application/javascript',
      body: fs.readFileSync(require.resolve('../public/js/main.js'), 'utf8') });
    if (!url.pathname.includes('/api/')) return route.continue();
    const endpoint = url.pathname.split('/api/')[1];
    if (endpoint === 'feature-settings') return route.fulfill({json:{ok:true,revision:1,values:Object.fromEntries(['showActivities','showQuality','showUpdates','editIntro','editPhoto','editRest','editActivity','editFixedCare','editStays','editFormer'].map(k=>[k,true]))}});
    const body = endpoint === 'dogs' ? fixture : endpoint === 'rest' ? { rest: {} }
      : endpoint === 'walkers' ? { walkers: {}, names: [] } : { ok: true, source: 'd1', walks: [], dogs: [], edits: [], opened: {} };
    return route.fulfill({ json: body });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${base}/public/index.html`);
    await page.locator('#main .card').first().waitFor();
    await page.locator('[data-tab="info"]').click();
    await page.locator('[data-info-page="stay"]').click();
    await page.locator('#analysisBack').click();
    await page.locator('[data-tab="walk"]').click();
    await page.locator('#main .card .name').first().click();
    await page.locator('#detailName').waitFor();
    assert.deepEqual(await page.evaluate(() => ['BQApi', 'BQStore', 'SITE', 'allDogs', 'render', 'createWalkRegistration'].filter(name => name in window)), []);
    await page.goto(`${base}/public/cards.html`);
    await page.waitForFunction(() => document.getElementById('bqField').classList.contains('ready'));
    assert.equal(await page.evaluate(() => 'BQ' in window), false);
    await page.goto(`${base}/public/edits.html`);
    await page.getByText('還沒有編輯紀錄', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('#489 正式模組入口：主頁切頁／狗卡、圖鑑、編輯紀錄及無全域依賴通過');
  } catch (error) {
    // 循環引用的模組在頂層讀到 app.js 尚未初始化的 const，頁面只會卡住等不到狗卡；把真正的錯誤一起印出
    if (errors.length) throw new Error(`頁面錯誤：${errors.join('；')}（${error.message.split('\n')[0]}）`, { cause: error });
    throw error;
  } finally {
    await context.close();
  }
};
