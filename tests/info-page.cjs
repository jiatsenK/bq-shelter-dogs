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
  await context.route('**/*', route => {
    assert.equal(route.request().method() === 'GET' || route.request().method() === 'HEAD', true, '資訊流程不寫入');
    const u = new URL(route.request().url());
    if (u.origin !== base) return route.abort();
    if (u.pathname.endsWith('/website-updates.json')) return route.fulfill(failure ? { status: 503, body: 'unavailable' } : { json: emptyUpdates ? [] : [{ version: 'V10', date: '2026-10-17', text: '已上線的測試更新' }] });
    if (!u.pathname.includes('/api/')) return route.continue();
    const endpoint = u.pathname.split('/api/')[1];
    if (failure && ['dogs', 'departures/index', 'edits'].includes(endpoint)) return route.fulfill({ status: 503, json: { ok: false } });
    const json = endpoint === 'dogs' ? fixture : endpoint === 'edits' ? { ok: true, edits: [{ editorName: '志工甲', kind: 'group', at: '2026-10-17T00:00:00Z', before: { label: '舊群', names: ['小白'] }, after: { label: '新群', names: ['小黑'] } }] } : endpoint === 'departures/index' ? { departures: [], years: {} } : { rest: {}, walkers: [], walks: [] };
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
          assert.equal(await page.locator('.info-releases time').first().innerText(), 'V10 · 2026-10-17', '#421 每筆標版本');
          assert.equal(await page.locator('#main .a-hint').count(), 0, '#421 網站更新不放說明文字');
          await page.getByRole('button', { name: '資料編輯', exact: true }).click();
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
    await page.locator('[data-info-page="updates"]').click();
    // #421 重開時先顯示上次讀到的內容，背景檢查失敗不清空、也不假稱最新
    await page.getByText('已上線的測試更新', { exact: true }).waitFor();
    await page.getByText('暫時讀不到最新內容，以下是上次讀到的', { exact: true }).waitFor();
    await page.getByRole('button', { name: '資料編輯', exact: true }).click();
    const staleFrame = page.frameLocator('#infoEdits');
    await staleFrame.getByText('志工甲', { exact: true }).waitFor();
    await staleFrame.getByText('暫時讀不到最新編輯紀錄，以下是上次讀到的', { exact: true }).waitFor();
    await page.getByRole('button', { name: '網站更新', exact: true }).click();
    await page.evaluate(() => { localStorage.removeItem('bq-website-updates'); localStorage.removeItem('bq-edits-cache'); });
    await page.reload();
    await page.locator('[data-tab="info"]').click();
    await page.locator('[data-info-page="updates"]').click();
    await page.getByText('網站更新讀取失敗，請重試。', { exact: true }).waitFor();
    failure = false; emptyUpdates = true;
    await page.getByRole('button', { name: '重新讀取', exact: true }).click();
    await page.getByText('還沒有網站更新紀錄', { exact: true }).waitFor();
    console.log('#273 資訊分類、內容、更新與編輯紀錄、返回焦點及320／390／桌機通過；活動核心待 #270');
  } finally { await context.close(); }
};
