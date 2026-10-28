const assert = require('node:assert/strict');
const fixture = require('./fixtures/dogs.json');

// #738：我溜過排版不動；統計、修改是綠色底線字，名字前不放腳掌、統計不放圖示，月份箭頭沒有灰底
module.exports = async (browser, base) => {
  const data = structuredClone(fixture);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
  await context.addInitScript(() => {
    localStorage.setItem('bq-onboarded', '1');
    localStorage.setItem('bq-name-later', '1');
    localStorage.setItem('bq-walker-name', '測試志工');
    localStorage.setItem('bq-walker-codes', JSON.stringify(['aaaaaaaaaaaa']));
  });
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin !== base) return route.abort();
    if (!u.pathname.includes('/api/')) return route.continue();
    const endpoint = u.pathname.split('/api/')[1];
    if (endpoint.startsWith('identity')) return route.fulfill({ json: { ok: true, identity: { name: '測試志工', codes: ['aaaaaaaaaaaa'] } } });
    if (endpoint.startsWith('favorites')) return route.fulfill({ json: { ok: true, ids: [], aliases: {} } });
    return route.fulfill({ json: endpoint === 'dogs' ? data : endpoint === 'rest' ? { rest: {} } : endpoint === 'walkers' ? { walkers: {}, names: ['測試志工'] }
      : endpoint === 'today' ? { ok: true, source: 'd1', date: '2026-10-19', version: 0, walks: [] }
        : { ok: true, walks: [{ id: data.dogs[1].id, name: data.dogs[1].name, date: '2026-10-18', walkers: ['aaaaaaaaaaaa'] }], departures: [] } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.clock.install({ time: new Date('2026-10-19T02:00:00Z') });
  try {
    await page.goto(base + '/public/index.html');
    await page.locator('[data-tab="mine"]').click();
    await page.locator('#mineStats').waitFor();
    const mine = await page.evaluate(() => {
      const css = el => getComputedStyle(el);
      const root = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim().toUpperCase();
      const hex = rgb => '#' + rgb.match(/\d+/g).slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
      const link = id => { const s = css(document.getElementById(id)); return [s.textDecorationLine, s.backgroundColor, s.boxShadow, hex(s.color) === root]; };
      return {
        stats: link('mineStats'), edit: link('whoEdit'), icons: document.querySelectorAll('.who-hint .icon').length,
        name: [css(document.querySelector('.who-name')).fontSize, css(document.querySelector('.who-name')).fontWeight],
        nav: [...document.querySelectorAll('.mc-nav')].map(el => css(el).backgroundColor),
        date: css(document.querySelector('.walk-date')).fontWeight, dog: css(document.querySelector('.mine-dog .bname')).fontWeight,
      };
    });
    assert.deepEqual(mine.stats, ['underline', 'rgba(0, 0, 0, 0)', 'none', true], '統計是綠色底線字');
    assert.deepEqual(mine.edit, ['underline', 'rgba(0, 0, 0, 0)', 'none', true], '修改是綠色底線字');
    assert.equal(mine.icons, 0, '名字列沒有腳掌、統計沒有圖示');
    assert.deepEqual(mine.name, ['20px', '700'], '名字 20px 粗');
    assert(mine.nav.length === 2 && mine.nav.every(c => c === 'rgba(0, 0, 0, 0)'), '月份箭頭沒有灰底：' + mine.nav);
    assert(Number(mine.date) >= 700 && Number(mine.dog) >= 700, '日期標題、狗名加粗');
    // 統計展開時仍看得出是打開的
    await page.locator('#mineStats').click();
    await page.locator('.mine-stats').waitFor();
    assert.equal(await page.locator('#mineStats').getAttribute('aria-expanded'), 'true');
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '無水平溢出：' + width);
      const [stats, edit] = await Promise.all(['#mineStats', '#whoEdit'].map(s => page.locator(s).boundingBox()));
      for (const b of [stats, edit]) assert(b.width >= 44 && b.height >= 44, `點擊區 44px：${JSON.stringify(b)}`);
      assert(edit.x - (stats.x + stats.width) >= 8, '統計、修改相隔 8px：' + JSON.stringify({ stats, edit }));
    }
    // 大字模式（字級加倍）：統計、修改仍在名字那排可點，不橫向溢出
    await page.addStyleTag({ content: await page.evaluate(() => ['body', '.who-name', '#mineStats', '#whoEdit', '.mc-title', '.walk-date', '.mine-dog .bname']
      .map(s => `${s} { font-size: ${parseFloat(getComputedStyle(document.querySelector(s)).fontSize) * 2}px !important; }`).join(' ')) });
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '大字無水平溢出：' + width);
    }
    console.log('#738 我溜過次要按鈕收斂通過');
  } finally { await context.close(); }
};
