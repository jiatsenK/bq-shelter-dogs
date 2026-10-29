// #270 活動紀錄：資訊 → 活動紀錄。每場標題下直接列出席的狗；選好名字後新增、修改、刪除，重新整理後仍正確；狗卡上沒有活動
const assert = require('node:assert/strict');

module.exports = async (browser, base) => {
  const data = structuredClone(require('./fixtures/dogs.json'));
  data.dogs = data.dogs.slice(0, 4);
  const departures = require('./fixtures/departures.json');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    localStorage.setItem('bq-onboarded', '1'); localStorage.setItem('bq-name-later', '1');
    if (!sessionStorage.getItem('test-no-name')) localStorage.setItem('bq-walker-name', '測試志工');
  });
  // 假的 Worker：跟 worker/src/activities.js 一樣的形狀，改、刪對 revision
  let acts = [{ id: 'a'.repeat(32), date: '2026-10-11', kind: 'adoption', revision: 1, dogs: [
    { dogId: 'd1', number: '2020010100', name: '測試狗1' }, { dogId: null, number: '', name: '舊名單阿福' }] }];
  let seq = 0, conflict = false;
  const writes = [];
  const resolve = dogs => dogs.map(d => d.name ? { dogId: null, number: '', name: d.name }
    : d.number ? { dogId: `id-${d.number}`, number: d.number, name: [...data.dogs, ...departures.departures].find(x => x.id === d.number).name }
      : acts.flatMap(a => a.dogs).find(x => x.dogId === d.dogId));
  await ctx.route('**/api/**', route => {
    const req = route.request(), endpoint = new URL(req.url()).pathname.split('/api/')[1];
    if (endpoint === 'activities' && req.method() === 'GET') return route.fulfill({ json: { ok: true, activities: acts } });
    if (endpoint.startsWith('activities')) {
      const body = req.postDataJSON(), id = endpoint.split('/')[1];
      writes.push({ method: req.method(), id, body });
      if (conflict) return route.fulfill({ status: 409, json: { ok: false, error: '這場活動剛被別人改過，請重新整理後再改' } });
      if (req.method() === 'POST') {
        const a = { id: String(++seq).padStart(32, 'b'), date: body.date, kind: body.kind, revision: 1, dogs: resolve(body.dogs) };
        acts = [...acts, a].sort((x, y) => y.date.localeCompare(x.date));
        return route.fulfill({ json: { ok: true, activity: a } });
      }
      const cur = acts.find(a => a.id === id);
      assert.equal(body.revision, cur.revision, '改、刪帶打開時的 revision');
      if (req.method() === 'DELETE') { acts = acts.filter(a => a.id !== id); return route.fulfill({ json: { ok: true, activity: null, deleted: id } }); }
      Object.assign(cur, { date: body.date, kind: body.kind, revision: cur.revision + 1, dogs: resolve(body.dogs) });
      return route.fulfill({ json: { ok: true, activity: cur } });
    }
    if (endpoint === 'departures/index') return route.fulfill({ json: { version: 1, years: { 2026: '1' }, dogs: departures.departures } });
    if (endpoint === 'dogs') return route.fulfill({ json: data });
    return route.fulfill({ json: endpoint === 'rest' ? { rest: {} } : { ok: true, source: 'd1', walks: [], walkers: [] } });
  });
  const page = await ctx.newPage(); page.setDefaultTimeout(6000);
  // 重開網頁：網址會記著資訊子頁與詳細資訊（ADR 0024），reload 會留在原畫面；這裡要的是重新打開網站
  const reopen = options => page.goto(page.url().split('#')[0], options);
  page.on('pageerror', e => console.error(e.message));
  const openActivities = async () => {
    await page.locator('[data-tab="info"]').click();
    await page.locator('[data-info-page="activities"]').click();
    await page.locator('#main').getByRole('heading', { name: '活動紀錄', exact: true }).waitFor();
  };
  const titles = () => page.locator('.act-item h3').allTextContents();
  try {
    await page.goto(`${base}/public/index.html`);
    await page.locator('#main .card').first().waitFor();
    await page.locator('[data-tab="info"]').click();
    assert.deepEqual(await page.locator('[data-info-page] strong').allTextContents(), ['在所統計', '離所紀錄', '活動紀錄', '資料檢查', '更新紀錄']);
    await page.getByText('共 1 場活動', { exact: true }).waitFor();
    await page.locator('[data-info-page="activities"]').click();
    // 標題下直接看得到出席的狗，不用點進場次；只有名字的也照樣顯示
    assert.deepEqual(await titles(), ['2026/10/11（日） 認養會']);
    assert.deepEqual(await page.locator('.act-item .act-dogs li').allTextContents(), ['測試狗1', '舊名單阿福（還沒對上狗）']);

    // 新增：就地展開、對焦日期；選在所和離所的狗，送編號
    await page.getByRole('button', { name: '＋ 新增活動' }).click();
    assert(await page.locator('#actDate').evaluate(el => el === document.activeElement), '打開新增時對焦日期');
    await page.locator('#actDate').fill('2026-10-18');
    await page.getByRole('button', { name: '動保小小兵', exact: true }).click();
    await page.locator('#actSearch').fill('測試狗2');
    await page.locator('.act-pick', { hasText: '2020010101' }).click();
    assert(await page.locator('#actSearch').evaluate(el => el === document.activeElement && el.value === ''), '選完狗回到搜尋框');
    await page.locator('#actSearch').fill('離所甲');
    await page.locator('.act-pick', { hasText: '已離所' }).click();
    await page.locator('#actSearch').fill('名單上沒有的狗');
    await page.getByRole('button', { name: /只記名字「名單上沒有的狗」/ }).click();
    assert.deepEqual(await page.locator('.act-chip').evaluateAll(els => els.map(e => e.firstChild.textContent)), ['測試狗2', '離所甲', '名單上沒有的狗']);
    await page.getByRole('button', { name: '拿掉 名單上沒有的狗' }).click();
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px 表單不橫向溢出`);
      // 一次量完：換寬度後畫面會重畫，先抓的按鈕可能已被換掉而量不到
      const small = await page.locator('.act-form').evaluate(form => [...form.querySelectorAll('button')]
        .filter(b => b.getClientRects().length)
        .filter(b => { const r = b.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(b => b.textContent));
      assert.deepEqual(small, [], `${width}px 按鈕至少 44×44`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '存好' }).click();
    await page.getByText('2026/10/18（日） 動保小小兵 已存好').waitFor();
    assert.deepEqual(writes.at(-1), { method: 'POST', id: undefined, body: { editor: '測試志工', date: '2026-10-18', kind: 'kids', dogs: [{ number: '2020010101' }, { number: '2018010101' }] } });
    assert.deepEqual(await titles(), ['2026/10/18（日） 動保小小兵', '2026/10/11（日） 認養會']);
    assert(await page.getByRole('button', { name: '＋ 新增活動' }).evaluate(el => el === document.activeElement), '存好後焦點回到新增');

    // 修改：只有名字的出席照樣送回去；帶 revision
    await page.getByRole('button', { name: '修改 2026/10/11（日） 認養會' }).click();
    await page.getByRole('button', { name: '拿掉 測試狗1' }).click();
    await page.locator('#actSearch').fill('測試狗3');
    await page.locator('.act-pick', { hasText: '測試狗3' }).click();
    await page.getByRole('button', { name: '存好' }).click();
    await page.getByText('2026/10/11（日） 認養會 已存好').waitFor();
    assert.deepEqual(writes.at(-1).body, { editor: '測試志工', revision: 1, date: '2026-10-11', kind: 'adoption', dogs: [{ name: '舊名單阿福' }, { number: '2020010102' }] });
    assert(await page.getByRole('button', { name: '修改 2026/10/11（日） 認養會' }).evaluate(el => el === document.activeElement), '存好後焦點回到修改');

    // 別人剛改過：顯示錯誤、不假裝成功，表單內容保留
    conflict = true;
    await page.getByRole('button', { name: '修改 2026/10/11（日） 認養會' }).click();
    await page.getByRole('button', { name: '存好' }).click();
    await page.getByRole('alert').filter({ hasText: '剛被別人改過' }).waitFor();
    conflict = false;
    await page.getByRole('button', { name: '取消' }).click();

    // 刪除要按兩次
    await page.getByRole('button', { name: '修改 2026/10/18（日） 動保小小兵' }).click();
    await page.getByRole('button', { name: '刪除這場' }).click();
    assert.equal(writes.filter(w => w.method === 'DELETE').length, 0, '第一次只是確認');
    await page.getByRole('button', { name: '確定刪除這場' }).click();
    await page.getByText('已刪除 2026/10/18（日） 動保小小兵').waitFor();
    assert.deepEqual(writes.at(-1), { method: 'DELETE', id: 'b'.repeat(31) + '1', body: { editor: '測試志工', revision: 1 } });

    // 重新整理後仍正確（從伺服器讀）
    await reopen();
    await openActivities();
    assert.deepEqual(await titles(), ['2026/10/11（日） 認養會']);
    assert.deepEqual(await page.locator('.act-item .act-dogs li').allTextContents(), ['舊名單阿福（還沒對上狗）', '測試狗3']);

    // 狗卡上沒有活動資訊
    await page.locator('[data-tab="walk"]').click();
    await page.locator('#main .card', { hasText: '測試狗3' }).click();
    await page.locator('#detail').waitFor();
    assert(!/認養會|動保小小兵|活動/.test(await page.locator('#detail').innerText()), '狗卡不顯示活動');
    await page.keyboard.press('Escape');

    // 沒選名字：請先選名字，不送出
    await page.evaluate(() => { sessionStorage.setItem('test-no-name', '1'); localStorage.removeItem('bq-walker-name'); });
    await reopen();
    await openActivities();
    const before = writes.length;
    await page.getByRole('button', { name: '＋ 新增活動' }).click();
    await page.getByRole('button', { name: '存好' }).click();
    await page.getByRole('alert').filter({ hasText: '請先選好你的名字' }).waitFor();
    assert.equal(writes.length, before, '沒選名字不送出');
    console.log('#270 活動紀錄：資訊入口、標題下直接列狗、新增／修改／刪除、衝突、重新整理、狗卡無活動、需先選名字、320／390／1440px 通過');
  } finally { await ctx.close(); }
};
