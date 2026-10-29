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
    return route.fulfill({ json: endpoint === 'dogs' ? fixture : endpoint === 'rest' ? { rest: {} } : endpoint === 'walkers' ? { walkers: [] } : { source: 'd1', walks: [], departures: [] } });
  });
  const page = await context.newPage();
  try {
    await page.goto(baseUrl + '/public/index.html');
    await page.locator('#main .card').first().waitFor();
    assert.deepEqual(await page.locator('#tabs .t').allTextContents(), ['溜狗表', '常溜狗群', '我溜過', '資訊']);
    
    const selected = async id => {
      await page.locator('#tabs [data-tab="' + id + '"][aria-current="page"]').waitFor();
      assert.equal(await page.locator('#tabs [aria-current="page"]').count(), 1);
    };
    const counts = await page.locator('#tabs .n').allTextContents();
    await page.locator('#tabs [data-tab="groups"]').click();
    await selected('groups');
    assert.deepEqual(await page.locator('#tabs .n').allTextContents(), counts, '內頁保留底部數字');
    await page.locator('#groupStage').waitFor(); // 狗群資料非同步讀進來，先等畫好
    assert.equal(await page.locator('.gw-layer').count(), 1, '只顯示當前群');
    assert.equal(await page.locator('.gw-summary').count(), 0, '移除可變長度敘述');
    await page.locator('#groupPage h2').filter({ hasText: '測試群' }).waitFor();
    assert.equal(await page.locator('[data-gw-action="manage"], [data-gw-action="add"], [data-gw-action="create"], [data-gw-remove], #gwForm').count(), 0, '#474 狗群沒有編輯入口');
    await page.getByText('要改請到試算表「常遛狗群」分頁', { exact: true }).waitFor();
    assert(!(await page.locator('#analysisBack').isVisible()), '常溜狗群是主分頁，沒有返回');
    assert(await page.locator('header.app h1').filter({ hasText: '板收志工溜狗表' }).isVisible(), '常溜狗群顯示共用表頭');
    assert(!(await page.locator('.head-title').isVisible()), '常溜狗群不另放內頁標題');
    await page.locator('#tabs [data-tab="walk"]').click();
    await selected('walk');
    await page.locator('#tabs [data-tab="mine"]').click();
    await selected('mine');
    await page.locator('#tabs [data-tab="info"]').click();
    await selected('info');
    await page.locator('#main .a-card').first().waitFor();
    assert(await page.locator('#bottomBar').isVisible());
    assert(!(await page.locator('.head-title').isVisible()), '資訊首頁用網站表頭，不另放標題');
    assert(!(await page.locator('#analysisBack').isVisible()), '資訊首頁沒有返回');
    assert(await page.locator('header.app h1').isVisible(), '資訊首頁放網站名稱');
    assert(!(await page.locator('#searchInput').isVisible()), '資訊首頁沒有搜尋框');
    assert.equal(Math.round(await page.locator('header.app .brand').evaluate(e => e.getBoundingClientRect().height)), 44, '資訊頂列跟其他主分頁同高');
    await page.locator('[data-info-page="stay"]').click();
    assert.equal((await page.locator('#analysisBack').textContent()).trim(), '回資訊', '資訊子頁保留回資訊');
    assert(await page.locator('#analysisBack').isVisible());
    await page.locator('#analysisBack').click();
    await page.locator('[data-info-page="stay"]').waitFor();
    assert.equal(await page.locator('#analysisBtn').count(), 0);
    assert.deepEqual(await page.locator('#tabs .n').allTextContents(), counts, '資訊頁數字保留');
    await page.goBack();
    await selected('mine');
    assert(await page.locator('#tabs [data-tab="mine"]').evaluate(el => el === document.activeElement));
    await page.goForward();
    await selected('info');
    await page.locator('#tabs [data-tab="groups"]').click();
    await selected('groups');
    await page.goBack();
    await selected('info');
    await page.locator('#tabs [data-tab="walk"]').click();
    await selected('walk');
    await page.locator('#searchInput').fill(fixture.dogs.at(-1).name);
    assert.equal(await page.locator('#main .card').count(), 1, '搜尋仍可用');
    await page.locator('#searchClear').click();
    for (const width of [320, 390, 1100, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      for (const tab of await page.locator('#tabs [data-tab]').all()) {
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
    // CI 偶發：focus 和按鍵之間分頁列重畫（innerHTML 換掉按鈕），Enter 落到別處就沒切換。
    // 等焦點真的在「我溜過」上才按，沒切到就重來，直到逾時（#380 失敗紀錄）。
    const mineTab = page.locator('#tabs [data-tab="mine"]');
    const isSelected = () => page.locator('#tabs [data-tab="mine"][aria-current="page"]').count();
    const deadline = Date.now() + 10000;
    while (!(await isSelected())) {
      assert(Date.now() < deadline, '鍵盤 Enter 沒切到我溜過，焦點在 ' + await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)));
      await mineTab.focus();
      if (await mineTab.evaluate(el => el === document.activeElement)) await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('#tabs [data-tab="mine"][aria-current="page"]'), null, { timeout: 1000 }).catch(() => {});
    }
    await selected('mine');
    for (const id of ['info', 'groups']) {
      await page.locator('#tabs [data-tab="' + id + '"]').click();
      assert.equal(await page.locator('header.app').evaluate(el => getComputedStyle(el).position), 'fixed', '手機內頁固定定位');
      await page.evaluate(() => window.scrollTo(0, 400));
      assert.equal(await page.locator('header.app').evaluate(el => Math.round(el.getBoundingClientRect().top)), 0, '內頁表頭固定');
    }
    console.log('#373 導覽、既有狗群／資訊、返回／前進／焦點、搜尋、320／390px／桌機及鍵盤通過');
  } finally { await context.close(); }
};
