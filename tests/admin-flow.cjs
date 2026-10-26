const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 資料流頁（K 2026-10-26）：兩張節點圖、燈號、右側詳細與讀取失敗。API 全部用假回應，不碰正式資料。
module.exports = async (browser, base) => {
  const { ADMIN_CSP } = await import('../worker/src/admin/index.js');
  const now = Date.now(), iso = ms => new Date(ms).toISOString();
  const status = {
    readAt: iso(now),
    writeback: { total: 2, items: [
      { number: '2026010101', name: '阿福', status: 'retry', error: 'writeback-rejected: 找不到唯一的狗', nextAt: iso(now + 60000), targetDate: '2026-10-27' },
      { number: '', name: '小黑', status: 'pending', error: '', nextAt: iso(now - 1000), targetDate: '2026-10-27' },
    ] },
    conflicts: 1, delivering: 0,
    budget: { day: '2026-10-27', reserved: 1200, limit: 40000 },
    lastWalkAt: iso(now - 5 * 60000), dogListChangedAt: '2026-10-27T09:30:00+08:00',
    dogListScan: { checkedAt: iso(now - 3600000), extra: 0 },
    cron: [
      { job: 'retry', state: 'ok', okAt: iso(now - 4 * 60000), failAt: null, error: '', stale: false },
      { job: 'scan', state: 'never', okAt: null, failAt: null, error: '', stale: true },
      { job: 'trash', state: 'never', okAt: null, failAt: null, error: '', stale: true },
    ],
  };
  let code = 200;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
  await context.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(`${event.effectiveDirective}: ${event.blockedURI}`));
  });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/admin/public/flow.html') return route.fulfill({ body: fs.readFileSync(path.join(__dirname, '../admin/public/flow.html')), headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': ADMIN_CSP } });
    if (url.pathname === '/api/manage/flow-status') {
      assert.equal(req.method(), 'GET', '資料流頁只讀');
      return route.fulfill({ status: code, json: code === 200 ? status : { error: '管理資料暫時無法讀取，請稍後重試' } });
    }
    return route.continue();
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${base}/admin/public/flow.html`);
    await page.getByText('1 個燈號有問題', { exact: false }).waitFor();
    const node = id => page.locator(`.flow-node[data-id="${id}"]`);
    assert.equal(await page.locator('.flow-node').count(), 11);
    assert.equal(await page.locator('.flow-wire').count(), 13, '每條連線都畫出來');
    assert.equal(await node('gas').getAttribute('data-level'), 'bad');
    assert.match(await node('gas').textContent(), /有問題・1 隻被試算表拒絕/);
    assert.match(await node('sheet').textContent(), /注意・1 隻跟網站不一致/);
    assert.match(await node('scan').textContent(), /沒有紀錄・還沒有紀錄/, '還沒跑過不算出錯');
    assert.equal(await node('volunteer').getAttribute('data-level'), null, '不看狀態的節點沒有燈號');

    // 點節點：右側詳細、相關連線亮起、網址記住
    await node('gas').click();
    await page.locator('#flow-detail h2', { hasText: 'Apps Script' }).waitFor();
    assert.match(await page.locator('#flow-detail').textContent(), /阿福（2026010101）：等待重試・writeback-rejected/);
    assert.match(await page.locator('#flow-detail').textContent(), /小黑（無編號）：等待派送/);
    assert.equal(await page.locator('.flow-wire.on').count(), 7);
    assert.match(page.url(), /node=gas/);
    await page.locator('#flow-detail .flow-link', { hasText: '試算表' }).first().click();
    await page.locator('#flow-detail h2', { hasText: '試算表' }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.id), 'sheet', '點右側連線後焦點移到那個節點');
    await page.keyboard.press('Escape');
    await page.locator('#flow-detail h2', { hasText: '點一個節點看詳細' }).waitFor();
    assert.equal(await page.locator('.flow-wire.on').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.id), 'sheet', '關閉後焦點留在剛才那個節點');
    await node('d1').focus();
    await page.keyboard.press('Enter');
    await page.locator('#flow-detail h2', { hasText: 'D1' }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.id), 'd1', '鍵盤選取後焦點不會掉');
    await page.keyboard.press('Escape');

    // 傳輸鏈
    await page.getByRole('button', { name: '網站登記傳輸鏈' }).click();
    await node('receipt').waitFor();
    assert.equal(await page.getByRole('button', { name: '網站登記傳輸鏈' }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.flow-node').count(), 11);
    assert.equal(await page.locator('.flow-wire').count(), 11);
    assert.match(await node('tx').textContent(), /正常・今天寫入預算 3%/);
    assert.match(page.url(), /view=chain/);
    await page.reload();
    await node('receipt').waitFor();

    const shots = path.join(__dirname, '../.impeccable/review');
    fs.mkdirSync(shots, { recursive: true });
    for (const [width, height] of [[1440, 1000], [1100, 900], [390, 844]]) {
      await page.setViewportSize({ width, height });
      for (const view of ['flow', 'chain']) {
        await page.goto(`${base}/admin/public/flow.html?view=${view}&node=${view === 'flow' ? 'gas' : 'receipt'}`);
        await page.getByText('燈號有問題', { exact: false }).waitFor();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${view} ${width}px 整頁不溢出（圖在自己的捲動區）`);
        await page.screenshot({ path: path.join(shots, `flow-${view}-${width}.png`), fullPage: true });
      }
    }

    // 讀不到：燈號寫讀不到，不當成正常
    code = 503;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${base}/admin/public/flow.html`);
    await page.getByText('燈號暫時無法判斷，不代表正常', { exact: false }).waitFor();
    assert.match(await node('gas').textContent(), /讀不到/);
    assert.equal(await page.locator('#flow-status').getAttribute('data-error'), 'true');

    assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
    assert.deepEqual(errors, []);
    console.log('資料流：兩張圖、燈號、右側詳細、網址、讀取失敗、1440／1100／390px 通過');
  } finally {
    await context.close();
  }
};
