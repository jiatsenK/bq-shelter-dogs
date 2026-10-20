const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// #420：手機點底部頁籤後不殘留焦點框；鍵盤切頁仍有可見焦點
module.exports = async function verifyTabFocus(browser, baseUrl) {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/dogs.json'), 'utf8'));
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    localStorage.setItem('bq-onboarded', '1');
    localStorage.setItem('bq-name-later', '1');
    // 模擬 iOS Safari：點按鈕不給焦點，之後程式 focus() 會被當成鍵盤焦點
    document.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); }, true);
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== baseUrl) return route.abort();
    if (!url.pathname.includes('/api/')) return route.continue();
    const endpoint = url.pathname.split('/api/')[1];
    return route.fulfill({ json: endpoint === 'dogs' ? fixture : endpoint === 'rest' ? { rest: {} } : endpoint === 'walkers' ? { walkers: [] } : { walks: [], departures: [] } });
  });
  const page = await context.newPage();
  const ring = () => page.evaluate(() => {
    const el = document.activeElement;
    return !!el && el.closest('#tabs') !== null && el.matches(':focus-visible');
  });
  try {
    await page.goto(baseUrl + '/public/index.html');
    await page.locator('#main .card').first().waitFor();
    assert.equal(await ring(), false, '初次開啟頁籤沒有焦點框');
    for (const id of ['groups', 'mine', 'info', 'walk']) {
      await page.locator(`#tabs [data-tab="${id}"]`).tap();
      await page.locator(`#tabs [data-tab="${id}"][aria-current="page"]`).waitFor();
      assert.equal(await ring(), false, `觸控切到 ${id} 不殘留焦點框`);
    }
    await page.evaluate(() => typeof buildTabs === 'function' && render());
    assert.equal(await ring(), false, '背景重繪後仍沒有焦點框');

    // 鍵盤：焦點在頁籤上按 Enter 切頁，焦點留在新頁籤且看得見
    await page.locator('#tabs [data-tab="walk"]').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await page.locator('#tabs [data-tab="groups"][aria-current="page"]').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'groups', '鍵盤切頁焦點留在頁籤');
    assert.equal(await ring(), true, '鍵盤切頁仍有焦點框');
    await page.evaluate(() => render());
    assert.equal(await ring(), true, '鍵盤使用中重繪仍保留焦點框');
  } finally {
    await context.close();
  }
};
