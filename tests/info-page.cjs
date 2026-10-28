const assert = require('node:assert/strict');
const fixture = require('./fixtures/dogs.json');

module.exports = async (browser, base) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    localStorage.setItem('bq-onboarded', '1');
    localStorage.setItem('bq-name-later', '1');
  });
  let failure = false;
  await context.route('**/*', route => {
    assert.equal(route.request().method() === 'GET' || route.request().method() === 'HEAD', true, '資訊流程不寫入');
    const u = new URL(route.request().url());
    if (u.origin !== base) return route.abort();
    if (!u.pathname.includes('/api/')) return route.continue();
    const endpoint = u.pathname.split('/api/')[1];
    if (failure && ['dogs', 'departures/index', 'edits', 'activities'].includes(endpoint)) return route.fulfill({ status: 503, json: { ok: false } });
    if (endpoint === 'feature-settings') return route.fulfill({ json: {ok:true,revision:1,values:Object.fromEntries(['showActivities','showQuality','showUpdates','editIntro','editPhoto','editRest','editActivity','editFixedCare','editStays'].map(k=>[k,true]))} });
    const json = endpoint === 'dogs' ? fixture : endpoint === 'edits' ? { ok: true, edits: [{ editorName: '志工甲', kind: 'group', at: '2026-10-17T00:00:00Z', before: { label: '舊群', names: ['小白'] }, after: { label: '新群', names: ['小黑'] } }] } : endpoint === 'departures/index' ? { departures: [], years: {} } : endpoint === 'activities' ? { ok: true, activities: [] } : { rest: {}, walkers: [], walks: [] };
    return route.fulfill({ json });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', e => console.error(e.message));
  try {
    await page.goto(base + '/public/index.html');
    await page.locator('#main .card').first().waitFor();
    await page.locator('[data-tab="info"]').click();
    assert.deepEqual(await page.locator('[data-info-page] strong').allTextContents(), ['在所統計', '離所紀錄', '活動紀錄', '資料檢查', '更新紀錄']);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      for (const key of ['stay', 'departures', 'activities', 'quality', 'updates']) {
        await page.locator('[data-info-page="' + key + '"]').click();
        assert(!/超過 \d+ 天沒溜|本月溜狗/.test(await page.locator('#main').innerText()));
        if (key === 'stay') await page.getByRole('heading', { name: '入所多久分布', exact: true }).waitFor();
        if (key === 'departures') await page.getByText('還沒有離所紀錄', { exact: true }).waitFor();
        if (key === 'activities') await page.getByText('還沒有活動紀錄', { exact: true }).waitFor();
        if (key === 'quality') await page.getByRole('heading', { name: '狗的資料完整度', exact: true }).waitFor();
        if (key === 'updates') {
          assert.equal(await page.locator('[data-update-tab]').count(), 0, 'K 2026-10-28 更新紀錄只剩資料編輯，不分頁');
          const frame = page.frameLocator('#infoEdits');
          await frame.getByText('志工甲', { exact: true }).waitFor();
          assert((await frame.locator('#list').innerText()).includes('舊群'));
          assert((await frame.locator('#list').innerText()).includes('新群'));
          assert(!(await frame.locator('.hint').isVisible()), '#421 資料編輯不放說明文字');
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '頁面不橫向溢出');
        await page.locator('#analysisBack').click();
        await page.locator('[data-info-page="' + key + '"]').waitFor();
        assert(await page.locator('[data-info-page="' + key + '"]').evaluate(el => el === document.activeElement), '返回分類恢復焦點');
      }
    }
    await page.locator('[data-info-page="stay"]').click();
    await page.goBack();
    await page.locator('[data-info-page="stay"]').waitFor();
    await page.goForward();
    await page.getByRole('heading', { name: '入所多久分布', exact: true }).waitFor();
    await page.locator('[data-tab="mine"]').click();
    assert.equal(await page.locator('#main [data-open-guide]').count(), 0, '#447 我溜過的頁不再有使用說明');
    await page.locator('[data-tab="info"]').click();
    await page.locator('[data-open-guide]').filter({ hasText: '使用說明' }).click();
    await page.locator('.tour-tip').waitFor();
    assert.equal(await page.locator('#tabs [data-tab="walk"]').getAttribute('aria-current'), 'page', '使用說明回到溜狗表看導覽');
    await page.locator('.tour-skip').click();
    await page.locator('[data-tab="info"]').click();
    await page.locator('[data-info-page="stay"]').waitFor();
    await page.locator('[data-info-page="stay"]').click();
    await page.locator('#analysisBack').click();
    await page.locator('[data-info-page="stay"]').waitFor();
    failure = true;
    await page.reload();
    await page.locator('[data-tab="info"]').click();
    await page.getByText('在所資料讀取失敗', { exact: true }).waitFor();
    await page.getByText('離所紀錄讀取失敗', { exact: true }).waitFor();
    await page.getByText('活動紀錄讀取失敗', { exact: true }).waitFor();
    await page.locator('[data-info-page="updates"]').click();
    const staleFrame = page.frameLocator('#infoEdits');
    await staleFrame.getByText('志工甲', { exact: true }).waitFor();
    await staleFrame.getByText('暫時讀不到最新編輯紀錄，以下是上次讀到的', { exact: true }).waitFor();
    console.log('#273 資訊分類、內容、更新與編輯紀錄、返回焦點及320／390／桌機通過（活動 #270）');
  } finally { await context.close(); }
};
