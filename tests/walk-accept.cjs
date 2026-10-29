const assert = require('node:assert/strict');
const fs = require('node:fs');
const fixture = require('./fixtures/dogs.json');

module.exports = async (browser, base) => {
  const day = '2026-10-21', data = structuredClone(fixture);
  data.syncedAt = '2026-10-21 09:00';
  data.dogs = data.dogs.slice(0, 2).map((d,i) => ({ ...d, name: `登記測試${i+1}`, note:'', walkedDate:'2026-10-01' }));
  data.groupColumns = [{ column: 1, label:'測試群', names:data.dogs.map(d => d.name) }];
  let pack = { ok:true, source:'d1', date:day, version:0, walks:[] }, release, sent, conflictNext = false, writes = 0;
  const context = await browser.newContext({ viewport:{ width:390,height:844 }, timezoneId:'Asia/Taipei', serviceWorkers:'block' });
  await context.addInitScript(() => {
    localStorage.setItem('bq-onboarded','1'); localStorage.setItem('bq-name-later','1'); localStorage.setItem('bq-walker-name','甲');
  });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== base) return route.abort();
    if (!url.pathname.includes('/api/')) return route.continue();
    const endpoint = url.pathname.split('/api/')[1];
    if (endpoint === 'walk') {
      writes++;
      sent = req.postDataJSON();
      await new Promise(resolve => { release = resolve; });
      assert.ok(sent.requestId); assert.equal(sent.operationDate,day);
      if (conflictNext) {
        conflictNext = false;
        const row = { ...pack.walks[0], version:pack.walks[0].version+1,walker:'乙、丙' };
        pack = { ...pack,version:pack.version+1,walks:[row] };
        return route.fulfill({ status:409,json:{ ok:false,source:'d1',error:'名單已改變',snapshot:pack,
          results:[{ ...sent.dogs[0],status:'changed',version:row.version,current:{ date:day,walker:row.walker } }] } });
      }
      const current = sent.action === 'undo' ? { date:'2026-10-01',walker:'' } : { date:day,walker:sent.action === 'edit' ? sent.walker : '甲' };
      const row = { key:data.dogs[0].id, version:(pack.walks[0]?.version || 0)+1, walkedDate:current.date, walker:current.walker, syncStatus:'pending', at:'2026-10-21T02:00:00Z' };
      pack = { ...pack, version:pack.version+1, walks:[row] };
      return route.fulfill({ json:{ ok:true, source:'d1', today:day, snapshot:pack, results:[{ ...sent.dogs[0], status:sent.action === 'undo' ? 'restored' : 'written', accepted:true, requestId:sent.requestId, operationDate:day, version:row.version, current, syncStatus:'pending', at:row.at }] } });
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
    assert.equal(await card.locator('.walk-sync').textContent(),'寫回試算表中');
    assert.equal(await page.getByText('已寫進試算表',{ exact:true }).count(),0);
    // K 2026-10-24：D1 接受後提示條照舊有「＋一起溜的人」（開關打開前就有的入口）
    await page.locator('#toast .toast-extra',{ hasText:'＋一起溜的人' }).waitFor();
    await page.locator('#toast .toast-text').click();
    await card.click();
    assert.equal(await page.locator('.last-walk .walk-sync').textContent(),'寫回試算表中');
    await page.getByRole('button',{ name:'關閉',exact:true }).click();
    await page.locator('[data-tab="groups"]').click();
    assert.equal(await page.locator('.front .walk-sync').textContent(),'寫回試算表中');
    pack = { ...pack, version:2, walks:[{ ...pack.walks[0], syncStatus:'retry' }] };
    await page.evaluate(() => loadTodayWalks());
    await page.getByText('寫回試算表失敗，會自動重試',{ exact:true }).waitFor();
    pack = { ...pack, version:3, walks:[{ ...pack.walks[0], syncStatus:'synced' }] };
    await page.evaluate(() => loadTodayWalks());
    assert.equal(await page.locator('.walk-sync').count(),0);
    // 新裝置只能依 D1 包恢復，不依本機今天已溜紀錄。
    await page.reload({ waitUntil:'networkidle' });
    await page.locator('[data-tab="walk"]').click();
    await page.locator('#main .card[data-dog="0"] .walk-btn.done').waitFor();
    pack = { ...pack, version:pack.version+1, walks:[{ ...pack.walks[0], version:2,walker:'甲、乙' }] };
    await page.evaluate(() => loadTodayWalks());
    await page.locator('#main .card[data-dog="0"]').click();
    release = null;
    await page.getByRole('button',{ name:'拿掉 甲',exact:true }).click();
    await page.waitForFunction(() => document.querySelector('.last-walk')?.textContent.includes('乙'));
    while (!release) await new Promise(resolve => setTimeout(resolve,10));
    assert.equal(sent.action,'edit');
    assert.equal(sent.editor,'甲');
    assert.equal(sent.dogs[0].expectedVersion,2);
    assert.equal(sent.walker,'乙');
    assert.match(await page.locator('.last-walk').textContent(),/甲/,'接受前保留原名單');
    release();
    await page.waitForFunction(() => document.querySelector('.last-walk')?.textContent.includes('乙') && !document.querySelector('.last-walk')?.textContent.includes('甲'));
    assert.equal(await page.locator('.last-walk .walk-sync').textContent(),'寫回試算表中');
    assert.equal(await page.getByText(/已寫進試算表/).count(),0);
    await page.reload({ waitUntil:'networkidle' });
    // 網址還是這隻狗（ADR 0024 #dog/<編號>），重新整理後詳細資訊直接打開
    await page.locator('#detailBackdrop').waitFor();
    fs.mkdirSync('.scratch/checks',{ recursive:true });
    await page.screenshot({ path:'.scratch/checks/457-mobile.png',fullPage:true });
    await page.setViewportSize({ width:1440,height:1000 });
    await page.screenshot({ path:'.scratch/checks/457-desktop.png',fullPage:true });
    assert.equal(await page.getByRole('button',{ name:'取消這次登記（乙）',exact:true }).isVisible(),true);
    await page.setViewportSize({ width:390,height:844 });
    release = null;
    await page.getByRole('button',{ name:'取消這次登記（乙）',exact:true }).click();
    while (!release) await new Promise(resolve => setTimeout(resolve,10));
    assert.equal(sent.action,'undo');
    assert.equal(sent.walker,'甲','另一位志工可復原');
    assert.equal(sent.dogs[0].expectedVersion,3);
    assert.equal(sent.dogs[0].prev,undefined);
    release();
    await page.waitForFunction(() => !document.querySelector('[data-who-undo]'));
    assert.equal(await page.locator('.last-walk .walk-sync').textContent(),'寫回試算表中');
    assert.equal(await page.getByText(/已從試算表復原/).count(),0);
    assert.equal(await page.locator('#main .card[data-dog="0"] .walk-btn.done').count(),0);
    pack = { ...pack,version:pack.version+1,walks:[{ ...pack.walks[0],version:5,walkedDate:day,walker:'乙' }] };
    await page.evaluate(() => loadTodayWalks());
    conflictNext = true; release = null;
    const before = writes;
    await page.getByRole('button',{ name:'取消這次登記（乙）',exact:true }).click();
    while (!release) await new Promise(resolve => setTimeout(resolve,10));
    release();
    await page.getByText(/沒有蓋掉別人的紀錄/).waitFor();
    await page.getByRole('button',{ name:'拿掉 丙',exact:true }).waitFor();
    assert.equal(await page.locator('[data-who-undo]').count(),0);
    assert.equal(await page.getByRole('button',{ name:'再試一次',exact:true }).count(),0);
    assert.equal(writes,before+1,'版本衝突不自動重送復原');
    console.log('#456/#457 D1 接受、名單修改、跨裝置復原、同步小字與手機／電腦操作入口通過');
  } finally { release?.(); await context.close(); }
};
