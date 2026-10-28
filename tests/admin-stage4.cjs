const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// #567 管理網站第 4 階段：活動紀錄、待補清單（原資料檢查）、修改紀錄、網站更新（#624 從更新紀錄拆出）。API 全部用隔離的假回應，不碰正式資料。
module.exports = async (browser, base) => {
  const { ADMIN_CSP } = await import('../worker/src/admin/index.js');
  const RELEASES_URL = 'https://api.github.com/repos/jiatsenK/bq-shelter-dogs/releases?per_page=30';
  const releases = [
    { tag_name: 'v9.3.0', html_url: 'https://github.com/o/r/releases/tag/v9.3.0', draft: false, prerelease: false, published_at: '2026-10-22T08:53:10Z',
      body: '## [9.3.0](https://github.com/o/r/compare/v9.2.1...v9.3.0) (2026-10-22)\n\n\n### 新功能\n\n* 名單修改與復原先存 D1 ([#457](https://github.com/o/r/issues/457)) ([a8edd13](https://github.com/o/r/commit/a8edd13))\n\n### 修正\n\n* 狗群換群箭頭固定位置 ([#443](https://github.com/o/r/issues/443))\n' },
    { tag_name: 'v9.2.1', html_url: 'https://github.com/o/r/releases/tag/v9.2.1', draft: false, prerelease: false, published_at: '2026-10-22T08:51:08Z', body: '' },
    { tag_name: 'v9.4.0', html_url: 'https://github.com/o/r/releases/tag/v9.4.0', draft: true, prerelease: false, published_at: null, body: '' },
  ];
  let releasesCode = 200;
  const A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'c'.repeat(32), D = 'd'.repeat(32);
  const dogs = [
    { dogId: A, number: '2026010101', name: '阿福', cage: 'A1', note: '', intro: '親人', sex: 'male', onMain: true, status: 'main', formerNumber: '', departure: null, fixedCare: false, rest: null, photoUrl: null, walkedDate: '2026-10-01' },
    { dogId: B, number: '', name: '小黑', cage: 'B2', note: '', intro: '', sex: '', onMain: true, status: 'main', formerNumber: '', departure: null, fixedCare: false, rest: null, photoUrl: null, walkedDate: '' },
  ];
  let activities = [
    { id: D, date: '2026-10-04', kind: 'adoption', revision: 1, dogs: [{ dogId: A, number: '2026010101', name: '阿福' }] },
    { id: C, date: '2026-09-06', kind: 'kids', revision: 3, dogs: [{ dogId: null, number: '', name: '舊名單小白' }, { dogId: A, number: '2026010101', name: '阿福' }] },
  ];
  const writes = [], editQueries = [];
  let conflictNext = false, checksCode = 200, dogsCode = 200;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
  await context.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(`${event.effectiveDirective}: ${event.blockedURI}`));
  });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (req.url() === RELEASES_URL) return route.fulfill({ status: releasesCode, headers: { 'Access-Control-Allow-Origin': '*' }, json: releasesCode === 200 ? releases : { message: 'API rate limit exceeded' } });
    if (url.origin !== base) return route.abort();
    const page = url.pathname.match(/^\/admin\/public\/(activities|checks|updates|releases)\.html$/);
    if (page) return route.fulfill({ body: fs.readFileSync(path.join(__dirname, `../admin/public/${page[1]}.html`)), headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': ADMIN_CSP } });
    if (url.pathname === '/api/manage/links') return route.fulfill({ json: { site: 'https://site.example.org/', testSite: 'https://test.example.org/', sheet: 'https://docs.google.com/spreadsheets/d/abc/edit', testSheet: 'https://docs.google.com/spreadsheets/d/xyz/edit', gas: 'https://script.google.com/macros/s/abc/exec', testGas: null } });
    if (url.pathname === '/api/manage/settings') return route.fulfill({ json: { revision: 2, values: { showActivities: false, showQuality: true, showUpdates: true, editActivity: true } } });
    if (url.pathname === '/api/manage/dogs') return route.fulfill({ status: dogsCode, json: dogsCode === 200 ? { dogs } : { error: '狗資料暫時讀不到' } });
    if (url.pathname === '/api/manage/data-checks') return route.fulfill({ status: checksCode, json: checksCode === 200 ? { sheetGaps: { state: 'ok', recordedAt: '2026-10-24T01:43:00.000Z', checkedAt: '2026-10-24T15:53:00.000Z', stale: true, total: 2, items: [
      { sheet: 'main', key: 'main:2026010202', number: '2026010202', name: '小花', dogId: 'e'.repeat(32), cage: 'C3' },
      { sheet: 'departed', key: 'departed:名:無名', number: '', name: '無名', dogId: null, cage: '' },
    ] } } : { error: '管理資料暫時無法讀取，請稍後重試' } });
    if (url.pathname === '/api/manage/cron-status') return route.fulfill({ status: checksCode, json: checksCode === 200 ? { jobs: [
      { job: 'retry', state: 'ok', okAt: '2026-10-26T05:45:00.000Z', failAt: null, error: '', stale: false },
      { job: 'scan', state: 'ok', okAt: '2026-10-25T15:53:00.000Z', failAt: '2026-10-26T01:53:00.000Z', error: '主清單直接讀回失敗', stale: false },
      { job: 'trash', state: 'never', okAt: null, failAt: null, error: '', stale: true },
    ] } : { error: '管理資料暫時無法讀取，請稍後重試' } });
    if (url.pathname === '/api/manage/edits') {
      editQueries.push(url.search);
      const size = Number(url.searchParams.get('size') || 25);
      return route.fulfill({ json: { next: url.searchParams.get('cursor') ? null : 77, pageSize: size, kinds: [{ value: 'activity', label: '活動紀錄' }, { value: 'sex', label: '性別補正' }],
        edits: [{ id: 99, at: '2026-10-20T01:00:00.000Z', kind: 'sex', kindLabel: '性別補正', source: 'access', editorName: '管理者', dogId: A, dogNumber: '2026010101', dogName: '阿福', before: '', after: 'male', actorEmail: 'manager@example.org' },
          { id: 98, at: '2026-10-19T01:00:00.000Z', kind: 'activity', kindLabel: '活動紀錄', source: 'volunteer', editorName: '小明', dogId: null, dogNumber: '', dogName: '', before: null, after: { date: '2026-10-04', kind: 'adoption', dogs: ['阿福'] } }] } });
    }
    const act = url.pathname.match(/^\/api\/manage\/activities(?:\/([a-f0-9]{32}))?$/);
    if (act) {
      if (req.method() === 'GET') return route.fulfill({ json: { activities } });
      const body = req.postDataJSON();
      writes.push({ method: req.method(), id: act[1], body });
      if (conflictNext) { conflictNext = false; activities = activities.map(a => (a.id === act[1] ? { ...a, revision: a.revision + 1 } : a)); return route.fulfill({ status: 409, json: { error: '這場活動剛被別人改過，請重新整理後再改' } }); }
      if (req.method() === 'DELETE') { activities = activities.filter(a => a.id !== act[1]); return route.fulfill({ json: { deleted: act[1] } }); }
      const named = body.dogs.map(d => (d.dogId ? { dogId: d.dogId, number: dogs.find(x => x.dogId === d.dogId).number, name: dogs.find(x => x.dogId === d.dogId).name } : { dogId: null, number: '', name: d.name }));
      const saved = { id: act[1] || 'f'.repeat(32), date: body.date, kind: body.kind, revision: act[1] ? body.revision + 1 : 1, dogs: named };
      activities = [saved, ...activities.filter(a => a.id !== saved.id)];
      return route.fulfill({ json: { activity: saved } });
    }
    return route.continue();
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const status = id => page.locator(`#${id}`).textContent();
  try {
    // 活動紀錄
    await page.goto(`${base}/admin/public/activities.html`);
    await page.waitForFunction(() => !document.getElementById('new-activity').disabled);
    assert.equal(await page.locator('#activities tr').count(), 2);
    assert.match(await status('status'), /共 2 場；1 筆出席只有名字（未對應）/);
    assert.equal(await page.locator('#activities .state-label', { hasText: '未對應' }).count(), 1);
    await page.getByText('活動紀錄已隱藏', { exact: false }).waitFor();
    assert.equal(await page.locator('#volunteer-state').getAttribute('href'), './settings.html', '#624 開關標記連到志工網站設定');
    assert.equal(await page.locator('.source-note#volunteer-state').count(), 0, '#624 開關狀態不再用說明樣式');
    await page.locator('#kind').selectOption('kids');
    assert.equal(await page.locator('#activities tr').count(), 1);
    await page.locator('#clear').click();
    await page.waitForFunction(() => document.querySelectorAll('#activities tr').length === 2);

    await page.locator('#new-activity').click();
    await page.locator('#activity-date').fill('2026-10-18');
    await page.locator('#activity-kind').selectOption('adoption');
    await page.locator('#dog-input').fill('小');
    await page.locator('#add-dog').click();
    assert.match(await status('dog-hint'), /對不上狗/);
    await page.locator('#dog-input').fill('2026010101 阿福');
    await page.locator('#dog-input').press('Enter');
    assert.match(await status('diff-after'), /2026-10-18 認養會：阿福/);
    await page.locator('#save-activity').click();
    await page.getByText('已儲存（第 1 版）', { exact: false }).waitFor();
    assert.deepEqual(writes.at(-1), { method: 'POST', id: undefined, body: { date: '2026-10-18', kind: 'adoption', dogs: [{ dogId: A }] } });
    assert.equal(await page.locator('#activities tr').count(), 3);

    await page.locator(`[data-edit="${C}"]`).click();
    assert.equal(await page.locator('#save-activity').isDisabled(), true, '沒改不能存');
    await page.locator('[data-remove="1"]').click();
    assert.match(await status('diff-before'), /舊名單小白（未對應）、阿福/);
    assert.equal(await status('diff-after'), '2026-09-06 動保小小兵：舊名單小白（未對應）');
    conflictNext = true;
    await page.locator('#save-activity').click();
    await page.getByText('請按「重新讀取」取得最新版本', { exact: false }).waitFor();
    assert.equal(await page.locator('#save-activity').isDisabled(), true, '衝突後要先重新讀取');
    await page.locator('#reload').click();
    await page.getByText('已取得最新版本（第 4 版），草稿保留', { exact: false }).waitFor();
    assert.equal(await page.locator('#activity-dogs li').count(), 1, '草稿保留');
    await page.locator('#save-activity').click();
    await page.getByText('已儲存（第 5 版）', { exact: false }).waitFor();
    assert.deepEqual(writes.at(-1).body, { revision: 4, date: '2026-09-06', kind: 'kids', dogs: [{ name: '舊名單小白' }] }, '未對應名字原樣送出');

    await page.locator('#delete-activity').click();
    await page.locator('#confirm-delete').click();
    await page.getByText('已刪除 2026-09-06 動保小小兵', { exact: false }).waitFor();
    assert.deepEqual(writes.at(-1), { method: 'DELETE', id: C, body: { revision: 5 } });
    assert.equal(await page.locator('#activity-editor').isHidden(), true);

    // 待補清單
    await page.goto(`${base}/admin/public/checks.html`);
    await page.getByText('共 2 筆', { exact: false }).waitFor();
    assert.match(await status('gap-status'), /已過期/);
    assert.match(await status('gap-status'), /最後掃描 2026\/10\/24 23:53/);
    assert.equal(await page.locator('#gaps tr').count(), 2);
    assert.match(await page.locator('#gaps').textContent(), /D1 已找不到這筆/);
    await page.getByText('主清單上共 2 隻', { exact: false }).waitFor();
    assert.match(await page.locator('#complete-list').textContent(), /缺編號1 隻/);
    assert.match(await page.locator('#complete-list').textContent(), /缺照片2 隻/);
    assert.match(await page.locator('#complete-list').textContent(), /缺介紹還沒寫狗自己的介紹/, 'ADR 0022：缺介紹的意思寫出來');
    // #624 項目連到已篩選的狗資料表，狗名直接開抽屜
    await page.locator('#complete-list summary', { hasText: '缺編號' }).click();
    assert.equal(await page.getByRole('link', { name: '在狗資料表看這 1 隻' }).getAttribute('href'), './?care=missingNumber');
    assert.equal(await page.getByRole('link', { name: '小黑', exact: true }).first().getAttribute('href'), `./?care=missingNumber&dog=${B}`);
    await page.getByText('1 件排程需要注意', { exact: false }).waitFor();
    assert.equal(await page.locator('#cron-jobs tr').count(), 3);
    assert.match(await page.locator('#cron-jobs').textContent(), /2026\/10\/26 13:45/);
    assert.match(await page.locator('#cron-jobs').textContent(), /2026\/10\/26 09:53 失敗：主清單直接讀回失敗/);
    checksCode = 503; dogsCode = 503;
    await page.locator('#reload').click();
    await page.getByText('這不代表沒有差異', { exact: false }).waitFor();
    await page.getByText('不代表沒有缺漏', { exact: false }).waitFor();
    await page.getByText('這不代表排程有在跑', { exact: false }).waitFor();
    assert.equal(await page.locator('#cron-region').isHidden(), true);
    assert.equal(await page.locator('#gap-region').isHidden(), true);
    checksCode = 200; dogsCode = 200;

    // 修改紀錄
    await page.goto(`${base}/admin/public/updates.html`);
    await page.getByText('搜尋範圍是全部紀錄', { exact: false }).waitFor();
    assert.equal(editQueries.at(-1), '');
    assert.match(await page.locator('#edits').textContent(), /manager@example\.org/);
    assert.match(await page.locator('#edits').textContent(), /2026\/10\/20 09:00/);
    assert.match(await page.locator('#edits').textContent(), /2026-10-04 認養會：阿福/);
    assert.equal(await page.locator('#kind option').count(), 3);
    await page.locator('#next').click();
    await page.waitForFunction(() => document.getElementById('page-number').textContent === '第 2 頁');
    assert.equal(editQueries.at(-1), '?cursor=77');
    assert.equal(await page.locator('#next').isDisabled(), true, '伺服器說沒有下一頁');
    await page.locator('#previous').click();
    await page.waitForFunction(() => document.getElementById('page-number').textContent === '第 1 頁');
    assert.equal(editQueries.at(-1), '');
    await page.locator('#next').click();
    await page.waitForFunction(() => document.getElementById('page-number').textContent === '第 2 頁');
    await page.locator('#kind').selectOption('sex');
    await page.waitForFunction(() => document.getElementById('page-number').textContent === '第 1 頁');
    assert.equal(editQueries.at(-1), '?kind=sex', '換條件回第一頁');
    const typed = page.waitForRequest(r => r.url().includes('/api/manage/edits?q='));
    await page.locator('#q').fill('阿福');
    await typed;
    await page.waitForFunction(() => !document.getElementById('status').textContent.startsWith('正在'));
    assert.equal(editQueries.at(-1), '?q=%E9%98%BF%E7%A6%8F&kind=sex');
    await page.locator('#page-size').selectOption('50');
    await page.waitForFunction(() => !document.getElementById('status').textContent.startsWith('正在'));
    assert.equal(editQueries.at(-1), '?q=%E9%98%BF%E7%A6%8F&kind=sex&size=50');
    assert.equal(await page.locator('#releases').count(), 0, '#624 網站更新拆到另一頁');

    // 網站更新
    await page.goto(`${base}/admin/public/releases.html`);
    await page.waitForFunction(() => document.querySelectorAll('#releases > li').length === 2);
    assert.deepEqual(await page.locator('#releases > li > time').allTextContents(), ['v9.3.0 · 2026-10-22', 'v9.2.1 · 2026-10-22'], '草稿不列，日期是台灣日期');
    assert.deepEqual(await page.locator('#releases > li').first().locator('ul li').allTextContents(), ['名單修改與復原先存 D1', '狗群換群箭頭固定位置'], '拿掉 PR／commit 連結');
    assert.equal(await page.locator('#releases > li').nth(1).locator('p').textContent(), '這版沒有列出改動。');
    assert.equal(await page.locator('#releases a[href="https://github.com/o/r/releases/tag/v9.3.0"][target="_blank"]').count(), 1);
    assert.equal(await page.locator('#volunteer-state').count(), 0, '志工網站不顯示網站更新，不放志工開關標記');
    releasesCode = 403;
    await page.locator('#reload').click();
    await page.getByText('GitHub 暫時限制讀取次數', { exact: false }).waitFor();
    releasesCode = 200;

    // 網站連結：正式版／測試版各一列，有網址就新分頁開，沒設定寫出要設哪個 Secret
    await page.goto(`${base}/admin/public/links.html`);
    await page.locator('#links tr').nth(1).waitFor();
    assert.deepEqual(await page.locator('#links th').allTextContents(), ['正式版', '測試版測試資料']);
    assert.equal(await page.locator('#links a[href="https://test.example.org/"][target="_blank"][rel="noopener noreferrer"]').count(), 1);
    assert.equal(await page.locator('#links a').count(), 5);
    assert.equal(await page.locator('#links td[data-label="試算表"] a[href="https://docs.google.com/spreadsheets/d/xyz/edit"]').count(), 1);
    await page.getByText('GitHub Secret TEST_GAS_URL').waitFor();
    assert.equal(await page.locator('#links-status').textContent(), '有 1 個網址還沒設定。');

    // 手機寬度不讓整頁橫向溢出；截圖留給人眼檢查
    const shots = path.join(__dirname, '../.impeccable/review');
    fs.mkdirSync(shots, { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width > 400 ? 1000 : 844 });
      for (const name of ['activities', 'checks', 'updates', 'releases', 'links']) {
        await page.goto(`${base}/admin/public/${name}.html`);
        await page.waitForLoadState('networkidle');
        if (name === 'activities') await page.locator('#activities [data-edit]').first().click();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} ${width}px 不溢出`);
        await page.screenshot({ path: path.join(shots, `567-${name}-${width}.png`), fullPage: true });
      }
    }
    assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
    assert.deepEqual(errors, []);
    console.log('#567／#624 活動／待補清單／修改紀錄／網站更新：增修刪、未對應保留、409 草稿、讀取失敗與過期、伺服器搜尋分頁、390／1440px通過');
  } finally {
    await context.close();
  }
};
