const assert = require('node:assert/strict');

module.exports = async (browser, base) => {
  const data = structuredClone(require('./fixtures/dogs.json'));
  [20, 19, 18, 6].forEach((day, i) => { data.dogs[i].walkedDate = `2026-10-${String(day).padStart(2, '0')}`; data.dogs[i].covered = false; });
  data.dogs[8].name = '名字很長也要完整閱讀的測試狗';
  data.dogs[4].walkedDate = '2026-07-12'; data.dogs[4].covered = false;
  data.dogs[3].note = '不親狗，測試警示原文';
  data.dogs[6].walkedDate = '2026-10-17'; data.dogs[6].covered = false;
  data.dogs[6].note = '不要一起溜，測試黃色警示';
  data.groupColumns = [{ column: 4, label: '大字完整捲閱測試群', names: data.dogs.slice(0, 10).map(d => d.name) }];
  const ctx = await browser.newContext({ viewport: { width: 320, height: 568 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
  await ctx.addInitScript(() => { localStorage.setItem('bq-onboarded', '1'); localStorage.setItem('bq-name-later', '1'); });
  await ctx.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin !== base) return route.abort();
    if (u.pathname.includes('/photos/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#DDE9E3"/><text x="60" y="66" text-anchor="middle" font-size="18">測試照片</text></svg>' });
    if (!u.pathname.includes('/api/')) return route.continue();
    const endpoint = u.pathname.split('/api/')[1];
    return route.fulfill({ json: endpoint === 'dogs' ? data : endpoint === 'rest' ? { rest: { [data.dogs[5].id]: { until: '2099-12-31' } } } : { ok: true, source: 'd1', walks: [], walkers: [] } });
  });
  const page = await ctx.newPage();
  try {
    await page.clock.install({ time: new Date('2026-10-20T04:00:00Z') });
    await page.goto(base + '/public/index.html');
    await page.locator('#main .card:not(.skeleton)').first().waitFor();
    const labels = [];
    for (const dog of data.dogs.slice(0, 4)) {
      const card = page.locator('#main .card').filter({ has: page.locator('.name').filter({ hasText: new RegExp('^' + dog.name + '[♂♀]?$') }) }).first();
      await card.scrollIntoViewIfNeeded();
      labels.push({ visible: await card.locator('.val').textContent(), full: await card.locator('.last').textContent() });
    }
    assert.deepEqual(labels.map(l => l.visible), ['今天', '1天', '2天', '14天'], '照片狗卡與列表採相同簡短天數');
    assert.match(labels[1].full, /上次溜1天前/, '輔助閱讀保留完整意思');
    for (const width of [320, 390, 768, 1024]) {
      await page.setViewportSize({ width, height: 700 });
      for (const dog of [data.dogs[3], data.dogs[6]]) {
        const warning = page.locator('#main .card.flagged').filter({ hasText: dog.name }).first();
        assert.equal(await warning.locator(dog === data.dogs[3] ? '.val.red' : '.val.amber').count(), 1, '警示案例保留紅、黃色覆蓋');
        await warning.scrollIntoViewIfNeeded();
        const geometry = await warning.evaluate(el => {
          const before = getComputedStyle(el, '::before');
          const track = parseFloat(getComputedStyle(el).gridTemplateColumns);
          const name = el.querySelector('.who .name');
          const box = name.getBoundingClientRect();
          return { backgroundWidth: parseFloat(before.width), track, nameVisible: name.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
        });
        assert(geometry.backgroundWidth <= geometry.track + 1, `${width}px 警示狗卡色籤只佔第一欄，不蓋住狗名與按鈕：${JSON.stringify(geometry)}`);
        assert(geometry.nameVisible, `${width}px 警示狗卡狗名未被色籤遮蓋`);
        const button = warning.locator('.walk-btn');
        await button.scrollIntoViewIfNeeded();
        await button.click({ trial: true });
      }
    }
    await page.setViewportSize({ width: 320, height: 568 });
    const cardFonts = await page.addStyleTag({ content: '.card .last .val b { font-size:60px !important; } .card .last .last-unit { font-size:28px !important; }' });
    for (const dog of [data.dogs[3], data.dogs[4]]) {
      const card = page.locator('#main .card').filter({ has: page.locator('.name').filter({ hasText: new RegExp('^' + dog.name + '[♂♀]?$') }) }).first();
      await card.scrollIntoViewIfNeeded();
      assert(await card.evaluate(el => {
        const number = el.querySelector('.last b').getBoundingClientRect(), photo = el.querySelector('.thumb').getBoundingClientRect();
        return number.left >= 0 && number.right <= photo.left;
      }), '兩位與三位天數放大後不超出畫面、不侵入照片');
      assert(await card.locator('.who').evaluate(el => el.clientWidth >= 100), '窄手機保留狗名閱讀寬度，不擠成一字一行');
      if (dog.note) assert(await card.evaluate(el => el.querySelector('.warn-note').getBoundingClientRect().top >= el.querySelector('.who').getBoundingClientRect().bottom), '警示排在狗名之後，不重疊');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '放大天數後頁面仍無水平溢出');
    }
    if (process.env.CAPTURE_400) {
      await page.screenshot({ path: 'docs/design/issue-400/days-large-320.png' });
    }
    const resting = page.locator('#main .card').filter({ has: page.locator('.name').filter({ hasText: new RegExp('^' + data.dogs[5].name + '[♂♀]?$') }) }).first();
    await resting.scrollIntoViewIfNeeded();
    assert.equal(await resting.locator('.walk-btn').count(), 0, '休養卡仍無登記按鈕');
    assert(await resting.locator('.who').evaluate(el => el.clientWidth >= 100), '休養卡也保留狗名閱讀寬度');
    await cardFonts.evaluate(el => el.remove());
    await page.locator('[data-tab="groups"]').click();
    await page.locator('#groupStage').waitFor();
    if (process.env.CAPTURE_400) {
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '一般字級手機與電腦無水平溢出');
        await page.screenshot({ path: `docs/design/issue-400/groups-${width}.png`, fullPage: true });
      }
    }
    await page.setViewportSize({ width: 320, height: 568 });
    // Chromium 沒有 Android 系統字級開關：把已計算字級加倍，保留真實文件流與操作。
    const enlarged = await page.evaluate(() => ['body', '#groupPage', '.gw-heading h2', '.gw-heading small', '.gw-name', '.gw-cage', '.r-date', '#searchInput', '#gwSource'].map(selector => {
      const size = parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
      return `${selector} { font-size: ${size * 2}px !important; }`;
    }).join('\n'));
    await page.addStyleTag({ content: enlarged });
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 568 });
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.gw-name')).fontSize === '32px');
      assert.equal(await page.locator('.gw-name').first().evaluate(el => getComputedStyle(el).fontSize), '32px', '重新排版後仍維持兩倍狗名字級');
      const layout = await page.locator('#groupStage').evaluate(el => ({ height: el.clientHeight, content: el.scrollHeight }));
      assert(layout.content <= layout.height + 1, '大字群組應自然增高，不把狗卡壓在內捲動區：' + JSON.stringify(layout));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '大字不產生水平捲動');
      for (const tile of await page.locator('.front [data-gw-dog]').all()) {
        await tile.scrollIntoViewIfNeeded();
        assert(await tile.evaluate(el => {
          const name = el.querySelector('.gw-name'), cage = el.querySelector('.gw-cage');
          return [name, cage].every(e => e.scrollHeight <= e.clientHeight + 1);
        }), '狗名與籠位沒有被固定行高裁切');
      }
      await page.locator('#gwWalk').evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const action = await page.locator('#gwWalk').boundingBox(), bar = await page.locator('#bottomBar').boundingBox();
      assert(action.y + action.height <= bar.y, '整群登記按鈕可捲到導覽列上方：' + JSON.stringify({ width, action, bar }));
      const [prev, next] = await Promise.all(['.gw-side.prev', '.gw-side.next'].map(s => page.locator(s).boundingBox()));
      const sameRow = b => b.y < action.y + action.height && b.y + b.height > action.y;
      assert(prev.x + prev.width <= action.x && next.x >= action.x + action.width && sameRow(prev) && sameRow(next), '#443 大字時換群箭頭仍在「溜了」兩側：' + JSON.stringify({ width, prev, action, next }));
      if (process.env.CAPTURE_400) {
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: `docs/design/issue-400/groups-large-${width}.png`, fullPage: true });
      }
    }
    console.log('#400 大字群組完整捲閱通過');
  } finally { await ctx.close(); }
};
