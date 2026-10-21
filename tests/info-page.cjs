const assert = require('node:assert/strict');
const fixture = require('./fixtures/dogs.json');

module.exports = async (browser, base) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    localStorage.setItem('bq-onboarded', '1');
    localStorage.setItem('bq-name-later', '1');
  });
  let failure = false;
  let emptyUpdates = false;
  let departures = [];
  await context.route('**/*', route => {
    assert.equal(route.request().method() === 'GET' || route.request().method() === 'HEAD', true, '資訊流程不寫入');
    const u = new URL(route.request().url());
    if (u.origin !== base) return route.abort();
    if (u.pathname.endsWith('/website-updates.json')) return route.fulfill(failure ? { status: 503, body: 'unavailable' } : { json: emptyUpdates ? [] : [{ date: '2026-10-17', text: '已上線的測試更新' }] });
    if (!u.pathname.includes('/api/')) return route.continue();
    const endpoint = u.pathname.split('/api/')[1];
    if (failure && ['dogs', 'departures/index', 'edits'].includes(endpoint)) return route.fulfill({ status: 503, json: { ok: false } });
    const json = endpoint === 'dogs' ? fixture : endpoint === 'edits' ? { ok: true, edits: [{ editorName: '志工甲', kind: 'group', at: '2026-10-17T00:00:00Z', before: { label: '舊群', names: ['小白'] }, after: { label: '新群', names: ['小黑'] } }] } : endpoint === 'departures/index' ? { version: 1, years: departures.length ? { 2026: '1' } : {}, dogs: departures } : { rest: {}, walkers: [], walks: [] };
    return route.fulfill({ json });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', e => console.error(e.message));
  try {
    await page.goto(base + '/public/index.html');
    await page.locator('#main .card').first().waitFor();
    await page.locator('[data-tab="info"]').click();
    assert.deepEqual(await page.locator('[data-info-page] strong').allTextContents(), ['在所統計', '離所紀錄', '資料檢查', '更新紀錄']);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      for (const key of ['stay', 'departures', 'quality', 'updates']) {
        await page.locator('[data-info-page="' + key + '"]').click();
        assert(!/超過 \d+ 天沒溜|本月溜狗/.test(await page.locator('#main').innerText()));
        if (key === 'stay') await page.getByRole('heading', { name: '入所多久分布', exact: true }).waitFor();
        if (key === 'departures') await page.getByText('還沒有離所紀錄', { exact: true }).waitFor();
        if (key === 'quality') await page.getByRole('heading', { name: '狗的資料完整度', exact: true }).waitFor();
        if (key === 'updates') {
          await page.getByRole('button', { name: '網站更新', exact: true }).click();
          await page.getByText('已上線的測試更新', { exact: true }).waitFor();
          await page.getByRole('button', { name: '資料編輯', exact: true }).click();
          const frame = page.frameLocator('#infoEdits');
          await frame.getByText('志工甲', { exact: true }).waitFor();
          assert((await frame.locator('#list').innerText()).includes('舊群'));
          assert((await frame.locator('#list').innerText()).includes('新群'));
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
    await page.locator('[data-tab="info"]').click();
    await page.locator('[data-info-page="stay"]').waitFor();
    await page.locator('[data-info-page="stay"]').click();
    await page.locator('#analysisBack').click();
    await page.locator('[data-info-page="stay"]').waitFor();
    // #446 離所紀錄頁一進來就展開名冊；可收起，返回再進來又展開
    departures = [{ id: '2026010101', name: '雪寶', date: '2026-10-01', reason: 'adopt' }];
    await page.reload();
    await page.locator('[data-tab="info"]').click();
    await page.getByText('共 1 筆離所紀錄', { exact: true }).waitFor();
    await page.locator('[data-info-page="departures"]').click();
    await page.locator('#depList [data-dep-dog]').waitFor();
    assert.equal(await page.locator('#depToggle').getAttribute('aria-expanded'), 'true');
    await page.getByRole('button', { name: '收起離所名冊', exact: true }).click();
    await page.getByRole('button', { name: '看離所名冊（1 隻）', exact: true }).waitFor();
    assert.equal(await page.locator('#depList').count(), 0, '收起後不顯示名冊');
    await page.locator('#analysisBack').click();
    await page.locator('[data-info-page="departures"]').click();
    await page.locator('#depList [data-dep-dog]').waitFor();
    departures = [];
    failure = true;
    await page.reload();
    await page.locator('[data-tab="info"]').click();
    await page.getByText('在所資料讀取失敗', { exact: true }).waitFor();
    await page.getByText('離所紀錄讀取失敗', { exact: true }).waitFor();
    await page.locator('[data-info-page="updates"]').click();
    await page.getByText('網站更新讀取失敗，請重試。', { exact: true }).waitFor();
    failure = false; emptyUpdates = true;
    await page.getByRole('button', { name: '重新讀取', exact: true }).click();
    await page.getByText('還沒有網站更新紀錄', { exact: true }).waitFor();
    console.log('#273 資訊分類、內容、更新與編輯紀錄、返回焦點及320／390／桌機通過；活動核心待 #270');
  } finally { await context.close(); }
};
