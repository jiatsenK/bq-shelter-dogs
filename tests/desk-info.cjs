// 電腦版資訊寬版（K 2026-10-29）：≥1100px 設定頁式，左邊子頁清單、右邊內容撐滿；進資訊直接打開第一個子頁、沒有「回資訊」；
// 在所統計 Top 10 是表格、看不出入所日期的狗名收起來；更新紀錄整頁不捲、只有 iframe 裡面捲。手機（390px）照舊是分類清單。
const assert = require('node:assert/strict');
const sample = require('./fixtures/dogs.json');

// 前 10 隻照今天往回推編號（有入所日），後面的編號看不出入所日期
const intakeId = years => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 2);
  d.setFullYear(d.getFullYear() - years);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}0101`;
};
const fixture = { ...sample, dogs: sample.dogs.map((d, i) => ({ ...d, formerIds: undefined, id: i < 10 ? intakeId(i) : `X${i}` })) };
const noIntake = fixture.dogs.length - 10;

module.exports = async (browser, base) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
  await context.addInitScript(() => {
    localStorage.setItem('bq-onboarded', '1');
    localStorage.setItem('bq-name-later', '1');
    localStorage.setItem('bq-walker-name', '甲');
  });
  const d1 = require('./fixtures/fake-d1-walks.cjs')({ today: () => '2026-10-21' });
  const edits = Array.from({ length: 30 }, (_, i) => ({ editorName: `志工${i}`, kind: 'group', at: '2026-10-17T00:00:00Z', before: { label: '舊群', names: ['小白'] }, after: { label: '新群', names: ['小黑'] } }));
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin !== base) return route.abort();
    if (!u.pathname.includes('/api/')) return route.continue();
    const endpoint = u.pathname.split('/api/')[1];
    if (endpoint === 'feature-settings') return route.fulfill({ json: { ok: true, revision: 1, values: Object.fromEntries(['showActivities', 'showQuality', 'showUpdates', 'editIntro', 'editPhoto', 'editRest', 'editActivity', 'editFixedCare', 'editStays', 'showShare'].map(k => [k, true])) } });
    const json = endpoint === 'dogs' ? fixture : endpoint === 'today' ? d1.pack() : endpoint === 'edits' ? { ok: true, edits } : endpoint === 'departures/index' ? { departures: [], years: {} }
      : endpoint === 'activities' ? { ok: true, activities: [] } : { rest: {}, walkers: [], walks: [] };
    return route.fulfill({ json });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const box = sel => page.locator(sel).evaluate(el => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; });
  const current = () => page.locator('#main .info-nav [aria-current="page"]').innerText();
  try {
    await page.goto(base + '/public/index.html');
    await page.locator('.desk-table').waitFor();
    await page.locator('#tabs [data-tab="info"]').click();

    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('#main .info-desk').waitFor();
      // 進資訊直接是第一個子頁：不先出分類大卡片，也沒有「回資訊」
      assert.equal(await current(), '在所統計', `${width}px 預設打開第一個子頁`);
      assert.equal(await page.locator('#main .info-home').count(), 0, `${width}px 沒有分類大卡片`);
      assert.equal(await page.locator('#analysisBack').isVisible(), false, `${width}px 沒有回資訊`);
      assert.equal(await page.locator('#main .info-title').innerText(), '在所統計');
      const desk = await box('#main .info-desk'), nav = await box('#main .info-nav'), body = await box('#main .info-body');
      assert.equal(desk.left, 24, `${width}px 左邊線 24`);
      assert(nav.width >= 200 && nav.width <= 220, `${width}px 子頁清單 200～220（${nav.width}）`);
      assert(body.left >= nav.right && Math.abs(body.top - nav.top) < 20, `${width}px 子頁清單與內容並排`);
      assert(body.width > 480, `${width}px 內容不卡 480（${body.width}）`);
      const rows = await page.locator('#main .info-nav :is(a, button)').evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().height)));
      assert(rows.every(h => h >= 38 && h <= 44), `${width}px 清單一列約 40px（${rows}）`);
      assert.deepEqual(await page.locator('#main .info-nav :is(a, button)').allInnerTexts(), ['在所統計', '離所紀錄', '活動紀錄', '資料檢查', '更新紀錄', '使用說明']);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px 沒有橫向捲動`);
    }

    // 在所統計：長條圖撐寬、Top 10 是表格、看不出入所日期的狗名收起來
    assert.equal(await page.locator('#main .a-table tbody tr').count(), 10, 'Top 10 表格');
    assert.deepEqual(await page.locator('#main .a-table thead th').allInnerTexts(), ['名次', '狗名', '籠位', '入所', '在所']);
    assert((await box('#main .a-dist .a-cols')).width > 900, '長條圖撐寬');
    assert.equal(await page.locator('#main .a-hero-note').innerText(), '入所日期取編號（含舊編號）前 8 碼和出入所紀錄裡最早的那天', '狗名不寫在說明裡');
    const names = page.locator('#main .a-noin');
    assert.equal(await names.locator('summary').innerText(), `${noIntake} 隻編號看不出入所日期，不列入時間統計`);
    assert.equal(await names.locator('p').isVisible(), false, '狗名先收起來');
    await names.locator('summary').click();
    assert.equal(await names.locator('p').innerText(), fixture.dogs.slice(10).map(d => d.name).join('、'), '展開列狗名');
    await page.locator('#main .a-table .a-t-dog').first().click();
    await page.waitForFunction(() => document.documentElement.classList.contains('detail-open'));
    assert.equal(await page.locator('#detailName').innerText(), fixture.dogs[9].name, '點 Top 10 狗名開詳細資訊');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.documentElement.classList.contains('detail-open'));

    // 換子頁：清單標示跟著換、焦點留在清單；返回回到上一個子頁
    for (const [key, title] of [['departures', '離所紀錄'], ['activities', '活動紀錄'], ['quality', '資料檢查']]) {
      await page.locator(`#main .info-nav [data-info-page="${key}"]`).click();
      await page.locator(`#main .info-nav [data-info-page="${key}"][aria-current="page"]`).waitFor();
      assert.equal(await page.locator('#main .info-title').innerText(), title);
      // 子頁清單是連結（ADR 0024）：資料讀完會再重畫一次，等畫面穩定再量焦點與寬度
      await page.waitForFunction(k => document.activeElement === document.querySelector(`#main [data-info-page="${k}"]`), key, { timeout: 3000 })
        .catch(() => assert.fail(`${title} 焦點留在清單`));
      await page.waitForFunction(() => document.querySelector('#main .info-body .a-card')?.getBoundingClientRect().width > 480, null, { timeout: 3000 })
        .catch(() => assert.fail(`${title} 不卡 480`));
    }
    await page.goBack();
    await page.locator('#main .info-nav [data-info-page="activities"][aria-current="page"]').waitFor();

    // 更新紀錄：iframe 填滿頁首以下，整頁不出現第二條捲軸
    await page.locator('#main .info-nav [data-info-page="updates"]').click();
    await page.frameLocator('#infoEdits').getByText('志工0', { exact: true }).waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), '更新紀錄整頁不捲');
    const frame = await box('#infoEdits');
    assert(frame.top + frame.height <= 900 && frame.height > 600, `iframe 在畫面內且夠高（${frame.top}+${frame.height}）`);

    // 縮成手機：照舊是頁首「回資訊」＋分類清單
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#analysisBack').waitFor();
    // 跨 1100px 會整頁重畫，CI 機器較慢：等重畫完再判斷
    await page.waitForFunction(() => !document.querySelector('#main .info-desk'), null, { timeout: 3000 })
      .catch(() => assert.fail('手機不用電腦版版面'));
    await page.locator('#infoEdits').waitFor();
    await page.locator('#analysisBack').click();
    await page.locator('#main .info-home [data-info-page="stay"]').waitFor();
    assert.equal(await page.locator('#main .info-nav').count(), 0, '手機沒有左邊清單');
    assert.deepEqual(errors, [], '沒有錯誤');
    console.log('電腦版資訊寬版：子頁清單、預設第一頁、Top 10 表格、狗名收起、更新紀錄不捲、手機照舊通過');
  } finally {
    await context.close();
  }
};
