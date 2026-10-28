const assert = require('node:assert/strict');

// 只替換 API 邊界；由實際狗卡進入詳細資訊，不連正式服務。
// ADR 0022（#667）：出入所紀錄只列出入所表，介紹原文照顯示，不再從介紹抓日期句、不讀入所事件
module.exports = async (browser, base) => {
  const data = structuredClone(require('./fixtures/dogs.json'));
  data.dogs = [{ ...data.dogs[0], id: '2017090508', name: '墨西哥', intro: '親人，怕機車聲。',
    // Worker 給的出入所表（ADR 0021）：查不到編號的那次＋目前編號那列
    stays: [{ number: '', in: '2015-08-18', out: '2017-09-05', reason: '迷路', outReason: '整修移所' }, { number: '2017090508', in: '2017-09-05', out: '', reason: '' }], formerIds: [],
    // 舊後端還帶入所事件也不列
    intakeEvents: [{ number: '', date: '2016-01-01', event: '退回入所' }] }];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    localStorage.setItem('bq-onboarded', '1'); localStorage.setItem('bq-name-later', '1');
    localStorage.setItem('bq-walker-name', '測試志工');
  });
  const writes = [];
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base) return route.abort();
    if (!url.pathname.includes('/api/')) return route.continue();
    const endpoint = url.pathname.split('/api/')[1];
    if (request.method() !== 'GET') writes.push({ endpoint, body: request.postDataJSON() });
    return route.fulfill({ json: endpoint === 'dogs' ? data : endpoint === 'rest' ? { rest: {} } : { ok: true, source: 'd1', walks: [], walkers: [] } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  // 一行一件事、同一天同一種事不重複
  const lines = async section => {
    const rows = await section.locator('.stay-lines li').allTextContents();
    const keys = await section.locator('.stay-lines li').evaluateAll(ls => ls.map(l => `${l.querySelector('time')?.textContent || ''}${l.querySelector('.stay-kind').textContent}`));
    assert.equal(new Set(keys).size, keys.length, `同一天不重複：${rows.join('、')}`);
    return rows;
  };
  try {
    await page.goto(`${base}/public/index.html`);
    await page.locator('#main .card').filter({ hasText: '墨西哥' }).click();
    const section = page.locator('#detail [data-section="intro"]');
    assert.equal(await page.locator('#detail [data-section="stays"]').count(), 0, '閱讀時只有一段');
    assert.deepEqual(await section.locator('h3').evaluateAll(hs => hs.map(h => h.firstChild.nextSibling.textContent)), ['出入所紀錄', '介紹']);
    // #639 驗收：墨西哥的入所日仍是 2015-08-18；入所事件（2016-01-01）不列
    assert.deepEqual(await lines(section), ['2015/08/18入所迷路', '2017/09/05離所整修移所', '2017/09/05入所']);
    assert.equal(await section.locator('.content').textContent(), '親人，怕機車聲。', '介紹接在下面');
    assert.equal(await section.locator('details, [role="tablist"]').count(), 0, '直接呈現，不加展開或切換');
    // 兩個入口同一種筆圖示（K 2026-10-26）
    assert.deepEqual(await section.locator('button').evaluateAll(bs => bs.map(b => [b.className, b.getAttribute('aria-label'), b.textContent.trim(), !!b.querySelector('svg')])),
      [['intro-heading-edit', '改出入所紀錄', '', true], ['intro-heading-edit', '改介紹', '', true]]);
    assert.match(await page.locator('#detail .chips').textContent(), /入所 2015\/8/);
    assert.equal(writes.length, 0, '閱讀不寫入資料');
    await section.locator('#introEdit').click();
    // 介紹表單只有一個文字框，標籤「介紹」
    assert.equal(await page.locator('#introForm input, #introForm select, #introForm textarea').count(), 1, '只有一個文字框');
    assert.equal(await page.locator('#introForm label').evaluate(l => l.firstChild.textContent), '介紹');
    assert.equal(await page.locator('#introText').inputValue(), data.dogs[0].intro, '編輯看到完整原文');
    await page.locator('#introText').fill('尚未儲存的介紹');
    // 出入所紀錄跟介紹在同一段：改介紹時那段換成介紹表單，不會同時開兩個表單
    assert.equal(await page.locator('#staysEdit').count(), 0, '改介紹時不另外開出入所紀錄');
    await page.locator('#introCancel').click();
    await page.locator('#staysEdit').click();
    assert.equal(await page.locator('[form="introForm"]').count(), 0, '補登期間不留錯誤的儲存介紹按鈕');
    await page.locator('#staysCancel').click();
    await page.locator('#introEdit').click();
    await page.locator('[form="introForm"]').click();
    await page.locator('#introForm').waitFor({ state: 'detached' });
    assert.deepEqual(writes, [{ endpoint: 'intro/2017090508', body: { editor: '測試志工', text: data.dogs[0].intro } }], '存介紹只帶名字和文字，不帶入所事件');
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = await section.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
      assert(bounds.scroll <= bounds.width + 1, `${width}px 介紹不橫向溢出`);
      await section.locator('#introEdit').click();
      const form = await section.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
      assert(form.scroll <= form.width + 1, `${width}px 介紹表單不橫向溢出`);
      await page.locator('#introCancel').click();
      if (process.env.BQ_INTAKE_SCREENSHOTS && width !== 320) {
        const path = require('node:path'), fs = require('node:fs');
        fs.mkdirSync(process.env.BQ_INTAKE_SCREENSHOTS, { recursive: true });
        await section.screenshot({ path: path.join(process.env.BQ_INTAKE_SCREENSHOTS, `intake-${width}.png`) });
      }
    }
    // 離所狗卡（parseDeparturesData）照樣顯示同一段
    await page.evaluate(value => {
      const [dog] = parseDeparturesData({ departures: [{ id: value.id, name: value.name, date: '2026-10-01', reason: 'adopt', dateSource: 'sheet', matched: '被認養', flags: [], last: value, stays: value.stays }] });
      showDetail(dog);
    }, data.dogs[0]);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.locator('#detail [data-section="intro"]').count(), 1, '離所也共用一段介紹');
      assert.equal(await page.locator('#detail [data-section="stays"]').count(), 0);
      assert.deepEqual(await section.locator('.intake-event').allTextContents(), ['迷路', '整修移所']);
      assert.equal(await section.locator('.content').textContent(), '親人，怕機車聲。', '離所也顯示介紹');
      assert.equal(await section.locator('#introEdit').count(), 0, '保留離所介紹唯讀權限');
    }
    await page.locator('#staysEdit').click();
    await page.locator('#staysCancel').click();
    assert.equal(await page.locator('#staysEdit').evaluate(el => el === document.activeElement), true, '離所補登取消後回到原入口');
    // 介紹裡的日期句不再抽出來排進出入所紀錄，原文照顯示
    const cases = [
      { intro: '主人不擬續養而入所。怕機車聲。', stays: [], expected: [] },
      { intro: '2020年1月2日迷路入所。請保持距離。', stays: [{ in: '2020-01-02', out: '', reason: '迷路' }], expected: ['2020/01/02入所迷路'] },
      { intro: '2019年1月2日迷路入所。', stays: [{ in: '2020-01-02', out: '', reason: '迷路' }], intakeEvents: [{ date: '', event: '退回，日期待確認', number: '' }], expected: ['2020/01/02入所迷路'] },
      { intro: '', stays: [{ in: '', out: '', reason: '轉所' }, { in: '2019-05-01', out: '2020-01-02', reason: '迷路', outReason: '轉所' }], expected: ['2019/05/01入所迷路', '2020/01/02離所轉所', '日期未確認入所轉所'] },
      { intro: '', stays: [], expected: [] },
    ];
    for (const test of cases) {
      Object.assign(data.dogs[0], { intakeEvents: [] }, test);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await page.locator('#main .card').first().click();
      assert.deepEqual(await lines(section), test.expected);
      assert.equal(await section.locator('.content').count(), test.intro ? 1 : 0);
      if (test.intro) assert.equal(await section.locator('.content').textContent(), test.intro, '介紹原文照顯示');
      assert.equal(await section.locator('.empty').count(), 0, '沒有內容不顯示空提示');
    }
    assert.equal(writes.length, 1, '閱讀、切換編輯及取消不會額外送出資料');
    console.log('#667 出入所紀錄只列出入所表、同一天不重複、介紹原文照顯示、單一文字框、離所狗卡、320／390／1440px 通過');
  } finally { await context.close(); }
};
