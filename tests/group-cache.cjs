const assert = require('node:assert/strict');
const fixture = require('./fixtures/dogs.json');
module.exports = async (browser, base) => {
  const data = structuredClone(fixture);
  data.groupColumns = [{ column: 4, label: '測試群', names: data.dogs.slice(0, 2).map(d => d.name) }];
  let reads = 0;
  let hold = false, fail = false, partial = false, release;
  const writes = [];
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    localStorage.setItem('bq-onboarded', '1'); localStorage.setItem('bq-name-later', '1');
    localStorage.setItem('bq-walker-name', '測試志工');
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (!url.pathname.includes('/api/')) return route.continue();
    const endpoint = url.pathname.split('/api/')[1];
    if (endpoint === 'walk' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); writes.push(body);
      return route.fulfill({ json: { ok: true, today: '2026-10-20', results: body.dogs.map((d, i) => ({ ...d, status: partial && i === 0 ? 'unknown' : 'written', prev: {}, wrote: { date: '2026-10-20', walker: body.walker } })) } });
    }
    if (endpoint === 'groups' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      const group = data.groupColumns.find(g => g.column === body.column);
      group.names.push(body.name);
      return route.fulfill({ json: { ok: true, group } });
    }
    if (endpoint === 'dogs') {
      reads++;
      const snapshot = structuredClone(data);
      if (hold) await new Promise(resolve => { release = resolve; });
      if (fail) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: snapshot });
    }
    return route.fulfill({ json: endpoint === 'dogs' ? data : endpoint === 'rest' ? { rest: {} } : { ok: true, walks: [], departures: [] } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  await page.clock.install({ time: new Date('2026-10-20T02:00:00Z') });
  try {
    await page.goto(base + '/public/index.html');
    await page.locator('#main .card').first().waitFor();
    await page.locator('[data-tab="groups"]').click();
    await page.locator('#groupStage').waitFor();
    assert.equal(reads, 1, '第一次切進狗群共用首頁的資料，不重複讀取');
    await page.locator('[data-tab="walk"]').click();
    await page.clock.runFor(61000);
    hold = true;
    await page.locator('[data-tab="groups"]').click();
    await page.locator('#gwSource').filter({ hasText: '檢查中' }).waitFor();
    assert.equal(await page.locator('.front [data-gw-dog]').count(), 2, '慢網重開保留已讀內容');
    assert.equal(reads, 2, '重開只送一次背景檢查');
    fail = true; hold = false; release();
    await page.getByRole('button', { name: '重新讀取', exact: true }).waitFor();
    assert.equal(await page.locator('.front [data-gw-dog]').count(), 2, '背景失敗保留已讀內容');
    fail = false;
    data.groupColumns[0].names = [data.dogs[1].name];
    await page.getByRole('button', { name: '重新讀取', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.front [data-gw-dog]').length === 1);
    assert.equal(reads, 3, '重試讀回其他手機更新的群');
    data.groupColumns[0].names = [data.dogs[0].name];
    await page.locator('#gwWalk').click();
    await page.getByText('狗群名單已變更，請確認後再登記', { exact: true }).waitFor();
    assert.equal(writes.length, 0, '名單改變時不把舊名單送出');
    await page.locator('#gwWalk').click();
    await page.getByText('已登記 1 隻', { exact: true }).waitFor();
    assert.deepEqual(writes[0].dogs.map(d => d.name), [data.dogs[0].name]);
    // 身分在登記前的讀取期間切換，不能把原本的操作寫到新身分。
    data.groupColumns[0].names = [data.dogs[1].name];
    await page.locator('[data-tab="walk"]').click();
    await page.clock.runFor(61000);
    await page.locator('[data-tab="groups"]').click();
    await page.locator('.front [data-gw-dog]').filter({ hasText: data.dogs[1].name }).waitFor();
    await page.locator('#gwWalk').filter({ hasText: '整群溜了' }).waitFor();
    hold = true;
    const checking = page.waitForRequest(r => r.url().endsWith('/api/dogs'));
    await page.locator('#gwWalk').click(); await checking;
    await page.evaluate(() => localStorage.setItem('bq-walker-name', '另一位志工'));
    hold = false; release();
    await page.getByText('登記名字已變更，請確認後再登記', { exact: true }).waitFor();
    assert.equal(writes.length, 1, '身分切換後不送出等待中的登記');
    fail = true;
    await page.locator('#gwWalk').click();
    await page.getByText('無法確認最新狗群，尚未登記，請重試', { exact: true }).waitFor();
    assert.equal(writes.length, 1, '離線或讀取失敗時不使用舊群登記');
    fail = false;
    data.groupColumns = [{ column: 4, label: '壞資料', names: [null] }];
    await page.getByRole('button', { name: '重新讀取', exact: true }).click();
    await page.locator('#gwSource').filter({ hasText: '檢查失敗' }).waitFor();
    assert.equal(await page.locator('.front [data-gw-dog]').count(), 1, '格式無效時保留可用內容');
    data.groupColumns = [{ column: 4, label: '測試群', names: [data.dogs[1].name] }];
    hold = true;
    await page.getByRole('button', { name: '重新讀取', exact: true }).click();
    await page.locator('#gwSource').filter({ hasText: '檢查中' }).waitFor();
    await page.clock.runFor(8100);
    await page.locator('#gwSource').filter({ hasText: '檢查失敗' }).waitFor();
    assert.equal(await page.locator('.front [data-gw-dog]').count(), 1, '逾時仍可看舊內容');
    hold = false; release();
    await page.getByRole('button', { name: '重新讀取', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#gwSource')?.textContent.includes('檢查中') && !document.querySelector('#gwSource')?.textContent.includes('檢查失敗'));
    await page.locator('[data-tab="walk"]').click();
    await page.clock.runFor(61000);
    hold = true;
    await page.locator('[data-tab="groups"]').click();
    await page.locator('#gwSource').filter({ hasText: '檢查中' }).waitFor();
    await page.getByRole('button', { name: '加入狗', exact: true }).click();
    await page.locator('#gwForm input[name="name"]').fill(data.dogs[2].name);
    await page.getByRole('button', { name: '儲存', exact: true }).click();
    await page.getByText('狗群已更新', { exact: true }).waitFor();
    hold = false; release();
    await page.locator('#gwSource').filter({ hasText: '檢查失敗' }).waitFor();
    assert.equal(await page.locator('.front [data-gw-dog]').count(), 2, '寫入前開始的舊讀取不覆蓋修改後讀回的群');
    // 直接以狗群入口重開文件時，首頁與狗群也只共用一個進行中的請求。
    const reopened = await context.newPage();
    hold = true;
    const countBefore = reads;
    const initial = reopened.waitForRequest(r => r.url().endsWith('/api/dogs'));
    await reopened.goto(base + '/public/index.html#groups'); await initial;
    await reopened.getByText('狗群讀取中…', { exact: true }).waitFor();
    assert.equal(reads, countBefore + 1, '首次慢網開啟不另送重複請求');
    hold = false; release();
    await reopened.locator('#groupStage').waitFor();
    await reopened.close();
    if (process.env.BQ_SCREENSHOTS) {
      const fs = require('node:fs');
      fs.mkdirSync(process.env.BQ_SCREENSHOTS, { recursive: true });
      await page.getByRole('button', { name: '重新讀取', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('#gwSource')?.textContent.includes('檢查中'));
      for (const width of [320, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '提示不造成水平溢出');
        await page.screenshot({ path: `${process.env.BQ_SCREENSHOTS}/groups-${width}.png`, fullPage: true });
      }
    }
    await page.evaluate(() => { localStorage.removeItem('bq-sheet-writes'); localStorage.removeItem('bq-walked-today'); });
    await page.goto(base + '/public/index.html?retry#groups');
    await page.locator('#groupStage').waitFor();
    partial = true;
    await page.locator('#gwWalk').click();
    await page.getByText(/未全部登記成功/).waitFor();
    partial = false;
    const beforeRetry = writes.length;
    data.dogs[1].note = '禁止溜狗';
    await page.locator('[data-gw-action="retry-walk"]').click();
    await page.getByText('待重試的狗目前無法登記，請確認狗群狀態', { exact: true }).waitFor();
    assert.equal(writes.length, beforeRetry, '部分失敗重試也必須重新檢查狗的限制');
    data.dogs[1].note = '';
    const originalId = data.dogs[1].id;
    data.dogs[1].id = '20991231001';
    await page.locator('[data-gw-action="retry-walk"]').click();
    await page.getByText('待重試的狗目前無法登記，請確認狗群狀態', { exact: true }).waitFor();
    assert.equal(writes.length, beforeRetry, '同名換編號也不能重送舊狗');
    data.dogs[1].id = originalId;
    await page.locator('[data-gw-action="retry-walk"]').click();
    await page.getByText('已登記 2 隻', { exact: true }).waitFor();
    assert.deepEqual(writes.at(-1).dogs.map(d => d.name), [data.dogs[1].name], '安全重試只送先前失敗項目');
    console.log('#419 共用、背景檢查、舊名單／身分保護、逾時、修改競態與部分重試通過');
  } finally { await context.close(); }
};
