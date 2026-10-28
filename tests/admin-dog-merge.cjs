const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// 合併狗（K 2026-10-26）：待核對的那隻在編輯抽屜底下選同名的在所狗→預覽→按兩次才送；失敗不改畫面資料。
module.exports = async (browser, base) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Taipei' });
  const T = 'a'.repeat(32), S = 'b'.repeat(32), OTHER = 'c'.repeat(32);
  const dog = extra => ({ name: '米香', number: '', formerNumber: '', cage: '', note: '', intro: '', sex: '', sexMismatch: false,
    onMain: false, status: 'unknown', departure: null, fixedCare: false, rest: null, photoUrl: null, ...extra });
  let dogs = [dog({ dogId: T, number: '2026082501', cage: 'C區13', onMain: true, status: 'main' }), dog({ dogId: S }),
    dog({ dogId: OTHER, name: '別隻', number: '2026010101', onMain: true, status: 'main' })];
  const posts = [];
  let failNext = true, dogsReads = 0;
  await context.route('**/api/manage/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/api/manage/dogs') { dogsReads++; return route.fulfill({ json: { dogs } }); }
    if (url.pathname === `/api/manage/dogs/${T}/merge` && request.method() === 'GET') {
      assert.equal(url.searchParams.get('source'), S, '正在編輯的待核對那隻被併掉、在所那隻留下');
      return route.fulfill({ json: { target: { dogId: T, name: '米香', number: '2026082501', numbers: ['2026082501'], revision: 7, onMain: true },
        source: { dogId: S, name: '米香', number: '', numbers: [], revision: 3, onMain: false },
        moved: { 溜狗紀錄: 4 }, kept: { 介紹: 1 }, lost: { 介紹: '先登記的介紹' } } });
    }
    if (url.pathname === `/api/manage/dogs/${T}/merge` && request.method() === 'POST') {
      posts.push(request.postDataJSON());
      if (failNext) { failNext = false; return route.fulfill({ status: 409, json: { error: '兩隻狗的資料在預覽後有變動，請重新預覽再合併' } }); }
      dogs = dogs.filter(d => d.dogId !== S);
      return route.fulfill({ json: { logId: 12, target: { dogId: T, revision: 8 } } });
    }
    if (request.method() === 'GET') return route.fulfill({ json: { dogId: S, revision: 3, intro: '', sex: '', sexCopies: [], fixedCare: false, rest: null, numbers: [], currentNumbers: [], stays: [], photo: null } });
    return route.fulfill({ status: 500, json: { error: '測試沒預期的寫入' } });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(base + '/admin/public/index.html');
    await page.locator('[data-status="unknown"]').click();
    await page.getByRole('button', { name: '編輯米香', exact: true }).click();
    const options = await page.locator('#merge-with option').allTextContents();
    assert.deepEqual(options, ['同名：米香 2026082501（在所）', '別隻 2026010101（在所）'], '同名排最前；不在所的狗只能併到別隻');
    await page.getByRole('button', { name: '預覽合併' }).click();
    await page.locator('.merge-preview').waitFor();
    const preview = await page.locator('.merge-preview').textContent();
    assert.match(preview, /留下：米香 2026082501/);
    assert.match(preview, /併掉：米香 無編號/);
    assert.match(preview, /搬到留下那隻：溜狗紀錄 4 筆/);
    assert.match(preview, /不採用被併那隻的介紹：先登記的介紹/);
    fs.mkdirSync(path.join(__dirname, '../.scratch/dog-merge-evidence'), { recursive: true });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(__dirname, `../.scratch/dog-merge-evidence/merge-${width}.png`), fullPage: true });
    }
    await page.getByRole('button', { name: '合併', exact: true }).click();
    assert.equal(posts.length, 0, '第一次只是準備，不送出');
    await page.getByRole('button', { name: /確定合併/ }).click();
    await page.getByText('兩隻狗的資料在預覽後有變動，請重新預覽再合併', { exact: true }).waitFor();
    assert.deepEqual(posts[0], { sourceId: S, revision: 7, sourceRevision: 3 });
    assert.equal(await page.locator('.merge-preview').isHidden(), true, '失敗要重新預覽');
    await page.getByRole('button', { name: '預覽合併' }).click();
    await page.locator('.merge-preview').waitFor();
    await page.getByRole('button', { name: '合併', exact: true }).click();
    await page.getByRole('button', { name: /確定合併/ }).click();
    await page.getByText(/已把「米香 無編號」併到「米香 2026082501」/).waitFor();
    assert.equal(await page.locator('#dog-drawer').isHidden(), true, '被併的那隻消失，抽屜關掉');
    await page.waitForFunction(() => document.querySelector('[data-count="unknown"]').textContent === '0');
    assert.equal(posts.length, 2);
    assert.equal(dogsReads, 2, '合併後重新讀狗表');
    await page.locator('[data-status="all"]').click();
    await page.getByRole('button', { name: '編輯米香', exact: true }).click();
    await page.getByText('沒有可以合併的狗（兩隻都在主清單上時不能合併）。', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('合併狗：同名候選、預覽、兩次確認、409 不改、成功後重讀與 390／1440px 通過');
  } finally {
    await context.close();
  }
};
