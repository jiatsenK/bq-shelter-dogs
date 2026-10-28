const assert = require('node:assert/strict');
const fixture = require('./fixtures/dogs.json');

const KEYS = ['showActivities','showQuality','showUpdates','editIntro','editPhoto','editRest','editActivity','editFixedCare','editStays','showShare'];
const SHARE_URL = 'https://share.example';

// ADR 0023 分享網站：開關與網址決定卡片出不出現；成功的分享、複製才記次數；取消不記
module.exports = async (browser, base) => {
  async function open({ showShare = true, shareUrl = SHARE_URL, nav = 'share' } = {}) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await context.addInitScript(nav => {
      localStorage.setItem('bq-onboarded', '1');
      localStorage.setItem('bq-name-later', '1');
      window.__BQ_FEATURE_TEST__ = true; // 用這裡給的設定，不用測試預設值
      window.__shared = [];
      const share = async data => { window.__shared.push(data); if (window.__cancel) throw new DOMException('canceled', 'AbortError'); };
      Object.defineProperty(navigator, 'share', { value: nav === 'share' ? share : undefined });
      Object.defineProperty(navigator, 'clipboard', { value: nav === 'none' ? undefined : { writeText: async text => { window.__copied = text; } } });
    }, nav);
    const posts = [];
    await context.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.origin !== base) return route.abort();
      if (!u.pathname.includes('/api/')) return route.continue();
      const endpoint = u.pathname.split('/api/')[1];
      if (endpoint === 'share') { posts.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); }
      assert.equal(route.request().method(), 'GET', endpoint);
      if (endpoint === 'feature-settings') return route.fulfill({ json: { ok: true, revision: 1, ...(shareUrl ? { shareUrl } : {}), values: Object.fromEntries(KEYS.map(k => [k, k === 'showShare' ? showShare : true])) } });
      const json = endpoint === 'dogs' ? fixture : endpoint === 'departures/index' ? { departures: [], years: {} } : endpoint === 'activities' ? { ok: true, activities: [] } : { rest: {}, walkers: [], walks: [] };
      return route.fulfill({ json });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', e => console.error(e.message));
    await page.goto(base + '/public/index.html');
    await page.locator('#main .card').first().waitFor();
    await page.locator('[data-tab="info"]').click();
    await page.locator('[data-info-page="stay"]').waitFor();
    return { context, page, posts };
  }

  for (const options of [{ showShare: false }, { shareUrl: '' }]) {
    const { context, page } = await open(options);
    await page.locator('[data-info-page="quality"]').waitFor();
    assert.equal(await page.locator('[data-share-site]').count(), 0, JSON.stringify(options));
    await context.close();
  }

  {
    const { context, page, posts } = await open();
    await page.locator('[data-share-site]').waitFor();
    const items = await page.locator('.info-home strong').allTextContents();
    assert.deepEqual(items.slice(-2), ['分享網站連結', '使用說明'], '分享在使用說明前面');
    await page.locator('[data-share-site]').click();
    await page.waitForFunction(() => window.__shared.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__shared[0]), { text: '來去板橋動物之家遛狗吧 🐕', url: SHARE_URL });
    for (let i = 0; i < 40 && !posts.length; i++) await page.waitForTimeout(50);
    assert.deepEqual(posts, [{ method: 'share' }]);
    await page.evaluate(() => { window.__cancel = true; });
    await page.locator('[data-share-site]').click();
    await page.waitForFunction(() => window.__shared.length === 2);
    await page.waitForTimeout(300);
    assert.deepEqual(posts, [{ method: 'share' }], '取消不記、也不改成複製');
    assert.equal(await page.evaluate(() => window.__copied), undefined);
    await context.close();
  }

  {
    const { context, page, posts } = await open({ nav: 'copy' });
    await page.locator('[data-share-site]').click();
    await page.getByText('已複製，貼給其他志工就好').waitFor();
    assert.equal(await page.evaluate(() => window.__copied), '來去板橋動物之家遛狗吧 🐕\n' + SHARE_URL);
    assert.deepEqual(posts, [{ method: 'copy' }]);
    await context.close();
  }

  {
    const { context, page, posts } = await open({ nav: 'none' });
    await page.locator('[data-share-site]').click();
    assert.equal(await page.locator('[data-share-url]').inputValue(), SHARE_URL);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '網址不讓頁面橫向溢出');
    assert.deepEqual(posts, [], '只顯示網址不記次數');
    await context.close();
  }
  console.log('ADR 0023 分享網站：開關、網址、分享／取消／複製／顯示網址與次數通過');
};
