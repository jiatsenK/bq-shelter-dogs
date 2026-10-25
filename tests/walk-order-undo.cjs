// #445：按溜了直接往下排；復原立刻顯示、捲到那隻狗；有按鈕的提示條久一點。以 D1 回應為準。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fixture = require('./fixtures/dogs.json');

module.exports = async (browser, base) => {
  const day = '2026-10-21', data = structuredClone(fixture);
  data.syncedAt = '2026-10-21 09:00';
  // 天數由多到少：排序測試0 最久沒溜排第一
  data.dogs = data.dogs.map((d, i) => ({ ...d, name: `排序測試${i}`, note: '', walkedDate: `2026-09-${String(i + 1).padStart(2, '0')}`, walkers: [] }));
  data.groups = {};
  data.groupColumns = [{ column: 1, label: '測試群', names: [data.dogs[6].name, data.dogs[7].name] }];
  let pack = { ok: true, source: 'd1', date: day, version: 0, walks: [] };
  const sent = [], held = [];
  let hold = false, failUndo = false, syncStatus = 'pending';
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
  await context.addInitScript(favs => {
    if (!localStorage.getItem('bq-favs')) localStorage.setItem('bq-favs', JSON.stringify(favs));
    localStorage.setItem('bq-onboarded', '1'); localStorage.setItem('bq-name-later', '1'); localStorage.setItem('bq-walker-name', '甲');
  }, data.dogs.slice(1, 4).map(d => d.id));
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== base) return route.abort();
    if (url.pathname.endsWith('/js/site-config.js')) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(require.resolve('../public/js/site-config.js'), 'utf8').replace('d1WalkAccept: false', 'd1WalkAccept: true') });
    if (!url.pathname.includes('/api/')) return route.continue();
    const endpoint = url.pathname.split('/api/')[1];
    if (endpoint === 'walk') {
      const body = req.postDataJSON();
      sent.push(body);
      if (hold) await new Promise(resolve => held.push(resolve));
      const dog = body.dogs[0], undo = body.action === 'undo';
      if (undo && failUndo) return route.fulfill({ status: 503, json: { ok: false, error: '暫時無法接受' } });
      const old = pack.walks.find(w => w.key === dog.id);
      const prior = data.dogs.find(d => d.id === dog.id).walkedDate;
      const current = undo ? { date: prior, walker: '' } : { date: day, walker: '甲' };
      const row = { key: dog.id, version: (old?.version || 0) + 1, walkedDate: current.date, walker: current.walker, syncStatus, at: '2026-10-21T02:00:00Z' };
      pack = { ...pack, version: pack.version + 1, walks: [...pack.walks.filter(w => w.key !== dog.id), row] };
      return route.fulfill({ json: { ok: true, source: 'd1', today: day, snapshot: pack, results: [{ ...dog, status: undo ? 'restored' : 'written', accepted: true, requestId: body.requestId, operationDate: day, version: row.version, current, syncStatus, at: row.at }] } });
    }
    const body = endpoint === 'dogs' ? data : endpoint === 'today' ? pack
      : endpoint === 'walkers' ? { walkers: {}, dates: {}, names: ['甲'] } : endpoint === 'rest' ? { rest: {} } : { ok: true, walks: [], departures: [], ids: [], aliases: {} };
    return route.fulfill({ json: body });
  });
  const page = await context.newPage();
  page.on('pageerror', e => console.error(e.message));
  page.setDefaultTimeout(5000);
  await page.clock.install({ time: new Date('2026-10-21T02:00:00Z') });
  const order = () => page.locator('#main .card[data-dog]').evaluateAll(cards => cards.map(c => c.dataset.dog));
  const card = i => page.locator(`#main .card[data-dog="${i}"]`);
  // 卡片整張在頁首下面、提示條上面
  const visible = i => card(i).evaluate(el => {
    const r = el.getBoundingClientRect(), top = document.querySelector('header')?.getBoundingClientRect().bottom || 0;
    const toast = document.querySelector('#toast:not([hidden])')?.getBoundingClientRect().top ?? innerHeight;
    return r.top >= top && r.bottom <= Math.min(innerHeight, toast);
  });
  const waitSent = async n => { while (sent.length < n) await new Promise(r => setTimeout(r, 10)); };
  try {
    await page.goto(base + '/public/index.html', { waitUntil: 'networkidle' });
    const start = await order();
    assert.equal(start[0], '0', '最久沒溜的排第一');

    // 1. 按溜了：D1 接受後狗立刻照天數排到後面，不固定在原位
    await card(0).locator('[data-walk="add"]').click();
    await card(0).locator('.walk-btn.done').waitFor();
    assert.deepEqual(await order(), [...start.slice(1), '0'], '按溜了直接排到最後');
    // 常溜狗群（★ 我的常溜）一致
    await page.locator('[data-walk-fav="1"]').click();
    assert.deepEqual(await order(), ['1', '2', '3'], '常溜清單也最久沒溜在前');
    await card(1).locator('[data-walk="add"]').click();
    await card(1).locator('.walk-btn.done').waitFor();
    assert.deepEqual(await order(), ['2', '3', '1'], '常溜清單按溜了也直接排到最後');
    await page.locator('[data-walk-fav="0"]').click();
    // 常遛狗群分頁整群溜了，回溜狗表也一樣排到後面
    await page.locator('[data-tab="groups"]').click();
    await page.locator('#gwWalk').click();
    await page.getByText(/已登記 2 隻/).waitFor();
    await page.locator('[data-tab="walk"]').click();
    assert.deepEqual((await order()).slice(-4), ['0', '1', '6', '7'], '整群溜了的也照天數排到後面');

    // 2. 按復原：D1 還沒回應，畫面就恢復、捲到那隻狗並看得到
    hold = true;
    let n = sent.length;
    await card(0).scrollIntoViewIfNeeded();
    await card(0).locator('[data-walk="back"]').click();
    assert.equal((await order())[0], '0', '復原後立刻回到原本的位置');
    assert.equal(await card(0).locator('.walk-btn.done').count(), 0, '立刻不再顯示已溜');
    assert.match(await card(0).locator('.walk-btn').textContent(), /溜了/);
    assert.ok(await visible(0), '捲到復原的那隻，看得到');
    await waitSent(n + 1);
    assert.equal(sent[n].action, 'undo');
    held.shift()();
    await page.locator('#toast .toast-text', { hasText: /^已取消 排序測試0 今天溜了$/ }).waitFor();
    assert.equal(await card(0).locator('.walk-btn.done').count(), 0, 'D1 接受後仍是復原');
    // 沒有按鈕的提示條照舊約 5 秒收起
    await page.clock.runFor(5500);
    assert.equal(await page.locator('#toast').isHidden(), true, '沒有按鈕的提示條 5 秒收起');

    // 3. 有按鈕（＋一起溜的人、復原、再試一次）的提示條約 8 秒
    hold = false;
    await card(2).locator('[data-walk="add"]').click();
    await page.locator('#toast .toast-extra', { hasText: '＋一起溜的人' }).waitFor();
    await page.clock.runFor(7000);
    assert.equal(await page.locator('#toast').isVisible(), true, '7 秒時還在');
    await page.clock.runFor(1500);
    assert.equal(await page.locator('#toast').isHidden(), true, '約 8 秒收起');

    // 4a. D1 寫入失敗：先恢復，失敗才改回已溜並給再試一次，不假稱已復原
    await card(2).locator('.walk-btn.done').waitFor();
    hold = true; failUndo = true;
    n = sent.length;
    await card(2).locator('[data-walk="back"]').click();
    assert.equal(await card(2).locator('.walk-btn.done').count(), 0, '送出就先恢復');
    await waitSent(n + 1);
    held.shift()();
    await page.locator('#toast .toast-text', { hasText: /排序測試2 尚未確認.*尚未復原/ }).waitFor();
    await card(2).locator('.walk-btn.done').waitFor();
    assert.ok(await visible(2), '改回已溜的那隻也看得到');
    assert.doesNotMatch(await page.locator('#toast .toast-text').textContent(), /已取消/);
    failUndo = false; n = sent.length;
    await page.clock.runFor(7000);
    assert.equal(await page.locator('#toast').isVisible(), true, '有「再試一次」的提示條 7 秒時還在');
    await page.locator('#toast .toast-extra', { hasText: '再試一次' }).click();
    assert.equal(await card(2).locator('.walk-btn.done').count(), 0, '再試一次也立刻恢復');
    await waitSent(n + 1);
    assert.equal(sent[n].requestId, sent[n - 1].requestId, '再試一次沿用原本的登記識別');
    held.shift()();
    await page.locator('#toast .toast-text', { hasText: /^已取消 排序測試2 今天溜了$/ }).waitFor();
    assert.equal(await card(2).locator('.walk-btn.done').count(), 0);

    // 4b. 連按復原：同一隻連點兩下只送一次；接著按另一隻，兩隻都立刻恢復、依序送出
    hold = false;
    for (const i of [3, 4]) { await card(i).locator('[data-walk="add"]').click(); await card(i).locator('.walk-btn.done').waitFor(); }
    hold = true; n = sent.length;
    await card(3).locator('[data-walk="back"]').dblclick();
    assert.equal(await card(3).locator('.walk-btn').isDisabled(), true, '確認中的按鈕不能再按');
    await card(4).locator('[data-walk="back"]').click();
    const doneOf = async ids => (await Promise.all(ids.map(i => card(i).locator('.walk-btn.done').count()))).reduce((a, b) => a + b);
    assert.equal(await doneOf([3, 4]), 0, '兩隻都立刻恢復');
    assert.deepEqual((await order()).slice(0, 5), ['0', '2', '3', '4', '5'], '回到原本的順序（排序測試1 早先溜了，在後面）');
    await waitSent(n + 1);
    held.shift()();
    await waitSent(n + 2);
    held.shift()();
    await page.locator('#toast .toast-text', { hasText: /^已取消 排序測試4 今天溜了$/ }).waitFor();
    const undos = sent.slice(n).filter(b => b.action === 'undo').map(b => b.dogs[0].name);
    assert.deepEqual(undos, ['排序測試3', '排序測試4'], '連按同一隻只送一次復原');
    assert.equal(await doneOf([3, 4]), 0);

    // 5. D1 接受但試算表背景寫回失敗：仍算已復原，不跳失敗提示
    hold = false;
    await card(5).locator('[data-walk="add"]').click();
    await card(5).locator('.walk-btn.done').waitFor();
    syncStatus = 'retry';
    await card(5).locator('[data-walk="back"]').click();
    await page.locator('#toast .toast-text', { hasText: /^已取消 排序測試5 今天溜了$/ }).waitFor();
    pack = { ...pack, version: pack.version + 1 };
    await page.evaluate(() => loadTodayWalks());
    assert.equal(await card(5).locator('.walk-btn.done').count(), 0, '試算表寫回失敗不影響復原');
    assert.match(await card(5).locator('.last').textContent(), /45/, '顯示登記前的天數');
    assert.doesNotMatch(await page.locator('#toast .toast-text').textContent(), /尚未/);

    // 6. 詳細資訊溜狗人旁的 × 也立刻恢復，關掉詳細資訊就看得到那隻
    syncStatus = 'pending'; hold = true; n = sent.length;
    await card(6).scrollIntoViewIfNeeded();
    await card(6).click();
    await page.getByRole('button', { name: '取消這次登記（甲）', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '取消這次登記（甲）', exact: true }).count(), 0, '× 按了就收起，不能連按');
    assert.equal(await card(6).locator('.walk-btn.done').count(), 0, '× 復原立刻恢復');
    await waitSent(n + 1);
    held.shift()();
    await page.locator('#toast .toast-text', { hasText: /^已取消 排序測試6 今天溜了$/ }).waitFor();
    assert.equal(sent.length, n + 1);
    await page.getByRole('button', { name: '關閉', exact: true }).click();
    assert.ok(await visible(6), '關掉詳細資訊後看得到復原的那隻');
    console.log('#445 按溜了往下排、復原立刻顯示並捲到那隻、提示條久一點、D1 失敗與連按、試算表寫回失敗通過');
  } finally { held.forEach(r => r()); await context.close(); }
};
