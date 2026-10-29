const assert = require('node:assert/strict');
const sample = require('./fixtures/dogs.json');

// #739 入所多久分布：照今天往回推編號，讓 11 根有空的、超過 5 隻的、10 年以上的（入所日都取月初再多退一個月，不踩滿年的邊界）
const STAY_YEARS = [0, 3, 3, 3, 3, 3, 3, 3, 8, 11, 12, 5];
const intakeId = (years, months) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - months - 1);
  d.setFullYear(d.getFullYear() - years);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}0101`;
};
const fixture = { ...sample, dogs: sample.dogs.map((d, i) => ({ ...d, id: intakeId(STAY_YEARS[i], i % 8), formerIds: undefined })) };

module.exports = async (browser, base) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    localStorage.setItem('bq-onboarded', '1');
    localStorage.setItem('bq-name-later', '1');
  });
  let failure = false;
  await context.route('**/*', route => {
    assert.equal(route.request().method() === 'GET' || route.request().method() === 'HEAD', true, '資訊流程不寫入');
    const u = new URL(route.request().url());
    if (u.origin !== base) return route.abort();
    if (!u.pathname.includes('/api/')) return route.continue();
    const endpoint = u.pathname.split('/api/')[1];
    if (failure && ['dogs', 'departures/index', 'edits', 'activities'].includes(endpoint)) return route.fulfill({ status: 503, json: { ok: false } });
    if (endpoint === 'feature-settings') return route.fulfill({ json: {ok:true,revision:1,values:Object.fromEntries(['showActivities','showQuality','showUpdates','editIntro','editPhoto','editRest','editActivity','editFixedCare','editStays','showShare'].map(k=>[k,true]))} });
    const json = endpoint === 'dogs' ? fixture : endpoint === 'edits' ? { ok: true, edits: [{ editorName: '志工甲', kind: 'group', at: '2026-10-17T00:00:00Z', before: { label: '舊群', names: ['小白'] }, after: { label: '新群', names: ['小黑'] } }] } : endpoint === 'departures/index' ? { departures: [], years: {} } : endpoint === 'activities' ? { ok: true, activities: [] } : { rest: {}, walkers: [], walks: [] };
    return route.fulfill({ json });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', e => console.error(e.message));
  try {
    await page.goto(base + '/public/index.html');
    await page.locator('#main .card').first().waitFor();
    await page.locator('[data-tab="info"]').click();
    assert.deepEqual(await page.locator('[data-info-page] strong').allTextContents(), ['在所統計', '離所紀錄', '活動紀錄', '資料檢查', '更新紀錄']);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      for (const key of ['stay', 'departures', 'activities', 'quality', 'updates']) {
        await page.locator('[data-info-page="' + key + '"]').click();
        assert(!/超過 \d+ 天沒溜|本月溜狗/.test(await page.locator('#main').innerText()));
        if (key === 'stay') {
          await page.getByRole('heading', { name: '入所多久分布', exact: true }).waitFor();
          // iPhone 內建字型沒有 ♂♀，文字符號會換字型而下沉（#93）；性別一律用 sexMark 的內嵌圖示
          assert(!/[♂♀]/.test(await page.locator('#main').innerText()), '在所統計不寫文字 ♂♀');
          assert.equal(await page.locator('.a-split .sex.male svg.icon, .a-split .sex.female svg.icon').count(), 2, '公母比例條用性別圖示');
          assert.equal(await page.locator('.a-sex-line .sex.male svg.icon, .a-sex-line .sex.female svg.icon').count(), 2, '公母平均在所用性別圖示');
        }
        if (key === 'departures') await page.getByText('還沒有離所紀錄', { exact: true }).waitFor();
        if (key === 'activities') await page.getByText('還沒有活動紀錄', { exact: true }).waitFor();
        if (key === 'quality') await page.getByRole('heading', { name: '狗的資料完整度', exact: true }).waitFor();
        if (key === 'updates') {
          assert.equal(await page.locator('[data-update-tab]').count(), 0, 'K 2026-10-28 更新紀錄只剩資料編輯，不分頁');
          const frame = page.frameLocator('#infoEdits');
          await frame.getByText('志工甲', { exact: true }).waitFor();
          assert((await frame.locator('#list').innerText()).includes('舊群'));
          assert((await frame.locator('#list').innerText()).includes('新群'));
          assert(!(await frame.locator('.hint').isVisible()), '#421 資料編輯不放說明文字');
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '頁面不橫向溢出');
        // 手機的「回資訊」在頁首；電腦版是左邊子頁清單、沒有回資訊，焦點留在清單選中的那一項（K 2026-10-29）
        if (width < 1100) {
          await page.locator('#analysisBack').click();
          await page.locator('[data-info-page="' + key + '"]').waitFor();
        } else assert.equal(await page.locator('#main [data-info-page="' + key + '"]').getAttribute('aria-current'), 'page', '電腦版清單標示目前子頁');
        assert(await page.locator('[data-info-page="' + key + '"]').evaluate(el => el === document.activeElement), '返回分類恢復焦點');
      }
    }
    // #739 入所多久分布：0～9 每年一格＋10+，點長條在下面列名單
    await page.setViewportSize({ width: 390, height: 844 });
    // 電腦版最後停在更新紀錄子頁，縮成手機後先回資訊
    await page.locator('#analysisBack').click();
    await page.locator('[data-info-page="stay"]').click();
    const bars = page.locator('[data-stay-bucket]');
    assert.deepEqual(await bars.locator('.a-col-l').allTextContents(), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10+'], '固定 11 根');
    const counts = (await bars.locator('.a-col-v').allTextContents()).map(Number);
    assert.deepEqual(counts, [1, 0, 0, 7, 0, 1, 0, 0, 1, 0, 2]);
    assert.equal(counts.reduce((s, n) => s + n, 0), sample.dogs.length, '隻數加總＝有入所日的狗');
    await page.getByText('單位：滿幾年（0＝未滿 1 年）', { exact: true }).waitFor();
    await page.getByText('點長條看是哪些狗', { exact: true }).waitFor();
    assert.equal(await page.locator('#main .a-h-icon, #main .a-hero-title .icon').count(), 0, '在所統計沒有標題圖示');
    assert.equal(await page.locator('#analysisBack').evaluate(el => getComputedStyle(el).boxShadow), 'none', '回資訊沒有外框');
    assert.equal(await page.locator('.a-pick').count(), 0, '一開始不列名單');
    assert(await page.getByRole('button', { name: '滿 1 年，0 隻', exact: true }).isDisabled(), '0 隻的長條不能選');
    const three = page.getByRole('button', { name: '滿 3 年，7 隻', exact: true });
    assert.equal(await three.getAttribute('aria-pressed'), 'false');
    await three.focus();
    await page.keyboard.press('Enter');
    const pick = page.locator('.a-pick');
    await pick.waitFor();
    assert.equal(await page.getByRole('button', { name: '滿 3 年，7 隻', exact: true }).getAttribute('aria-pressed'), 'true', '鍵盤選得到');
    assert.equal((await pick.locator('h3').innerText()).replace(/\s+/g, ' '), '滿 3 年 7 隻 · 久的排前面');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390px 選了長條也不橫向溢出');
    const pickNames = () => pick.locator('.a-dog-name').allTextContents();
    assert.deepEqual(await pickNames(), ['測試狗8', '測試狗7', '測試狗6', '測試狗5', '測試狗4'], '先列 5 隻、久的排前面');
    await pick.getByRole('button', { name: '看全部 7 隻', exact: true }).click();
    assert.deepEqual(await pickNames(), ['測試狗8', '測試狗7', '測試狗6', '測試狗5', '測試狗4', '測試狗3', '測試狗2']);
    await page.getByRole('button', { name: '滿 3 年，7 隻', exact: true }).click();
    assert.equal(await pick.count(), 0, '再點同一根收起');
    await page.getByRole('button', { name: '滿 10 年以上，2 隻', exact: true }).click();
    assert.equal((await pick.locator('h3').innerText()).replace(/\s+/g, ' '), '10 年以上 2 隻 · 久的排前面');
    assert.deepEqual(await pickNames(), ['測試狗11', '測試狗10']);
    assert.equal(await pick.getByRole('button', { name: /看全部/ }).count(), 0, '5 隻以內不放看全部');
    await pick.locator('.a-dog').first().click();
    await page.waitForFunction(() => document.documentElement.classList.contains('detail-open'));
    assert.equal(await page.locator('#detailName').innerText(), '測試狗11', '點狗名開詳細資訊');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.documentElement.classList.contains('detail-open'));
    await pick.getByRole('button', { name: '收起', exact: true }).click();
    assert.equal(await pick.count(), 0, '收起');
    await page.setViewportSize({ width: 320, height: 844 });
    await page.getByRole('button', { name: '滿 5 年，1 隻', exact: true }).click();
    const widths = await bars.evaluateAll(els => els.map(el => el.getBoundingClientRect().width));
    assert(Math.min(...widths) >= 24, `整欄點擊範圍至少 24px（${Math.min(...widths).toFixed(1)}）`);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '320px 選了長條也不橫向溢出');
    await page.locator('#analysisBack').click();
    await page.locator('[data-info-page="stay"]').click();
    await page.goBack();
    await page.locator('[data-info-page="stay"]').waitFor();
    await page.goForward();
    await page.getByRole('heading', { name: '入所多久分布', exact: true }).waitFor();
    await page.locator('[data-tab="mine"]').click();
    assert.equal(await page.locator('#main [data-open-guide]').count(), 0, '#447 我溜過的頁不再有使用說明');
    await page.locator('[data-tab="info"]').click();
    await page.locator('[data-open-guide]').filter({ hasText: '使用說明' }).click();
    await page.locator('.tour-tip').waitFor();
    assert.equal(await page.locator('#tabs [data-tab="walk"]').getAttribute('aria-current'), 'page', '使用說明回到溜狗表看導覽');
    await page.locator('.tour-skip').click();
    await page.locator('[data-tab="info"]').click();
    await page.locator('[data-info-page="stay"]').waitFor();
    await page.locator('[data-info-page="stay"]').click();
    await page.locator('#analysisBack').click();
    await page.locator('[data-info-page="stay"]').waitFor();
    failure = true;
    await page.reload();
    await page.locator('[data-tab="info"]').click();
    await page.getByText('在所資料讀取失敗', { exact: true }).waitFor();
    await page.getByText('離所紀錄讀取失敗', { exact: true }).waitFor();
    await page.getByText('活動紀錄讀取失敗', { exact: true }).waitFor();
    await page.locator('[data-info-page="updates"]').click();
    const staleFrame = page.frameLocator('#infoEdits');
    await staleFrame.getByText('志工甲', { exact: true }).waitFor();
    await staleFrame.getByText('暫時讀不到最新編輯紀錄，以下是上次讀到的', { exact: true }).waitFor();
    console.log('#273 資訊分類、內容、更新與編輯紀錄、返回焦點及320／390／桌機通過（活動 #270）');
  } finally { await context.close(); }
};
