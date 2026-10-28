// ── V9 正式上線版（#141）──
async function runV9Tests() {
  const saved = [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, UPLOAD_URL, walkerNames, walkerNameList, sheetWriteState, walkerNameMemory, walkerCodesMemory, myWalks, myWalksState];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const days = n => new Date(Date.now() - n * 864e5);
  const main = document.getElementById('main');
  try {
    allDogs = [
      { id: '9901', name: 'V9甲', cage: 'A01', note: '', covered: false, walkedDate: days(40) },
      { id: '9902', name: 'V9乙', cage: 'A02', note: '', covered: false, walkedDate: days(10) },
      { id: '9903', name: 'V9丙', cage: 'A03', note: '', covered: false, walkedDate: days(1) },
      { id: '9904', name: 'V9丁', cage: 'A04', note: '', covered: false, walkedDate: null },
    ];
    groupMap = {}; activeTab = 'walk'; searchQuery = '';
    phoneStore = fakeStorage(); walkRecords = freshWalkRecords(); walkerNameMemory = ''; sheetWriteState = 'off';
    walkerNames = {};
    fakeD1.forget(allDogs);
    render();
    await check('2026-10-08 溜狗表上面只有「全部／★ 我的常溜」兩個選一個，沒有天數篩選和排序', () => {
      const chips = () => [...main.querySelectorAll('[data-walk-fav]')].map(b => [b.firstChild.textContent + b.querySelector('small').textContent, b.getAttribute('aria-pressed')]);
      eq(chips(), [['全部4', 'true'], ['★ 我的常溜0', 'false']], '兩個選項：');
      eq([main.querySelectorAll('[data-walk-filter], [data-walk-sort]').length, main.querySelectorAll('.card').length], [0, 4], '沒有天數、排序：');
      eq([...main.querySelectorAll('.card .name')].map(n => n.firstChild.textContent), ['V9丁', 'V9甲', 'V9乙', 'V9丙'], '最久沒溜在前：');
      main.querySelector('[data-walk-fav="1"]').click();
      eq(chips().map(c => c[1]), ['false', 'true'], '只有一個是選的：');
      main.querySelector('[data-walk-fav="0"]').click();
      if (main.querySelector('.stat-tile')) throw new Error('不再有三格');
    });
    await check('#141 列表模式（收起照片）：一列一隻 天數｜狗名｜籠位｜溜了（K 2026-10-09 拿掉溜狗人），溜狗人在詳細資訊、一格好幾人拆開', async () => {
      UPLOAD_URL = 'https://worker.test';
      // 溜狗人來自 D1 今日紀錄（狗清單同步進 D1 的那一格）
      fakeD1.set('9902', '阿文+阿華。阿明', BQDates.localDateKey(allDogs[1].walkedDate));
      walkRegistration.receiveToday(fakeD1.pack(), allDogs);
      main.querySelector('[data-walk-view="list"]').click();
      const row = main.querySelector('.row-dog[data-dog="1"]');
      eq([row.querySelector('.r-cage').textContent, row.querySelector('.r-name').textContent, row.querySelector('.r-who')], ['A02', 'V9乙', null], '一列：');
      eq([...main.querySelectorAll('.row-head span')].map(n => n.textContent), ['天數', '狗名', '籠位', ''], '欄位標題：');
      eq([...row.children].map(c => c.className.split(' ')[0]), ['r-date', 'r-name', 'r-cage', 'walk-btn'], '天數排最前面：');
      eq(row.querySelector('.r-cage').tagName, 'SPAN', '平面圖上沒有的籠位只寫字：');
      const cage1 = allDogs[1].cage;
      try {
        allDogs[1].cage = '新A04'; render();
        const btn = main.querySelector('.row-dog[data-dog="1"] .r-cage');
        eq([btn.tagName, btn.hasAttribute('data-where'), btn.classList.contains('cage-pill'), !!btn.querySelector('use[href="#i-pin"]')], ['BUTTON', true, true, true], '平面圖上有的籠位是按鈕，樣子跟狗卡的圖釘籠位一樣（10-10）：');
        btn.click();
        eq([whereDog === allDogs[1], !!detailDog], [true, false], '點籠位開平面圖、不開詳細資訊：');
        whereHide();
        eq(document.activeElement, btn, '關掉後回到籠位：');
      } finally { if (whereDog) whereHide(); allDogs[1].cage = cage1; render(); }
      const s1 = computeStatus(allDogs[1], new Date());
      eq(row.querySelector('.r-date').textContent, s1.kind === 'dated' && s1.days > 0 ? `${s1.days}天前` : row.querySelector('.r-date').textContent, '寫天數不寫日期：');
      if ([...main.querySelectorAll('.r-date')].some(d => d.textContent.includes('/'))) throw new Error('列表還有 月/日 日期');
      eq(main.querySelectorAll('.row-dog .thumb').length, 0, '沒有照片：');
      const warnRow = new DOMParser().parseFromString(walkRow({ ...allDogs[1], note: '會攻擊其他狗' }, new Date()), 'text/html').body.firstElementChild;
      eq([warnRow.classList.contains('flagged'), !!warnRow.querySelector(':scope > .warn-note .text'), !warnRow.querySelector('.r-name .icon')], [true, true, true], '警示原文放在那一列下面：');
      eq(phoneStore.get(WALK_VIEW_KEY), 'list', '記住：');
      main.querySelector('.row-dog[data-dog="1"] .r-name').click();
      eq([...document.querySelectorAll('#detail .last-walk .who-chip')].map(c => c.textContent), ['阿文', '阿華', '阿明'], '詳細資訊溜狗人：');
      hideDetail();
      main.querySelector('[data-walk-view="photo"]').click();
    });
    await check('#141 沒有今天已溜：按溜了留在溜狗表、變「已溜」、天數變今天；再按一次取消', async () => {
      eq(TABS.map(t => t.id), ['walk', 'groups', 'mine', 'info'], '分類：');
      saveWalkerName('志工我'); sheetWriteState = 'unknown'; UPLOAD_URL = 'https://worker.test';
      fakeApi(fakeD1.api());
      const dog = allDogs[0], btn = () => main.querySelector(`.card[data-dog="${allDogs.indexOf(dog)}"] .walk-btn`);
      btn().click();
      await until(() => btn().dataset.walk === 'back', 'D1 接受：');
      eq([btn().dataset.walk, btn().textContent.trim(), computeStatus(dog, new Date()).days], ['back', '已溜', 0], '已溜：');
      eq(main.querySelectorAll('.card').length, 4, '還在溜狗表：');
      btn().click();
      await until(() => btn().dataset.walk === 'add', '取消：');
      BQWalkUI.hideToast();
    });
    await check('#141 溜了之後加一起溜的人：寫進同一格、詳細資訊顯示；復原時一起清掉', async () => {
      saveWalkerName('志工我'); sheetWriteState = 'unknown'; walkRecords = freshWalkRecords();
      const calls = [], d1Api = fakeD1.api();
      fakeD1.forget([allDogs[1]]);
      fakeApi((name, body) => { if (name === 'walk') calls.push(body.walker); return d1Api(name, body); });
      BQWalkUI.setWalked([allDogs[1]], true);
      await until(() => document.querySelector('#toast .toast-extra')?.textContent === '＋一起溜的人', 'D1 接受後提示條：');
      const extra = document.querySelector('#toast .toast-extra');
      eq([extra.hidden, extra.textContent], [false, '＋一起溜的人'], '提示條有加人：');
      extra.click();
      const input = document.getElementById('withInput');
      input.value = '阿華'; input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-with-ok]').click();
      await until(() => walkerList(allDogs[1]).length === 2, '加上一起溜的人：');
      eq(calls, ['志工我', '阿華'], '送兩次（先自己，再一起溜的人）：');
      eq(walkerList(allDogs[1]), ['志工我', '阿華'], '畫面上：');
      eq(loadCompanions(), ['阿華'], '記住最近一起溜的人：');
      BQWalkUI.hideToast(); restoreApi(); fakeD1.forget([allDogs[1]]);
    });
    await check('#396 整群只有部分狗已有同行人，仍可替其他狗補加', () => {
      const targets = allDogs.slice(0, 2);
      clearWalkWith(targets);
      addWalkWith([targets[0]], ['阿華']);
      BQWalkUI.openWithSheet(targets);
      eq(!!document.querySelector('#withBackdrop [data-with="阿華"]'), true, '只有全部狗都有的人才隱藏：');
      BQWalkUI.closeWithSheet(); clearWalkWith(targets);
    });
    await check('#141 多人登記立即更新今天紀錄與統計；重新載入仍可編輯及復原，衝突不覆寫', async () => {
      phoneStore = fakeStorage(); walkRecords = freshWalkRecords();
      saveWalkerName('志工我'); saveMyCodes(['aaaaaaaaaaaa']);
      myWalks = []; myWalksState = 'ready'; sheetWriteState = 'unknown';
      const dog = allDogs[0], today = BQDates.localDateKey(new Date());
      const originalDate = days(5);
      dog.walkedDate = originalDate;
      let lastBody;
      const d1Api = fakeD1.api(), current = () => fakeD1.rows.get(dog.id).walker;
      fakeApi((name, body) => { if (name === 'walk') lastBody = body; return d1Api(name, body); });
      fakeD1.show([dog], '志工乙'); // 志工乙今天先登記
      await walkRegistration.register([dog]);
      eq(walkerList(dog), ['志工乙', '志工我'], '完整名單：');
      eq(currentMyWalks().map(w => w.id), [dog.id], '立即出現：');
      eq(myWalksCount(''), 1, '數字：');
      if (!myMonthStats(currentMyWalks(), new Date()).includes('<b>1</b>')) throw new Error('統計沒有新登記');
      eq(computeStatus(dog, new Date()).days, 0, '日期：');
      if (BQWalkUI.walkerEditBase(dog, new Date()) !== current()) throw new Error('可在名字旁加減');
      const seen = walkRegistration.state(dog).version;
      await BQWalkUI.editWalkers(dog, ['志工乙']);
      eq([lastBody.action, lastBody.dogs[0].expectedVersion, lastBody.walker], ['edit', seen, '志工乙'], '修改請求：');
      eq(currentMyWalks().length, 0, '移除自己不留今日紀錄：');
      await BQWalkUI.editWalkers(dog, ['志工乙', '志工我']);
      eq([walkerList(dog), currentMyWalks().length], [['志工乙', '志工我'], 1], '加回自己：');
      fakeD1.set(dog.id, '志工乙、志工我、志工戊'); // 別的手機先改過
      await BQWalkUI.editWalkers(dog, ['志工我']);
      eq(current(), '志工乙、志工我、志工戊', '不蓋掉他人：');
      eq(walkerList(dog), ['志工乙', '志工我', '志工戊'], '更新衝突名單：');
      restoreApi(); fakeD1.forget([dog]); dog.walkedDate = originalDate;
      BQWalkUI.closeWithSheet(); BQWalkUI.hideToast();
    });
    await check('#141 名字清理：去除經常帶敘述，查詢含舊別名', async () => {
      UPLOAD_URL = 'https://worker.test';
      let payload;
      fakeApi((name, ...a) => {
        if (name === 'walkers') return json({ ok: true, names: ['志工甲經常帶', '志工丙'], walkers: {} });
        if (name === 'identity') payload = a[1]; return json({ ok: true, identity: { volunteerId: 'test-person', name: '志工丙', codes: ['aaaaaaaaaaaa', 'bbbbbbbbbbbb'] } });
      });
      await loadWalkerNames();
      eq(walkerNameList, ['志工甲', '志工丙'], '可選人名：');
      BQWelcome.askNameThenWalk([]);
      const input = document.getElementById('obInput'); input.value = '志工丙'; input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#onboard .ob-next').click();
      for (let i=0;i<8;i++) await new Promise(r=>setTimeout(r,0));
      eq(payload.name, '志工丙', '以登記名字解析身分，不推測別名：');
      eq(loadMyCodes(), ['aaaaaaaaaaaa', 'bbbbbbbbbbbb'], '只採服務提供的名字對照：');
    });
    await check('#141 開頭畫面：沒設定名字先問名字，才進說明；說明看完不再出現', async () => {
      phoneStore = fakeStorage(); walkerNameMemory = ''; walkerCodesMemory = null; BQWelcome.close();
      UPLOAD_URL = 'https://worker.test';
      fakeApi((name, ...a) => json({ ok: true, codes: ['aaaaaaaaaaaa'], identity: { volunteerId: 'test-person', name: (name === 'identity' ? a[1] : a[0]).name || '志工新', codes: ['aaaaaaaaaaaa'] } }));
      walkerNameList = ['阿明', '阿華'];
      BQWelcome.start();
      const box = () => document.getElementById('onboard');
      if (!box() || !box().querySelector('#obInput')) throw new Error('要先問名字');
      eq(box().querySelectorAll('[data-ob-name]').length, 0, '沒打字不列名字（K 2026-10-12）：');
      const typed = box().querySelector('#obInput');
      typed.value = '阿'; typed.dispatchEvent(new Event('input', { bubbles: true }));
      eq([...box().querySelectorAll('[data-ob-name]')].map(b => b.textContent), ['阿明', '阿華'], '打一個字出現推薦：');
      box().querySelector('[data-ob-name="阿明"]').click();
      eq([box().querySelector('#obInput').value, box().querySelectorAll('[data-ob-name].on').length], ['阿明', 1], '點了填進去（一人選一個，K 2026-10-08）：');
      box().querySelector('[data-ob-name="阿明"]').click();
      eq(box().querySelector('#obInput').value, '', '再點一次拿掉：');
      walkerNameList = [];
      box().querySelector('.ob-next').click();
      await new Promise(r => setTimeout(r, 0));
      if (!box().querySelector('#obInput')) throw new Error('沒填名字不能往下');
      const input = box().querySelector('#obInput');
      input.value = '志工新'; input.dispatchEvent(new Event('input', { bubbles: true }));
      box().querySelector('.ob-next').click();
      for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));
      const tour = () => document.getElementById('tour');
      eq([loadWalkerName(), box(), !!tour()], ['志工新', null, true], '設好名字進導覽（K 2026-10-09 直接用實際的網頁）：');
      tour().querySelector('[data-tour="done"]').click();
      eq([box(), tour(), phoneStore.get(BQStore.keys.onboarded)], [null, null, '1'], '看完：');
      BQWelcome.start();
      eq(box(), null, '不再出現：');
    });
    await check('K 2026-10-12：沒打字不列名字，打一個字出現推薦（開頭一樣的在前），以前溜過的也找得到', async () => {
      const box = () => document.getElementById('onboard');
      phoneStore = fakeStorage(); walkRecords = freshWalkRecords(); walkerNameMemory = ''; walkerCodesMemory = null; BQWelcome.close();
      walkerNameList = ['阿明', '小華', '明華', '美玲'];
      BQWelcome.start();
      const names = () => [...box().querySelectorAll('[data-ob-name]')].map(b => b.textContent);
      const input = box().querySelector('#obInput');
      input.value = '明'; input.dispatchEvent(new Event('input', { bubbles: true }));
      eq([names(), input.isConnected], [['明華', '阿明'], true], '打「明」（輸入框不重畫，注音選字不會斷）：');
      input.value = '明x'; input.dispatchEvent(new Event('input', { bubbles: true }));
      eq(names(), [], '沒有符合的就不列：');
      input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
      eq(names(), [], '清掉字就不列：');
      BQWelcome.close();
      // 以前溜過、現在表上沒有的（Worker 記下來的）：沒打字不列，打字才推薦；點了也不算表上沒有
      walkerOlderNames = ['老K', '明哲'];
      BQWelcome.start();
      eq(names(), [], '沒打字不列：');
      const input2 = box().querySelector('#obInput');
      input2.value = '老'; input2.dispatchEvent(new Event('input', { bubbles: true }));
      eq(names(), ['老K'], '打字連以前的一起找：');
      box().querySelector('[data-ob-name="老K"]').click();
      eq([names(), box().querySelector('#obInput').value], [['老K'], '老K'], '點了以前的名字：');
      input2.value = '明'; box().querySelector('#obInput').value = '明'; box().querySelector('#obInput').dispatchEvent(new Event('input', { bubbles: true }));
      eq(names(), ['明華', '明哲', '阿明'], '開頭一樣的在前：');
      walkerOlderNames = []; BQWelcome.close();
    });
    await check('K 2026-10-12：名字清單上沒有、但遛狗紀錄裡有（最近沒溜的人）就不用再確認', async () => {
      const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)); };
      const box = () => document.getElementById('onboard');
      phoneStore = fakeStorage(); walkRecords = freshWalkRecords(); walkerNameMemory = ''; walkerCodesMemory = null; BQWelcome.close(); walksData = null;
      UPLOAD_URL = 'https://worker.test';
      fakeApi((api, ...a) => {
        if (api === 'identity' && a[0] === '') { const name = a[1].name; return json({ ok: true, identity: { volunteerId: 'test-person', name, codes: [name === '老K' ? 'abcabcabcabc' : 'cccccccccccc'] } }); }
        if (api === 'walkerCodes') return json({ ok: true, codes: [a[0][0] === '老K' ? 'abcabcabcabc' : 'cccccccccccc'] });
        if (api === 'walks') return json({ version: 1, walks: [{ id: 'x1', name: '舊狗', date: '2026-09-01', walkers: ['abcabcabcabc'] }] });
        throw new Error('不該送別的');
      });
      walkerNameList = ['阿明'];
      BQWelcome.start();
      const input = box().querySelector('#obInput');
      input.value = '老K'; input.dispatchEvent(new Event('input', { bubbles: true }));
      box().querySelector('.ob-next').click();
      await tick();
      eq([box() && box().querySelector('.ob-confirm'), loadWalkerName(), loadMyCodes()], [null, '老K', ['abcabcabcabc']], '紀錄裡有就直接設好：');
      const t = document.getElementById('tour'); if (t) t.querySelector('[data-tour="done"]').click();
      BQWelcome.close(); walksData = null;
    });
    await check('介面評估第四輪：先看看不設名字也能進；按溜了才問名字，設好直接登記；表上沒有的名字先確認；說明可以再打開', async () => {
      const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };
      const box = () => document.getElementById('onboard');
      phoneStore = fakeStorage(); walkRecords = freshWalkRecords(); walkerNameMemory = ''; walkerCodesMemory = null; BQWelcome.close();
      UPLOAD_URL = 'https://worker.test'; sheetWriteState = 'unknown';
      const calls = [];
      fakeApi((api, ...a) => {
        calls.push(api);
        if (api === 'identity' && a[0] === '') { const name = a[1].name; return json({ ok: true, identity: { volunteerId: 'test-person', name, codes: [name === '老K' ? 'abcabcabcabc' : 'cccccccccccc'] } }); }
        if (api === 'walkerCodes') return json({ ok: true, codes: [a[0][0] === '老K' ? 'abcabcabcabc' : 'cccccccccccc'] });
        if (api === 'walks') return json({ version: 1, walks: [{ id: 'x1', name: '舊狗', date: '2026-09-01', walkers: ['abcabcabcabc'] }] });
        if (api === 'walk') return apiJson(fakeD1.walk(a[0]));
        return json({ ok: true });
      });
      fakeD1.forget(allDogs);
      walkerNameList = ['阿明', '阿華'];
      BQWelcome.start();
      eq(box().querySelector('[data-ob="later"]').textContent, '先看看，等一下再設定', '名字頁可以先看看：');
      const typed = box().querySelector('#obInput');
      typed.value = '阿'; typed.dispatchEvent(new Event('input', { bubbles: true }));
      box().querySelector('[data-ob-name="阿明"]').click();
      eq(box().querySelector('[data-ob-name="阿明"]').classList.contains('me-name'), true, '選自己的名字跟一起溜的人樣子不同：');
      box().querySelector('[data-ob="later"]').click();
      const tour = () => document.getElementById('tour');
      eq([box(), !!tour(), (phoneStore.get(BQStore.keys.nameLater) === '1'), activeTab], [null, true, true, 'walk'], '先看看進導覽，在溜狗表上：');
      eq(document.documentElement.classList.contains('tour-open'), true, '導覽期間鎖住背景捲動：');
      eq([tour().querySelector('h2').textContent, tour().querySelector('.tour-n').textContent], ['溜狗表', '1 / 9'], '第一步：');
      eq(tour().querySelector('[data-tour="back"]'), null, '第一步沒有上一步：');
      eq(guideSpotlights(document.querySelector('#main .card[data-dog]')), true, '亮的是最上面那張狗卡（最久沒溜）：');
      if (!document.getElementById('main').closest('[inert]')) throw new Error('導覽時後面的網頁不能按');
      tour().querySelector('[data-tour="next"]').click();
      eq([document.activeElement === tour().querySelector('h2'), tour().querySelector('.tour-n').textContent], [true, '2 / 9'], '換一步焦點到標題：');
      eq(guideSpotlights(document.querySelector('#main .card[data-dog] .last')), true, '第二步亮色籤：');
      tour().querySelector('[data-tour="back"]').click();
      eq(tour().querySelector('h2').textContent, '溜狗表', '上一步：');
      tour().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      eq([tour(), phoneStore.get(BQStore.keys.onboarded), document.getElementById('main').closest('[inert]')], [null, '1', null], 'Esc 等於略過，下次開不再問名字：');
      eq(document.documentElement.classList.contains('tour-open'), false, '關閉後解除背景捲動限制：');
      BQWalkUI.setWalked([allDogs[0]], true);
      eq([!!box(), box().querySelector('.ob-next').textContent], [true, '設定並登記'], '按溜了才問名字：');
      const input = box().querySelector('#obInput');
      input.value = '阿名'; input.dispatchEvent(new Event('input', { bubbles: true }));
      box().querySelector('.ob-next').click();
      await tick();
      eq([/溜狗紀錄裡還沒有「阿名」/.test(box().textContent), /不在|試算表上還沒有/.test(box().textContent), calls.includes('walk')], [true, false, false], '清單上和紀錄裡都沒有的名字先確認，不說不在表上（K 2026-10-12）：');
      calls.length = 0;
      box().querySelector('.ob-next').click();
      await until(() => walkedToday().has(allDogs[0]), 'D1 接受：');
      eq([box(), loadWalkerName(), walkedToday().has(allDogs[0]), (phoneStore.get(BQStore.keys.nameLater) === '1')], [null, '阿名', true, false], '設好直接登記：');
      eq(calls.filter(api => api !== 'favorites'), ['identity', 'identity', 'walk'], '送出：');
      BQWalkUI.hideToast();
      activeTab = 'mine'; myWalks = []; myWalksState = 'ready'; render();
      eq(document.querySelector('#main [data-open-guide]'), null, '#447 我溜過不再放使用說明：');
      showAnalysis();
      document.querySelector('#main .info-home [data-open-guide]').click();
      eq([tour().querySelector('h2').textContent, tour().querySelector('[data-tour="done"]').textContent, activeTab, analysisOpen], ['溜狗表', '關閉', 'walk', false], '#447 資訊的使用說明再打開導覽（回到溜狗表）：');
      tour().querySelector('[data-tour="done"]').click();
      eq(tour(), null, '關閉：');
    });
  } finally {
    hideDetail(); BQWalkUI.hideToast(); BQWelcome.close(); closeGuideIn(); BQWalkUI.closeWithSheet(); restoreApi();
    [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, UPLOAD_URL, walkerNames, walkerNameList, sheetWriteState, walkerNameMemory, walkerCodesMemory, myWalks, myWalksState] = saved;
    render();
  }
}

