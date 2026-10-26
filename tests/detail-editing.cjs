const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 真實狗卡 + 合成資料；只攔截 API 邊界，沒有正式讀寫。
module.exports = async function verifyDetailEditing(browser, baseUrl) {
  const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/dogs.json'), 'utf8'));
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    localStorage.setItem('bq-onboarded', '1');
    localStorage.setItem('bq-name-later', '1');
  });
  let failIntro = false;
  await context.route('**/*', route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== baseUrl) return route.abort();
    if (!url.pathname.includes('/api/')) return route.continue();
    const endpoint = url.pathname.split('/api/')[1];
    let data = { ok: true };
    if (endpoint === 'dogs') data = fixtures;
    else if (endpoint === 'rest') data = { rest: {} };
    else if (endpoint === 'walkers') data = { walkers: [] };
    else if (endpoint === 'walks') data = { walks: [] };
    else if (req.method() === 'PUT' && endpoint.startsWith('intro/')) {
      const body = req.postDataJSON();
      if (failIntro) return route.fulfill({ status: 503, json: { ok: false, error: '測試：暫時無法儲存，請稍後再試' } });
      data = { ok: true, intro: body.text, intakeEvents: body.events || [] };
    }
    return route.fulfill({ json: data });
  });
  const page = await context.newPage();
  const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
  const assertFieldVisible = async selector => {
    await settle();
    const rect = await page.locator(selector).boundingBox();
    const bounds = await page.evaluate(() => ({ top: visualViewport.offsetTop, bottom: visualViewport.offsetTop + visualViewport.height }));
    assert(rect && rect.y >= bounds.top - 1 && rect.y + rect.height <= bounds.bottom + 1, `${selector} 超出可見範圍：${JSON.stringify({ rect, bounds })}`);
    const bar = await page.locator('#detail .detail-bar').boundingBox();
    assert(rect.y + rect.height <= bar.y + 1, `${selector} 被底部操作列遮住`);
  };
  try {
    await page.goto(baseUrl + '/public/index.html', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => allDogs.length > 0);
    await page.evaluate(() => {
      UPLOAD_URL = 'api'; sheetWriteState = 'unknown'; saveWalkerName('測試志工');
      const dog = { id: '2021021703', name: '編輯測試狗', cage: 'A1', intro: '保留原介紹。'.repeat(40), note: '不親狗，保持距離。', formerIds: ['2015081801'] };
      allDogs = [dog]; groupMap = {}; showDetail(dog);
    });
    await page.locator('#introEdit').click();
    await page.setViewportSize({ width: 390, height: 480 });
    await assertFieldVisible('#introText');
    await page.locator('#introText').fill('鍵盤展開後仍可編輯的介紹');
    failIntro = true;
    await page.locator('[form="introForm"]').click();
    await page.locator('#introForm [role="alert"]').waitFor();
    await assertFieldVisible('#introText');
    assert.equal(await page.locator('#introText').inputValue(), '鍵盤展開後仍可編輯的介紹');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'introText');
    assert.equal(await page.locator('#introText').evaluate(el => el.selectionEnd), '鍵盤展開後仍可編輯的介紹'.length, '失敗後游標保留');
    await page.locator('#introText').fill('這是一段長文。'.repeat(120));
    await page.setViewportSize({ width: 390, height: 280 });
    await assertFieldVisible('#introText');
    assert(await page.locator('#introText').evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 2), '低高度長文末端游標仍在文字框內可見');
    await page.locator('#introCancel').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#restEdit').click();
    await page.setViewportSize({ width: 390, height: 480 });
    await assertFieldVisible('#restReason');
    await page.locator('#restUntil').focus();
    await assertFieldVisible('#restUntil');
    await page.locator('#restCancel').click();
    assert.equal(await page.locator('#detailBackdrop').evaluate(el => el.classList.contains('detail-editing-viewport')), false, '取消後移除編輯限定樣式');
    // 模擬鍵盤覆蓋但layout viewport不縮小，以及Safari視窗平移。
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#introEdit').click();
    await page.locator('#introText').focus();
    await page.evaluate(() => {
      Object.defineProperty(visualViewport, 'height', { configurable: true, value: 420 });
      Object.defineProperty(visualViewport, 'offsetTop', { configurable: true, value: 40 });
      visualViewport.dispatchEvent(new Event('resize'));
      visualViewport.dispatchEvent(new Event('scroll'));
    });
    await assertFieldVisible('#introText');
    await page.locator('#introCancel').click();
    await page.evaluate(() => { delete visualViewport.height; delete visualViewport.offsetTop; visualViewport.dispatchEvent(new Event('resize')); });
    assert.equal(await page.locator('#detailBackdrop').evaluate(el => el.style.getPropertyValue('--detail-edit-height')), '', '取消後清除視窗限制');
    await page.locator('[data-append-open="note"]').click();
    await page.setViewportSize({ width: 390, height: 480 });
    await assertFieldVisible('#appendText');
    await page.locator('#appendText').fill('只預覽，不送出');
    await page.locator('[data-append-form] [type=submit]').click();
    assert.match(await page.locator('.append-preview').textContent(), /只預覽，不送出（測試志工）/);
    await page.locator('[data-append-back]').click();
    await assertFieldVisible('#appendText');
    await page.locator('[data-append-cancel]').click();
    // 多次入所可讀、逐筆新增、儲存失敗後資料不消失。
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { detailDog.intakeEvents = [
      { number: '2021021703', date: '2021-02-17', event: '迷路入所' },
      { number: '2021021703', date: '2026-01-02', event: '領養退回' },
    ]; renderDetail(); });
    // 舊編號那次也列成入所（出入所紀錄跟逐次事件同一串，K 2026-10-26）
    assert.deepEqual(await page.locator('.intake-list time').allTextContents(), ['2015/08/18', '2021/02/17', '2026/01/02']);
    await page.locator('#introEdit').click();
    await page.locator('#intakeAdd').click();
    const reason = page.locator('[data-intake-row="2"][data-intake-field="event"]');
    await reason.fill('第三次入所的原因');
    await page.setViewportSize({ width: 390, height: 480 });
    await assertFieldVisible('[data-intake-row="2"][data-intake-field="event"]');
    await page.locator('[form="introForm"]').click();
    await page.locator('#introForm [role="alert"]').waitFor();
    assert.equal(await reason.inputValue(), '第三次入所的原因');
    assert.equal(await reason.evaluate(el => el === document.activeElement), true);
    await assertFieldVisible('[data-intake-row="2"][data-intake-field="event"]');
    failIntro = false;
    await page.locator('[form="introForm"]').click();
    await page.locator('#introForm').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.intake-list li').count(), 4);
    assert.match(await page.locator('.intake-list').textContent(), /第三次入所的原因/);
    assert.equal(await page.locator('#detail .info .warn-note').count(), 0);
    assert.equal(await page.locator('#detail #staysEdit').count(), 1);
    assert.equal(await page.locator('#detail [data-section=walks]').count(), 1);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('#restEdit').click();
    await settle();
    assert.equal(await page.locator('#detailBackdrop').evaluate(el => el.classList.contains('detail-editing-viewport')), false, '桌面不套用手機限定定位');
    // 同一張表單跨越桌面斷點再回手機，仍需跟隨鍵盤。
    await page.setViewportSize({ width: 390, height: 480 });
    await assertFieldVisible('#restReason');
    await page.locator('#restUntil').focus();
    await assertFieldVisible('#restUntil');
    await page.locator('#restCancel').click();
    console.log('詳細狗卡編輯：可見高度／平移、失敗焦點與游標、備註預覽、休養切欄、多次入所及桌面通過');
  } finally { await context.close(); }
};
