const assert = require('node:assert/strict');

// 只替換 API 邊界；由實際狗卡進入詳細資訊，不連正式服務。
module.exports = async (browser, base) => {
  const data = structuredClone(require('./fixtures/dogs.json'));
  data.dogs = [{ ...data.dogs[0], id: '2017090508', name: '墨西哥', intro: '2015年8月18日迷路入所。親人，怕機車聲。',
    stays: [{ in: '2015-08-18', out: '2017-09-05', reason: '整修移所' }], formerIds: [], intakeEvents: [] }];
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
  try {
    await page.goto(`${base}/public/index.html`);
    await page.locator('#main .card').filter({ hasText: '墨西哥' }).click();
    const section = page.locator('#detail [data-section="intro"]');
    assert.equal(await page.locator('#detail [data-section="stays"]').count(), 0, '閱讀時只有一段入所介紹');
    assert.equal(await section.locator('h3').textContent(), '入所介紹');
    assert.deepEqual(await section.locator('time').allTextContents(), ['2015/08/18', '2017/09/05']);
    assert.deepEqual(await section.locator('.intake-event').allTextContents(), ['迷路入所', '整修移所']);
    assert.equal(await section.locator('.content').textContent(), '親人，怕機車聲。', '其他補充接在下面');
    assert.equal(await section.locator('details, [role="tablist"]').count(), 0, '直接呈現，不加展開或切換');
    assert.equal(await section.locator('button').count(), 1, '閱讀時只有既有的編輯入口');
    assert.equal(writes.length, 0, '整理呈現不寫入資料');
    await section.locator('#introEdit').click();
    assert.equal(await page.locator('#introText').inputValue(), data.dogs[0].intro, '編輯仍看到完整原文');
    await page.locator('#introText').fill('尚未儲存的介紹');
    await page.locator('#staysEdit').click();
    assert.equal(await page.locator('[form="introForm"]').count(), 0, '補登期間不留錯誤的儲存介紹按鈕');
    await page.locator('#staysCancel').click();
    assert.equal(await page.locator('#introText').inputValue(), '尚未儲存的介紹', '從補登返回不丟失介紹草稿');
    await page.locator('#introCancel').click();
    await page.locator('#introEdit').click();
    await page.locator('[form="introForm"]').click();
    await page.locator('#introForm').waitFor({ state: 'detached' });
    assert.deepEqual(writes, [{ endpoint: 'intro/2017090508', body: { editor: '測試志工', text: data.dogs[0].intro, events: [] } }], '排版日期不會變成自動儲存的事件');
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = await section.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
      assert(bounds.scroll <= bounds.width + 1, `${width}px 介紹不橫向溢出`);
      if (process.env.BQ_INTAKE_SCREENSHOTS && width !== 320) {
        const path = require('node:path'), fs = require('node:fs');
        fs.mkdirSync(process.env.BQ_INTAKE_SCREENSHOTS, { recursive: true });
        await section.screenshot({ path: path.join(process.env.BQ_INTAKE_SCREENSHOTS, `intake-${width}.png`) });
      }
    }
    await page.evaluate(value => {
      const [dog] = parseDeparturesData({ departures: [{ id: value.id, name: value.name, date: '2026-10-01', reason: 'adopt', dateSource: 'sheet', matched: '被認養', flags: [], last: value, stays: value.stays }] });
      showDetail(dog);
    }, data.dogs[0]);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.locator('#detail [data-section="intro"]').count(), 1, '離所也共用一段介紹');
      assert.equal(await page.locator('#detail [data-section="stays"]').count(), 0);
      assert.deepEqual(await section.locator('.intake-event').allTextContents(), ['迷路入所', '整修移所']);
      assert.equal(await section.locator('#introEdit').count(), 0, '保留離所介紹唯讀權限');
    }
    await page.locator('#staysEdit').click();
    await page.locator('#staysCancel').click();
    assert.equal(await page.locator('#staysEdit').evaluate(el => el === document.activeElement), true, '離所補登取消後回到原入口');
    // 只有原文、未知／錯誤日期、多筆、來源矛盾及空內容不應被去重誤刪。
    const cases = [
      { intro: '主人不擬續養而入所。怕機車聲。', stays: [], intakeEvents: [], expected: [], supplement: '主人不擬續養而入所。怕機車聲。' },
      { intro: '2025年2月30日迷路入所。不要猜日期。', stays: [], intakeEvents: [], expected: [], supplement: '2025年2月30日迷路入所。不要猜日期。' },
      { intro: '2020年1月2日迷路入所。請保持距離。', stays: [{ in: '2020-01-02', out: '', reason: '迷路' }], intakeEvents: [{ date: '2020-01-02', event: '迷路入所', number: '2020010201' }], expected: ['2020/01/02迷路入所'], supplement: '請保持距離。' },
      { intro: '2020年1月2日迷路入所，有晶片但沒人領回。', stays: [{ in: '2020-01-02', out: '', reason: '迷路' }], intakeEvents: [], expected: ['2020/01/02迷路入所，有晶片但沒人領回'], supplement: '' },
      { intro: '2019年1月2日迷路入所。', stays: [{ in: '2020-01-02', out: '', reason: '迷路' }], intakeEvents: [{ date: '', event: '退回，日期待確認', number: '' }], expected: ['2019/01/02迷路入所', '2020/01/02迷路入所', '日期未確認退回，日期待確認'], supplement: '' },
      { intro: '', stays: [], intakeEvents: [], expected: [], supplement: '' },
    ];
    for (const test of cases) {
      Object.assign(data.dogs[0], test);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await page.locator('#main .card').first().click();
      assert.deepEqual(await section.locator('.intake-list li').allTextContents(), test.expected);
      assert.equal(await section.locator('.content').count(), test.supplement ? 1 : 0);
      if (test.supplement) assert.equal(await section.locator('.content').textContent(), test.supplement);
      assert.equal(await section.locator('.empty').count(), 0, '沒有內容不顯示空提示');
    }
    assert.equal(writes.length, 1, '閱讀、切換編輯及取消不會額外送出資料');
    console.log('#390 單段介紹、原文保留、去重、日期差異、320／390／1440px 與編輯返回通過');
  } finally { await context.close(); }
};
