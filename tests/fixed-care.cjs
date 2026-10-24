const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async (browser, base) => {
  const data = structuredClone(require('./fixtures/dogs.json'));
  data.dogs = data.dogs.slice(0, 3);
  data.dogs.forEach(d => { d.covered = false; d.walkedDate = '2026-01-01'; });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    localStorage.setItem('bq-onboarded', '1'); localStorage.setItem('bq-name-later', '1');
    localStorage.setItem('bq-walker-name', '測試志工');
  });
  let fail = false;
  const writes = [];
  await ctx.route('**/api/**', route => {
    const req = route.request(), endpoint = new URL(req.url()).pathname.split('/api/')[1];
    if (req.method() === 'PUT' && endpoint.startsWith('fixed-care/')) {
      const body = req.postDataJSON(); writes.push(body);
      if (fail) return route.fulfill({ status: 503, json: { ok: false, error: '測試：請稍後再試' } });
      data.dogs.find(d => d.id === endpoint.split('/')[1]).covered = body.enabled;
      return route.fulfill({ json: { ok: true, enabled: body.enabled } });
    }
    if (req.method() === 'POST' && endpoint === 'walk') {
      const body = req.postDataJSON();
      if (body.action === 'undo') return route.fulfill({ json: { ok: true, results: body.dogs.map(d => ({ id: d.id, name: d.name, status: 'restored' })) } });
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
      return route.fulfill({ json: { ok: true, today, results: body.dogs.map(d => ({ ...d, status: 'written', prev: { date: { date: '2026-01-01' }, walker: '' }, wrote: { date: today, walker: body.walker } })) } });
    }
    return route.fulfill({ json: endpoint === 'dogs' ? data : endpoint === 'rest' ? { rest: {} } : { ok: true, walks: [], walkers: [] } });
  });
  await require('./fixtures/legacy-walk-mode.cjs')(ctx);
  const page = await ctx.newPage(); page.setDefaultTimeout(6000);
  try {
    await page.goto(`${base}/public/index.html`);
    const other = await ctx.newPage();
    await other.goto(`${base}/public/index.html`);
    await other.locator('#main .card').first().waitFor();
    await page.locator('#main .card').first().click();
    const toggle = page.getByRole('switch', { name: '有人固定照顧' });
    await toggle.waitFor();
    await assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('#fixedCareToggle')?.getAttribute('aria-checked') === 'true');
    assert.deepEqual(writes[0], { editor: '測試志工', enabled: true });
    await other.locator('#syncBtn').click();
    await other.locator('#main .card').filter({ hasText: data.dogs[0].name }).getByText('有人固定照顧').waitFor();
    await other.close();
    assert.equal(await page.evaluate(() => computeStatus(allDogs[0], new Date()).kind), 'covered');
    assert.equal(await page.evaluate(() => analysisRows([allDogs[0]], new Date())[0].walkDays), null);
    assert.equal(await page.evaluate(() => dueDogs(allDogs, new Date()).at(-1).id), data.dogs[0].id);
    assert.equal(await page.locator('#detail #groupWalk').count(), 1);
    await page.locator('#detailClose').click();
    const card = page.locator('#main .card').filter({ hasText: data.dogs[0].name });
    await card.locator('[data-walk="add"]').click();
    await card.locator('[data-walk="back"]').waitFor();
    assert.equal(await page.evaluate(() => computeStatus(allDogs[0], new Date()).kind), 'covered', '今天已溜也保留固定照顧狀態');
    await card.locator('[data-walk="back"]').click();
    await card.locator('[data-walk="add"]').waitFor();
    await card.click();
    fail = true;
    await toggle.click();
    await page.getByRole('alert').filter({ hasText: '測試：請稍後再試' }).waitFor();
    assert.equal(await toggle.getAttribute('aria-checked'), 'true', '失敗維持原狀');
    fail = false;
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('#fixedCareToggle')?.getAttribute('aria-checked') === 'false');
    assert.equal(await page.evaluate(() => computeStatus(allDogs[0], new Date()).kind), 'dated');
    await page.evaluate(() => localStorage.removeItem('bq-walker-name'));
    const writeCount = writes.length;
    await toggle.click();
    await page.getByRole('alert').filter({ hasText: '請先' }).waitFor();
    assert.equal(writes.length, writeCount, '未選身分不送出');
    await page.evaluate(() => localStorage.setItem('bq-walker-name', '測試志工'));
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('#fixedCareToggle')?.getAttribute('aria-checked') === 'true');
    for (const [width, large] of [[320, false], [390, true], [1440, false]]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(large => document.documentElement.style.fontSize = large ? '24px' : '', large);
      const box = await toggle.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, '開關觸控範圍');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '沒有橫向捲動');
      assert.ok(await page.locator('.fixed-care').evaluate(el => el.scrollWidth <= el.clientWidth), '大字內容不溢出');
      const output = path.resolve(__dirname, '../.scratch/399-evidence'); fs.mkdirSync(output, { recursive: true });
      await page.locator('#detail').screenshot({ path: path.join(output, `fixed-care-${width}.png`) });
    }
  } finally { await ctx.close(); }
};
