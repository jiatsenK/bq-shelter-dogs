// #460：D1 模式下整群逐狗接受、部分成功逐狗呈現；本機已溜與試算表即時名單不能反駁 D1。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fixture = require('./fixtures/dogs.json');

module.exports = async (browser, base) => {
  const day = '2026-10-21', data = structuredClone(fixture);
  data.syncedAt = '2026-10-21 09:00';
  data.dogs = data.dogs.slice(0, 2).map((d, i) => ({ ...d, name: `整群測試${i + 1}`, note: '', walkedDate: '2026-10-01', walkers: [] }));
  data.groups = {};
  data.groupColumns = [{ column: 1, label: '測試群', names: data.dogs.map(d => d.name) }];
  let pack = { ok: true, source: 'd1', date: day, version: 0, walks: [] };
  const sent = [];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
  await context.addInitScript(([day, key]) => {
    localStorage.setItem('bq-onboarded', '1'); localStorage.setItem('bq-name-later', '1'); localStorage.setItem('bq-walker-name', '甲');
    // 舊版留下的「今天我溜了」不能讓狗顯示已溜
    if (!sessionStorage.getItem('seeded')) { localStorage.setItem('bq-walked', JSON.stringify({ date: day, ids: [key] })); sessionStorage.setItem('seeded', '1'); }
  }, [day, data.dogs[1].id]);
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== base) return route.abort();
    if (!url.pathname.includes('/api/')) return route.continue();
    const endpoint = url.pathname.split('/api/')[1];
    if (endpoint === 'walk') {
      const body = req.postDataJSON();
      sent.push(body);
      const dog = body.dogs[0];
      if (dog.id === data.dogs[1].id) return route.fulfill({ status: 503, json: { ok: false, error: '暫時無法接受' } });
      const row = { key: dog.id, version: 1, walkedDate: day, walker: '甲', syncStatus: 'pending', at: '2026-10-21T02:00:00Z' };
      pack = { ...pack, version: pack.version + 1, walks: [...pack.walks.filter(w => w.key !== dog.id), row] };
      return route.fulfill({ json: { ok: true, source: 'd1', today: day, snapshot: pack, results: [{ ...dog, status: 'written', accepted: true, requestId: body.requestId, operationDate: day, version: 1, current: { date: day, walker: '甲' }, syncStatus: 'pending', at: row.at }] } });
    }
    // 試算表即時名單說第二隻今天甲溜了：D1 沒接受就不算
    const body = endpoint === 'dogs' ? data : endpoint === 'today' ? pack
      : endpoint === 'walkers' ? { walkers: { [data.dogs[1].id]: '甲' }, dates: { [data.dogs[1].id]: day }, names: ['甲'], readAt: '2026-10-21T03:00:00Z' }
        : endpoint === 'rest' ? { rest: {} } : { ok: true, walks: [], departures: [], ids: [], aliases: {} };
    return route.fulfill({ json: body });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.clock.install({ time: new Date('2026-10-21T02:00:00Z') });
  try {
    await page.goto(base + '/public/index.html', { waitUntil: 'networkidle' });
    assert.equal(await page.locator('#main .walk-btn.done').count(), 0, '本機舊紀錄與試算表即時名單不能顯示已溜');
    // #479：登記識別必須確實存入手機，記憶體備援不能當作持久儲存成功。
    await page.evaluate(() => {
      window.__save479 = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'bq-walk-requests') throw new Error('QuotaExceededError');
        return window.__save479.call(this, key, value);
      };
    });
    await page.locator('#main .card[data-dog="0"] .walk-btn').click();
    await page.waitForFunction(() => !document.querySelector('#main .card[data-dog="0"] .walk-btn')?.textContent.includes('登記中'));
    assert.equal(sent.length, 0, '未存入登記識別時不得送出 D1 要求');
    await page.getByText(/沒登記到|還不知道有沒有登記到/).first().waitFor();
    assert.equal(await page.locator('#main .walk-btn.done').count(), 0, '未送出不得顯示已溜');
    await page.evaluate(() => { Storage.prototype.setItem = window.__save479; delete window.__save479; });
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('[data-tab="groups"]').click();
    await page.locator('#gwWalk').click();
    await page.getByText(/已登記 1 隻/).waitFor();
    assert.match(await page.locator('body').innerText(), /沒登記到|還不知道有沒有登記到/);
    assert.equal(sent.length, 2);
    assert.ok(sent.every(b => b.dogs.length === 1 && b.requestId), '整群逐狗送 D1 單狗請求');
    assert.notEqual(sent[0].requestId, sent[1].requestId);
    await page.locator('[data-tab="walk"]').click();
    const done = await page.locator('#main .card .walk-btn.done').count();
    assert.equal(done, 1, '只有 D1 接受的那隻顯示已溜');
    const walked = await page.evaluate(() => JSON.parse(localStorage.getItem('bq-walked') || 'null'));
    assert.ok(!walked || !walked.ids.includes(data.dogs[0].id), '不把 D1 結果另存本機已溜');
    console.log('#460 整群逐狗 D1 接受、部分成功、本機／試算表即時名單不反駁 D1 通過');
  } finally { await context.close(); }
};
