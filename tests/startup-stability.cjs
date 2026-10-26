const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('./fixtures/dogs.json');

// 真實頁面與 HTTP 邊界；合成的休養、今日消息與個人紀錄刻意交換回應順序。
module.exports = async (browser, base) => {
  const data = structuredClone(fixture);
  data.syncedAt = '2026-10-19 06:30';
  data.dogs = data.dogs.slice(0, 3).map((d, i) => ({ ...d, name: `啟動測試${i + 1}`, walkedDate: ['2026-10-04', '2026-10-14', '2026-10-15'][i] }));
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
  await context.addInitScript(() => {
    localStorage.setItem('bq-onboarded', '1');
    localStorage.setItem('bq-name-later', '1');
    localStorage.setItem('bq-walker-name', '測試志工');
    localStorage.setItem('bq-walker-codes', JSON.stringify(['aaaaaaaaaaaa']));
  });
  const held = new Set(['rest']), releases = new Map(), failed = new Set(), posts = [];
  let withToday = false; // K 2026-10-26：Worker 的狗清單帶今天的紀錄
  const d1 = require('./fixtures/fake-d1-walks.cjs')({ today: () => '2026-10-19' });
  const pathIs = (r, endpoint) => new URL(r.url()).pathname.endsWith('/api/' + endpoint);
  const release = endpoint => { held.delete(endpoint); releases.get(endpoint)?.(); releases.delete(endpoint); };
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (!url.pathname.includes('/api/')) return route.continue();
    const endpoint = url.pathname.split('/api/')[1];
    if (held.has(endpoint)) await new Promise(resolve => { releases.set(endpoint, resolve); });
    if (failed.has(endpoint)) return route.fulfill({ status: 503, json: {} });
    if (endpoint.startsWith('identity')) return route.fulfill({ json: { ok: true, identity: { name: '測試志工', codes: ['aaaaaaaaaaaa'] } } });
    if (endpoint.startsWith('favorites')) return route.fulfill({ json: { ok: true, ids: [], aliases: {} } });
    if (endpoint === 'sync') posts.push('sync');
    if (endpoint === 'walk' && route.request().method() === 'POST') return route.fulfill({ json: d1.walk(route.request().postDataJSON()) });
    const body = endpoint === 'dogs' ? (withToday ? { ...data, today: d1.pack() } : data)
      : endpoint === 'rest' ? { rest: { [data.dogs[0].id]: { until: '2026-10-20', reason: '測試休養' } } }
        : endpoint === 'today' ? d1.pack()
          : endpoint === 'walkers' ? { walkers: {}, names: ['測試志工'] }
            : { ok: true, walks: [{ id: data.dogs[1].id, name: data.dogs[1].name, date: '2026-10-18', walkers: ['aaaaaaaaaaaa'] }], departures: [] };
    return route.fulfill({ json: body });
  });
  const page = await context.newPage();
  page.on('pageerror', e => console.error(e.message));
  page.setDefaultTimeout(5000);
  await page.clock.install({ time: new Date('2026-10-19T02:00:00Z') });
  try {
    await page.goto(base + '/public/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForResponse(r => pathIs(r, 'today'));
    assert.equal(await page.locator('#main [data-dog]').count(), 0, '休養還沒讀好，不先顯示會跳位的狗清單');
    await page.locator('[data-tab="mine"]').click();
    await page.waitForFunction(() => document.querySelector('[data-tab="mine"] .n')?.textContent === '1');
    await page.locator('[data-tab="walk"]').click();
    assert.equal(await page.locator('#main [data-dog]').count(), 0, '等待休養期間看過個人紀錄，也不預先固定錯誤排序');
    release('rest');
    await page.locator('#main .card[data-dog]').first().waitFor();
    assert.equal(await page.locator('#main .card[data-dog]').first().getAttribute('data-dog'), '1', '第一個可靠畫面已將休養狗排到後面');
    held.add('today'); held.add('walks');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#tabs [data-tab="walk"] .n')?.textContent === '3');
    assert.equal(await page.locator('#main [data-dog]').count(), 0, '今日消息尚未確認時，不顯示過時的天數與排序');
    assert.equal(await page.locator('[data-tab="mine"] .n').textContent(), '…', '個人紀錄未確認時以載入提示取代不明的空白或假數字');
    await page.locator('[data-tab="info"]').click();
    await page.locator('[data-info-page="stay"]').waitFor();
    release('today');
    await page.locator('[data-tab="walk"]').click();
    await page.locator('#main .card[data-dog]').first().waitFor();
    assert.equal(await page.locator('[data-tab="mine"] .n').textContent(), '…');
    release('walks');
    await page.waitForFunction(() => document.querySelector('[data-tab="mine"] .n')?.textContent === '1');
    const order = () => page.locator('#main .card[data-dog]').evaluateAll(cards => cards.map(c => c.dataset.dog));
    assert.deepEqual(await order(), ['1', '2', '0']);
    await page.locator('#main [data-dog="1"] [data-walk="add"]').click();
    await page.locator('#main [data-dog="1"] [data-walk="back"]').waitFor();
    assert.deepEqual(await order(), ['2', '1', '0'], '#445 登記後直接照天數排到後面');
    await page.locator('#syncBtn').click();
    await page.getByText('資料已更新', { exact: true }).waitFor();
    assert.deepEqual(await order(), ['2', '1', '0'], '按「更新」後順序不變');
    assert.ok((await page.locator('#main [data-dog="1"]').textContent()).includes('今天'), '同步舊日期不能蓋掉較新的今日消息');
    d1.set(data.dogs[2].id, '其他志工');
    await page.clock.runFor(61000);
    await page.waitForFunction(() => document.querySelector('#main [data-dog="2"]')?.textContent.includes('今天'));
    assert.deepEqual(await order(), ['1', '2', '0'], 'K 2026-10-20：其他手機溜的不是我按的，一分鐘內更新並照天數排到後面');
    held.add('today');
    failed.add('walks'); failed.add('rest');
    const failedRead = page.waitForResponse(r => pathIs(r, 'walks'));
    await page.locator('#syncBtn').click();
    await page.getByText('資料已更新', { exact: true }).waitFor();
    assert.deepEqual(posts, [], '#512 按「更新」只重讀，不 POST /sync');
    assert.ok((await page.locator('#main [data-dog="2"]').textContent()).includes('今天'), '重讀狗清單時保留已讀到的較新今日消息，不等下一份回應才補回');
    await (await failedRead).finished();
    assert.equal(await page.locator('[data-tab="mine"] .n').textContent(), '2', '背景個人紀錄失敗保留已確認數字');
    await page.getByText('休養設定暫時讀不到', { exact: false }).waitFor();
    assert.equal(await page.locator('#main [data-dog="0"] [data-walk="add"]').count(), 0, '背景休養讀取失敗不清掉已知休養設定');
    release('today');
    // 狗清單沒帶今日紀錄（舊 Worker）時，D1 模式（#456）要等 /today 確認才排狗卡；這裡只測休養與個人紀錄失敗
    failed.add('rest'); failed.add('walks');
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#main .card[data-dog]').first().waitFor();
    assert.ok((await page.locator('#main').textContent()).includes('休養設定暫時讀不到'), '失敗仍可看狗，但不把未知休養設定當成可靠狀態');
    assert.equal(await page.locator('[data-tab="mine"] .n').textContent(), '—', '紀錄失敗不能顯示 0');
    failed.delete('rest');
    await page.locator('#restRetry').click();
    await page.getByText('休養設定暫時讀不到', { exact: false }).waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#main .card[data-dog]').last().getAttribute('data-dog'), '0', '首次補齊休養設定後，重新建立可靠排序');
    failed.clear();
    // 每次重開換一個最慢來源；今日消息與個人紀錄不互相冒充已讀完。
    for (const endpoint of ['dogs', 'today', 'walks', 'rest']) {
      held.add(endpoint);
      const requested = page.waitForRequest(r => pathIs(r, endpoint));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await requested;
      if (endpoint === 'today') {
        await page.locator('[data-tab="mine"]').click();
        await page.getByText('讀取溜狗紀錄中…', { exact: true }).waitFor();
        assert.equal(await page.locator('#main .mc-cell.on').count(), 0, '今日消息未回應前不呈現不完整個人紀錄');
      }
      await page.locator('[data-tab="info"]').click();
      await page.locator('[data-info-page="stay"]').waitFor();
      release(endpoint);
      await page.locator('[data-tab="mine"]').click();
      await page.waitForFunction(() => document.querySelector('[data-tab="mine"] .n')?.textContent === '2');
      await page.locator('[data-tab="walk"]').click();
      await page.locator('#main .card[data-dog]').first().waitFor();
      assert.equal(await page.locator('#main .card[data-dog]').first().getAttribute('data-dog'), '1', `${endpoint} 最後回應時，第一份清單仍使用完整狀態排序`);
    }
    // K 2026-10-26：狗清單帶了今天的紀錄，/today 讀不到也直接排狗卡，不停在載入畫面
    withToday = true; failed.add('today');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#main .card[data-dog]').first().waitFor();
    assert.ok((await page.locator('#main [data-dog="2"]').textContent()).includes('今天'), '狗清單帶的今日紀錄直接用上');
    assert.equal(await page.locator('#main .card[data-dog]').first().getAttribute('data-dog'), '1', '跟讀到 /today 時同一個排序');
    withToday = false;
    failed.clear(); held.add('rest');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#tabs [data-tab="walk"] .n')?.textContent === '3');
    await page.clock.runFor(8100);
    await page.locator('#main .card[data-dog]').first().waitFor();
    assert.ok((await page.locator('#main').textContent()).includes('休養設定暫時讀不到'), '請求沒有回應時也能結束載入，不無限等待');
    const output = path.resolve(__dirname, '../.scratch/418-evidence');
    fs.mkdirSync(output, { recursive: true });
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(large => { document.documentElement.style.fontSize = large ? '24px' : ''; }, width === 390);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px 無橫向捲動`);
      if (width !== 320) await page.screenshot({ path: path.join(output, `startup-${width}.png`) });
    }
    console.log('#418 啟動、順序、數字、背景更新、部分失敗與逾時通過');
  } finally {
    for (const endpoint of releases.keys()) release(endpoint);
    await context.close();
  }
};
