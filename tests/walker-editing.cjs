const assert = require('node:assert/strict');
const fixture = require('./fixtures/dogs.json');

// 以實際頁面操作驗證；只攔截 HTTP，所有狗與溜狗人都是合成資料。
module.exports = async (browser, base) => {
  const day = '2026-10-18';
  const data = structuredClone(fixture);
  data.syncedAt = '2026-10-18 06:30';
  data.dogs = data.dogs.slice(0, 2).map((d, i) => ({ ...d, name: `編輯測試${i + 1}`, walkedDate: day }));
  data.groupColumns = [{ column: 4, label: '測試群', names: data.dogs.map(d => d.name) }];
  const d1 = require('./fixtures/fake-d1-walks.cjs')({ today: () => day });
  data.dogs.forEach(d => d1.set(d.id, '測試志工、同行甲'));
  const walkerOf = dog => d1.rows.get(dog.id).walker;
  const writes = [];
  let releaseWrite = null, holdWrite = false, failWrite = false;
  let delayedRead = '', releaseRead = null;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
  await context.addInitScript(() => {
    localStorage.setItem('bq-onboarded', '1');
    localStorage.setItem('bq-name-later', '1');
    if (!localStorage.getItem('bq-test-seeded')) {
      localStorage.setItem('bq-walker-name', '測試志工');
      localStorage.setItem('bq-test-seeded', '1');
    }
  });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== base) return route.abort();
    if (!url.pathname.includes('/api/')) return route.continue();
    const endpoint = url.pathname.split('/api/')[1];
    if (endpoint === delayedRead && req.method() === 'GET') await new Promise(resolve => { releaseRead = resolve; });
    if (endpoint === 'walk' && req.method() === 'POST') {
      const body = req.postDataJSON(); writes.push(body);
      if (holdWrite) await new Promise(resolve => { releaseWrite = resolve; });
      if (failWrite) return route.fulfill({ status: 503, json: { ok: false, error: '測試寫入失敗' } });
      return route.fulfill({ json: d1.walk(body) });
    }
    const out = endpoint === 'dogs' ? data : endpoint === 'walkers' ? { walkers: {}, names: ['測試志工', '同行甲', '同行乙'] }
      : endpoint === 'today' ? d1.pack()
        : endpoint === 'rest' ? { rest: {} } : { ok: true, walks: [], departures: [] };
    return route.fulfill({ json: out });
  });
  const page = await context.newPage();
  // 重開網頁：詳細資訊開著時網址是 #dog/<編號>（ADR 0024），reload 會留在那隻狗；這裡要的是重新打開網站
  const reopen = options => page.goto(page.url().split('#')[0], options);
  page.setDefaultTimeout(5000);
  await page.clock.install({ time: new Date('2026-10-18T02:00:00Z') });
  const pathIs = (r, endpoint) => new URL(r.url()).pathname.endsWith('/api/' + endpoint);
  const lastWalk = () => page.locator('.last-walk').textContent();
  const openDog = async () => {
    const close = page.getByRole('button', { name: '關閉', exact: true });
    if (await close.isVisible()) await close.click();
    await page.locator('[data-tab="walk"]').click();
    await page.locator('#main [data-dog="0"]').first().click();
  };
  try {
    await page.goto(base + '/public/index.html', { waitUntil: 'networkidle' });
    await openDog();
    // 今日消息確認自己已溜，但這支手機沒有寫入快照，仍應可編輯。
    assert.equal(await page.locator('#whoAdd').count(), 1, '今日資料讀回後，不應因自己已溜而隱藏編輯入口');
    // D1 改名單成功不跳提示條（#457），以名單本身確認
    await page.getByRole('button', { name: '拿掉 同行甲', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.last-walk')?.textContent.includes('同行甲'));
    assert.deepEqual([writes.at(-1).action, writes.at(-1).walker, writes.at(-1).editor], ['edit', '測試志工', '測試志工']);
    assert.equal(walkerOf(data.dogs[0]), '測試志工');
    await page.locator('#whoAdd').click();
    await page.locator('[data-with="同行乙"]').click();
    await page.locator('[data-with-ok]').click();
    await page.waitForFunction(() => document.querySelector('.last-walk')?.textContent.includes('同行乙'));
    assert.equal(walkerOf(data.dogs[0]), '測試志工、同行乙');
    await reopen({ waitUntil: 'networkidle' });
    await openDog();
    assert.equal(await page.locator('#whoAdd').count(), 1, '重開後仍能編輯');
    assert.match(await lastWalk(), /同行乙/);
    // 別人先改名單：帶版本比對，不得覆蓋新名字，改顯示伺服器現況。
    d1.set(data.dogs[0].id, '測試志工、同行乙、同行丙');
    await page.getByRole('button', { name: '拿掉 同行乙', exact: true }).click();
    await page.getByText(/沒有蓋掉/).waitFor();
    assert.equal(walkerOf(data.dogs[0]), '測試志工、同行乙、同行丙');
    assert.match(await lastWalk(), /同行丙/);
    failWrite = true;
    await page.getByRole('button', { name: '拿掉 同行丙', exact: true }).click();
    await page.getByText(/測試寫入失敗/).waitFor();
    assert.equal(walkerOf(data.dogs[0]), '測試志工、同行乙、同行丙');
    assert.match(await lastWalk(), /同行丙/);
    failWrite = false;
    await context.setOffline(true);
    await openDog();
    assert.equal(await page.locator('#whoAdd').count(), 0, '離線不提供寫入入口');
    assert.match(await page.locator('.last-walk').textContent(), /沒網路/);
    await context.setOffline(false);
    await page.evaluate(() => localStorage.removeItem('bq-walker-name'));
    await reopen({ waitUntil: 'networkidle' });
    await openDog();
    assert.equal(await page.locator('#whoAdd').count(), 0, '未選身分不提供寫入入口');
    assert.match(await page.locator('.last-walk').textContent(), /選好.*名字/);
    await page.evaluate(() => localStorage.setItem('bq-walker-name', '測試志工'));
    data.dogs[1].walkedDate = '2026-10-17';
    d1.set(data.dogs[1].id, '同行甲', '2026-10-17');
    await reopen({ waitUntil: 'networkidle' });
    await page.locator('#main [data-dog="1"]').first().click();
    holdWrite = true;
    const ordinarySent = page.waitForRequest(r => r.url().endsWith('/api/walk') && r.method() === 'POST');
    await page.locator('#groupWalk').click();
    await ordinarySent;
    assert.equal(await page.locator('#whoAdd').count(), 0, '一般登記尚未確認時不可編輯');
    assert.match(await page.locator('.last-walk').textContent(), /正在寫進試算表/);
    holdWrite = false; releaseWrite();
    await page.locator('#whoAdd').waitFor();
    // 模擬重開後尚未登記的另一隻狗，再驗證整群入口。
    d1.set(data.dogs[1].id, '同行甲', '2026-10-17');
    await reopen({ waitUntil: 'networkidle' });
    await page.locator('[data-tab="groups"]').click();
    await page.locator('#gwWalk').waitFor();
    holdWrite = true;
    const sent = page.waitForRequest(r => r.url().endsWith('/api/walk') && r.method() === 'POST');
    await page.locator('#gwWalk').click();
    await sent;
    // 整群請求尚未完成時，保留原有停用操作保護。
    assert.equal(await page.locator('#gwWalk').isDisabled(), true);
    holdWrite = false; releaseWrite();
    await page.getByRole('button', { name: '這群今天已溜，按一下取消' }).waitFor();
    await page.locator('[data-gw-dog="1"]').click();
    assert.equal(await page.locator('#whoAdd').count(), 1, '整群成功後與一般登記同樣可編輯');
    await page.clock.setSystemTime(new Date('2026-10-19T02:00:00Z'));
    await reopen({ waitUntil: 'networkidle' });
    await openDog();
    assert.equal(await page.locator('#whoAdd').count(), 0, '隔天不開放昨天名單編輯');
    assert.doesNotMatch(await page.locator('.last-walk').textContent(), /僅能編輯已確認的今天溜狗人/, '刪除提示後不顯示該文案，昨天名單仍不可編輯');
    await page.clock.setSystemTime(new Date('2026-10-18T02:00:00Z'));
    for (const endpoint of ['walkers', 'today']) {
      delayedRead = endpoint; releaseRead = null;
      const first = page.waitForResponse(r => pathIs(r, endpoint === 'walkers' ? 'today' : 'walkers'));
      await reopen({ waitUntil: 'domcontentloaded' });
      await first;
      if (endpoint === 'walkers') {
        await openDog();
        await page.locator('#whoAdd').waitFor();
      } else {
        // #418：初次今日消息尚未確認時，溜狗表先維持載入狀態。
        assert.equal(await page.locator('#main [data-dog]').count(), 0);
      }
      const last = page.waitForResponse(r => pathIs(r, endpoint));
      delayedRead = ''; releaseRead();
      await last;
      await page.waitForLoadState('networkidle');
      if (endpoint === 'today') await openDog();
      assert.equal(await page.locator('#whoAdd').count(), 1, `${endpoint} 較晚抵達仍可編輯`);
    }
    console.log('#417 今日資料讀回、加減溜狗人、重開及衝突保護通過');
  } finally { await context.close(); }
};
