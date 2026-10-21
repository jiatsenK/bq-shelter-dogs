const assert = require('node:assert/strict');
const fixture = require('./fixtures/dogs.json');
module.exports = async (browser, base) => {
  const data = structuredClone(fixture);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
  data.dogs[8].name = '名字很長也要完整顯示的測試狗';
  data.groupColumns = [{ column: 4, label: '同名群', names: data.dogs.slice(0, 2).map(d => d.name) }, { column: 7, label: '同名群', names: data.dogs.slice(0, 10).map(d => d.name) }, { column: 12, label: '空群', names: [] }];
  const writes = [];
  let failWrite = false, partial = false, failRead = false, restMode = false, undoMode = 'ok';
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
  await context.addInitScript(() => { localStorage.setItem('bq-onboarded', '1'); localStorage.setItem('bq-name-later', '1'); localStorage.setItem('bq-walker-name', '測試志工'); });
  await context.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin !== base) return route.abort();
    if (!u.pathname.includes('/api/')) return route.continue();
    const endpoint = u.pathname.split('/api/')[1];
    if (failRead && endpoint === 'dogs') return route.fulfill({ status: 500, json: {} });
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); writes.push({ endpoint, body });
      if (failWrite) return route.fulfill({ status: 500, json: { ok: false, error: '測試寫入失敗' } });
      if (endpoint === 'walk' && body.action === 'undo') {
        if (undoMode === 'fail') return route.fulfill({ status: 500, json: { ok: false, error: '測試復原失敗' } });
        return route.fulfill({ json: { ok: true, today, results: body.dogs.map((d, i) => undoMode === 'partial' && i === 0 ? { id: d.id, name: d.name, status: 'changed', current: { date: today, walker: '別人' } } : { id: d.id, name: d.name, status: 'restored' }) } });
      }
      if (endpoint === 'walk') return route.fulfill({ json: { ok: true, today, results: body.dogs.map(d => ({ ...d, status: partial && d.name === body.dogs[0].name ? 'missing' : 'written', prev: {}, wrote: { date: today, walker: body.walker } })) } });
      const group = data.groupColumns.find(g => g.column === body.column);
      if (body.op === 'add' && !group.names.includes(body.name)) group.names.push(body.name);
      if (body.op === 'remove') group.names = group.names.filter(n => n !== body.name);
      if (body.op === 'create') { data.groupColumns.push({ column: 15, label: body.label, names: [body.name] }); }
      return route.fulfill({ json: { ok: true, group: body.op === 'create' ? data.groupColumns.at(-1) : group } });
    }
    return route.fulfill({ json: endpoint === 'dogs' ? data : endpoint === 'rest' ? { rest: restMode ? { [data.dogs[0].id]: { until: '2099-12-31', reason: '測試休養' } } : {} } : endpoint === 'walkers' ? { walkers: ['測試志工'] } : { ok: true, walks: [], departures: [] } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  try {
    await page.goto(base + '/public/index.html');
    await page.locator('#main .card').first().waitFor();
    await page.locator('[data-tab="groups"]').click();
    await page.locator('#groupStage').waitFor();
    assert.equal(await page.locator('.gw-layer').count(), 1, '多群資料仍只渲染當前群');
    assert.equal(await page.locator('.gw-layer:not([inert]) [data-gw-dog]').count(), 2);
    // 搜尋狗名：跳到有這隻的群，其他狗變淡；沒有群有就提示（K 2026-10-17）
    await page.locator('#searchInput').fill(data.dogs[5].name);
    await page.locator('.front [data-gw-dog]:not(.miss)').filter({ hasText: data.dogs[5].name }).waitFor();
    assert.equal(await page.locator('.front [data-gw-dog]:not(.miss)').count(), 1);
    await page.locator('#searchInput').fill('不存在的狗');
    await page.getByText('沒有狗群有「不存在的狗」').waitFor();
    await page.locator('#searchClear').click();
    await page.getByRole('button', { name: '上一群', exact: true }).click();
    await page.getByRole('button', { name: '有狗沒溜', exact: true }).click();
    await page.locator('.gw-layer:not([inert]) [data-gw-dog]').first().click();
    await page.getByRole('button', { name: '登記其餘 1 隻', exact: true }).click();
    await page.getByText('已登記 1 隻', { exact: true }).waitFor();
    assert.deepEqual(writes.find(w => w.endpoint === 'walk').body.dogs.map(d => d.name), [data.dogs[1].name]);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const action = await page.locator('[data-gw-action="companions"]').boundingBox();
      const bar = await page.locator('#bottomBar').boundingBox();
      assert(action.y + action.height <= bar.y, '同行人按鈕不能被底部分類列遮住：' + JSON.stringify({ width, action, bar }));
    }
    await page.getByRole('button', { name: '＋一起溜的人', exact: true }).click();
    await page.locator('#withInput').fill('同行志工');
    await page.locator('[data-with-ok]').click();
    await page.getByText('已加上 同行志工', { exact: true }).waitFor();
    assert.deepEqual(writes.at(-1).body.dogs.map(d => d.name), [data.dogs[1].name], '同行人只套用本次成功狗');
    assert.equal(writes.at(-1).body.walker, '同行志工');
    await page.getByRole('button', { name: '下一群', exact: true }).click();
    assert.equal(await page.locator('.gw-layer:not([inert]) [data-gw-dog]').count(), 10);
    await page.getByRole('button', { name: '下一群', exact: true }).click();
    await page.getByRole('heading', { name: /空群/ }).waitFor();
    assert(await page.locator('#gwWalk').isDisabled());
    // 頭尾相接：最後一群按下一群回第一群，再按上一群回最後一群
    const lastCol = await page.locator('.front').getAttribute('data-column');
    await page.getByRole('button', { name: '下一群', exact: true }).click();
    assert.equal(await page.locator('.gw-pages span').textContent(), `1 / ${await page.locator('.gw-pages span').textContent().then(t => t.split(' / ')[1])}`);
    await page.getByRole('button', { name: '上一群', exact: true }).click();
    assert.equal(await page.locator('.front').getAttribute('data-column'), lastCol);
    await page.getByRole('button', { name: '上一群', exact: true }).click();
    await page.getByRole('button', { name: '有狗沒溜', exact: true }).click();
    for (const dog of await page.locator('.front [data-gw-dog]').all()) await dog.click();
    assert(await page.getByRole('button', { name: '登記其餘 0 隻', exact: true }).isDisabled());
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await page.locator('.front [aria-pressed="true"]').count(), 0);
    partial = true;
    await page.locator('#gwWalk').click();
    await page.getByText(/未全部登記成功/).waitFor();
    partial = false;
    const sideTop = () => page.evaluate(() => { scrollTo(0, 0); return document.querySelector('.gw-side.next').getBoundingClientRect().top; });
    const beforeWalk = await sideTop();
    await page.locator('#gwWalk').click();
    await page.getByText('已登記 10 隻', { exact: true }).waitFor();
    assert(Math.abs(await sideTop() - beforeWalk) <= 1, '#443 按下溜了變「已溜」後箭頭不移動');
    await page.getByRole('button', { name: '加入狗', exact: true }).click();
    await page.locator('#gwForm input[name="name"]').fill(data.dogs[10].name);
    failWrite = true;
    await page.getByRole('button', { name: '儲存', exact: true }).click();
    await page.getByText(/測試寫入失敗，請重試/).waitFor();
    assert.equal(await page.locator('#gwForm input[name="name"]').inputValue(), data.dogs[10].name);
    failWrite = false;
    await page.getByRole('button', { name: '儲存', exact: true }).click();
    await page.getByText('狗群已更新', { exact: true }).waitFor();
    assert.equal(writes.at(-1).body.column, 7);
    assert.equal(await page.locator('.front [data-gw-dog]').count(), 11);
    await page.getByRole('button', { name: '管理', exact: true }).click();
    await page.getByRole('button', { name: '＋狗群', exact: true }).click();
    await page.locator('#gwForm input[name="label"]').fill('新測試群');
    await page.locator('#gwForm input[name="name"]').fill(data.dogs[0].name);
    await page.getByRole('button', { name: '儲存', exact: true }).click();
    await page.getByRole('heading', { name: /新測試群/ }).waitFor();
    await page.getByRole('button', { name: '管理', exact: true }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '移出 ' + data.dogs[0].name, exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.front [data-gw-dog]').length === 0);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByRole('button', { name: '上一群', exact: true }).click();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '無水平溢出');
      await page.mouse.move(0, 0);
      await page.waitForTimeout(350);
      assert(await page.locator('.front .gw-tile').evaluateAll(els => els.every(el => {
        const b = el.getBoundingClientRect(), root = document.getElementById('groupPage').getBoundingClientRect();
        return b.left >= root.left && b.right <= root.right;
      })), '前景卡完整可見');
      for (const el of await page.locator('#groupPage button:visible').all()) {
        if (await el.evaluate(e => !!e.closest('[inert]'))) continue;
        const b = await el.boundingBox(); assert(b.width >= 44 && b.height >= 44, '點擊區44px');
      }
    }
    // #443：換群箭頭在「溜了」兩側（#395），換群時不跟著狗數移動；長群也停在底部分類列上方
    for (const [width, height] of [[320, 844], [390, 844], [390, 568]]) {
      await page.setViewportSize({ width, height });
      const total = Number((await page.locator('.gw-pages span').textContent()).split(' / ')[1]);
      let first;
      for (let i = 0; i < total; i++) {
        await page.evaluate(() => scrollTo(0, 0));
        const box = await page.evaluate(() => Object.fromEntries(['.gw-side.prev', '#gwWalk', '.gw-side.next', '#bottomBar', '#groupPage'].map(s => {
          const b = document.querySelector(s).getBoundingClientRect();
          return [s, { left: b.left, right: b.right, top: b.top, bottom: b.bottom, mid: (b.top + b.bottom) / 2 }];
        })));
        const prev = box['.gw-side.prev'], walk = box['#gwWalk'], next = box['.gw-side.next'], groupBox = box['#groupPage'];
        const info = JSON.stringify({ width, height, group: i, prev, walk, next });
        assert(Math.abs(prev.mid - walk.mid) <= 2 && Math.abs(next.mid - walk.mid) <= 2, '箭頭跟「溜了」同一排：' + info);
        assert(prev.right + 16 <= walk.left && walk.right + 16 <= next.left, '箭頭在「溜了」左右兩側，留 16px 防誤按：' + info);
        assert(prev.left - groupBox.left <= 24 && groupBox.right - next.right <= 24, '箭頭貼齊畫面左右邊：' + info);
        assert(next.bottom <= box['#bottomBar'].top, '箭頭不被底部分類列遮住：' + info);
        if (!first) first = { prev, next };
        else assert(Math.abs(first.prev.top - prev.top) <= 1 && Math.abs(first.next.top - next.top) <= 1, '狗數變化不移動切群按鈕：' + info);
        await page.getByRole('button', { name: '下一群', exact: true }).click();
      }
    }
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.locator('.gw-side.next').focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('[data-tab="groups"][aria-current="page"]').count(), 1);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const before = await page.locator('.front').getAttribute('data-column');

    await page.getByRole('button', { name: '下一群', exact: true }).click();
    assert(await page.locator('.gw-side.next').evaluate(el => el.getBoundingClientRect().top >= document.querySelector('#groupStage').getBoundingClientRect().bottom), '#400 切群按鈕隨狗卡自然增高，保持在內容之後');
    await page.getByRole('button', { name: '上一群', exact: true }).click();
    await page.locator('#groupStage').scrollIntoViewIfNeeded();
    const stage = await page.locator('#groupStage').boundingBox();
    await page.mouse.move(stage.x + stage.width * .7, stage.y + 15);
    await page.mouse.down();
    await page.mouse.move(stage.x + stage.width * .2, stage.y + 15, { steps: 6 });
    await page.mouse.up();
    assert.equal(await page.locator('.front').getAttribute('data-column'), before, '滑動不換群');
    assert.equal(await page.locator('[data-tab="groups"][aria-current="page"]').count(), 1);
    const current = await page.locator('.front').getAttribute('data-column');
    const region = await page.locator('#groupStage').boundingBox();
    await page.mouse.move(region.x + region.width * .6, region.y + 15);
    await page.mouse.down();
    await page.mouse.move(region.x + region.width * .25, region.y + 15, { steps: 4 });
    await page.mouse.move(region.x + region.width * .6, region.y + 15, { steps: 4 });
    await page.mouse.up();
    assert.equal(await page.locator('.front').getAttribute('data-column'), current, '拖動反向回起點不換群');
    await page.mouse.move(region.x + region.width * .6, region.y + 15);
    await page.mouse.down();
    await page.mouse.move(region.x + region.width * .6, region.y + 90, { steps: 4 });
    await page.mouse.up();
    assert.equal(await page.locator('.front').getAttribute('data-column'), current, '上下移動不換群');
    await page.goto(base + '/public/groups.html');
    await page.locator('#groupStage').waitFor();
    await page.evaluate(() => { localStorage.removeItem('bq-walker-name'); render(); });
    const writeCount = writes.length;
    await page.locator('#gwWalk').click();
    await page.getByText('請先在「我溜過」選好你的名字再登記', { exact: true }).waitFor();
    assert.equal(writes.length, writeCount, '未選身分不送出');
    failRead = true;
    await page.reload();
    await page.locator('[data-tab="groups"]').click();
    await page.getByRole('button', { name: '重新讀取', exact: true }).waitFor();
    failRead = false;
    await page.getByRole('button', { name: '重新讀取', exact: true }).click();
    await page.locator('#groupStage').waitFor();
    restMode = true;
    // 休養與復原情境從未登記開始，不沿用前面整群登記的快照。
    await page.evaluate(() => {
      localStorage.setItem('bq-walker-name', '測試志工');
      localStorage.removeItem('bq-sheet-writes'); localStorage.removeItem('bq-walked-today');
    });
    await page.reload();
    await page.locator('[data-tab="groups"]').click();
    await page.locator('.gw-restrictions').filter({ hasText: '休養中' }).waitFor();
    await page.getByRole('button', { name: '整群溜了 · 1 隻', exact: true }).click();
    await page.getByText('已登記 1 隻', { exact: true }).waitFor();
    assert.deepEqual(writes.at(-1).body.dogs.map(d => d.name), [data.dogs[1].name], '休養狗不送出');
    // 誤觸「整群溜了」：比照溜狗表，整群溜了變「已溜」，再按一次復原；失敗不能假裝已復原
    const undoBtn = page.getByRole('button', { name: '這群今天已溜，按一下取消', exact: true });
    await undoBtn.waitFor();
    assert.equal((await undoBtn.textContent()).trim(), '已溜 · 1 隻');
    assert.equal(await page.getByRole('button', { name: /復原今天登記/ }).count(), 0, '不另放復原按鈕');
    undoMode = 'fail';
    await undoBtn.click();
    await page.getByText(/試算表沒改回來：測試復原失敗/).first().waitFor();
    assert.equal(writes.at(-1).body.action, 'undo');
    assert.deepEqual(writes.at(-1).body.dogs.map(d => d.name), [data.dogs[1].name]);
    assert(await undoBtn.isVisible(), '失敗後仍可重試');
    undoMode = 'ok';
    await undoBtn.click();
    await page.getByText('已從試算表復原 1 隻').first().waitFor();
    await page.getByRole('button', { name: '整群溜了 · 1 隻', exact: true }).waitFor();
    // 別人改過的不蓋掉；我溜過不另放取消那排
    await page.getByRole('button', { name: '整群溜了 · 1 隻', exact: true }).click();
    await page.getByText('已登記 1 隻', { exact: true }).waitFor();
    undoMode = 'partial';
    await undoBtn.click();
    await page.getByText(/已(?:經)?被改過/).first().waitFor();
    await page.locator('[data-tab="mine"]').click();
    assert.equal(await page.locator('.mine-undo, [data-undo-walk]').count(), 0, '我溜過沒有取消那排');
    undoMode = 'ok';
    console.log('#374 全量欄號、同名群、例外登記與空群通過');
  } finally { await context.close(); }
};
