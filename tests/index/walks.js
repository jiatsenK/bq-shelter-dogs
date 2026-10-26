// #58 我最近溜過：會切分類、開詳細資訊、替換 BQApi，所以一項一項跑
async function runMyWalksTests() {
  const saved = [allDogs, groupMap, activeTab, searchQuery, myWalks, myWalksState, walksData, UPLOAD_URL];
  // #96 起看自己的代號：我＝ME，別人＝OTHER（假代號）；測試完把這支手機原本的設定放回去
  const ME = 'aaaaaaaaaaaa', OTHER = 'bbbbbbbbbbbb';
  let savedCodes = null;
  try { savedCodes = localStorage.getItem(WALKER_CODES_KEY); } catch (e) { /* 無痕模式 */ }
  const main = document.getElementById('main');
  const tick = () => new Promise(r => setTimeout(r, 0));
  const dog = (name, id, walked) => ({ cage: 'A01', id, name, walkedDate: walked, covered: true, note: '', sex: '', intro: '' });
  const WALKS = { version: 1, walks: [
    { id: '8001', name: '紀錄甲', date: '2026-09-22' },                 // #56 舊紀錄，沒有 mine
    { id: '8001', name: '紀錄甲', date: '2026-09-24', mine: true, walkers: [ME] },
    { id: '8002', name: '紀錄乙', date: '2026-09-22', mine: true, walkers: [ME] },
    { id: '8003', name: '紀錄丙', date: '2026-09-24', mine: false, walkers: [OTHER] },    // 別人遛的
    { id: '8002', name: '紀錄乙', date: '2026-09-26', mine: false, walkers: [OTHER] },    // 之後別人遛了乙
    { id: '8004', name: '已離所狗', date: '2026-09-18', mine: true, walkers: [ME] },
    { id: '8005', name: '紀錄戊', date: '2026-09-24', mine: true, walkers: [ME] },
    { id: '8001', name: '紀錄甲', date: '2026-09-24', mine: true, walkers: [ME] },     // 重複
    { id: '8006', name: '日期壞', date: '2026-02-30', mine: true, walkers: [ME] },
    { id: '8003', name: '紀錄丙', date: '2026-09-23', mine: true },      // #94 前的舊紀錄還沒補代號：不算
    { id: '8003', name: '紀錄丙', date: '2026-09-21', walkers: [OTHER, ME.toUpperCase()] }, // 代號大小寫不同：不算
  ] };
  const heads = () => [...main.querySelectorAll('.walk-date')].map(h => h.firstChild.textContent);
  const cardNames = () => [...main.querySelectorAll('.mine-dog .bname')].map(n => n.textContent);
  const setup = () => {
    allDogs = [dog('紀錄甲', '8001', new Date(2026, 8, 24)), dog('紀錄乙', '8002', new Date(2026, 8, 26)),
      dog('紀錄丙', '8003', null), dog('紀錄戊', '8005', new Date(2026, 8, 24))];
    groupMap = {}; searchQuery = '';
    walksData = WALKS;
    saveMyCodes([ME]);
    myWalks = parseMyWalks(WALKS); myWalksState = 'ready';
    mineMonth = ''; mineDay = '';
    activeTab = 'mine'; render(); document.getElementById('whoCancel')?.click();
  };
  // 月曆上有來的每一天點一次（新到舊），回傳 [日期標題, 那天的狗, 幾隻]
  const eachDay = () => [...main.querySelectorAll('.mc-cell.on')].map(c => c.dataset.mineDay).reverse().map(k => {
    main.querySelector(`[data-mine-day="${k}"]`).click();
    return [heads()[0], cardNames(), main.querySelector('.visit .walk-date .n').textContent];
  });
  try {
    await check('#58 只取我遛的紀錄（#96 看代號）：去重、丟掉不合理日期，新到舊', () => {
      eq(parseMyWalks(WALKS, [ME]).map(w => `${w.ymd} ${w.name}`),
        ['2026-09-24 紀錄戊', '2026-09-24 紀錄甲', '2026-09-22 紀錄乙', '2026-09-18 已離所狗']);
      eq(parseMyWalks({ version: 1, walks: [] }, [ME]), []);
      eq(parseMyWalks(WALKS, [OTHER]).map(w => `${w.ymd} ${w.name}`), ['2026-09-26 紀錄乙', '2026-09-24 紀錄丙', '2026-09-21 紀錄丙'], '別人看到的是別人的：');
      eq(parseMyWalks(WALKS, []), [], '沒設定：');
      let threw = false;
      try { parseMyWalks({}); } catch { threw = true; }
      eq(threw, true, '格式不對要丟錯：');
    });
    await check('#58 每次到所一張卡（K 選 A）：同一天的狗排在同一張；之後別人遛過，我那筆仍在；離所的狗只列名字', () => {
      setup();
      // 10-10 K：改成一個月一張月曆，先看最近一次，點哪天看那天
      eq([main.querySelector('.mc-title').firstChild.textContent, main.querySelector('.mc-title span').textContent], ['2026 年 9 月', '來 3 天・溜 4 隻次'], '月曆標題：');
      eq([...main.querySelectorAll('.mc-cell.on')].map(c => [c.querySelector('b').textContent, c.querySelector('small').textContent]), [['18', '1 隻'], ['22', '1 隻'], ['24', '2 隻']], '有來的日子：');
      eq([heads(), main.querySelector('.mc-cell.sel b').textContent], [['2026/09/24（四）'], '24'], '先看最近一次：');
      eq(eachDay(), [['2026/09/24（四）', ['紀錄戊', '紀錄甲'], '2 隻'], ['2026/09/22（二）', ['紀錄乙'], '1 隻'], ['2026/09/18（五）', ['已離所狗'], '1 隻']], '點哪天看那天：');
      eq(main.querySelectorAll('.mine-dog.gone').length, 1, '離所：');
      eq(main.querySelector('.mine-dog.gone').tagName, 'DIV', '離所的狗不能點：');
      eq(document.querySelector('#tabs button[data-tab="mine"] .n').textContent, '4', '分類數字：');
      eq(main.querySelectorAll('.walk-btn, .card').length, 0, '這頁不放狗卡與已遛按鈕：');
      if (/上次遛狗/.test(main.textContent)) throw new Error('這頁不顯示大家的上次遛狗');
      if (/紀錄丙/.test(main.textContent)) throw new Error('別人遛的不該出現');
    });
    await check('#58 我溜過不顯示備註；V9（#141）不標「第一次」；這個月小計收在「統計」按鈕', () => {
      setup();
      allDogs[0].note = '勿溜，測試用備註';
      myWalks = parseMyWalks({ version: 1, walks: [...WALKS.walks, { id: '8001', name: '紀錄甲', date: '2026-09-26', mine: true, walkers: [ME] }] });
      render();
      eq(main.querySelectorAll('.warn-note, .card.flagged, mark').length, 0, '備註：');
      if (main.textContent.includes('測試用備註')) throw new Error('不該出現備註文字');
      eachDay();
      eq(main.querySelectorAll('.mine-dog .first').length, 0, '不標第一次：');
      eq([main.querySelector('.mine-stats'), !!main.querySelector('#mineStats')], [null, true], '小計先收起、有統計按鈕：');
      main.querySelector('#mineStats').click();
      if (!main.querySelector('.mine-stats') || !main.querySelector('.mine-progress')) throw new Error('按統計要展開小計');
      main.querySelector('#mineStats').click();
      allDogs[0].note = '';
      const box = document.createElement('div');
      box.innerHTML = myMonthStats(myWalks, new Date(2026, 8, 27));
      eq([...box.querySelectorAll('.mine-tiles b')].map(b => b.textContent), ['4', '4', '5'], '9 月：到所 4 次、4 隻、5 趟：');
      if (!box.textContent.includes('上個月到所 0 次')) throw new Error(box.textContent);
      box.innerHTML = myMonthStats(myWalks, new Date(2026, 9, 3));
      eq([...box.querySelectorAll('.mine-tiles b')].map(b => b.textContent), ['0', '0', '0'], '10 月：');
      if (!box.textContent.includes('上個月到所 4 次')) throw new Error(box.textContent);
    });
    await check('#58 月曆可以往前翻到最早有紀錄的那個月，不能翻到未來；搜尋時照舊一路往下列', () => {
      setup();
      myWalks = parseMyWalks({ version: 1, walks: [...WALKS.walks, { id: '8002', name: '紀錄乙', date: '2026-08-05', mine: true, walkers: [ME] }] });
      render();
      const nav = () => [...main.querySelectorAll('.mc-nav')];
      eq(main.querySelector('.mc-title').firstChild.textContent, '2026 年 9 月', '先看最近有紀錄的月：');
      nav()[0].click();
      eq([main.querySelector('.mc-title').firstChild.textContent, heads(), nav()[0].disabled], ['2026 年 8 月', ['2026/08/05（三）'], true], '上個月、到最早就不能再翻：');
      nav()[1].click();
      eq(main.querySelector('.mc-title').firstChild.textContent, '2026 年 9 月', '下個月：');
      searchQuery = '乙'; render();
      eq([heads(), main.querySelector('.mine-cal')], [['2026/09/22（二）', '2026/08/05（三）'], null], '搜尋：');
      searchQuery = '';
    });
    await check('#346 月曆翻到上個月 1 號以前才按年拿，網址帶那年版本號；拿回來併進月曆', async () => {
      setup();
      walksData = { ...WALKS, years: { 2025: '4', 2026: '9.2026-09-26.1' } };
      render();
      const calls = [];
      let done;
      const wait = new Promise(r => { done = r; });
      fakeApi(async (name, ...args) => {
        if (name !== 'walksYear') return API_REAL[name](...args);
        calls.push(args);
        await wait;
        const year = args[0];
        return new Response(JSON.stringify({ ok: true, version: 1, year, walks: year === '2026' ? [{ id: '8002', name: '紀錄乙', date: '2026-08-05', walkers: [ME] }] : [{ id: '8001', name: '紀錄甲', date: '2025-12-30', walkers: [ME] }] }));
      });
      const nav = () => [...main.querySelectorAll('.mc-nav')];
      try {
      eq(nav()[0].disabled, false, '還有沒拿的年份可以往前翻：');
      nav()[0].click();
      eq([calls, main.querySelector('.mc-title span').textContent], [[['2026', '9.2026-09-26.1']], '讀取中…'], '拿那一年：');
      done(); await tick(); await tick();
      eq([main.querySelector('.mc-title').firstChild.textContent, heads()], ['2026 年 8 月', ['2026/08/05（三）']], '拿回來還在 8 月，併進月曆：');
      eq(myWalks.filter(w => w.ymd.startsWith('2026-09')).length, 4, '近期範圍不重複：');
      nav()[0].click();
      eq(calls.length, 1, '同一年不再拿：');
      for (let i = 0; i < 7; i++) nav()[0].click();
      eq(main.querySelector('.mc-title').firstChild.textContent, '2025 年 12 月', '跨年：');
      await tick(); await tick();
      eq([calls[1], heads()], [['2025', '4'], ['2025/12/30（二）']], '跨年拿前一年：');
      eq(nav()[0].disabled, true, '都拿過了，最早有紀錄就不能再翻：');
      } finally { restoreApi(); walksData = WALKS; }
    });
    await check('#58 點狗開原本的詳細資訊；搜尋只篩這頁', () => {
      setup();
      main.querySelector('.mine-dog[data-mine-dog]').click();
      eq(detailDog && detailDog.name, '紀錄戊', '詳細資訊：');
      hideDetail();
      searchQuery = '甲'; render();
      eq(cardNames(), ['紀錄甲'], '搜尋：');
      searchQuery = '';
    });
    await check('#58 還沒有紀錄：提示試算表要寫設定的名字', () => {
      setup();
      myWalks = []; render();
      if (!main.textContent.includes('還沒有你的溜狗紀錄')) throw new Error(main.textContent);
      eq(!!document.getElementById('whoEdit'), true, '可以修改我是誰：');
    });
    await check('#58 讀 api/walks；讀不到顯示錯誤，可重新讀取', async () => {
      setup();
      walksData = null; myWalks = []; // 初次讀取失敗；已有資料的背景失敗由 #418 保留原內容
      const calls = fakeApi(() => new Response('Not Found', { status: 404 }));
      await loadMyWalks();
      eq(calls, [['walks']], '讀的位置：');
      if (!main.textContent.includes('溜狗紀錄讀不到')) throw new Error('要顯示讀取失敗');
      fakeApi(() => apiJson(WALKS));
      document.getElementById('mineRetry').click();
      await tick(); await tick();
      eq(main.querySelectorAll('.mc-cell.on').length, 3, '重新讀取後：');
    });
    await check('#58 repo 裡的 data/walks.json 讀得懂，畫面不出現其他志工名字', async () => {
      const res = await fetch('fixtures/walks.json', { cache: 'no-store' });
      const data = await res.json();
      const list = parseMyWalks(data);
      if (!Array.isArray(data.walks)) throw new Error('walks.json 沒有 walks');
      // walks.json 每筆只能有編號、犬名、日期、是不是我遛的
      const extra = data.walks.flatMap(w => Object.keys(w)).filter(k => !['id', 'name', 'date', 'mine', 'walkers'].includes(k));
      eq([...new Set(extra)], [], 'walks.json 多出的欄位：');
      // #94 walkers 只能是 12 碼代號，不能是名字
      const bad = data.walks.filter(w => 'walkers' in w && !(Array.isArray(w.walkers) && w.walkers.every(c => /^[0-9a-f]{12}$/.test(c))));
      eq(bad, [], 'walkers 不是代號：');
      eq(list.every(w => w.ymd && w.date), true, '日期：');
    });
    await check('#96 還沒設定我是誰：我溜過顯示設定框、分類不顯示數字；設定固定志工身分', async () => {
      setup();
      saveMyCodes([]); render();
      eq(!!document.getElementById('whoForm'), true, '設定框：');
      eq(document.querySelector('#tabs button[data-tab="mine"] .n').textContent, '', '分類數字：');
      eq(main.querySelectorAll('.visit').length, 0, '不列紀錄：');
      eq(document.getElementById('whoClear'), null, '沒設定過不顯示清除：');
      UPLOAD_URL = 'https://worker.test';
      const calls = fakeApi(() => apiJson({ ok: true, identity: { volunteerId: 'test-person', name: '測試志工', codes: [ME] } }));
      const input = document.getElementById('whoInput');
      input.value = '測試志工';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('whoSave').click();
      await tick(); await tick(); await tick();
      eq(calls.filter(c => c[0] === 'identity'), [['identity', '', { name: '測試志工' }], ['identity', '', { name: '測試志工' }]], '送給 Worker：');
      eq(loadMyCodes(), [ME], '記住代號：');
      let stored = '';
      try { stored = localStorage.getItem(WALKER_CODES_KEY) || ''; } catch (e) { /* 無痕模式 */ }
      if (stored.includes('測試志工')) throw new Error('名字不該存在手機');
      eq(main.querySelectorAll('.mc-cell.on').length, 3, '設定後列出我的紀錄：');
      eq(document.querySelector('#tabs button[data-tab="mine"] .n').textContent, '4', '分類數字：');
    });
    await check('#267 更名保留身分；名字衝突先顯示摘要，取消不合併，再次確認才合併', async () => {
      const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
      setup(); UPLOAD_URL = 'https://worker.test'; saveWalkerName('甲'); saveMyCodes([ME]);
      const requests = [];
      let conflict = false;
      fakeApi(async (name, action, init) => {
        const path = name === 'identity' ? `/identity${action}` : name; const body = name === 'identity' ? init : {};
        requests.push(path);
        if (path === '/identity/rename' && conflict) return new Response(JSON.stringify({ ok: false, error: '這個名字已有人使用，請換一個', targetCode: 'bbbbbbbbbbbb' }), { status: 409 });
        if (path === '/identity/merge-preview') return json({ ok: true, token: 'preview', source: { name: '甲新', favorites: 2, cards: 3, walkRows: 4 }, target: { name: '乙', favorites: 5, cards: 6, walkRows: 7 } });
        if (path === '/identity/merge') { eq(body.confirm, true); return json({ ok: true, identity: { volunteerId: 'person', name: '乙', codes: [ME, 'bbbbbbbbbbbb'] } }); }
        if (path === '/identity/rename') return json({ ok: true, identity: { volunteerId: 'person', name: body.name, codes: [ME] } });
        if (path === '/identity') return json({ ok: true, identity: { volunteerId: 'person', name: loadWalkerName(), codes: loadMyCodes() } });
        return json({ ok: true, ids: [], aliases: {} });
      });
      const change = async name => { document.getElementById('whoEdit').click(); const input = document.getElementById('whoInput'); input.value = name; input.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('whoRename').click(); for (let i=0;i<8;i++) await tick(); };
      await change('甲新'); if(loadWalkerName() !== '甲新') throw new Error(JSON.stringify({requests, text:main.textContent}));
      conflict = true; await change('乙');
      if (!main.textContent.includes('常溜 2') || !main.textContent.includes('開卡 6')) throw new Error('未呈現雙方摘要');
      document.getElementById('whoCancel').click(); eq(requests.includes('/identity/merge'), false, '取消不合併：'); eq(loadWalkerName(), '甲新');
      await change('乙'); document.getElementById('whoMerge').click(); for (let i=0;i<8;i++) await tick();
      eq(loadWalkerName(), '乙'); eq(loadMyCodes(), [ME, 'bbbbbbbbbbbb']); eq(requests.filter(p => p === '/identity/merge').length, 1);
    });
    await check('#96 換代號失敗：保留輸入的名字並顯示原因；沒輸入不送出', async () => {
      setup();
      saveMyCodes([]); render();
      UPLOAD_URL = 'https://worker.test';
      let n = 0;
      fakeApi(() => { n++; return apiJson({ ok: false, error: '太頻繁了，請稍等一下再試' }, 429); });
      document.getElementById('whoSave').click();
      await tick();
      eq(n, 0, '空白不送：');
      if (!main.textContent.includes('請輸入你在試算表上寫的名字')) throw new Error(main.textContent);
      const input = document.getElementById('whoInput');
      input.value = '測試志工';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('whoSave').click();
      await tick(); await tick(); await tick();
      eq(n, 1, '送出：');
      if (!main.textContent.includes('太頻繁了')) throw new Error(main.textContent);
      eq(document.getElementById('whoInput').value, '測試志工', '保留名字：');
      eq(loadMyCodes(), [], '沒記代號：');
    });
    await check('#96 修改、取消、清除這支手機的設定', () => {
      setup();
      document.getElementById('whoEdit').click();
      eq(!!document.getElementById('whoForm'), true, '按修改出現設定框：');
      document.getElementById('whoCancel').click();
      eq(main.querySelectorAll('.mc-cell.on').length, 3, '取消回到紀錄：');
      document.getElementById('whoEdit').click();
      document.getElementById('whoClear').click();
      eq(loadMyCodes(), ['aaaaaaaaaaaa'], '先問一次，還沒清：');
      document.getElementById('whoClearNo').click();
      eq([loadMyCodes().length, !!document.getElementById('whoInput')], [1, true], '不要清除：');
      document.getElementById('whoClear').click();
      document.getElementById('whoClearOk').click();
      eq(loadMyCodes(), [], '清除：');
      eq(!!document.getElementById('whoForm'), true, '清除後回到設定框：');
      eq(document.getElementById('whoCancel'), null, '清除後沒有取消：');
    });
  } finally {
    restoreApi();
    hideDetail();
    [allDogs, groupMap, activeTab, searchQuery, myWalks, myWalksState, walksData, UPLOAD_URL] = saved;
    walkerCodesMemory = null;
    try { if (savedCodes == null) localStorage.removeItem(WALKER_CODES_KEY); else localStorage.setItem(WALKER_CODES_KEY, savedCodes); } catch (e) { /* 無痕模式 */ }
    render();
  }
}

