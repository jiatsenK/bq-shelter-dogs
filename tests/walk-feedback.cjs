// #498：D1 模式按「溜了」與復原，伺服器回應前就有處理中；D1 接受就更新畫面，不等試算表；未接受不假報成功。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fixture = require('./fixtures/dogs.json');

module.exports = async (browser, base) => {
  const day = '2026-10-21', data = structuredClone(fixture);
  data.syncedAt = '2026-10-21 09:00';
  data.dogs = data.dogs.slice(0, 1).map(d => ({ ...d, name: '回饋測試', note: '', walkedDate: '2026-10-01', walkers: [] }));
  data.groups = {};
  data.groupColumns = [];
  const dog = data.dogs[0];
  let pack = { ok: true, source: 'd1', date: day, version: 0, walks: [] }, version = 0;
  let hold = null; // 測試放行前，/api/walk 一直不回應（模擬試算表或網路很慢）
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
      const answer = await new Promise(resolve => { hold = resolve; });
      if (answer === 'reject') return route.fulfill({ status: 503, json: { ok: false, error: '暫時無法接受' } });
      const undo = body.action === 'undo';
      const current = undo ? { date: '2026-10-01', walker: '' } : { date: day, walker: '甲' };
      const row = { key: dog.id, version: ++version, walkedDate: current.date, walker: current.walker, syncStatus: 'pending', at: '2026-10-21T02:00:00Z' };
      pack = { ...pack, version: pack.version + 1, walks: [row] };
      return route.fulfill({ json: { ok: true, source: 'd1', today: day, snapshot: pack, results: [{ id: dog.id, name: dog.name, status: undo ? 'restored' : 'written', accepted: true,
        requestId: body.requestId, operationDate: day, version, current, syncStatus: 'pending', at: row.at }] } });
    }
    const body = endpoint === 'dogs' ? data : endpoint === 'today' ? pack
      : endpoint === 'rest' ? { rest: {} } : { ok: true, walks: [], departures: [], ids: [], aliases: {}, walkers: {}, names: [] };
    return route.fulfill({ json: body });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.clock.install({ time: new Date('2026-10-21T02:00:00Z') });
  const button = () => page.locator('#main .card .walk-btn').first();
  const release = async answer => { while (!hold) await new Promise(r => setTimeout(r, 10)); const h = hold; hold = null; h(answer); };
  try {
    await page.goto(base + '/public/index.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#main .card .walk-btn[data-walk="add"]').waitFor();

    await button().click();
    await page.locator('#main .card .walk-btn.pending', { hasText: '登記中' }).waitFor();
    assert.equal(await page.locator('#main .card .walk-btn.done').count(), 0, '尚未接受前不能顯示已溜');
    await release('accept');
    await page.locator('#main .card .walk-btn.done').waitFor();
    // D1 接受就更新，試算表另外標寫回中
    await page.locator('#main .card .walk-sync', { hasText: '寫回試算表中' }).waitFor();

    await button().click();
    // #445：復原畫面立刻恢復；確認期間按鈕不能再按
    assert.equal(await page.locator('#main .card .walk-btn.done').count(), 0, '復原立刻不顯示已溜');
    assert.equal(await button().isDisabled(), true, '確認期間不能再按');
    await release('accept');
    await page.locator('#main .card .walk-btn[data-walk="add"]').waitFor();

    await button().click();
    await page.locator('#main .card .walk-btn.pending', { hasText: '登記中' }).waitFor();
    await release('reject');
    await page.getByText(/沒登記到|還不知道有沒有登記到/).first().waitFor();
    assert.equal(await page.locator('#main .card .walk-btn.done').count(), 0, '被拒絕不能假報成功');
    console.log('#498 登記立即處理中、復原立即恢復、D1 接受不等試算表、拒絕不假報成功通過');
  } finally { hold?.('reject'); await context.close(); }
};
