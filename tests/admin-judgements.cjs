const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// #775 系統自動判斷：資料頁「待核對」旁的按鈕數字＝等確認的配對數，按下去列出判斷紀錄（最新在上，載入更早的接著讀），
// 自動合併那筆按兩次取消合併；編輯抽屜底下只列這隻狗的判斷紀錄；修改紀錄頁類別篩選有系統自動判斷。做法同 admin-dog-pairs。
module.exports = async (browser, base) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Taipei' });
  const WARM = 'a'.repeat(32), WHITE = 'b'.repeat(32), NEW = 'c'.repeat(32), EGG = 'd'.repeat(32);
  const dog = extra => ({ number: '', formerNumber: '', cage: '', note: '', intro: '', sex: '', sexMismatch: false,
    onMain: false, status: 'unknown', departure: null, fixedCare: false, rest: null, photoUrl: null, ...extra });
  const dogs = [dog({ dogId: WARM, name: '暖暖', number: '2026103001', cage: '新A01', onMain: true, status: 'main' }), dog({ dogId: WHITE, name: '小白', formerNumber: '9002' }),
    dog({ dogId: NEW, name: '阿白', number: '9010', cage: 'A02', onMain: true, status: 'main' }), dog({ dogId: EGG, name: '皮蛋', number: '9003', cage: 'A03', onMain: true, status: 'main' })];
  const pairs = [{ goneDogId: WHITE, dogId: NEW, createdAt: '2026-10-30T03:00:00.000Z', goneName: '小白', name: '阿白', number: '9010', cage: 'A02' }];
  const log = (id, at, kind, kindLabel, dogId, dogName, before, after) => ({ id, at, kind, kindLabel, source: 'sheet', editorName: '系統自動判斷', dogId, dogNumber: '', dogName, before, after });
  const edits = [
    log(9, '2026-10-30T03:00:00.000Z', 'pair', '可能是同一隻', WHITE, '小白', { name: '小白', number: '9002', cage: 'A02' }, { dogId: NEW, name: '阿白', number: '9010', cage: 'A02' }),
    log(8, '2026-10-30T02:30:00.000Z', 'stay-end', '暫住結束', EGG, '皮蛋', { cage: 'A01' }, null),
    log(7, '2026-10-30T02:10:00.000Z', 'automerge', '系統自動合併', WARM, '暖暖', { name: '(乳白)', numbers: [], cage: '新A01', counts: {} }, { sourceId: 'e'.repeat(32), name: '暖暖', number: '2026103001', moved: {}, kept: {} }),
    log(5, '2026-10-30T02:00:00.000Z', 'stay-start', '暫住開始', EGG, '皮蛋', null, { cage: 'A01' }),
    log(2, '2026-10-29T09:00:00.000Z', 'not_same', '不是同一隻', WHITE, '小白', { name: '小白' }, { dogId: NEW, name: '阿白', number: '9010', cage: 'A02' }),
  ];
  const edited = [], unmerges = [];
  await context.route('**/api/manage/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/api/manage/dogs') return route.fulfill({ json: { dogs } });
    if (url.pathname === '/api/manage/dog-pairs') return route.fulfill({ json: { count: pairs.length, pairs } });
    if (url.pathname === '/api/manage/edits') {
      edited.push(url.search);
      const kinds = [{ value: 'judge', label: '系統自動判斷（全部）' }, { value: 'pair', label: '可能是同一隻' }];
      const dogFilter = url.searchParams.get('dog');
      if (dogFilter) return route.fulfill({ json: { pageSize: 25, kinds, next: null, edits: edits.filter(e => e.dogId === dogFilter || e.after?.dogId === dogFilter) } });
      // 第一頁四筆、還有下一頁；接著讀最後一筆
      const older = url.searchParams.get('cursor') === '5';
      return route.fulfill({ json: { pageSize: 50, kinds, next: older ? null : 5, edits: older ? edits.slice(4) : edits.slice(0, 4) } });
    }
    if (url.pathname === `/api/manage/dogs/${WARM}/unmerge` && request.method() === 'POST') {
      unmerges.push(request.postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    if (request.method() === 'GET') return route.fulfill({ json: { dogId: url.pathname.split('/').pop(), revision: 4, intro: '', sex: '', sexCopies: [], fixedCare: false, rest: null, numbers: [], currentNumbers: [], stays: [], photo: null } });
    return route.fulfill({ status: 500, json: { error: '測試沒預期的寫入' } });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(base + '/admin/public/index.html');
    const tab = page.locator('[data-status="judge"]');
    await page.locator('[data-count="judge"]').filter({ hasText: '1' }).waitFor();
    assert.equal(await tab.textContent(), '系統自動判斷 1', '數字只算等確認的配對');
    await tab.click();
    assert.equal(await tab.getAttribute('aria-pressed'), 'true');
    assert.equal(new URL(page.url()).searchParams.get('status'), 'judge');
    await page.getByText('判斷可能是同一隻', { exact: false }).waitFor();
    assert.equal(await page.locator('#filters').isHidden(), true);
    assert.equal(await page.locator('#table-region').isHidden(), true);
    const items = () => page.locator('#judgements .judge-text').allTextContents();
    assert.deepEqual(await items(), [
      'A02 小白 9002 消失，同籠有 阿白 9010，判斷可能是同一隻，等管理者確認',
      'A01 皮蛋 的暫住列消失，暫住結束',
      '新A01 (乳白) 改成 暖暖 2026103001，判斷為同一隻，已合併',
      'A01 出現 皮蛋 的暫住列，判斷為暫住，不另建狗',
    ]);
    assert.equal(await page.locator('#judgements time').first().textContent(), '2026/10/30 11:00');
    await page.getByRole('button', { name: '載入更早的紀錄' }).click();
    await page.getByText('管理者確認 小白 跟 阿白（A02）不是同一隻').waitFor();
    assert.equal((await items()).length, 5);
    assert.equal(await page.locator('#judge-more').isHidden(), true);
    assert.equal(await page.locator('#judgements .btn').count(), 1, '只有自動合併那筆有取消合併');
    fs.mkdirSync(path.join(__dirname, '../.scratch/judgements-evidence'), { recursive: true });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(__dirname, `../.scratch/judgements-evidence/judge-${width}.png`), fullPage: true });
    }

    // 取消合併：按兩次才送，送出留下那隻的版本與這筆紀錄
    await page.getByRole('button', { name: '取消合併' }).click();
    assert.equal(unmerges.length, 0);
    const reloaded = page.waitForResponse(r => r.url().includes('/api/manage/dogs') && !r.url().includes('unmerge') && !r.url().includes(WARM));
    await page.getByRole('button', { name: '確定取消：拆回「(乳白)」' }).click();
    await reloaded; // 拆回來之後狗表重讀
    assert.deepEqual(unmerges, [{ logId: 7, revision: 4 }]);

    // 直接開網址也在判斷紀錄；切回待核對，抽屜底下只列小白的判斷
    await page.goto(base + '/admin/public/index.html?status=judge');
    await page.getByText('判斷可能是同一隻', { exact: false }).waitFor();
    await page.locator('[data-status="unknown"]').click();
    await page.getByRole('button', { name: '編輯小白', exact: true }).click();
    const section = page.locator('.judge-section');
    await section.getByText('管理者確認 小白 跟 阿白（A02）不是同一隻').waitFor();
    assert.deepEqual(await section.locator('.judge-text').allTextContents(), [
      'A02 小白 9002 消失，同籠有 阿白 9010，判斷可能是同一隻，等管理者確認',
      '管理者確認 小白 跟 阿白（A02）不是同一隻',
    ]);
    assert.ok(edited.includes(`?kind=judge&dog=${WHITE}`), '抽屜帶這隻狗的永久 ID 查');
    await page.keyboard.press('Escape');
    await page.locator('[data-status="main"]').click();
    await page.getByRole('button', { name: '編輯暖暖', exact: true }).click();
    await section.getByText('判斷為同一隻，已合併', { exact: false }).waitFor();
    assert.equal(await section.locator('li').count(), 1);

    // 修改紀錄頁：類別篩選有系統自動判斷（選項來自伺服器）
    await page.goto(base + '/admin/public/updates.html');
    await page.locator('#kind option[value="judge"]').waitFor({ state: 'attached' });
    await page.locator('#kind').selectOption('judge');
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('搜尋範圍'));
    assert.ok(edited.at(-1).includes('kind=judge'));
    assert.deepEqual(errors, []);
    console.log('系統自動判斷：按鈕數字、列表最新在上與載入更早、取消合併兩次確認、抽屜只列這隻狗、修改紀錄頁類別篩選，390／1440px 通過');
  } finally {
    await context.close();
  }
};
