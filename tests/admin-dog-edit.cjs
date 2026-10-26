const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// #566／#624 管理狗編輯：右側抽屜、七欄全開、低風險欄位直接存、高風險先預覽、存並開下一隻、焦點回原列。
// API 全部是假回應，不碰正式資料。
module.exports = async (browser, base) => {
  const { ADMIN_CSP } = await import('../worker/src/admin/index.js');
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
  await context.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => window.cspViolations.push(`${event.effectiveDirective}: ${event.blockedURI}`));
  });
  const A = 'a'.repeat(32),
    B = 'b'.repeat(32);
  const dogs = [
    { dogId: A, name: '阿福', number: '2020010101', cage: 'A1', note: '試算表唯讀', intro: '原介紹', sex: 'male', sexMismatch: false, onMain: true, fixedCare: false, rest: null, photoUrl: '/photos/2020010101.jpg', walkedDate: '2026-10-20' },
    { dogId: B, name: '小黑', number: '2020010102', cage: 'B2', note: '', intro: '', sex: '', sexMismatch: false, onMain: true, fixedCare: false, rest: null, photoUrl: null, walkedDate: '' }
  ];
  const snap = (dog) => ({ dogId: dog.dogId, revision: 1, intro: dog.intro, sex: dog.sex, sexCopies: [], fixedCare: false, rest: null, numbers: [dog.number], currentNumbers: [dog.number], stays: [], photo: null, intakeEvents: [] });
  const snapshots = { [A]: snap(dogs[0]), [B]: snap(dogs[1]) };
  let fail = false,
    conflict = false,
    dogReads = 0;
  const writes = [];
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/admin/public/index.html')
      return route.fulfill({ body: fs.readFileSync(path.join(__dirname, '../admin/public/index.html')), headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': ADMIN_CSP } });
    if (url.pathname.startsWith('/photos/'))
      return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    if (url.pathname === '/api/manage/dogs') {
      dogReads++;
      return route.fulfill({ json: { dogs } });
    }
    const match = url.pathname.match(/^\/api\/manage\/dogs\/([a-f0-9]{32})(\/trash)?$/);
    if (!match) return route.continue();
    const id = match[1];
    if (match[2]) return route.fulfill({ json: { days: 30, trash: [{ id: 'trash1', deletedAt: '2026-10-20T03:00:00.000Z' }] } });
    if (request.method() === 'GET') return route.fulfill({ json: snapshots[id] });
    const input = request.postDataJSON();
    writes.push({ id, ...input });
    if (fail) return route.fulfill({ status: 503, json: { error: '暫時無法儲存，草稿保留' } });
    if (conflict) return route.fulfill({ status: 409, json: { error: '資料已變更，草稿仍保留' } });
    assert.equal(input.revision, snapshots[id].revision, '每欄都帶上一筆回應的 revision');
    snapshots[id] = { ...snapshots[id], [input.field]: input.value, revision: snapshots[id].revision + 1 };
    return route.fulfill({ json: snapshots[id] });
  });
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const drawer = page.locator('#dog-drawer');
  const status = () => page.locator('.drawer-status').textContent();
  const save = page.getByRole('button', { name: '儲存', exact: true });
  const row = (id) => page.locator(`#dogs tr[data-dog-id="${id}"]`);
  try {
    await page.goto(base + '/admin/public/index.html');
    await page.getByRole('button', { name: '編輯阿福', exact: true }).waitFor();
    assert.equal(await page.locator('#dogs tr').first().locator('td').first().locator('.edit-button').count(), 1, '編輯按鈕在第一欄');
    await page.setViewportSize({ width: 1440, height: 400 });
    const scrolled = await page.evaluate(() => { scrollTo({ top: 120, behavior: 'instant' }); return scrollY; });
    assert.ok(scrolled > 0, '測試頁要能捲動');
    await page.getByRole('button', { name: '編輯阿福', exact: true }).click();
    await page.getByText('改完按「儲存」', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => scrollY), scrolled, '表格不動、不捲回頁首');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'drawer-title', '焦點進抽屜標題');
    assert.match(await row(A).getAttribute('class'), /is-selected/);
    assert.equal(await drawer.locator('.edit-field').count(), 7, '七個欄位全部展開');
    assert.match(await drawer.locator('.drawer-head').textContent(), /阿福.*2020010101.*A1/);
    assert.match(await drawer.locator('[data-field="intro"] .edit-field-head').textContent(), /3 字/);
    assert.equal(await page.locator('#edit-intro').getAttribute('maxlength'), '1000');
    assert.equal(await save.isDisabled(), true);
    assert.equal(await page.locator('.drawer-dirty').textContent(), '沒有修改。');

    // 休養：日期有 min／max，勾「不設定休養」停用日期與原因
    const today = await page.evaluate(async () => (await import('/admin/public/shared/dates.js')).BQDates.taipeiToday());
    assert.equal(await page.locator('#edit-until').getAttribute('min'), today);
    assert.ok((await page.locator('#edit-until').getAttribute('max')) > today);
    assert.equal(await page.locator('#edit-until').isDisabled(), true, '沒有休養時日期停用');
    await page.locator('#edit-rest-end').uncheck();
    assert.equal(await page.locator('#edit-until').isDisabled(), false);
    assert.match(await page.locator('.drawer-dirty').textContent(), /請填休養到哪一天/);
    assert.equal(await save.isDisabled(), true, '休養日期沒填不能存');
    await page.locator('#edit-rest-end').check();

    // 介紹：改完直接可存，行內只標差異；409 與失敗保留草稿
    await page.locator('#edit-intro').fill('原介紹，親人');
    assert.equal(await drawer.locator('[data-field="intro"] ins').textContent(), '，親人');
    assert.equal(await drawer.locator('[data-field="intro"] del').count(), 0, '只標差異，不全文重印');
    assert.equal(await save.isDisabled(), false, '低風險欄位不用預覽');
    conflict = true;
    await save.click();
    await page.getByText('資料已變更，草稿仍保留', { exact: false }).waitFor();
    assert.equal(await page.locator('#edit-intro').inputValue(), '原介紹，親人');
    snapshots[A] = { ...snapshots[A], revision: 2, intro: '別人新介紹' };
    conflict = false;
    await page.getByRole('button', { name: '讀取最新資料並保留草稿' }).click();
    await page.getByText('已讀取最新資料，草稿保留', { exact: false }).waitFor();
    assert.equal(await page.locator('#edit-intro').inputValue(), '原介紹，親人');
    assert.match(await drawer.locator('[data-field="intro"] .diff-line').textContent(), /別人新介紹|原介紹，親人/);
    fail = true;
    await save.click();
    await page.getByText('暫時無法儲存，草稿保留', { exact: false }).waitFor();
    assert.equal(await page.locator('#edit-intro').inputValue(), '原介紹，親人');
    fail = false;

    // 一次存多欄：依序一欄一筆，只更新那一列、不整表重讀
    await page.locator('#edit-sex').selectOption('');
    await page.locator('#edit-fixed-care').check();
    assert.match(await page.locator('.drawer-dirty').textContent(), /改了 3 項：介紹、固定照顧、性別補正/);
    const before = writes.length;
    await save.click();
    await page.getByText('已儲存：介紹、固定照顧、性別補正。伺服器已確認。', { exact: true }).waitFor();
    assert.deepEqual(writes.slice(before).map((w) => [w.field, w.revision]), [['intro', 2], ['fixedCare', 3], ['sex', 4]]);
    assert.equal(dogReads, 1, '存檔後不重讀整張表');
    assert.match(await row(A).textContent(), /固定照顧/);
    assert.match(await row(A).textContent(), /性別待確認/);
    assert.match(await drawer.locator('[data-field="sex"] .edit-field-head').textContent(), /待補/);

    // 編號是高風險欄位：沒預覽不能存，改了要重新預覽
    await page.locator('#edit-numbers').fill('2020010101\n2019010101');
    assert.equal(await save.isDisabled(), true);
    assert.match(await page.locator('.drawer-dirty').textContent(), /編號要先按「預覽改前／改後」/);
    await drawer.locator('[data-preview="numbers"]').click();
    assert.match(await drawer.locator('[data-field="numbers"] .field-diff').textContent(), /改前2020010101改後2019010101\n?2020010101/);
    assert.equal(await save.isDisabled(), false);
    await page.locator('#edit-numbers').fill('2020010101\n2018010101');
    assert.equal(await save.isDisabled(), true, '預覽後又改要重新預覽');
    await page.locator('#edit-numbers').fill('2020010101');

    // 照片：舊固定路徑沒有 D1 引用，預覽仍顯示改前圖
    await page.getByRole('button', { name: '查看這隻狗的照片垃圾桶' }).click();
    await page.getByRole('button', { name: /預覽復原/ }).click();
    assert.equal(await page.getByAltText('改前照片').getAttribute('src'), '/photos/2020010101.jpg', '舊固定路徑沒有 D1 pointer 仍顯示改前圖');
    assert.equal(await save.isDisabled(), false);

    // 有沒存的修改時關閉要按兩次；Esc 關閉後焦點回原列「編輯」
    await page.keyboard.press('Escape');
    assert.equal(await drawer.isVisible(), true, '第一次只提醒');
    assert.match(await status(), /還有沒存的修改（照片）/);
    await page.keyboard.press('Escape');
    assert.equal(await drawer.isHidden(), true);
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '編輯阿福', '焦點回到原列');
    assert.doesNotMatch((await row(A).getAttribute('class')) || '', /is-selected/);

    // 存並開下一隻：依目前排序（編號）開下一隻，成功訊息帶到下一隻的抽屜頂部
    await page.getByRole('button', { name: '編輯阿福', exact: true }).click();
    await page.getByText('改完按「儲存」', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: '下一隻', exact: true }).isEnabled(), true, '沒改時是「下一隻」');
    await page.locator('#edit-fixed-care').uncheck();
    await page.getByRole('button', { name: '存並開下一隻' }).click();
    await page.getByText('阿福 已儲存：固定照顧。現在編輯小黑。', { exact: true }).waitFor();
    assert.equal(await drawer.locator('#drawer-title').textContent(), '小黑');
    assert.match(await row(B).getAttribute('class'), /is-selected/);
    assert.match(await drawer.locator('[data-field="intro"] .edit-field-head').textContent(), /待補/);
    assert.match(await drawer.locator('[data-field="photo"] .edit-field-head').textContent(), /待補/);
    await page.getByRole('button', { name: '下一隻', exact: true }).click();
    assert.equal(await drawer.isHidden(), true);
    assert.match(await page.locator('#status').textContent(), /已經是目前清單的最後一隻/);

    // 網址帶篩選與 dog：待補清單連過來直接開抽屜
    await page.goto(`${base}/admin/public/index.html?presence=main&care=missingIntro&dog=${B}`);
    await page.getByText('改完按「儲存」', { exact: false }).waitFor();
    assert.equal(await page.locator('#care').inputValue(), 'missingIntro');
    assert.equal(await page.locator('#dogs tr').count(), 1);
    assert.equal(await drawer.locator('#drawer-title').textContent(), '小黑');
    await page.locator('#sex').selectOption('unknown');
    assert.match(await page.evaluate(() => location.search), /care=missingIntro/);
    assert.match(await page.evaluate(() => location.search), /sex=unknown/);

    const shots = path.join(__dirname, '../.impeccable/review');
    fs.mkdirSync(shots, { recursive: true });
    for (const [width, height] of [[1440, 1000], [375, 812]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`${base}/admin/public/index.html`);
      await page.getByRole('button', { name: '編輯阿福', exact: true }).waitFor();
      const editBox = await page.getByRole('button', { name: '編輯阿福', exact: true }).boundingBox();
      assert.ok(editBox.x + editBox.width <= width, `${width}px 不用橫捲就按得到編輯`);
      await page.getByRole('button', { name: '編輯阿福', exact: true }).click();
      await page.getByText('改完按「儲存」', { exact: false }).waitFor();
      await page.locator('#edit-intro').fill('原介紹，親人，喜歡散步');
      const box = await drawer.boundingBox();
      assert.equal(Math.round(box.width), width > 900 ? 480 : width, '桌機 480px、手機全寬');
      assert.ok(await save.isVisible(), '儲存按鈕固定在抽屜底部看得到');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(shots, `624-drawer-${width}.png`) });
    }
    assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
    assert.deepEqual(errors, []);
    console.log('#624 管理狗編輯抽屜：表格不動、七欄全開、低風險直接存／高風險先預覽、409／失敗保留草稿、多欄依序存只更新一列、焦點回原列、存並開下一隻、網址開抽屜、375／1440px通過');
  } finally {
    await context.close();
  }
};
