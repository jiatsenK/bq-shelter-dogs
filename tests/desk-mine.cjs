// 電腦版我溜過（critique 2026-10-28，K 2026-10-29 解除 480 單欄）：主內容寬過 480、跟溜狗表同一條左邊線、
// 月曆和右欄（那天的狗、這個月的統計）並排；格子寫狗名（最多 2 個，其餘「＋N」）；列與格子有滑鼠移過樣式；
// 點狗名開右側詳細資訊；還沒設定是誰時表單放主內容。1099px 以下照舊是手機版。
const assert = require('node:assert/strict');
const fixture = require('./fixtures/dogs.json');

module.exports = async (browser, base) => {
  const day = '2026-10-21', data = structuredClone(fixture);
  data.syncedAt = '2026-10-21 09:00';
  data.dogs = data.dogs.slice(0, 6).map((d, i) => ({ ...d, id: `M000${i + 1}`, name: `月曆${i + 1}`, cage: `新A0${i + 1}`, note: '', covered: false, walkedDate: '2026-10-01', walkers: [] }));
  const plan = { '2026-10-08': [0, 1, 2], '2026-10-12': [0], '2026-10-20': [0, 3] };
  const walks = Object.entries(plan).flatMap(([date, ids]) => ids.map(i => ({ id: data.dogs[i].id, name: data.dogs[i].name, date, walkers: ['aaaaaaaaaaaa'] })));
  const d1 = require('./fixtures/fake-d1-walks.cjs')({ today: () => day });
  const open = async (setup = false) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
    await context.addInitScript(s => {
      localStorage.setItem('bq-onboarded', '1'); localStorage.setItem('bq-name-later', '1');
      if (!s) { localStorage.setItem('bq-walker-name', '甲'); localStorage.setItem('bq-walker-codes', JSON.stringify(['aaaaaaaaaaaa'])); }
    }, setup);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.includes('/api/')) return route.continue();
      const endpoint = url.pathname.split('/api/')[1];
      if (endpoint.startsWith('identity')) return route.fulfill({ json: { ok: true, identity: { name: '甲', codes: ['aaaaaaaaaaaa'] } } });
      if (endpoint.startsWith('favorites')) return route.fulfill({ json: { ok: true, ids: [], aliases: {} } });
      const out = endpoint === 'dogs' ? data : endpoint === 'today' ? d1.pack() : endpoint === 'rest' ? { rest: {} }
        : endpoint === 'walkers' ? { walkers: {}, names: ['甲'] } : { ok: true, walks, departures: [] };
      return route.fulfill({ json: out });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await page.clock.install({ time: new Date('2026-10-21T02:00:00Z') });
    await page.goto(base + '/public/index.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#tabs [data-tab="mine"]').click();
    return { context, page };
  };
  const frame = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const box = (page, sel) => page.locator(sel).evaluate(el => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width) }; });

  let { context, page } = await open();
  try {
    await page.locator('.mine-desk .mine-cal').waitFor();
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await frame(page);
      const desk = await box(page, '#main > .mine-desk');
      const cal = await box(page, '.mine-desk .mine-cal');
      const side = await box(page, '.mine-side');
      assert(desk.width > 480, `${width}px 主內容寬過 480：${desk.width}`);
      assert.equal(desk.left, 24, `${width}px 左邊線 24`);
      assert(cal.width > 480, `${width}px 月曆撐寬：${cal.width}`);
      assert(side.left >= cal.right && side.top < cal.bottom, `${width}px 月曆與明細並排：${JSON.stringify({ cal, side })}`);
      assert.equal(side.width, 300, `${width}px 右欄 300`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px 沒有橫向捲動`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    // 標題列：名字＋修改；統計一直在右欄，不放「統計」開關
    assert.match(await page.locator('.mine-head .mine-who').innerText(), /^甲\s/, '標題是名字');
    assert.equal(await page.locator('.mine-head #whoEdit').count(), 1, '標題列有修改');
    assert.equal(await page.locator('#mineStats').count(), 0, '電腦版沒有統計開關');

    // 格子寫狗名：三隻的那天寫兩個名字＋1，螢幕閱讀器念全部
    const eight = page.locator('[data-mine-day="2026-10-08"]');
    assert.deepEqual(await eight.locator('.mc-names i').allInnerTexts(), ['月曆3', '月曆2', '＋1']);
    assert.match(await eight.getAttribute('aria-label'), /溜 3 隻：月曆3、月曆2、月曆1/);
    assert.deepEqual(await page.locator('[data-mine-day="2026-10-12"] .mc-names i').allInnerTexts(), ['月曆1']);

    // 右欄：預設最近一次（10/20），點 10/8 換成那天三隻；統計是月曆那個月
    assert.match(await page.locator('#mineDayTitle').innerText(), /10\/20（二）[\s\S]*溜了 2 隻/);
    await eight.click();
    assert.match(await page.locator('#mineDayTitle').innerText(), /10\/8（四）[\s\S]*溜了 3 隻/);
    assert.equal(await page.locator('[data-mine-day="2026-10-08"]').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await page.locator('.mine-day .md-name').allInnerTexts(), ['月曆3', '月曆2', '月曆1']);
    assert.deepEqual(await page.locator('.mine-day .md-cage').allInnerTexts(), ['新A03', '新A02', '新A01']);
    assert.equal(await page.locator('.mine-day .md-times').last().innerText(), '共 3 次', '月曆1 總共溜過 3 次');
    const stats = await page.locator('.mine-sum').innerText();
    assert.match(stats, /來了\s*3\s*天/); assert.match(stats, /溜了\s*6\s*隻次/); assert.match(stats, /溜過\s*4\s*隻/);
    assert.match(stats, /最常溜\s*月曆1\s*3 次/);

    // 滑鼠移過：有紀錄的格子、右欄的列換底色
    const bg = loc => loc.evaluate(el => getComputedStyle(el).backgroundColor);
    const cell = page.locator('[data-mine-day="2026-10-12"]');
    const cellBefore = await bg(cell);
    await cell.hover();
    await page.waitForFunction(b => getComputedStyle(document.querySelector('[data-mine-day="2026-10-12"]')).backgroundColor !== b, cellBefore);
    const row = page.locator('.mine-day button.md-row').nth(1);
    const rowBefore = await bg(row);
    await row.hover();
    await page.waitForFunction(b => getComputedStyle(document.querySelectorAll('.mine-day button.md-row')[1]).backgroundColor !== b, rowBefore);

    // 點狗名開右側詳細資訊
    await row.click();
    await page.locator('#detail').waitFor();
    assert.match(await page.locator('#detailName').innerText(), /月曆2/);
    await page.locator('#detail').evaluate(el => el.getAnimations().forEach(a => a.finish()));
    const drawer = await box(page, '#detail');
    assert.deepEqual([drawer.right, drawer.width], [1280, 480], '右側抽屜');
    await page.locator('#detailClose').click();
    await page.locator('#detailBackdrop').waitFor({ state: 'hidden' });

    // 1099px 回到手機版：月曆一格寫幾隻、有統計開關
    await page.setViewportSize({ width: 1099, height: 900 });
    await page.locator('#mineStats').waitFor();
    assert.equal(await page.locator('.mine-desk').count(), 0, '手機版不畫電腦版');
    assert.equal(await page.locator('[data-mine-day="2026-10-08"] small').innerText(), '3 隻');
  } finally { await context.close(); }

  // 還沒設定是誰：表單在主內容，寬度合理（不是 480 長條，也不撐滿）
  ({ context, page } = await open(true));
  try {
    await page.locator('.mine-setup #whoForm').waitFor();
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await frame(page);
      const form = await box(page, '.mine-setup .who-box');
      assert.equal(form.left, 24, `${width}px 表單左邊線 24`);
      assert(form.width > 480 && form.width <= 640, `${width}px 表單寬度：${form.width}`);
      assert.equal((await page.locator('.mine-head .mine-who').innerText()).trim(), '我溜過');
    }
  } finally { await context.close(); }
  console.log('電腦版我溜過通過');
};