// #445（K 2026-10-21）：按了溜了直接照天數排到後面，不再固定在原位
async function runWalkSortTests() {
  const saved = [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, sheetWriteState];
  const TODAY = new Date(2026, 9, 4);
  const now = new Date();
  const ymdDash = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const d = (name, cage, days, base = TODAY) => parseDogsData({ dogs: [{ id: '', name, cage, note: '', covered: false, walkedDate: ymdDash(new Date(base.getFullYear(), base.getMonth(), base.getDate() - days)) }] }).dogs[0];
  try {
    allDogs = [d('排序丙', '舊A10', 3), d('排序甲', '舊A2', 9), d('排序乙', '', 40), d('排序丁', '新B01', 1), d('排序戊', '舊A2', 20)];
    groupMap = {}; activeTab = 'walk'; searchQuery = '';
    phoneStore = fakeStorage(); walkRecords = freshWalkRecords();
    await check('溜狗表一律最久沒溜在前', () => {
      eq(dueDogs(allDogs, TODAY).map(x => x.name), ['排序乙', '排序戊', '排序甲', '排序丙', '排序丁'], '最久沒溜：');
    });
  } finally {
    [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, sheetWriteState] = saved;
    render();
  }
}

// #138 按「溜了」寫進試算表（經 Worker 的 /walk）
async function runSheetWriteTests() {
  const saved = [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, UPLOAD_URL];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const toastText = () => (document.querySelector('#toast .toast-text') || {}).textContent || '';
  try {
    allDogs = [{ id: '9801', name: '寫入甲', cage: 'A01', note: '', covered: false, walkedDate: null }, { id: '', name: '寫入乙', cage: 'A02', note: '', covered: false, walkedDate: null }];
    groupMap = {}; activeTab = 'walk'; searchQuery = '';
    phoneStore = fakeStorage(); walkRecords = freshWalkRecords(); walkerNameMemory = ''; sheetWriteState = 'unknown';
    UPLOAD_URL = 'https://worker.test';
    render();
    await check('#138 還沒設定名字（先看看）：按溜了先問名字，不送試算表；按取消就不記', async () => {
      const calls = fakeApi(() => json({ ok: true, results: [] }));
      BQWalkUI.setWalked([allDogs[0]], true);
      await sheetQueue;
      eq(calls, [], '不送：');
      const box = document.getElementById('onboard');
      eq([!!box, !!(box && box.querySelector('#obInput')), box && box.querySelector('.ob-next').textContent], [true, true, '設定並登記'], '先問名字：');
      eq(!!document.getElementById('main').closest('[inert]'), true, '後面的網頁不能點：');
      box.querySelector('[data-ob="cancel"]').click();
      eq([document.getElementById('onboard'), walkedToday().has(allDogs[0]), !!document.getElementById('main').closest('[inert]')], [null, false, false], '取消：');
    });
    await check('#397 換手機讀到自己的今日登記：狗卡、詳細資訊、狗群一致，沒有本機證據不能復原', () => {
      const dog = allDogs[0], today = new Date();
      saveWalkerName('志工我');
      dog.walkedDate = BQDates.parseYmd(BQDates.localDateKey(today));
      fakeD1.show([dog], '志工我、同行人'); // 另一支手機登記、這支手機從 D1 今日紀錄讀到
      sheetWriteState = 'on';
      eq([walkedNow(dog), BQWalkUI.sheetUndoable(dog), groupDateLabel(dog)], [true, false, '今天溜過']);
      const card = document.createElement('div'); card.innerHTML = BQWalkUI.walkButton(dog);
      eq([card.querySelector('button').textContent, card.querySelector('button').disabled], ['已溜', true]);
      eq(walkerList(dog), ['志工我', '同行人']);
      if (!lastWalkSection(dog, today).includes('志工我')) throw new Error('詳細資訊缺自己名字');
    });
  } finally {
    [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, UPLOAD_URL] = saved;
    restoreApi(); walkRecords = freshWalkRecords(); walkerNameMemory = ''; sheetWriteState = 'off';
    render();
  }
}

