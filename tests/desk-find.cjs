// 電腦版找狗與在哪（critique 2026-10-28 P1，K 2026-10-29 解除找狗 480 單欄）：
// 頁首有「找狗」並標示目前頁、平面圖撐滿主內容＋右欄 300px 列那一區的狗、列表 40～46px 一列、沒有「溜了」大按鈕；
// 在哪是籠位旁的小卡（不貼底、沒有拖曳把手），Esc、點外面關閉、焦點回到籠位。手機（390px）照舊四格、在哪從下面滑出。
const assert = require('node:assert/strict');
const fixture = require('./fixtures/dogs.json');

module.exports = async (browser, base) => {
  const day = '2026-10-21', data = structuredClone(fixture);
  data.syncedAt = '2026-10-21 09:00';
  const cages = ['新A01', '新A02', '新A03', '新B01', '舊B01', '舊B02', '舊A11', '住院1'];
  data.dogs = data.dogs.slice(0, 8).map((d, i) => ({ ...d, name: `找狗${i + 1}`, cage: cages[i], note: '', covered: false, walkedDate: '2026-10-01', walkers: [] }));
  data.groups = {};
  data.groupColumns = [];
  const d1 = require('./fixtures/fake-d1-walks.cjs')({ today: () => day });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
  await context.addInitScript(() => {
    localStorage.setItem('bq-onboarded', '1'); localStorage.setItem('bq-name-later', '1'); localStorage.setItem('bq-walker-name', '甲');
  });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== base) return route.abort();
    if (!url.pathname.includes('/api/')) return route.continue();
    const endpoint = url.pathname.split('/api/')[1];
    if (endpoint === 'walk') return route.fulfill({ json: d1.walk(req.postDataJSON()) });
    const out = endpoint === 'dogs' ? data : endpoint === 'today' ? d1.pack()
      : endpoint === 'rest' ? { rest: {} } : { ok: true, walks: [], departures: [], ids: [], aliases: {}, walkers: {}, names: [] };
    return route.fulfill({ json: out });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-10-21T02:00:00Z') });
  const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const box = sel => page.locator(sel).first().evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; });
  const sheet = () => page.locator('#whereSheet');
  const finishPop = () => sheet().evaluate(el => el.getAnimations().forEach(a => a.finish()));
  try {
    await page.goto(base + '/public/index.html', { waitUntil: 'domcontentloaded' });
    await page.locator('.desk-table').waitFor();

    // 頁首「找狗」：排在資訊前面，點了標示目前頁；1100 也還是一行 64px
    assert.deepEqual(await page.locator('#tabs button').evaluateAll(bs => bs.map(b => b.dataset.tab)), ['walk', 'groups', 'mine', 'find', 'info'], '電腦版五格');
    await page.locator('#tabs [data-tab="find"]').click();
    await page.locator('#main .desk-find').waitFor();
    assert.deepEqual(await page.locator('#tabs [aria-current="page"]').evaluateAll(bs => bs.map(b => b.dataset.tab)), ['find'], '找狗頁籤標示目前頁');
    for (const width of [1100, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await frame();
      assert.equal(Math.round((await box('header.app')).height), 64, `${width}px 頁首一行`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px 沒有橫向捲動`);
      const edge = await page.locator('#tabs, header.app .search, header.app a[href="cards.html"]').evaluateAll(els => els.map(el => el.getBoundingClientRect().right));
      assert(edge.every(r => r <= width), `${width}px 頁首每樣東西都在畫面裡`);
      if (width === 1100) continue;
      // 主內容撐滿（不卡在 480）、右欄 300、跟溜狗表同一條左邊線
      const main = await box('#main .df-main'), side = await box('#main .df-side');
      assert(main.width > 480, `${width}px 找狗主內容 ${Math.round(main.width)} > 480`);
      assert.equal(Math.round(side.width), 300, `${width}px 右欄 300px`);
      assert.equal(Math.round(main.left), 24, `${width}px 左邊線`);
      assert((await box('#main .df-main .find-map')).width > 480, `${width}px 平面圖不受 480 限制`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await frame();
    assert.equal(await page.locator('#main [data-walk], #main .walk-btn').count(), 0, '電腦版找狗沒有每隻狗的溜了按鈕');

    // 點一區：右欄換成那一區的狗（籠位、狗名、天數色籤），點狗名開右側詳細資訊
    await page.locator('#main g[data-find-zone="new"]').click();
    await page.locator('.df-side h2', { hasText: '新犬舍區' }).waitFor();
    assert.deepEqual(await page.locator('.df-side .df-row .df-name').allTextContents(), ['找狗1', '找狗2', '找狗3', '找狗4'], '右欄列新犬舍的狗');
    assert.equal(await page.locator('.df-side .df-row .dr-day').count(), 4, '每隻有天數色籤');
    await page.locator('#main g[data-find-cage="新A2"]').click();
    assert.deepEqual(await page.locator('.df-side .df-row .df-name').allTextContents(), ['找狗2'], '點籠子只列那一籠');
    await page.locator('.df-side .df-name', { hasText: '找狗2' }).click();
    await page.locator('#detail').waitFor();
    assert.equal(await page.locator('#detailName').textContent().then(t => t.trim().startsWith('找狗2')), true, '開那隻的詳細資訊');
    await page.locator('#detailClose').click();
    await page.locator('#detailBackdrop').waitFor({ state: 'hidden' });

    // 在哪：籠位旁的小卡，不貼底、沒有上緣大圓角與把手；Esc 關閉、焦點回到籠位
    const cage = page.locator('.df-side [data-where]').first();
    await cage.click();
    await sheet().waitFor();
    await finishPop();
    const pop = await box('#whereSheet'), cageBox = await cage.evaluate(el => { const r = el.getBoundingClientRect(); return { top: r.top, left: r.left }; });
    assert(pop.bottom < 900 - 8, `在哪不貼底（下緣 ${Math.round(pop.bottom)}）`);
    assert(pop.width <= 420, '小卡不是整片面板');
    assert(pop.right <= cageBox.left, '右欄的籠位：小卡在籠位左邊');
    assert(Math.abs(pop.top - Math.max(16, cageBox.top - 12)) <= 1, '上緣對齊籠位');
    assert.equal(await sheet().evaluate(el => getComputedStyle(el).borderTopLeftRadius), '4px', '沒有上緣大圓角');
    assert.equal(await page.locator('#whereSheet .where-grab').isVisible(), false, '沒有拖曳把手');
    await page.keyboard.press('Escape');
    await page.locator('#whereBackdrop').waitFor({ state: 'hidden' });
    assert(await cage.evaluate(el => el === document.activeElement), 'Esc 後焦點回到籠位');
    // 點外面關閉
    await cage.click();
    await sheet().waitFor();
    await page.mouse.click(200, 600);
    await page.locator('#whereBackdrop').waitFor({ state: 'hidden' });
    assert(await cage.evaluate(el => el === document.activeElement), '點外面關閉後焦點回到籠位');

    // 溜狗表全表的籠位也是小卡：放在籠位右邊
    await page.locator('#tabs [data-tab="walk"]').click();
    await page.locator('.desk-table').waitFor();
    const tableCage = page.locator('.desk-table [data-where]').first();
    await tableCage.click();
    await sheet().waitFor();
    await finishPop();
    const pop2 = await box('#whereSheet'), cage2 = await tableCage.evaluate(el => el.getBoundingClientRect().right);
    assert(pop2.left >= cage2 && pop2.bottom < 900 - 8, '全表籠位：小卡在右邊、不貼底');
    await page.keyboard.press('Escape');
    await page.locator('#whereBackdrop').waitFor({ state: 'hidden' });

    // 列表：工具列三種、區域分頁、一列 40～46px；我的常溜
    await page.locator('#tabs [data-tab="find"]').click();
    await page.locator('[data-df-view="list"]').click();
    await page.locator('.df-table').waitFor();
    assert.equal(await page.locator('[data-df-view="list"][aria-pressed="true"]').count(), 1, '列表選中');
    assert.equal(await page.locator('.dt-chip.on').getAttribute('data-find-zone'), 'new', '平面圖選的區帶到列表');
    await page.locator('.dt-chip[data-find-zone="all"]').click();
    const rowHeights = await page.locator('.df-table tbody tr.dr').evaluateAll(rs => rs.map(r => Math.round(r.getBoundingClientRect().height)));
    assert.equal(rowHeights.length, 8, '列表列出全部的狗');
    assert(rowHeights.every(h => h >= 40 && h <= 46), `列表一列 40～46px（${rowHeights.join('、')}）`);
    await page.locator('.dt-chip[data-find-zone="old"]').click();
    assert.equal(await page.locator('.df-table tbody tr.dr').count(), 3, '區域分頁只看舊犬舍');
    await page.locator('.df-table tbody tr.dr', { hasText: '找狗5' }).locator('td.df-id').click();
    await page.locator('#detail').waitFor();
    await page.locator('#detailClose').click();
    await page.locator('#detailBackdrop').waitFor({ state: 'hidden' });
    await page.locator('[data-df-view="fav"]').click();
    await page.locator('[data-df-view="fav"][aria-pressed="true"]').waitFor();
    assert.match(await page.locator('#main .df-main .status-msg').textContent(), /還沒有常溜的狗/, '我的常溜沒有狗時的說明');
    await page.locator('[data-df-view="map"]').click();
    await page.locator('#main .df-main .find-map').waitFor();

    // 手機（390px）照舊：底部四格沒有找狗、在哪從下面滑出
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#tabs [data-tab="walk"]').click();
    await page.locator('#main .card').first().waitFor();
    assert.deepEqual(await page.locator('#tabs button').evaluateAll(bs => bs.map(b => b.dataset.tab)), ['walk', 'groups', 'mine', 'info'], '手機底部四格');
    await page.locator('#main .card [data-where]').first().click();
    await sheet().waitFor();
    await sheet().evaluate(el => el.getAnimations().forEach(a => a.finish()));
    assert.equal(Math.round((await box('#whereSheet')).bottom), 844, '手機在哪貼底');
    assert(await page.locator('#whereSheet .where-grab').isVisible(), '手機有拖曳把手');
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, [], '沒有網頁錯誤');
    console.log('電腦版找狗（頁籤、撐滿＋右欄、列表、我的常溜）、在哪小卡、手機照舊通過');
  } finally {
    await context.close();
  }
};
