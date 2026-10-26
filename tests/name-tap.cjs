// #644：390px 觸控手機點狗名中間要開詳細資訊，不能被籠位標籤的點擊範圍吸走；點籠位標籤才開「在哪」。照片、列表模式都測。
const assert = require('node:assert/strict');
const sample = require('./fixtures/dogs.json');
// 平面圖找得到的籠位才有籠位標籤
const fixture = { ...sample, dogs: sample.dogs.map((d, i) => i ? d : { ...d, cage: '舊A3' }) };

module.exports = async (browser, base) => {
  for (const view of ['photo', 'list']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
    await context.addInitScript(v => {
      localStorage.setItem('bq-onboarded', '1'); localStorage.setItem('bq-name-later', '1'); localStorage.setItem('bq-walk-view', v);
    }, view);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.includes('/api/')) return route.continue();
      const endpoint = url.pathname.split('/api/')[1];
      return route.fulfill({ json: endpoint === 'dogs' ? fixture : endpoint === 'rest' ? { rest: {} }
        : endpoint === 'today' ? { ok: true, source: 'd1', date: '2026-10-21', version: 0, walks: [] } : endpoint === 'walkers' ? { walkers: [] } : { walks: [], departures: [] } });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await page.clock.install({ time: new Date('2026-10-21T02:00:00Z') });
    const item = view === 'photo' ? '#main .card[data-dog]' : '#main .row-dog[data-dog]';
    const name = view === 'photo' ? '.name' : '.r-name';
    const opened = () => page.evaluate(() => ({
      detail: document.documentElement.classList.contains('detail-open'),
      where: document.documentElement.classList.contains('where-open'),
    }));
    const close = async () => { await page.keyboard.press('Escape'); await page.waitForFunction(() => !/(detail|where)-open/.test(document.documentElement.className)); };
    const center = async loc => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    try {
      await page.goto(base + '/public/index.html');
      const row = page.locator(item).filter({ has: page.locator('.cage-pill') }).first();
      await row.waitFor();

      // 狗名中心與下緣都要開詳細資訊；手指有面積（半徑 12px），瀏覽器的觸控修正也不能把點擊吸到籠位
      const cdp = await context.newCDPSession(page);
      const finger = async (x, y) => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 12, radiusY: 12 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForFunction(() => /(detail|where)-open/.test(document.documentElement.className));
      };
      for (const [how, tap] of [['點', (x, y) => page.touchscreen.tap(x, y)], ['手指點', finger]]) {
        for (const [where, dy] of [['中間', h => h / 2], ['下緣', h => h - 2]]) {
          // 跟上一次點擊隔開（太近會被當成連點）；關掉詳細資訊後畫面可能捲動，點之前重新量狗名位置
          await page.waitForTimeout(400);
          const nb = await row.locator(name).boundingBox();
          await tap(nb.x + Math.min(nb.width / 2, 30), nb.y + dy(nb.height));
          assert.deepEqual(await opened(), { detail: true, where: false }, `${view}：${how}狗名${where}要開詳細資訊`);
          await close();
        }
      }

      // 點籠位標籤中心還是開「在哪」
      const pill = row.locator('.cage-pill');
      await page.waitForTimeout(400);
      const p = await center(pill);
      await page.touchscreen.tap(p.x, p.y);
      assert.deepEqual(await opened(), { detail: false, where: true }, `${view}：點籠位要開在哪`);
      await close();

      // 籠位有效點擊範圍（本體加 ::after）至少 44×44
      const hit = await pill.evaluate(el => {
        const r = el.getBoundingClientRect(), s = getComputedStyle(el, '::after');
        const px = v => parseFloat(v) || 0;
        const top = Math.min(r.top, r.top + px(s.top)), bottom = Math.max(r.bottom, r.bottom - px(s.bottom));
        const left = Math.min(r.left, r.left + px(s.left)), right = Math.max(r.right, r.right - px(s.right));
        return { w: right - left, h: bottom - top };
      });
      assert.ok(hit.w >= 44 && hit.h >= 44, `${view}：籠位點擊範圍 ${Math.round(hit.w)}×${Math.round(hit.h)} 要 ≥44×44`);
    } finally {
      await context.close();
    }
  }
};
