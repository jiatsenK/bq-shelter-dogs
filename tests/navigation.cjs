const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function verifyNavigation(browser, baseUrl) {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/dogs.json'), 'utf8'));
  fixture.groupColumns = [{ column: 1, label: '測試群', names: [fixture.dogs[0].name] }];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    localStorage.setItem('bq-onboarded', '1');
    localStorage.setItem('bq-name-later', '1');
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== baseUrl) return route.abort();
    if (!url.pathname.includes('/api/')) return route.continue();
    const endpoint = url.pathname.split('/api/')[1];
    return route.fulfill({ json: endpoint === 'dogs' ? fixture : endpoint === 'rest' ? { rest: {} } : endpoint === 'walkers' ? { walkers: [] } : { walks: [], departures: [] } });
  });
  const page = await context.newPage();
  try {
    await page.goto(baseUrl + '/public/index.html');
    await page.locator('#main .card').first().waitFor();
    assert.deepEqual(await page.locator('#tabs .t').allTextContents(), ['遛狗表', '常遛狗群', '我溜過', '資訊']);
    
    const selected = async id => {
      await page.locator('#tabs [data-tab="' + id + '"][aria-current="page"]').waitFor();
      assert.equal(await page.locator('#tabs [aria-current="page"]').count(), 1);
    };
    await page.locator('#tabs [data-tab="groups"]').click();
    await selected('groups');
    await page.locator('#groupPage h2').filter({ hasText: '測試群' }).waitFor();
    assert(await page.locator('[data-gw-action="create"]').isVisible(), '保留狗群管理');
    await page.locator('#analysisBack').click();
    await selected('walk');
    assert(await page.locator('#tabs [data-tab="walk"]').evaluate(el => el === document.activeElement), '返回恢復焦點');
    await page.locator('#tabs [data-tab="mine"]').click();
    await selected('mine');
    await page.locator('#tabs [data-tab="info"]').click();
    await selected('info');
    await page.locator('#main .a-card').first().waitFor();
    assert(await page.locator('#bottomBar').isVisible());
    assert.equal(await page.locator('.head-title').textContent(), '資訊');
    assert.equal(await page.locator('#analysisBtn').count(), 0);
    await page.goBack();
    await selected('mine');
    assert(await page.locator('#tabs [data-tab="mine"]').evaluate(el => el === document.activeElement));
    await page.goForward();
    await selected('info');
    await page.locator('#tabs [data-tab="groups"]').click();
    await selected('groups');
    await page.locator('#analysisBack').click();
    await selected('info');
    await page.locator('#tabs [data-tab="walk"]').click();
    await selected('walk');
    await page.locator('#searchInput').fill(fixture.dogs.at(-1).name);
    assert.equal(await page.locator('#main .card').count(), 1, '搜尋仍可用');
    await page.locator('#searchClear').click();
    for (const width of [320, 390, 1100, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      for (const tab of await page.locator('#tabs button').all()) {
        const box = await tab.boundingBox();
        assert(box && box.width >= 44 && box.height >= 44, '點擊區至少 44px');
        assert(await tab.locator('.t').evaluate(el => el.scrollWidth <= el.clientWidth), '名稱完整顯示');
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '沒有橫向溢出 ' + width + ' ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth).slice(0,8).map(el => [el.className, el.getBoundingClientRect().right]))));
    }
    for (const id of ['groups', 'info', 'mine', 'walk']) {
      await page.locator('#tabs [data-tab="' + id + '"]').click();
      await selected(id);
      assert(await page.locator('#tabs').isVisible(), '桌機內頁導覽仍可用');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#tabs [data-tab="mine"]').focus();
    await page.keyboard.press('Enter');
    await selected('mine');
    console.log('#373 導覽、既有狗群／資訊、返回／前進／焦點、搜尋、320／390px／桌機及鍵盤通過');
  } finally { await context.close(); }
};