async function runFix141Tests() {
  const saved = [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, UPLOAD_URL, walkerNames, walkerNameList, sheetWriteState, walkerNameMemory, walkerCodesMemory];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const tick = () => new Promise(r => setTimeout(r, 0));
  const today = BQDates.localDateKey(new Date());
  try {
    await check('K 2026-10-05：同一隻狗同一天以最後一筆為準，後來把我拿掉就不算我溜的', () => {
      const walks = parseMyWalks({ version: 1, walks: [
        { id: '9801', name: '修正甲', date: '2026-10-04', mine: false, walkers: ['bbbbbbbbbbbb'] },
        { id: '9801', name: '修正甲', date: '2026-10-04', mine: true, walkers: ['bbbbbbbbbbbb', 'aaaaaaaaaaaa'] },
        { id: '9801', name: '修正甲', date: '2026-10-04', mine: false, walkers: ['bbbbbbbbbbbb'] },
        { id: '9802', name: '修正乙', date: '2026-10-04', mine: true, walkers: ['aaaaaaaaaaaa'] },
        { id: '9801', name: '修正甲', date: '2026-10-03', mine: true, walkers: ['aaaaaaaaaaaa'] },
      ] }, ['aaaaaaaaaaaa']);
      eq(walks.map(w => `${w.name} ${w.ymd}`), ['修正乙 2026-10-04', '修正甲 2026-10-03']);
    });
    allDogs = [
      { id: '9811', name: '修正丙', cage: 'A01', note: '', covered: false, walkedDate: new Date(), formerIds: [] },
      { id: '9812', name: '修正丁', cage: 'A02', note: '', covered: false, walkedDate: null, formerIds: [] },
      { id: '9813', name: '修正戊', cage: 'A03', note: '', covered: false, walkedDate: new Date(), formerIds: [] },
    ];
    groupMap = {}; activeTab = 'walk'; searchQuery = '';
    phoneStore = fakeStorage(); walkRecords = freshWalkRecords(); sheetWriteState = 'unknown';
    saveWalkerName('志工我'); UPLOAD_URL = 'https://worker.test';
    // /walkers 的試算表名單用來認出「志工我經常帶」是自己；今日狀態來自 D1
    walkerNames = { '9811': '志工我經常帶', '9813': '志工乙' }; walkerNameList = [];
    fakeD1.forget([allDogs[1]]); fakeD1.show([allDogs[0]], '志工我經常帶'); fakeD1.show([allDogs[2]], '志工乙');
    const bodies = [], d1Api = fakeD1.api();
    fakeApi((name, body) => { if (name === 'walk') bodies.push(body); return d1Api(name, body); });
    await check('K 2026-10-05：同一人的不同寫法（名字後多了經常帶）只顯示一次', () => {
      const other = { id: '9890', name: '假' };
      fakeD1.forget([other]);
      eq(walkerList(other), [], '沒名字：');
      fakeD1.show([other], '志工我經常帶、志工我、志工乙');
      eq(walkerList(other), ['志工我', '志工乙']);
      fakeD1.forget([other]);
    });
    await check('K 2026-10-05：整群明確送出已有「志工我經常帶」的狗，仍沿用原寫法，其他狗送「志工我」', async () => {
      await walkRegistration.register([allDogs[0], allDogs[1]]); // 狗群頁整群送出
      eq(bodies.map(b => [b.action, b.walker, b.dogs.map(d => d.id)]), [['walk', '志工我經常帶', ['9811']], ['walk', '志工我', ['9812']]], '送出：');
      showDetail(allDogs[0]);
      eq([...document.querySelectorAll('.last-walk .who-chip')].map(c => c.firstChild.textContent), ['志工我'], '顯示：');
      hideDetail(); BQWalkUI.hideToast();
    });
    await check('K 2026-10-05：只有自己一人、是這支手機登記的，名字旁有 ×，按了取消這次登記', async () => {
      showDetail(allDogs[1]);
      const x = document.querySelector('.last-walk [data-who-undo]');
      if (!x) throw new Error('沒有 ×');
      bodies.length = 0;
      x.click();
      await until(() => !walkedNow(allDogs[1]), '今天已溜拿掉：');
      eq(bodies.map(b => [b.action, b.dogs.map(d => d.id)]), [['undo', ['9812']]], '送出：');
      hideDetail(); BQWalkUI.hideToast();
    });
    await check('ADR 0016：別人唯一的登記、這支手機沒有復原證據，也有 ×；按了請 Worker 找上一次再撤銷', async () => {
      showDetail(allDogs[2]);
      const x = document.querySelector('.last-walk [data-who-undo]');
      if (!x) throw new Error('沒有 ×');
      bodies.length = 0;
      x.click();
      await until(() => bodies.length === 1 && !walkRegistration.pending(allDogs[2]), '撤銷送出：');
      eq(document.querySelector('.last-walk [data-who-undo]'), null, '撤銷後不能再撤：');
      eq(bodies.map(b => [b.action, b.walker, b.dogs.map(d => [d.id, d.name])]), [['undo', '志工我', [['9813', '修正戊']]]], '送出：');
      hideDetail(); BQWalkUI.hideToast();
    });
  } finally {
    hideDetail(); BQWalkUI.hideToast(); restoreApi(); fakeD1.forget(allDogs);
    [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, UPLOAD_URL, walkerNames, walkerNameList, sheetWriteState, walkerNameMemory, walkerCodesMemory] = saved;
    render();
  }
}
