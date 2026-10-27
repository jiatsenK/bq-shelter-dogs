const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// #671 管理網站修改紀錄：勾選隱藏測試紀錄，只存瀏覽器（localStorage）；顯示已隱藏時仍可取消合併。API 全部是假回應。
module.exports = async (browser, base) => {
  const { ADMIN_CSP } = await import('../worker/src/admin/index.js');
  const A = 'a'.repeat(32), M = 'e'.repeat(32);
  const edits = [
    { id: 101, at: '2026-10-25T01:00:00.000Z', kind: 'sex', kindLabel: '性別補正', source: 'access', editorName: '測試者', dogId: A, dogNumber: '2026010101', dogName: '阿福', before: '', after: 'male' },
    { id: 102, at: '2026-10-25T02:00:00.000Z', kind: 'merge', kindLabel: '合併', source: 'access', editorName: '測試者', dogId: M, dogNumber: '2026010102', dogName: '米香', before: { name: '米香二號' }, after: { name: '米香' } },
    { id: 103, at: '2026-10-26T01:00:00.000Z', kind: 'sex', kindLabel: '性別補正', source: 'volunteer', editorName: '小明', dogId: A, dogNumber: '2026010101', dogName: '阿福', before: 'male', after: 'female' },
  ];
  const unmerges = [];
  const route = async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/admin/public/updates.html') return route.fulfill({ body: fs.readFileSync(path.join(__dirname, '../admin/public/updates.html')), headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': ADMIN_CSP } });
    if (url.pathname === '/api/manage/settings') return route.fulfill({ json: { revision: 1, values: { showUpdates: true } } });
    if (url.pathname === '/api/manage/edits') return route.fulfill({ json: { next: null, pageSize: 25, kinds: [], edits } });
    if (url.pathname === `/api/manage/dogs/${M}`) return route.fulfill({ json: { dogId: M, revision: 4 } });
    if (url.pathname === `/api/manage/dogs/${M}/unmerge`) { unmerges.push(req.postDataJSON()); return route.fulfill({ json: { ok: true } }); }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 500, json: { error: '測試沒預期的請求' } });
    return route.continue();
  };
  const open = async init => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
    if (init) await context.addInitScript(init);
    await context.route('**/*', route);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    return { context, page, errors };
  };
  const rows = page => page.locator('#edits tr');
  const ready = page => page.waitForFunction(() => !document.getElementById('status').textContent.startsWith('正在'));
  const pick = (page, when) => page.locator('#edits tr', { hasText: when }).locator('.select-cell input').check();

  const { context, page, errors } = await open();
  try {
    await page.goto(`${base}/admin/public/updates.html`);
    await ready(page);
    assert.equal(await rows(page).count(), 3);
    assert.equal(await page.locator('#edits .select-cell input[type="checkbox"]').count(), 3, '每一列有勾選框');
    assert.equal(await page.locator('#hide-selected').isDisabled(), true, '沒勾就不能隱藏');

    // 勾兩筆（含合併那筆）隱藏
    await pick(page, '2026/10/25 09:00');
    await pick(page, '2026/10/25 10:00');
    assert.equal(await page.locator('#hide-selected').textContent(), '隱藏所選（2 筆）');
    await page.locator('#hide-selected').click();
    assert.equal(await rows(page).count(), 1);
    assert.match(await page.locator('#edits').textContent(), /2026\/10\/26 09:00/);
    assert.match(await page.locator('#status').textContent(), /這頁藏了 2 筆/);
    assert.match(await page.locator('#hide-note').textContent(), /已隱藏 2 筆，只記在這台電腦的瀏覽器/);
    assert.equal(await page.locator('#show-hidden-label').textContent(), '顯示已隱藏（2 筆）');
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('bq-admin-hidden-edits'))).sort(), [101, 102]);

    // 重新整理還是藏著
    await page.reload();
    await ready(page);
    assert.equal(await rows(page).count(), 1, '重新整理後仍隱藏');

    // 顯示已隱藏：出現並標示「已隱藏」，合併那筆仍可取消合併
    await page.locator('#show-hidden').check();
    assert.equal(await rows(page).count(), 3);
    assert.equal(await page.locator('#edits tr[data-hidden] .state-label', { hasText: '已隱藏' }).count(), 2);
    assert.equal(await page.locator('#unhide-selected').isVisible(), true);
    const merge = page.locator('#edits tr', { hasText: '2026/10/25 10:00' });
    await merge.getByRole('button', { name: '取消合併' }).click();
    const reloaded = page.waitForResponse(r => r.url().endsWith('/api/manage/edits'));
    await merge.getByRole('button', { name: /確定取消：拆回「米香二號」/ }).click();
    await reloaded;
    await ready(page);
    assert.deepEqual(unmerges, [{ logId: 102, revision: 4 }], '被隱藏的合併紀錄照常取消合併');
    assert.equal(await rows(page).count(), 3, '取消合併後重讀，仍顯示已隱藏');

    // 取消隱藏：全選這頁只會取消被藏的兩筆
    await page.locator('#select-page').check();
    assert.equal(await page.locator('#unhide-selected').textContent(), '取消隱藏所選（2 筆）');
    assert.equal(await page.locator('#hide-selected').textContent(), '隱藏所選（1 筆）');
    await page.locator('#unhide-selected').click();
    assert.equal(await page.locator('#edits tr[data-hidden]').count(), 0);
    await page.locator('#show-hidden').uncheck();
    assert.equal(await rows(page).count(), 3, '取消隱藏後恢復正常');
    assert.equal(await page.evaluate(() => localStorage.getItem('bq-admin-hidden-edits')), '[]');

    // 一整頁都藏起來時說明怎麼找回
    await page.locator('#select-page').check();
    await page.locator('#hide-selected').click();
    assert.equal(await page.locator('#table-region').isHidden(), true);
    assert.match(await page.locator('#status').textContent(), /這一頁的紀錄都已隱藏/);
    assert.equal(await page.locator('#hide-bar').isVisible(), true);

    // 手機寬度不讓整頁橫向溢出；截圖留給人眼檢查
    await page.locator('#show-hidden').check();
    const shots = path.join(__dirname, '../.impeccable/review');
    fs.mkdirSync(shots, { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width > 400 ? 1000 : 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px 不溢出`);
      await page.screenshot({ path: path.join(shots, `671-updates-hidden-${width}.png`), fullPage: true });
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }

  // 瀏覽器儲存不能用：頁面照常顯示、可以隱藏，只是記不住
  const blocked = await open(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  try {
    await blocked.page.goto(`${base}/admin/public/updates.html`);
    await ready(blocked.page);
    assert.equal(await rows(blocked.page).count(), 3, '儲存不能用時照常顯示');
    assert.match(await blocked.page.locator('#hide-note').textContent(), /記不住隱藏/);
    await pick(blocked.page, '2026/10/26 09:00');
    await blocked.page.locator('#hide-selected').click();
    assert.equal(await rows(blocked.page).count(), 2);
    assert.match(await blocked.page.locator('#hide-note').textContent(), /已隱藏 1 筆，這個瀏覽器記不住/);
    await blocked.page.reload();
    await ready(blocked.page);
    assert.equal(await rows(blocked.page).count(), 3, '重新整理後恢復（記不住）');
    assert.deepEqual(blocked.errors, []);
  } finally {
    await blocked.context.close();
  }
  console.log('admin-hide-edits：勾選隱藏、重新整理仍隱藏、顯示已隱藏與取消合併、儲存不能用 全部通過');
};
