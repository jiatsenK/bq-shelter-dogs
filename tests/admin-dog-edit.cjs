const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
module.exports = async (browser, base) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Taipei' });
  const dog = {
    dogId: 'a'.repeat(32),
    name: '阿福',
    number: '2020010101',
    cage: 'A1',
    note: '試算表唯讀',
    intro: '原介紹',
    sex: 'male',
    sexMismatch: true,
    onMain: true,
    fixedCare: false,
    rest: null,
    photoUrl: null
  };
  let snapshot = {
    dogId: dog.dogId,
    revision: 1,
    intro: dog.intro,
    sex: 'male',
    sexCopies: [{ row: 0, sex: 'female' }],
    fixedCare: false,
    rest: null,
    numbers: [dog.number],
    currentNumbers: [dog.number],
    stays: [],
    photo: null,
    intakeEvents: []
  };
  let fail = false,
    conflict = false,
    writes = 0;
  await context.route('**/api/manage/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === '/api/manage/dogs') return route.fulfill({ json: { dogs: [dog] } });
    if (request.method() === 'GET') return route.fulfill({ json: snapshot });
    writes++;
    if (fail) return route.fulfill({ status: 503, json: { error: '暫時無法儲存，草稿保留' } });
    if (conflict) return route.fulfill({ status: 409, json: { error: '資料已變更，草稿仍保留' } });
    const input = request.postDataJSON();
    assert.equal(input.revision, snapshot.revision);
    snapshot = { ...snapshot, [input.field]: input.value, revision: snapshot.revision + 1 };
    return route.fulfill({ json: snapshot });
  });
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(base + '/admin/public/index.html');
    await page.getByRole('button', { name: '編輯阿福', exact: true }).click();
    await page.getByText('選擇項目，修改後預覽，再逐項儲存。', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '確認儲存這一項' }).isDisabled(), true);
    await page.locator('#edit-value').fill('草稿介紹');
    await page.getByRole('button', { name: '預覽改前／改後' }).click();
    assert.match(await page.locator('.edit-diff').textContent(), /原介紹.*草稿介紹/);
    conflict = true;
    await page.getByRole('button', { name: '確認儲存這一項' }).click();
    await page.getByText('資料已變更，草稿仍保留', { exact: true }).waitFor();
    assert.equal(await page.locator('#edit-value').inputValue(), '草稿介紹');
    snapshot = { ...snapshot, revision: 2, intro: '別人新介紹' };
    await page.getByRole('button', { name: '讀取最新資料並保留草稿' }).click();
    await page.getByText('已讀取最新資料，草稿保留；請重新預覽改前／改後。', { exact: true }).waitFor();
    assert.equal(await page.locator('#edit-value').inputValue(), '草稿介紹');
    assert.equal(await page.getByRole('button', { name: '確認儲存這一項' }).isDisabled(), true);
    conflict = false;
    fail = true;
    await page.getByRole('button', { name: '預覽改前／改後' }).click();
    await page.getByRole('button', { name: '確認儲存這一項' }).click();
    await page.getByText('暫時無法儲存，草稿保留', { exact: true }).waitFor();
    assert.equal(await page.locator('#edit-value').inputValue(), '草稿介紹');
    fail = false;
    await page.getByRole('button', { name: '預覽改前／改後' }).click();
    await page.getByRole('button', { name: '確認儲存這一項' }).click();
    await page.getByText('這一項已儲存，重新讀取確認完成。', { exact: true }).waitFor();
    assert.equal(snapshot.intro, '草稿介紹');
    await page.locator('#edit-field').selectOption('sex');
    assert.match(await page.locator('#dog-editor').textContent(), /遷移時試算表差異：母/);
    await page.locator('#edit-value').selectOption('');
    await page.getByRole('button', { name: '預覽改前／改後' }).click();
    fs.mkdirSync(path.join(__dirname, '../.scratch/566-evidence'), { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({
        path: path.join(__dirname, `../.scratch/566-evidence/dog-editor-${width}.png`),
        fullPage: true
      });
    }
    assert.equal(writes, 3);
    assert.deepEqual(errors, []);
    console.log('#566 管理狗編輯：預覽、無差異、409／失敗保留草稿、讀最新後核對、儲存及390／1440px通過');
  } finally {
    await context.close();
  }
};