// ── #141 溜狗人旁＋／×（K 2026-10-04 確認）──
async function runWalkerChipTests() {
  const saved = [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, UPLOAD_URL, walkerNames, walkerNameList, sheetWriteState, walkerNameMemory, walkerCodesMemory, myWalks, myWalksState];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const toastText = () => { const t = document.getElementById('toast'); return t && !t.hidden ? t.querySelector('.toast-text').textContent : ''; };
  const tick = () => new Promise(r => setTimeout(r, 0));
  const chips = () => [...document.querySelectorAll('.last-walk .who-chip')].map(c => c.firstChild.textContent);
  const today = BQDates.localDateKey(new Date());
  try {
    allDogs = [
      { id: '9901', name: '加減甲', cage: 'A01', note: '', covered: false, walkedDate: new Date(), formerIds: [] },
      { id: '9902', name: '加減乙', cage: 'A02', note: '', covered: false, walkedDate: new Date(Date.now() - 3 * 864e5), formerIds: [] },
    ];
    groupMap = {}; activeTab = 'walk'; searchQuery = '';
    phoneStore = fakeStorage(); walkRecords = freshWalkRecords(); sheetWriteState = 'unknown';
    saveWalkerName('志工我'); UPLOAD_URL = 'https://worker.test';
    walkerNameList = ['志工乙', '志工丙', '志工丁'];
    // D1 今日紀錄：今天的狗由志工乙、志工丙溜；三天前那隻照狗清單
    fakeD1.show([allDogs[0]], '志工乙+志工丙');
    fakeD1.set('9902', '志工乙+志工丙', BQDates.localDateKey(allDogs[1].walkedDate));
    walkRegistration.receiveToday(fakeD1.pack(), allDogs);
    const current = () => fakeD1.rows.get('9901').walker;
    let bodies = [];
    const d1Api = fakeD1.api();
    fakeApi((name, body) => { if (name === 'walk') bodies.push(body); return d1Api(name, body); });
    render();
    await check('#141 今天溜的狗：每個名字旁有 ×、最後有＋；不是今天的只顯示名字；沒有舊的三顆按鈕', () => {
      showDetail(allDogs[0]);
      eq(chips(), ['志工乙', '志工丙'], '名字：');
      eq(document.querySelectorAll('.last-walk [data-who-remove]').length, 2, '× 數：');
      if (!document.getElementById('whoAdd')) throw new Error('沒有＋');
      if (document.getElementById('walkEditPeople') || document.getElementById('walkAddPeople') || document.getElementById('walkUndoSaved')) throw new Error('舊按鈕還在');
      showDetail(allDogs[1]);
      eq([chips(), document.querySelectorAll('.last-walk .who-x').length, !!document.getElementById('whoAdd')], [['志工乙', '志工丙'], 0, false], '三天前的：');
    });
    await check('#141 按 × 直接改名單（帶版本比對）；只剩一人時 × 是取消這次登記', async () => {
      showDetail(allDogs[0]); bodies = [];
      const seen = walkRegistration.state(allDogs[0]).version;
      document.querySelector('.last-walk [data-who-remove="志工乙"]').click();
      if (!document.querySelector('.last-walk .who-x:disabled')) throw new Error('寫入中要不能按');
      for (let i = 0; i < 20 && bodies.length === 0; i++) await tick();
      for (let i = 0; i < 20 && document.querySelector('.last-walk .who-x:disabled'); i++) await tick();
      eq(bodies.map(b => [b.action, b.walker, b.editor, b.dogs[0].expectedVersion]), [['edit', '志工丙', '志工我', seen]], '送出：');
      eq([chips(), document.querySelectorAll('.last-walk [data-who-undo]').length, !!document.getElementById('whoAdd')], [['志工丙'], 1, true], '剩一人：');
      eq(toastText(), '', 'D1 改名單成功不跳提示條：');
    });
    await check('#141 按＋選名字，接在後面送出；已在名單上的人不列', async () => {
      showDetail(allDogs[0]); bodies = [];
      document.getElementById('whoAdd').click();
      const names = [...document.querySelectorAll('#withBackdrop [data-with]')].map(b => b.dataset.with);
      if (names.includes('志工丙') || !names.includes('志工乙')) throw new Error(`已在名單的不列、拿掉的人可再加：${names}`);
      document.querySelector('#withBackdrop [data-with="志工丁"]').click();
      document.querySelector('#withBackdrop [data-with-ok]').click();
      for (let i = 0; i < 20 && chips().length < 2; i++) await tick();
      eq([bodies[0].action, bodies[0].walker], ['edit', '志工丙、志工丁'], '送出：');
      eq(chips(), ['志工丙', '志工丁'], '名單：');
      BQWalkUI.hideToast();
    });
    await check('#141 別人先改過：不蓋掉，提示並換成最新名單', async () => {
      showDetail(allDogs[0]);
      fakeD1.set('9901', '志工丙、志工丁、志工戊'); // 別的手機先改過，這支手機還不知道
      document.querySelector('.last-walk [data-who-remove="志工丁"]').click();
      for (let i = 0; i < 20 && !toastText(); i++) await tick();
      eq(current(), '志工丙、志工丁、志工戊', 'D1 沒被蓋：');
      eq(chips(), ['志工丙', '志工丁', '志工戊'], '最新名單：');
      if (!toastText().includes('沒有蓋掉')) throw new Error(`提示：${toastText()}`);
      BQWalkUI.hideToast();
    });
  } finally {
    hideDetail(); BQWalkUI.hideToast(); BQWalkUI.closeWithSheet(); restoreApi();
    [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, UPLOAD_URL, walkerNames, walkerNameList, sheetWriteState, walkerNameMemory, walkerCodesMemory, myWalks, myWalksState] = saved;
    render();
  }
}
