// ADR 0024 志工網站的網址：直接打開 #dog/<編號>、#info/stay 到對的畫面，找不到的編號安靜退回溜狗表；
// 電腦版狗名、頁籤、資訊子頁入口是真連結：一般點擊在原頁打開，Ctrl＋點不攔（不 preventDefault）、交給瀏覽器開新分頁；
// 返回鍵關掉詳細資訊回到原分頁；「/」跳到搜尋框；手機 390px 狗卡和頁籤維持按鈕、點擊照舊。
const assert = require('node:assert/strict');
const fixture = require('./fixtures/dogs.json');

module.exports = async (browser, base) => {
  const data = structuredClone(fixture);
  data.groupColumns = [{ column: 1, label: '網址群', names: [data.dogs[0].name] }];
  const dog = data.dogs[2];
  const errors = [];
  const route = context => context.route('**/*', r => {
    const url = new URL(r.request().url());
    if (url.origin !== base) return r.abort();
    if (!url.pathname.includes('/api/')) return r.continue();
    const endpoint = url.pathname.split('/api/')[1];
    return r.fulfill({ json: endpoint === 'dogs' ? data : endpoint === 'rest' ? { rest: {} } : endpoint === 'walkers' ? { walkers: [] } : { source: 'd1', walks: [], departures: [] } });
  });
  const setup = async options => {
    const context = await browser.newContext({ serviceWorkers: 'block', ...options });
    await context.addInitScript(() => {
      if (location.protocol === 'about:') return; // Ctrl＋點開的新分頁一開始是 about:blank，碰不到 localStorage
      localStorage.setItem('bq-onboarded', '1');
      localStorage.setItem('bq-name-later', '1');
      // 最後一次 click 事件：看它有沒有被 preventDefault（document 捕獲階段之後才定案，所以掛在 window 捕獲、事後讀）
      window.addEventListener('click', e => { window.__lastClick = e; }, true);
    });
    await route(context);
    return context;
  };
  const watch = page => {
    page.on('pageerror', e => errors.push(e.stack || e.message));
    page.setDefaultTimeout(5000);
    return page;
  };
  const hash = page => page.evaluate(() => location.hash);
  const detailName = page => page.locator('#detailName').textContent();
  const detailOpen = page => page.locator('#detailBackdrop').isVisible();

  // ── 電腦版 1280 ──
  const desk = await setup({ viewport: { width: 1280, height: 900 } });
  try {
    // 直接打開 #dog/<編號>：疊在溜狗表上；按返回關掉、留在網站的溜狗表
    let page = watch(await desk.newPage());
    await page.goto(base + '/public/index.html#dog/' + dog.id);
    await page.locator('#detailBackdrop').waitFor();
    assert.match(await detailName(page), new RegExp(dog.name), '直接打開那隻狗的詳細資訊');
    assert.equal(await hash(page), '#dog/' + dog.id, '網址是這隻狗');
    await page.locator('.desk-table').waitFor();
    await page.goBack();
    await page.locator('#detailBackdrop').waitFor({ state: 'hidden' });
    assert.equal(await hash(page), '#walk', '返回關掉詳細資訊，回到溜狗表');
    assert(await page.locator('.desk-table').isVisible(), '還在網站裡');
    assert.equal(await page.locator('#tabs [data-tab="walk"][aria-current="page"]').count(), 1);

    // 找不到的編號：安靜退回溜狗表，不報錯
    await page.goto(base + '/public/index.html#dog/9999999999');
    await page.locator('.desk-table').waitFor();
    await page.evaluate(() => new Promise(r => setTimeout(r, 200)));
    assert.equal(await detailOpen(page), false, '找不到的狗不開詳細資訊');
    assert.equal(await hash(page), '#walk', '網址退回溜狗表');
    assert.equal(await page.locator('.alert-box, .status-msg:not(.sr-only)').count(), 0, '不顯示錯誤');

    // 直接打開 #info/stay：資訊子頁；回資訊到資訊首頁，不會離開網站
    await page.goto(base + '/public/index.html#info/stay');
    await page.locator('.info-subhead h2', { hasText: '在所統計' }).waitFor();
    assert.equal(await page.locator('#tabs [data-tab="info"][aria-current="page"]').count(), 1, '資訊分頁亮起');
    await page.locator('[data-info-back]').click();
    await page.locator('[data-info-page="stay"]').waitFor();
    assert.equal(await hash(page), '#info', '回資訊首頁');
    assert(page.url().startsWith(base + '/public/index.html'), '還在網站裡');
    assert.equal(await page.locator('[data-info-page="stay"]').getAttribute('href'), '#info/stay', '子頁入口是真連結');

    // 頁籤是真連結；一般點擊在原頁切換、網址跟著換
    assert.deepEqual(await page.locator('#tabs [data-tab]').evaluateAll(els => els.map(el => [el.tagName, el.getAttribute('href')])),
      [['A', '#walk'], ['A', '#groups'], ['A', '#mine'], ['A', '#info']], '電腦版頁籤是 <a href>');
    await page.locator('#tabs [data-tab="walk"]').click();
    await page.locator('.desk-table').waitFor();
    assert.equal(await page.evaluate(() => window.__lastClick.defaultPrevented), true, '一般點擊攔下來在原頁開');
    assert.equal(await hash(page), '#walk');

    // 狗名是真連結：Ctrl＋點交給瀏覽器開新分頁，原頁不攔、不開詳細資訊
    const name = page.locator('.desk-table tbody tr', { hasText: dog.name }).locator('[data-desk-open]');
    assert.deepEqual(await name.evaluate(el => [el.tagName, el.getAttribute('href')]), ['A', '#dog/' + dog.id], '狗名是 <a href>');
    const [popup] = await Promise.all([desk.waitForEvent('page'), name.click({ modifiers: ['Control'] })]);
    watch(popup);
    assert.equal(await page.evaluate(() => window.__lastClick.defaultPrevented), false, 'Ctrl＋點不呼叫 preventDefault');
    assert.equal(await detailOpen(page), false, '原分頁不開詳細資訊');
    assert.equal(await hash(page), '#walk', '原分頁網址不變');
    await popup.locator('#detailBackdrop').waitFor();
    assert.match(await detailName(popup), new RegExp(dog.name), '新分頁打開那隻狗');
    await popup.close();

    // 一般點擊狗名：原頁打開、網址換成狗；返回鍵關掉回到原分頁
    await name.click();
    await page.locator('#detailBackdrop').waitFor();
    assert.equal(await page.evaluate(() => window.__lastClick.defaultPrevented), true);
    assert.equal(await hash(page), '#dog/' + dog.id, '打開時網址換成這隻狗');
    await page.goBack();
    await page.locator('#detailBackdrop').waitFor({ state: 'hidden' });
    assert.equal(await hash(page), '#walk', '返回關掉詳細資訊');
    assert.equal(await page.locator('#tabs [data-tab="walk"][aria-current="page"]').count(), 1, '回到原分頁');

    // 換分頁後打開再按「關閉」：網址回到那個分頁，返回再回到溜狗表
    await page.locator('#tabs [data-tab="groups"]').click();
    await page.locator('#groupPage h2', { hasText: '網址群' }).waitFor();
    assert.equal(await hash(page), '#groups');
    await page.locator('#groupPage [data-gw-dog]').first().click();
    await page.locator('#detailBackdrop').waitFor();
    assert.equal(await hash(page), '#dog/' + data.dogs[0].id, '常溜狗群打開的狗也有網址');
    await page.locator('#detailClose').click();
    await page.locator('#detailBackdrop').waitFor({ state: 'hidden' });
    assert.equal(await hash(page), '#groups', '關閉回到常溜狗群的網址');
    await page.goBack();
    await page.locator('#tabs [data-tab="walk"][aria-current="page"]').waitFor();
    assert.equal(await hash(page), '#walk', '分頁也照網址返回');

    // 「/」跳到搜尋框；在搜尋框裡打「/」照常輸入
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('/');
    assert(await page.locator('#searchInput').evaluate(el => el === document.activeElement), '/ 跳到搜尋框');
    await page.keyboard.type('a/b');
    assert.equal(await page.locator('#searchInput').inputValue(), 'a/b', '輸入框裡的 / 照常輸入');
    await page.locator('#searchClear').click();
    await page.locator('#tabs [data-tab="info"]').click();
    await page.locator('[data-info-page="stay"]').focus();
    await page.keyboard.press('/');
    assert.notEqual(await page.evaluate(() => document.activeElement.id), 'searchInput', '資訊沒有搜尋框時不搶');
    assert.equal(await hash(page), '#info');
  } finally { await desk.close(); }

  // ── 手機 390：狗卡、頁籤維持按鈕，點擊照舊；網址照樣跟著詳細資訊 ──
  const phone = await setup({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    const page = watch(await phone.newPage());
    await page.goto(base + '/public/index.html');
    await page.locator('#main .card').first().waitFor();
    assert.deepEqual(await page.locator('#tabs [data-tab]').evaluateAll(els => els.map(el => el.tagName)), ['BUTTON', 'BUTTON', 'BUTTON', 'BUTTON'], '手機頁籤維持按鈕');
    assert.equal(await page.locator('#main .card a, #main a[href^="#"]').count(), 0, '手機狗卡沒有連結');
    const card = page.locator('#main .card', { hasText: dog.name });
    assert.equal(await card.getAttribute('role'), 'button', '狗卡維持按鈕');
    await card.locator('.name').tap();
    await page.locator('#detailBackdrop').waitFor();
    assert.match(await detailName(page), new RegExp(dog.name), '點狗卡打開詳細資訊');
    assert.equal(await hash(page), '#dog/' + dog.id, '手機網址也換成這隻狗');
    await page.goBack();
    await page.locator('#detailBackdrop').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => location.hash), '', '返回關掉、網址回到原本');
    assert(await card.isVisible(), '還在溜狗表');
    await page.locator('#tabs [data-tab="info"]').tap();
    assert.equal(await page.locator('[data-info-page="stay"]').evaluate(el => el.tagName), 'BUTTON', '手機資訊入口維持按鈕');
    await page.locator('[data-info-page="stay"]').tap();
    assert.equal(await hash(page), '#info/stay', '手機網址也跟著子頁');
  } finally { await phone.close(); }

  assert.deepEqual(errors, [], '沒有網頁錯誤');
  console.log('ADR 0024 網址：#dog、#info/stay、找不到退回、真連結 Ctrl＋點、返回鍵、/ 搜尋、手機 390 狗卡照舊通過');
};
