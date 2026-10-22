// #270 活動紀錄：資訊 → 活動紀錄，手機與桌機都能看、新增、修改、刪除；重新整理後讀回來的內容正確
const assert = require('node:assert/strict');

module.exports = async (browser, base) => {
  const data = structuredClone(require('./fixtures/dogs.json'));
  const [d1, d2] = data.dogs;
  let activities = [{ id: 'a1', date: '2026-09-14', kind: 'kids', dogs: [{ dogId: 'x1', name: d1.name, number: d1.id }, { dogId: null, name: '舊名單小黑', number: '' }] }];
  const writes = [];
  let seq = 1;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    localStorage.setItem('bq-onboarded', '1'); localStorage.setItem('bq-name-later', '1');
    localStorage.setItem('bq-walker-name', '測試志工');
  });
  const toActivity = (id, b) => ({ id, date: b.date, kind: b.kind, dogs: b.dogs.map(d => {
    if (d.dogId) return activities.flatMap(a => a.dogs).find(x => x.dogId === d.dogId);
    if (d.number) { const dog = data.dogs.find(x => x.id === d.number); return { dogId: 'id-' + d.number, name: dog.name, number: d.number }; }
    return { dogId: null, name: d.name, number: '' };
  }) });
  await ctx.route('**/api/**', route => {
    const req = route.request(), endpoint = new URL(req.url()).pathname.split('/api/')[1];
    if (endpoint === 'activities' || endpoint.startsWith('activities/')) {
      if (req.method() === 'GET') return route.fulfill({ json: { ok: true, activities: [...activities].sort((a, b) => (a.date < b.date ? 1 : -1)) } });
      const body = req.postDataJSON(), id = endpoint.split('/')[1];
      writes.push({ method: req.method(), id, body });
      if (req.method() === 'POST') { const a = toActivity('n' + seq++, body); activities.push(a); return route.fulfill({ json: { ok: true, activity: a } }); }
      if (req.method() === 'PUT') { const a = toActivity(id, body); activities = activities.map(x => (x.id === id ? a : x)); return route.fulfill({ json: { ok: true, activity: a } }); }
      activities = activities.filter(x => x.id !== id);
      return route.fulfill({ json: { ok: true, id } });
    }
    return route.fulfill({ json: endpoint === 'dogs' ? data : endpoint === 'rest' ? { rest: {} } : endpoint === 'departures/index' ? { departures: [], years: {} } : { ok: true, walks: [], walkers: [] } });
  });
  const page = await ctx.newPage(); page.setDefaultTimeout(6000);
  page.on('dialog', d => d.accept());
  page.on('pageerror', e => console.error(e.message));
  const open = async () => {
    await page.goto(`${base}/public/index.html`);
    await page.locator('#main .card').first().waitFor();
    await page.locator('[data-tab="info"]').click();
    await page.locator('[data-info-page="activities"]').click();
    await page.locator('[data-act-new]').waitFor();
  };
  try {
    await open();
    // 每場標題下直接列出席的狗，只有名字的也顯示
    const first = page.locator('.act-item').filter({ hasText: '2026/09/14 動保小小兵' });
    assert.equal(await first.locator('.act-dogs li').count(), 2);
    assert((await first.innerText()).includes('舊名單小黑'));

    // 手機新增
    await page.getByRole('button', { name: '新增活動' }).click();
    await page.locator('#actDate').fill('2026-10-12');
    await page.locator('#actKind').selectOption('adoption');
    await page.locator('#actQuery').fill(d2.name);
    await page.locator(`[data-act-add="${d2.id}"]`).click();
    await page.locator('#actQuery').fill('沒建卡的阿福');
    await page.locator('[data-act-add-name]').click();
    await page.getByRole('button', { name: '儲存' }).click();
    await page.locator('.act-item').filter({ hasText: '2026/10/12 認養會' }).waitFor();
    assert.deepEqual(writes.at(-1).body, { date: '2026-10-12', kind: 'adoption', dogs: [{ number: d2.id }, { name: '沒建卡的阿福' }], editor: '測試志工' });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '手機不橫向溢出');

    // 桌機修改：移除只有名字的那隻、類型改成動保小小兵；重新整理後仍正確
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('.act-item').filter({ hasText: '2026/10/12 認養會' }).getByRole('button', { name: '修改' }).click();
    await page.getByRole('button', { name: '移除 沒建卡的阿福' }).click();
    await page.locator('#actKind').selectOption('kids');
    await page.getByRole('button', { name: '儲存' }).click();
    await page.locator('.act-item').filter({ hasText: '2026/10/12 動保小小兵' }).waitFor();
    assert.deepEqual(writes.at(-1).body.dogs, [{ dogId: 'id-' + d2.id }]);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '桌機不橫向溢出');
    await page.setViewportSize({ width: 390, height: 844 });
    await open();
    const edited = page.locator('.act-item').filter({ hasText: '2026/10/12 動保小小兵' });
    assert.deepEqual(await edited.locator('.act-dogs li').allTextContents(), [d2.name]);

    // 刪除
    await page.locator('.act-item').filter({ hasText: '2026/09/14' }).getByRole('button', { name: '刪除' }).click();
    await page.locator('.act-item').filter({ hasText: '2026/09/14' }).waitFor({ state: 'detached' });
    assert.equal(writes.at(-1).method, 'DELETE');
    await open();
    assert.equal(await page.locator('.act-item').count(), 1);

    // 沒選名字不送出
    await page.evaluate(() => localStorage.removeItem('bq-walker-name'));
    const before = writes.length;
    await page.getByRole('button', { name: '新增活動' }).click();
    await page.getByRole('button', { name: '儲存' }).click();
    await page.getByText('請先選好你的名字再編輯', { exact: false }).waitFor();
    assert.equal(writes.length, before);

    // 狗卡上沒有活動資訊
    await page.locator('[data-tab="walk"]').click();
    await page.locator('#main .card').first().click();
    assert(!(await page.locator('#detail').innerText()).includes('活動'));
    console.log('#270 活動紀錄：手機、桌機新增／修改／刪除、重新整理、只有名字的出席、未選名字、狗卡不顯示通過');
  } finally { await ctx.close(); }
};
