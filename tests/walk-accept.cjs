const assert = require('node:assert/strict');
const fs = require('node:fs');
const fixture = require('./fixtures/dogs.json');

module.exports = async (browser, base) => {
  const day = '2026-10-21', data = structuredClone(fixture);
  data.syncedAt = '2026-10-21 09:00';
  data.dogs = data.dogs.slice(0, 2).map((d,i) => ({ ...d, name: `登記測試${i+1}`, note:'', walkedDate:'2026-10-01' }));
  data.groupColumns = [{ column: 1, label:'測試群', names:data.dogs.map(d => d.name) }];
  let pack = { ok:true, source:'d1', date:day, version:0, walks:[] }, release, sent;
  const context = await browser.newContext({ viewport:{ width:390,height:844 }, timezoneId:'Asia/Taipei', serviceWorkers:'block' });
  await context.addInitScript(() => {
    localStorage.setItem('bq-onboarded','1'); localStorage.setItem('bq-name-later','1'); localStorage.setItem('bq-walker-name','甲');
  });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== base) return route.abort();
    if (url.pathname.endsWith('/js/site-config.js')) return route.fulfill({ contentType:'application/javascript', body:fs.readFileSync(require.resolve('../public/js/site-config.js'),'utf8').replace('d1WalkAccept: false','d1WalkAccept: true') });
    if (!url.pathname.includes('/api/')) return route.continue();
    const endpoint = url.pathname.split('/api/')[1];
    if (endpoint === 'walk') {
      sent = req.postDataJSON();
      await new Promise(resolve => { release = resolve; });
      assert.ok(sent.requestId); assert.equal(sent.operationDate,day);
      const row = { key:data.dogs[0].id, version:1, walkedDate:day, walker:'甲', syncStatus:'pending', at:'2026-10-21T02:00:00Z' };
      pack = { ...pack, version:1, walks:[row] };
      return route.fulfill({ json:{ ok:true, source:'d1', today:day, snapshot:pack, results:[{ ...sent.dogs[0], status:'written', accepted:true, requestId:sent.requestId, operationDate:day, version:1, current:{ date:day, walker:'甲' }, syncStatus:'pending', at:row.at }] } });
    }
    const body = endpoint === 'dogs' ? data : endpoint === 'today' ? pack
      : endpoint === 'walkers' ? { walkers:{}, dates:{}, names:['甲'] } : endpoint === 'rest' ? { rest:{} } : { ok:true, walks:[], departures:[], ids:[], aliases:{} };
    return route.fulfill({ json:body });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.clock.install({ time:new Date('2026-10-21T02:00:00Z') });
  try {
    await page.goto(base+'/public/index.html',{ waitUntil:'networkidle' });
    const card = page.locator('#main .card[data-dog="0"]');
    await card.locator('.walk-btn').click();
    await page.waitForFunction(() => document.querySelector('#main .card[data-dog="0"] .walk-btn')?.textContent.includes('登記中'));
    assert.equal(await card.locator('.walk-btn.done').count(),0,'未接受前不能顯示已溜');
    release();
    await card.locator('.walk-btn.done').waitFor();
    assert.equal(await card.locator('.walk-sync').textContent(),'試算表同步中');
    assert.equal(await page.getByText('已寫進試算表',{ exact:true }).count(),0);
    await card.click();
    assert.equal(await page.locator('.last-walk .walk-sync').textContent(),'試算表同步中');
    await page.getByRole('button',{ name:'關閉',exact:true }).click();
    await page.locator('[data-tab="groups"]').click();
    assert.equal(await page.locator('.front .walk-sync').textContent(),'試算表同步中');
    pack = { ...pack, version:2, walks:[{ ...pack.walks[0], syncStatus:'retry' }] };
    await page.evaluate(() => loadTodayWalks());
    await page.getByText('試算表尚未同步，會自動重試',{ exact:true }).waitFor();
    pack = { ...pack, version:3, walks:[{ ...pack.walks[0], syncStatus:'synced' }] };
    await page.evaluate(() => loadTodayWalks());
    assert.equal(await page.locator('.walk-sync').count(),0);
    // 新裝置只能依 D1 包恢復，不依本機今天已溜紀錄。
    await page.reload({ waitUntil:'networkidle' });
    await page.locator('[data-tab="walk"]').click();
    await page.locator('#main .card[data-dog="0"] .walk-btn.done').waitFor();
    console.log('#456 D1 接受前等待、同步中／失敗／完成、狗卡／詳細資訊／狗群與重新載入通過');
  } finally { release?.(); await context.close(); }
};
