// #421 更新紀錄重開：已有內容先顯示，背景檢查新版；檢查失敗保留內容，不假稱最新
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('./fixtures/dogs.json');

module.exports = async (browser, base) => {
  const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/website-updates.json'), 'utf8'));
  assert(shipped.every(e => /^\d+\.\d+\.\d+$/.test(e.version)), '網站更新每一筆都有版本號');

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    localStorage.setItem('bq-onboarded', '1');
    localStorage.setItem('bq-name-later', '1');
  });
  const count = { updates: 0, edits: 0 };
  const mode = { updates: 'ok', edits: 'ok' };
  let updates = [{ version: '9.2.0', date: '2026-10-17', text: '第一則網站更新' }];
  let edits = [{ editorName: '志工甲', kind: 'group', at: '2026-10-17T00:00:00Z', before: { label: '舊群', names: ['小白'] }, after: { label: '新群', names: ['小黑'] } }];
  const held = { updates: null, edits: null };
  const hold = key => new Promise(r => { held[key] = r; });
  await context.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin !== base) return route.abort();
    if (u.pathname.endsWith('/website-updates.json')) {
      count.updates++;
      if (mode.updates === 'hold') await hold('updates');
      return route.fulfill(mode.updates === 'fail' ? { status: 503, body: 'unavailable' } : { json: updates });
    }
    if (!u.pathname.includes('/api/')) return route.continue();
    const endpoint = u.pathname.split('/api/')[1];
    if (endpoint === 'edits') {
      count.edits++;
      if (mode.edits === 'hold') await hold('edits');
      return route.fulfill(mode.edits === 'fail' ? { status: 503, json: { ok: false } } : { json: { ok: true, edits } });
    }
    const json = endpoint === 'dogs' ? fixture : endpoint === 'departures/index' ? { departures: [], years: {} } : { rest: {}, walkers: [], walks: [] };
    return route.fulfill({ json });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', e => console.error(e.message));
  const later = ms => page.evaluate(ms => { const now = Date.now; Date.now = () => now() + ms; }, ms);
  const reopen = async () => {
    await page.locator('#analysisBack').click();
    await page.locator('[data-info-page="updates"]').click();
  };
  try {
    await page.goto(base + '/public/index.html');
    await page.locator('#main .card').first().waitFor();
    await page.locator('[data-tab="info"]').click();
    await page.locator('[data-info-page="updates"]').click();
    await page.getByText('第一則網站更新', { exact: true }).waitFor();
    assert.equal(count.updates, 1, '初次載入一個請求');
    assert.equal(await page.locator('.info-releases li').first().locator('.info-release-ver').innerText(), 'V9.2.0', '每一筆標版本');
    assert(!(await page.locator('#main').innerText()).includes('只列已正式上線的變更'), '網站更新上方不放解釋文字');

    // 30 秒內重開：直接顯示，不重抓
    await reopen();
    assert(await page.getByText('第一則網站更新', { exact: true }).isVisible(), '重開立即顯示');
    assert.equal(count.updates, 1, '30 秒內不重抓');

    // 超過 30 秒重開：先顯示舊內容，背景檢查到新部署的版本後更新
    await later(31000);
    mode.updates = 'hold';
    updates = [{ version: '9.3.0', date: '2026-10-21', text: '部署後的新更新' }, ...updates];
    await reopen();
    assert(await page.getByText('第一則網站更新', { exact: true }).isVisible(), '檢查期間保留已有內容');
    await page.locator('#updatesSource').getByText('檢查中…').waitFor();
    mode.updates = 'ok'; held.updates();
    await page.getByText('部署後的新更新', { exact: true }).waitFor();
    assert.equal(count.updates, 2);
    assert(!(await page.locator('#updatesSource').innerText()).includes('檢查中'));

    // 背景檢查失敗：不清空，標示保留先前內容，可重試
    await later(31000);
    mode.updates = 'fail';
    await reopen();
    await page.locator('#updatesSource').getByText('檢查失敗，保留先前內容').waitFor();
    assert(await page.getByText('部署後的新更新', { exact: true }).isVisible(), '失敗不清空');
    await page.waitForTimeout(300);
    assert.equal(count.updates, 3, '檢查失敗後不連續重抓');
    mode.updates = 'ok';
    updates = [{ version: '9.3.1', date: '2026-10-22', text: '重試後的更新' }, ...updates];
    await page.locator('#retryUpdates').click();
    await page.getByText('重試後的更新', { exact: true }).waitFor();
    assert(await page.getByText('部署後的新更新', { exact: true }).isVisible(), '重試期間不清空');

    // 資料編輯：每次打開都向 API 確認，但先顯示上次讀到的內容
    await page.getByRole('button', { name: '資料編輯', exact: true }).click();
    const frame = page.frameLocator('#infoEdits');
    await frame.getByText('志工甲', { exact: true }).waitFor();
    assert.equal(count.edits, 1);
    assert(!(await frame.locator('main').innerText()).includes('大家都能直接改'), '資料編輯上方不放解釋文字');
    mode.edits = 'hold';
    edits = [{ editorName: '志工乙', kind: 'group', at: '2026-10-21T00:00:00Z', before: { label: '新群', names: ['小黑'] }, after: { label: '新群', names: ['小黑', '小花'] } }, ...edits];
    await page.getByRole('button', { name: '網站更新', exact: true }).click();
    await page.getByRole('button', { name: '資料編輯', exact: true }).click();
    await frame.getByText('志工甲', { exact: true }).waitFor({ timeout: 1000 });
    await frame.locator('#status').getByText('檢查中…').waitFor();
    mode.edits = 'ok'; held.edits();
    await frame.getByText('志工乙', { exact: true }).waitFor();
    assert.equal(count.edits, 2, '資料編輯每次打開都重新確認');
    assert.equal(await frame.locator('#status').innerText(), '');

    mode.edits = 'fail';
    await page.getByRole('button', { name: '網站更新', exact: true }).click();
    await page.getByRole('button', { name: '資料編輯', exact: true }).click();
    await frame.locator('#status').getByText('讀不到新的編輯紀錄').waitFor();
    assert(await frame.getByText('志工乙', { exact: true }).isVisible(), '失敗保留先前內容');
    mode.edits = 'ok';
    await frame.getByRole('button', { name: '重新讀取', exact: true }).click();
    await frame.locator('#retry').waitFor({ state: 'hidden' });
    await frame.locator('#status').getByText('檢查中…').waitFor({ state: 'detached' });
    assert.equal(await frame.locator('#status').innerText(), '');
    assert.equal(count.edits, 4);

    // 重新整理後沒有可用內容：初次載入有明確狀態
    mode.updates = 'fail';
    await page.reload();
    await page.locator('[data-tab="info"]').click();
    await page.locator('[data-info-page="updates"]').click();
    await page.getByText('網站更新讀取失敗，請重試。', { exact: true }).waitFor();
    console.log('#421 更新紀錄重開先顯示、背景檢查新版、失敗保留、版本標示通過');
  } finally { await context.close(); }
};
