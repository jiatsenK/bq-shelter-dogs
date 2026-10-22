// #271 圖鑑已出所狗卡：新志工（沒有代號、沒開過卡）打開圖鑑就看得到，不用開卡；大卡背面有在所期間、離所原因、溜過幾天、出席活動次數
const assert = require('node:assert/strict');

module.exports = async (browser, base) => {
  const data = structuredClone(require('./fixtures/dogs.json'));
  data.dogs = data.dogs.slice(0, 3);
  const alumni = { ok: true, dogs: [
    { id: '2020010101', number: '2020010101', dogId: null, name: '阿福', formerIds: ['2019010101'], stays: [], departed: '2026-10-10', reason: 'adopt', walkDays: 4, activities: 2, nameOnly: false },
    { id: 'm'.repeat(32), number: '', dogId: 'm'.repeat(32), name: '老黃', formerIds: [], stays: [], departed: '', reason: 'unknown', walkDays: 0, activities: 1, nameOnly: true },
  ] };
  let fail = false;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
  await ctx.route('**/*', route => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin !== base) return route.abort();
    if (!u.pathname.includes('/api/')) return route.continue();
    const endpoint = u.pathname.split('/api/')[1];
    if (endpoint === 'departed-cards') {
      assert.equal(req.method(), 'GET');
      return route.fulfill(fail ? { status: 503, json: { ok: false } } : { json: alumni });
    }
    if (endpoint === 'dogs') return route.fulfill({ json: data });
    return route.fulfill({ json: { ok: true, walks: [], dogs: {}, opened: [] } });
  });
  const page = await ctx.newPage(); page.setDefaultTimeout(6000);
  page.on('pageerror', e => console.error(e.message));
  try {
    await page.goto(`${base}/public/cards.html`);
    const pockets = page.locator('#bqAlumni [data-alumni]');
    await pockets.first().waitFor();
    assert.deepEqual(await pockets.locator('.bq-pocket-nm').allTextContents(), ['阿福', '老黃']);
    assert.equal(await page.locator('[data-bq="alumni"]').textContent(), '2');
    assert.equal(await page.locator('#bqAlumni .pending, #bqAlumni .locked').count(), 0, '不用開卡、不是灰卡');
    assert.equal(await page.locator('[data-bq="total"]').first().textContent(), '3', '不算進開卡進度');
    await pockets.first().click();
    const card = page.locator('#bqModalCard .bq-card');
    await card.waitFor();
    const back = await card.locator('.bq-back').textContent();
    for (const t of ['2019.1.1 – 2026.10.10', '7年9個月', '4 天', '2 次', '被認養']) assert(back.includes(t), `背面有 ${t}：${back}`);
    await card.click();
    assert(await card.evaluate(el => el.classList.contains('flipped')), '點了翻面');
    await page.keyboard.press('Escape');
    assert(await pockets.first().evaluate(el => el === document.activeElement), '關掉回到卡套');
    await pockets.nth(1).click();
    assert((await card.locator('.bq-back').textContent()).includes('網站開始記錄以前就離開了'));
    assert.equal(await card.locator('img').count(), 0, '只有名字的卡用補位圖');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '手機不橫向溢出');
    fail = true;
    await page.reload();
    await page.getByText('已出所的狗讀不到，請重新整理頁面。').waitFor();
    console.log('#271 已出所狗卡：新志工直接看得到、不算開卡進度、背面四項、只有名字的卡、讀取失敗通過');
  } finally { await ctx.close(); }
};
