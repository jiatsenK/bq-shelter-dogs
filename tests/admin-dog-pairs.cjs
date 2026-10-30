const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// #774 可能是同一隻：待核對的狗名下列出配對，「合併」開抽屜先選好那一隻預覽（照現有合併），「不是同一隻」按兩次才送；
// 待補清單只顯示組數、連到狗資料的待核對。做法同 admin-dog-merge。
module.exports = async (browser, base) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Taipei' });
  const WARM = 'a'.repeat(32), LEFT = 'b'.repeat(32), WHITE = 'c'.repeat(32), NEW = 'd'.repeat(32);
  const dog = extra => ({ number: '', formerNumber: '', cage: '', note: '', intro: '', sex: '', sexMismatch: false,
    onMain: false, status: 'unknown', departure: null, fixedCare: false, rest: null, photoUrl: null, ...extra });
  const dogs = [dog({ dogId: WARM, name: '暖暖', number: '2026101403', cage: '舊B06', onMain: true, status: 'main' }), dog({ dogId: LEFT, name: '暖暖' }),
    dog({ dogId: WHITE, name: '小白', formerNumber: '9002' }), dog({ dogId: NEW, name: '阿白', number: '9010', cage: 'A02', onMain: true, status: 'main' })];
  let pairs = [{ goneDogId: LEFT, dogId: WARM, createdAt: '2026-10-30T02:00:00.000Z', goneName: '暖暖', name: '暖暖', number: '2026101403', cage: '舊B06' },
    { goneDogId: WHITE, dogId: NEW, createdAt: '2026-10-30T01:00:00.000Z', goneName: '小白', name: '阿白', number: '9010', cage: 'A02' }];
  const rejects = [], previews = [];
  let pairsCode = 200;
  await context.route('**/api/manage/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/api/manage/dogs') return route.fulfill({ json: { dogs } });
    if (url.pathname === '/api/manage/dog-pairs') return route.fulfill({ status: pairsCode, json: pairsCode === 200 ? { count: pairs.length, pairs } : { error: '管理資料暫時無法讀取，請稍後重試' } });
    const reject = url.pathname.match(/^\/api\/manage\/dog-pairs\/([a-f0-9]{32})\/([a-f0-9]{32})\/not-same$/);
    if (reject && request.method() === 'POST') {
      rejects.push([reject[1], reject[2]]);
      pairs = pairs.filter(p => p.goneDogId !== reject[1] || p.dogId !== reject[2]);
      return route.fulfill({ json: { goneDogId: reject[1], dogId: reject[2], status: 'not_same' } });
    }
    if (url.pathname === `/api/manage/dogs/${WARM}/merge` && request.method() === 'GET') {
      previews.push(url.searchParams.get('source'));
      return route.fulfill({ json: { target: { dogId: WARM, name: '暖暖', number: '2026101403', numbers: ['2026101403'], revision: 7, onMain: true },
        source: { dogId: LEFT, name: '暖暖', number: '', numbers: [], revision: 3, onMain: false }, moved: { 溜狗紀錄: 2 }, kept: {}, lost: {} } });
    }
    if (request.method() === 'GET') return route.fulfill({ json: { dogId: LEFT, revision: 3, intro: '', sex: '', sexCopies: [], fixedCare: false, rest: null, numbers: [], currentNumbers: [], stays: [], photo: null } });
    return route.fulfill({ status: 500, json: { error: '測試沒預期的寫入' } });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(base + '/admin/public/index.html?status=unknown');
    await page.getByText('可能跟 暖暖（舊B06）是同一隻').waitFor();
    await page.getByText('可能跟 阿白（A02）是同一隻').waitFor();
    assert.equal(await page.locator('#pair-note').isHidden(), true);
    fs.mkdirSync(path.join(__dirname, '../.scratch/dog-pairs-evidence'), { recursive: true });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(__dirname, `../.scratch/dog-pairs-evidence/pairs-${width}.png`), fullPage: true });
    }

    // 不是同一隻：第一次只是準備，第二次才送；這一組從畫面消失
    const notSame = page.getByRole('button', { name: '可能跟 阿白（A02）是同一隻：不是同一隻' });
    await notSame.click();
    assert.equal(rejects.length, 0);
    await page.getByRole('button', { name: '可能跟 阿白（A02）是同一隻：確定不是同一隻' }).click();
    await page.getByText('已記下：小白跟 阿白（A02）不是同一隻，之後不再列出。').waitFor();
    assert.deepEqual(rejects, [[WHITE, NEW]]);
    assert.equal(await page.getByText('可能跟 阿白（A02）是同一隻').count(), 0);

    // 合併：開待核對那隻的抽屜，選好表上那隻、直接預覽；寫入照現有合併（再按兩次）
    await page.getByRole('button', { name: '可能跟 暖暖（舊B06）是同一隻：合併' }).click();
    await page.locator('.merge-preview').waitFor();
    assert.deepEqual(previews, [LEFT]);
    assert.equal(await page.locator('#merge-with').inputValue(), WARM);
    assert.match(await page.locator('.merge-preview').textContent(), /留下：暖暖 2026101403/);
    await page.getByRole('button', { name: '合併', exact: true }).waitFor();
    await page.keyboard.press('Escape');

    // 待補清單：組數與連結
    await page.goto(base + '/admin/public/checks.html');
    await page.getByText('有 1 組可能是同一隻。').waitFor();
    const link = page.getByRole('link', { name: '到狗資料的待核對處理' });
    assert.equal(await link.getAttribute('href'), './?status=unknown');
    pairs = [];
    await page.locator('#reload').click();
    await page.getByText('目前沒有可能是同一隻的狗。').waitFor();
    assert.equal(await link.isHidden(), true);
    pairsCode = 503;
    await page.locator('#reload').click();
    await page.getByText('這不代表沒有，請重新讀取', { exact: false }).waitFor();

    // 配對讀不到：狗資料表照常，另外說一聲
    await page.goto(base + '/admin/public/index.html?status=unknown');
    await page.locator('#pair-note').waitFor();
    assert.match(await page.locator('#status').textContent(), /待核對找到 2 隻/);
    assert.deepEqual(errors, []);
    console.log('可能是同一隻：狗名下配對、不是同一隻兩次確認、合併開抽屜預覽、待補清單組數與連結、讀不到時另外說明，390／1440px 通過');
  } finally {
    await context.close();
  }
};
