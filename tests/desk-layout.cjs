// 志工網站 critique 2026-10-28 P1／P2（K 2026-10-29 定）：電腦版頁首一行 64px、每個分頁同一個頁首與左邊線、
// 狗群只從分頁進、詳細資訊從右邊滑出；勾選不留看不到的狗、換頁清掉、面板打開藏浮條、登記失敗在全表標出來；
// 勿溜只提醒不擋（常溜狗群照樣整群登記）。
const assert = require('node:assert/strict');
const fixture = require('./fixtures/dogs.json');

module.exports = async (browser, base) => {
  const day = '2026-10-21', data = structuredClone(fixture);
  data.syncedAt = '2026-10-21 09:00';
  data.dogs = data.dogs.slice(0, 8).map((d, i) => ({ ...d, name: `桌面${i + 1}`, cage: i < 4 ? `新A0${i + 1}` : `舊B0${i + 1}`,
    note: i === 0 ? '勿溜，治療中' : '', covered: false, walkedDate: '2026-10-01', walkers: [] }));
  data.groups = {};
  data.groupColumns = [{ column: 4, label: '桌面群', names: data.dogs.slice(0, 3).map(d => d.name) }];
  const d1 = require('./fixtures/fake-d1-walks.cjs')({ today: () => day });
  let mode = 'ok'; // fail：/api/walk 全部回 503
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
  await context.addInitScript(() => {
    localStorage.setItem('bq-onboarded', '1'); localStorage.setItem('bq-name-later', '1'); localStorage.setItem('bq-walker-name', '甲');
  });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== base) return route.abort();
    if (!url.pathname.includes('/api/')) return route.continue();
    const endpoint = url.pathname.split('/api/')[1];
    if (endpoint === 'walk') {
      if (mode === 'fail') return route.fulfill({ status: 503, json: { ok: false, error: '暫時無法接受' } });
      return route.fulfill({ json: d1.walk(req.postDataJSON()) });
    }
    const out = endpoint === 'dogs' ? data : endpoint === 'today' ? d1.pack()
      : endpoint === 'rest' ? { rest: {} } : { ok: true, walks: [], departures: [], ids: [], aliases: {}, walkers: {}, names: [] };
    return route.fulfill({ json: out });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.clock.install({ time: new Date('2026-10-21T02:00:00Z') });
  const tab = id => page.locator(`#tabs [data-tab="${id}"]`);
  const row = name => page.locator('.desk-table tbody tr', { hasText: name });
  const batchCount = () => page.locator('.desk-batch .dbx-n b').textContent();
  const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  try {
    await page.goto(base + '/public/index.html', { waitUntil: 'domcontentloaded' });
    await page.locator('.desk-table').waitFor();

    // #1 頁首一行：1100、1280、1440 都是 64px，表頭黏在頁首下緣
    for (const width of [1100, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await frame();
      const head = await page.locator('header.app').evaluate(el => Math.round(el.getBoundingClientRect().height));
      assert.equal(head, 64, `${width}px 頁首一行 64px`);
      assert.equal(await page.locator('.desk-table thead th').first().evaluate(el => getComputedStyle(el).top), '64px', `${width}px 表頭黏在頁首下面`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px 沒有橫向捲動`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    // #6、#7、#5：每個分頁同一個頁首（同高、搜尋框同位置、圖鑑還在、沒有「狗群」入口），內容同一條左邊線
    assert.equal(await page.locator('header.app a[href="groups.html"]').count(), 0, '頁首不另放狗群入口');
    const look = () => page.evaluate(() => ({
      head: Math.round(document.querySelector('header.app').getBoundingClientRect().height),
      search: Math.round(document.querySelector('header.app .search').getBoundingClientRect().left),
      zukan: !!document.querySelector('header.app a[href="cards.html"]').offsetWidth,
      site: !!document.querySelector('header.app h1').offsetWidth,
      left: Math.round(document.querySelector('#main > :not(.sr-only)').getBoundingClientRect().left),
    }));
    const walkLook = await look();
    assert.deepEqual([walkLook.head, walkLook.zukan, walkLook.site, walkLook.left], [64, true, true, 24], '溜狗表');
    for (const id of ['groups', 'mine', 'info']) {
      await tab(id).click();
      await page.locator(`#tabs [data-tab="${id}"][aria-current="page"]`).waitFor();
      await frame();
      assert.deepEqual(await look(), walkLook, `${id} 的頁首與左邊線跟溜狗表一樣`);
    }
    // 資訊子頁：頁首不換，「回資訊」在內容最上面
    await page.locator('[data-info-page="stay"]').click();
    await page.locator('#main [data-info-back]').waitFor();
    assert.equal((await look()).search, walkLook.search, '資訊子頁搜尋框位置不變');
    assert(await page.locator('header.app h1').isVisible(), '資訊子頁仍是網站名稱');
    await page.locator('#main [data-info-back]').click();
    await page.locator('[data-info-page="stay"]').waitFor();

    // #2：勾了的狗被換區藏起來就拿掉；換分頁回來勾選清掉
    await tab('walk').click();
    await page.locator('.desk-table').waitFor();
    await row('桌面2').locator('[data-desk-check]').check();
    await row('桌面6').locator('[data-desk-check]').check();
    assert.equal(await batchCount(), '2', '勾兩隻');
    await page.locator('.dt-chip[data-desk-zone="new"]').click();
    assert.equal(await batchCount(), '1', '舊犬舍那隻看不到就不算');
    await page.locator('.dt-chip[data-desk-zone="all"]').click();
    assert.equal(await row('桌面6').locator('[data-desk-check]').isChecked(), false, '回到全部也不會再勾回來');
    await tab('mine').click();
    await tab('walk').click();
    await page.locator('.desk-table').waitFor();
    assert.equal(await page.locator('.desk-batch').count(), 0, '換分頁回來勾選清掉');

    // #14：勾完按 Enter 跳到「今天 溜了」
    await row('桌面3').locator('[data-desk-check]').check();
    await row('桌面3').locator('[data-desk-check]').press('Enter');
    assert(await page.locator('[data-desk-go]').evaluate(el => el === document.activeElement), 'Enter 跳到今天 溜了');

    // #3、#16：詳細資訊從右邊滑出、寬 480，打開時浮條藏起來
    await row('桌面3').locator('[data-desk-open]').click();
    await page.locator('#detail').waitFor();
    await page.locator('#detail').evaluate(el => el.getAnimations().forEach(a => a.finish())); // 滑入動畫直接跳到結尾再量
    const drawer = await page.locator('#detail').evaluate(el => { const r = el.getBoundingClientRect(); return [Math.round(r.right), Math.round(r.width), Math.round(r.top), Math.round(r.height)]; });
    assert.deepEqual(drawer, [1280, 480, 0, 900], '右側抽屜、整個畫面高');
    assert.equal(await page.locator('.desk-batch').isVisible(), false, '面板開著浮條藏起來');
    await page.locator('#detailClose').click();
    await page.locator('#detailBackdrop').waitFor({ state: 'hidden' });
    assert(await page.locator('.desk-batch').isVisible(), '關掉面板浮條回來');

    // #4：沒登記到的狗在全表標出來，按了再登記一次
    mode = 'fail';
    await page.locator('[data-desk-go]').click();
    await row('桌面3').locator('.dr-fail', { hasText: '未確認' }).waitFor();
    assert.equal(await row('桌面3').locator('[data-desk-check]').count(), 1, '失敗的狗還能再勾');
    mode = 'ok';
    await row('桌面3').locator('.dr-fail').click();
    await row('桌面3').locator('.dr-state.done').waitFor();
    assert.equal(await page.locator('.dr-fail').count(), 0, '成功後拿掉沒登記到');

    // #12：最近 30 天捲到別的位置後，全選重畫不會跳回最右邊
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.locator('[data-desk-view="days30"]').click();
    const sheet = page.locator('.desk-sheet.days30');
    await sheet.waitFor();
    assert(await sheet.evaluate(el => el.scrollWidth > el.clientWidth && el.scrollLeft > 0), '第一次打開捲到今天');
    await sheet.evaluate(el => { el.scrollLeft = 0; el.dispatchEvent(new Event('scroll')); });
    await page.locator('[data-desk-all]').check();
    assert.equal(await page.locator('.desk-sheet.days30').evaluate(el => el.scrollLeft), 0, '重畫後留在原位');
    await page.locator('[data-desk-clear]').click();
    await page.locator('[data-desk-view="sheet"]').click();
    await page.setViewportSize({ width: 1280, height: 900 });

    // #7：詳細資訊「看全部狗群」直接切到常溜狗群分頁、停在有這隻狗的群
    await row('桌面2').locator('[data-desk-open]').click();
    await page.locator('#detail [data-detail-groups]').click();
    await page.locator('#tabs [data-tab="groups"][aria-current="page"]').waitFor();
    await page.locator('#groupPage h2', { hasText: '桌面群' }).waitFor();
    assert.equal(await page.locator('#detailBackdrop').isVisible(), false, '詳細資訊關掉');

    // #9：勿溜只提醒：常溜狗群顯示警示原文，整群溜了照樣登記這隻
    assert.match(await page.locator('.gw-dog', { hasText: '桌面1' }).locator('.gw-warn').textContent(), /勿溜，治療中/);
    assert.equal(await page.locator('.gw-restrictions').textContent(), '', '勿溜不列在不登記');
    await page.locator('#gwWalk').click();
    await page.locator('#gwWalk.done').waitFor();
    assert.equal(d1.rows.has(data.dogs[0].id || '名:桌面1'), true, '勿溜的狗也登記了');
    console.log('critique P1／P2 電腦版頁首、外框、右側詳細資訊、勾選、登記失敗、狗群入口、勿溜只提醒通過');
  } finally { await context.close(); }
};
