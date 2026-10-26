const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 手機鍵盤（#389）：用假的 visualViewport 模擬鍵盤彈出（可見高度縮小、innerHeight 不變），
// 檢查整頁不跳、底部分類列收起、底部面板貼齊可見範圍、輸入框在面板裡看得到。
module.exports = async function verifyKeyboardViewport(browser, baseUrl) {
  const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/dogs.json'), 'utf8'));
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    if (location.search.includes('onboard')) localStorage.clear(); // 開頭畫面那段要從沒設定過的手機開始
    else { localStorage.setItem('bq-onboarded', '1'); localStorage.setItem('bq-name-later', '1'); }
    const fake = new EventTarget();
    Object.assign(fake, { width: 390, height: 844, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: fake });
    window.__keyboard = (height, offsetTop = 0) => { fake.height = height; fake.offsetTop = offsetTop; fake.dispatchEvent(new Event('resize')); };
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== baseUrl) return route.abort();
    if (!url.pathname.includes('/api/')) return route.continue();
    const endpoint = url.pathname.split('/api/')[1];
    const data = endpoint === 'dogs' ? fixtures : endpoint === 'rest' ? { rest: {} } : endpoint === 'walkers' ? { walkers: [] } : endpoint === 'walks' ? { walks: [] } : { ok: true };
    return route.fulfill({ json: data });
  });
  const page = await context.newPage();
  const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
  try {
    await page.goto(baseUrl + '/public/index.html', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => allDogs.length > 0);

    // 搜尋框：鍵盤彈出不捲整頁，分類列收起，收鍵盤後回來
    await page.locator('#searchInput').focus();
    await settle();
    const before = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => window.__keyboard(480));
    await settle();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('kb-open')), true, '鍵盤彈出要標記 kb-open');
    assert.equal(await page.locator('#bottomBar').isVisible(), false, '鍵盤彈出時底部分類列收起');
    assert.equal(await page.evaluate(() => window.scrollY), before, '鍵盤彈出不捲整頁');
    await page.evaluate(() => { document.activeElement.blur(); window.__keyboard(844); });
    await settle();
    assert.equal(await page.locator('#bottomBar').isVisible(), true, '收鍵盤後分類列回來');

    // 底部面板（一起溜的人同款）：貼齊可見範圍，輸入框在面板裡捲到看得見
    await page.evaluate(() => {
      const box = document.createElement('div');
      box.className = 'with-backdrop'; box.id = 'kbTest';
      box.innerHTML = `<div class="with-sheet"><h3>測試</h3><div style="height:900px"></div><input type="text" id="kbInput"></div>`;
      document.body.appendChild(box);
    });
    await page.evaluate(() => window.__keyboard(400, 40));
    await page.locator('#kbInput').focus({ preventScroll: true });
    await settle();
    const sheet = await page.locator('#kbTest').boundingBox();
    assert(Math.abs(sheet.y - 40) <= 1 && Math.abs(sheet.height - 400) <= 1, `面板沒貼齊可見範圍：${JSON.stringify(sheet)}`);
    const rect = await page.locator('#kbInput').boundingBox();
    assert(rect.y >= 40 - 1 && rect.y + rect.height <= 440 + 1, `輸入框超出可見範圍：${JSON.stringify(rect)}`);

    // 編輯介紹：不再用 scrollIntoView 置中捲整頁
    await page.evaluate(() => {
      document.getElementById('kbTest').remove(); window.__keyboard(844); window.scrollTo(0, 0);
      UPLOAD_URL = 'api'; sheetWriteState = 'unknown'; saveWalkerName('測試志工');
      const dog = { id: '2021021703', name: '鍵盤測試狗', cage: 'A1', intro: '原介紹。'.repeat(40) };
      allDogs = [dog]; groupMap = {}; showDetail(dog);
    });
    await page.locator('#introEdit').click();
    await settle();
    assert.equal(await page.evaluate(() => window.scrollY), 0, '打開編輯介紹不捲整頁');
    // #646 開頭畫面輸入名字：鍵盤打開時下一步不黏在可見範圍底部蓋住輸入框，排在輸入框下面
    const onboardPage = await context.newPage();
    await onboardPage.goto(baseUrl + '/public/index.html?onboard', { waitUntil: 'networkidle' });
    await onboardPage.locator('#obInput').focus();
    await onboardPage.evaluate(() => window.__keyboard(420));
    await onboardPage.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const input = await onboardPage.locator('#obInput').boundingBox();
    const next = await onboardPage.locator('.ob-foot').boundingBox(); // 整個按鈕區（有白底），不只按鈕
    assert(input.y + input.height <= 420, `輸入框被鍵盤擋住：${JSON.stringify(input)}`);
    assert(next.y >= input.y + input.height, `下一步那區蓋住輸入框：輸入框 ${JSON.stringify(input)}，下一步 ${JSON.stringify(next)}`);
    // 開頭畫面只剩可見範圍那麼高，外面要用同色蓋住，不露出後面的狗卡
    const cover = await onboardPage.evaluate(() => getComputedStyle(document.querySelector('.onboard')).boxShadow.match(/0px 0px 0px (\d+)px/));
    assert(cover && Number(cover[1]) >= 844, `開頭畫面外面沒蓋住：${cover}`);
    await onboardPage.close();
    console.log('#389 手機鍵盤：整頁不跳、分類列收起、底部面板貼齊可見範圍、開頭畫面下一步不蓋輸入框通過');
  } finally {
    await context.close();
  }
};
