// #643：登記失敗的狗卡留下「沒登記到／未確認」直到成功或再按；失敗的提示條不自動消失；整群部分失敗只標失敗的狗。
const assert = require('node:assert/strict');
const fixture = require('./fixtures/dogs.json');

module.exports = async (browser, base) => {
  const day = '2026-10-21', data = structuredClone(fixture);
  data.syncedAt = '2026-10-21 09:00';
  data.dogs = data.dogs.slice(0, 5).map((d, i) => ({ ...d, name: `失敗測試${i + 1}`, note: '', walkedDate: '2026-10-01', walkers: [] }));
  data.groups = {};
  data.groupColumns = [{ column: 4, label: '失敗測試群', names: data.dogs.slice(2, 5).map(d => d.name) }];
  const d1 = require('./fixtures/fake-d1-walks.cjs')({ today: () => day });
  let mode = 'ok'; // fail：全部回 503；partial：只有「失敗測試4」回 503
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
  await context.addInitScript(() => {
    localStorage.setItem('bq-onboarded', '1'); localStorage.setItem('bq-name-later', '1'); localStorage.setItem('bq-walker-name', '甲');
  });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== base) return route.abort();
    if (!url.pathname.includes('/api/')) return route.continue();
    const endpoint = url.pathname.split('/api/')[1];
    if (endpoint === 'walk') {
      const body = req.postDataJSON();
      if (mode === 'fail' || (mode === 'partial' && body.dogs[0].name === '失敗測試4')) return route.fulfill({ status: 503, json: { ok: false, error: '暫時無法接受' } });
      return route.fulfill({ json: d1.walk(body) });
    }
    const out = endpoint === 'dogs' ? data : endpoint === 'today' ? d1.pack()
      : endpoint === 'rest' ? { rest: {} } : { ok: true, walks: [], departures: [], ids: [], aliases: {}, walkers: {}, names: [] };
    return route.fulfill({ json: out });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.clock.install({ time: new Date('2026-10-21T02:00:00Z') });
  const card = name => page.locator('#main .card', { hasText: name });
  const toast = page.locator('#toast:not([hidden])');
  try {
    await page.goto(base + '/public/index.html', { waitUntil: 'domcontentloaded' });
    await card('失敗測試1').locator('.walk-btn[data-walk="add"]').waitFor();

    // 送出了但沒被接受：還不知道有沒有登記到
    mode = 'fail';
    await card('失敗測試1').locator('.walk-btn').click();
    await card('失敗測試1').locator('.walk-btn.failed', { hasText: '未確認' }).waitFor();
    await toast.getByText('失敗測試1 還不知道有沒有登記到（暫時無法接受），按「再試一次」確認').waitFor();
    await page.clock.runFor(10000);
    assert.equal(await toast.count(), 1, '失敗的提示條過 10 秒還在');
    assert.equal(await card('失敗測試1').locator('.walk-btn.failed').count(), 1, '狗卡失敗狀態過 10 秒還在');
    mode = 'ok';
    await toast.getByRole('button', { name: '再試一次' }).click();
    await card('失敗測試1').locator('.walk-btn.done').waitFor();
    assert.equal(await page.locator('#main .walk-btn.failed').count(), 0, '成功後拿掉失敗狀態');

    // 手機沒網路：確定沒登記到；提示條可以自己關
    await context.setOffline(true);
    await card('失敗測試2').locator('.walk-btn').click();
    await card('失敗測試2').locator('.walk-btn.failed', { hasText: '沒登記到' }).waitFor();
    await toast.getByText('失敗測試2 沒登記到（沒網路），有訊號再按一次').waitFor();
    await toast.getByRole('button', { name: '關閉提示' }).click();
    assert.equal(await toast.count(), 0, '按 × 關掉提示條');
    assert.equal(await card('失敗測試2').locator('.walk-btn.failed').count(), 1, '關掉提示條狗卡仍留失敗狀態');
    await context.setOffline(false);
    await card('失敗測試2').locator('.walk-btn.failed').click();
    await card('失敗測試2').locator('.walk-btn.done').waitFor();

    // 整群只有部分失敗：只有失敗的那隻有標記
    mode = 'partial';
    await page.locator('[data-tab="groups"]').click();
    await page.locator('#gwWalk').click();
    await page.getByText(/^已登記 2 隻；失敗測試4 還不知道有沒有登記到/).waitFor();
    mode = 'ok';
    await page.locator('[data-tab="walk"]').click();
    await card('失敗測試4').locator('.walk-btn.failed').waitFor();
    assert.equal(await page.locator('#main .walk-btn.failed').count(), 1, '只有失敗的狗有標記');
    assert.equal(await card('失敗測試3').locator('.walk-btn.done').count(), 1);
    assert.equal(await card('失敗測試5').locator('.walk-btn.done').count(), 1);
    console.log('#643 失敗狀態留在狗卡、失敗提示條不自動關、再試一次成功、整群只標失敗的狗通過');
  } finally { await context.close(); }
};
