const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// #566／#624 管理狗編輯：右側抽屜、六欄全開（#639 編號併進出入所紀錄）、低風險欄位直接存、高風險先預覽、存並開下一隻、焦點回原列。
// API 全部是假回應，不碰正式資料。
module.exports = async (browser, base) => {
  const { ADMIN_CSP } = await import('../worker/src/admin/index.js');
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
  await context.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => window.cspViolations.push(`${event.effectiveDirective}: ${event.blockedURI}`));
  });
  const A = 'a'.repeat(32),
    B = 'b'.repeat(32),
    C = 'c'.repeat(32),
    D = 'd'.repeat(32);
  const dogs = [
    { dogId: A, name: '阿福', number: '2020010101', cage: 'A1', note: '試算表唯讀', intro: '原介紹', sex: 'male', sexMismatch: false, onMain: true, status: 'main', formerNumber: '', departure: null, fixedCare: false, rest: null, photoUrl: '/photos/2020010101.jpg', walkedDate: '2026-10-20' },
    { dogId: B, name: '小黑', number: '2020010102', cage: 'B2', note: '', intro: '', sex: '', sexMismatch: false, onMain: true, status: 'main', formerNumber: '', departure: null, fixedCare: false, rest: null, photoUrl: null, walkedDate: '' },
    { dogId: C, name: '球球', number: '2020010103', cage: 'C3', note: '', intro: '', sex: 'female', sexMismatch: false, onMain: true, status: 'main', formerNumber: '', departure: null, fixedCare: false, rest: null, photoUrl: null, walkedDate: '2026-10-21' },
    { dogId: D, name: '花花', number: '2020010104', cage: 'D4', note: '', intro: '', sex: 'female', sexMismatch: false, onMain: true, status: 'main', formerNumber: '', departure: null, fixedCare: false, rest: null, photoUrl: null, walkedDate: '2026-10-21' }
  ];
  const stay = (n, extra = {}) => ({ number: n, in: `${n.slice(0, 4)}-${n.slice(4, 6)}-${n.slice(6, 8)}`, out: '', reason: '', ...extra });
  const snap = (dog) => ({ dogId: dog.dogId, revision: 1, intro: dog.intro, sex: dog.sex, sexCopies: [], fixedCare: false, rest: null, numbers: [dog.number], currentNumbers: [dog.number], stays: [stay(dog.number)], photo: null });
  const snapshots = Object.fromEntries(dogs.map((dog) => [dog.dogId, snap(dog)]));
  // 球球有離所過的舊編號：後端帶的 departed 不算進草稿比較，打開不能顯示「改了出入所紀錄」
  snapshots[C].numbers = ['2019120101', '2020010103'];
  snapshots[C].stays = [stay('2019120101', { out: '2020-01-01', reason: '迷路', departed: true, departure: '認養' }), stay('2020010103')];
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
    // 先把第一列捲到畫面中間（不靠固定像素：表格上方多了狀態分頁），點編輯時 Playwright 不必自己捲
    const scrolled = await page.evaluate(() => { document.querySelector('#dogs tr').scrollIntoView({ block: 'center', behavior: 'instant' }); return scrollY; });
    assert.ok(scrolled > 0, '測試頁要能捲動');
    await page.getByRole('button', { name: '編輯阿福', exact: true }).click();
    await page.getByText('改完按「儲存」', { exact: false }).waitFor();
    assert.ok((await page.evaluate(() => scrollY)) > 0, '不捲回頁首（列位置在後面的寬度檢查量）');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'drawer-title', '焦點進抽屜標題');
    assert.match(await row(A).getAttribute('class'), /is-selected/);
    assert.equal(await drawer.locator('.edit-field').count(), 6, '六個欄位全部展開');
    assert.match(await drawer.locator('.drawer-head').textContent(), /阿福.*2020010101.*A1/);
    assert.match(await drawer.locator('[data-field="intro"] .edit-field-head').textContent(), /3 字/);
    assert.equal(await page.locator('#edit-intro').getAttribute('maxlength'), '1000');
    assert.match(await page.locator('#edit-intro-hint').textContent(), /入所經過寫在出入所紀錄/);
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
    assert.equal(await page.evaluate(() => document.activeElement.className), 'drawer-status', '存完焦點在狀態列，不掉到 body');
    assert.match(await row(A).textContent(), /固定照顧/);
    assert.match(await row(A).textContent(), /性別待確認/);
    assert.match(await drawer.locator('[data-field="sex"] .edit-field-head').textContent(), /待補/);

    // 出入所紀錄（含編號，ADR 0021）是高風險欄位：沒預覽不能存，改了要重新預覽。補編號＝新增一列填編號，入所日跟著編號
    const stays = drawer.locator('[data-field="stays"]');
    assert.equal(await stays.locator('.stay-row').first().getByRole('button').count(), 0, '目前編號那列不能刪');
    await stays.getByRole('button', { name: '新增一列' }).click();
    const added = stays.locator('.stay-row').last();
    await added.locator('[data-key="number"]').fill('2019010101');
    assert.equal(await added.locator('[data-key="in"]').inputValue(), '2019-01-01');
    assert.equal(await added.locator('[data-key="in"]').getAttribute('readonly'), '', '有編號的入所日不能另外改');
    assert.equal(await save.isDisabled(), true);
    assert.match(await page.locator('.drawer-dirty').textContent(), /出入所紀錄要先按「預覽改前／改後」/);
    await drawer.locator('[data-preview="stays"]').click();
    assert.match(await stays.locator('.field-diff').textContent(), /改後2020010101：入所 2020-01-01（原因未填）／還在所\n2019010101：入所 2019-01-01（原因未填）／還在所/);
    assert.equal(await save.isDisabled(), false);
    await added.locator('[data-key="out"]').fill('2019-05-01');
    assert.equal(await save.isDisabled(), true, '預覽後又改要重新預覽');
    // 沒有離所紀錄的那列，離所原因手填（K 2026-10-26）
    await added.locator('[data-key="outReason"]').fill('整修移所');
    await drawer.locator('[data-preview="stays"]').click();
    assert.match(await stays.locator('.field-diff').textContent(), /2019010101：入所 2019-01-01（原因未填）／離所 2019-05-01（整修移所）/);
    await added.getByRole('button', { name: '刪掉這列' }).click();

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
    await page.getByText('改完按「儲存」', { exact: false }).waitFor();
    assert.equal(await drawer.locator('#drawer-title').textContent(), '球球');
    assert.equal(await page.locator('.drawer-dirty').textContent(), '沒有修改。', '後端帶的離所旗標不算改了出入所紀錄');
    const departedRow = drawer.locator('[data-field="stays"] .stay-row').first();
    // #663：同步從備註讀錯離所日時，管理者可以直接改
    assert.equal(await departedRow.locator('[data-key="out"]').getAttribute('readonly'), null, '管理者可以修正離所日');
    assert.equal(await departedRow.locator('[data-key="reason"]').getAttribute('readonly'), null, '入所原因有離所紀錄也能填');
    assert.match(await departedRow.textContent(), /離所原因照離所紀錄（認養）。離所日讀錯可以直接改/);
    assert.equal(await departedRow.locator('[data-key="outReason"]').count(), 0, '有離所紀錄的那列不另填離所原因');
    // 焦點不在抽屜裡時 Esc 也關得掉
    await page.locator('#query').focus();
    await page.keyboard.press('Escape');
    assert.equal(await drawer.isHidden(), true);
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '編輯球球');

    // 網址帶篩選與 dog：待補清單連過來直接開抽屜；在篩選清單裡存第 2 隻，要開第 3 隻，不是跳回第 1 隻
    await page.goto(`${base}/admin/public/index.html?care=missingIntro&dog=${C}`);
    await page.getByText('改完按「儲存」', { exact: false }).waitFor();
    assert.equal(await page.locator('#care').inputValue(), 'missingIntro');
    assert.equal(await page.locator('#dogs tr').count(), 3);
    assert.equal(await drawer.locator('#drawer-title').textContent(), '球球');
    await page.locator('#edit-intro').fill('愛玩球');
    await page.getByRole('button', { name: '存並開下一隻' }).click();
    await page.getByText('球球 已儲存：介紹。現在編輯花花。', { exact: true }).waitFor();
    await page.locator('#edit-intro').fill('安靜');
    await page.getByRole('button', { name: '存並開下一隻' }).click();
    await drawer.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#status').textContent(), '花花 已儲存：介紹。這份清單處理完了。');
    await page.goto(`${base}/admin/public/index.html?care=missingIntro&dog=${B}`);
    await page.getByText('改完按「儲存」', { exact: false }).waitFor();
    assert.equal(await drawer.locator('#drawer-title').textContent(), '小黑');
    await page.locator('#sex').selectOption('unknown');
    assert.match(await page.evaluate(() => location.search), /care=missingIntro/);
    assert.match(await page.evaluate(() => location.search), /sex=unknown/);

    const shots = path.join(__dirname, '../.impeccable/review');
    fs.mkdirSync(shots, { recursive: true });
    // 淺藍選取底上的文字與按鈕都要過 AA：沿祖先找到實際底色再算對比
    const selectedContrast = () =>
      page.evaluate(() => {
        const lum = (color) => {
          const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => (v > 1 || !color.includes('srgb') ? v / 255 : v)).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const background = (node) => {
          for (; node; node = node.parentElement) {
            const bg = getComputedStyle(node).backgroundColor;
            if (!/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
          }
          return 'rgb(255, 255, 255)';
        };
        const nodes = [...document.querySelectorAll('tr.is-selected *')].filter((n) => n.childNodes.length && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && n.offsetParent);
        return nodes.map((n) => {
          const a = lum(getComputedStyle(n).color),
            b = lum(background(n));
          return [n.textContent.trim().slice(0, 12), Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100];
        });
      });
    for (const [width, height] of [[1440, 1000], [1100, 900], [375, 812]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`${base}/admin/public/index.html`);
      const editBall = page.getByRole('button', { name: '編輯球球', exact: true });
      await editBall.waitFor();
      const editBox = await editBall.boundingBox();
      assert.ok(editBox.x + editBox.width <= width, `${width}px 不用橫捲就按得到編輯`);
      const beforeRow = await row(C).boundingBox();
      await editBall.click();
      await page.getByText('改完按「儲存」', { exact: false }).waitFor();
      const box = await drawer.boundingBox();
      assert.equal(Math.round(box.width), width > 900 ? 480 : width, '桌機 480px、手機全寬');
      if (width > 900) {
        // 抽屜開著時表格切精簡欄、讓位，被點的列留在原處、整列看得到
        const after = await row(C).boundingBox();
        assert.ok(Math.abs(after.y - beforeRow.y) <= 2, `${width}px 被點的列留在原本的螢幕位置（${beforeRow.y}→${after.y}）`);
        assert.equal(await page.locator('th.col-wide').first().isHidden(), true, '精簡欄');
        // 1440 精簡欄整張看得到；1100 內容區太窄，至少編輯到狗名看得到，維護狀態在表格自己的捲動區裡
        const lastVisible = await page.locator(width >= 1200 ? 'thead th:has-text("維護狀態")' : `#dogs tr[data-dog-id="${C}"] .dog-name`).boundingBox();
        assert.ok(lastVisible.x + lastVisible.width <= box.x, `${width}px 該看到的欄沒被抽屜蓋住`);
        assert.ok(after.y >= 0 && after.y + after.height <= height, `${width}px 被點的列在畫面內`);
        if (width === 1440) {
          const filters = await page.locator('#filters').boundingBox();
          assert.ok(filters.height < 120, '篩選列不換行');
        }
        for (const [text, ratio] of await selectedContrast()) assert.ok(ratio >= 4.5, `選取列「${text}」對比 ${ratio}`);
      }
      await page.locator('#edit-intro').fill('會握手，喜歡散步');
      assert.ok(await save.isVisible(), '儲存按鈕固定在抽屜底部看得到');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(shots, `624-drawer-${width}.png`) });
    }
    assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
    assert.deepEqual(errors, []);
    console.log('#624 管理狗編輯抽屜：表格不動、六欄全開、低風險直接存／高風險先預覽、409／失敗保留草稿、多欄依序存只更新一列、焦點回原列、存並開下一隻、網址開抽屜、切精簡欄、列不移位、選取列對比 AA、篩選清單照原順序往下、存後焦點與 Esc、出入所表帶編號、375／1100／1440px通過');
  } finally {
    await context.close();
  }
};
