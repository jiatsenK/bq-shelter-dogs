async function runTourLayoutTests() {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:absolute;left:-9999px;width:390px;height:660px;border:0';
  const ready = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
  frame.srcdoc = INDEX_HTML.replace('<head>', `<head><base href="${new URL('../public/', location.href)}"><script>window.__BQ_TEST__=true;<\/script>`);
  document.body.appendChild(frame);
  await ready;
  const win = frame.contentWindow;
  win.__tourFixture = await fetch('fixtures/dogs.json').then(r => r.json());
  try {
    win.eval(`
      const fixtureStorage = new Map();
      phoneStore = BQStore.create({ getItem: k => fixtureStorage.get(k) || null, setItem: (k, v) => fixtureStorage.set(k, v), removeItem: k => fixtureStorage.delete(k) });
      const originalMedia = window.matchMedia.bind(window);
      window.__tourMedia = originalMedia;
      window.matchMedia = q => q.includes('prefers-reduced-motion') ? { matches: true } : originalMedia(q);
      document.head.insertAdjacentHTML('beforeend', '<style>* { transition: none !important; animation: none !important; }</style>');
      saveWalkerName('測試'); saveMyCodes(['abcdef123456']);
      const fixtureWalks = { walks: parseDogsData(window.__tourFixture).dogs.slice(0, 9).map(d => ({ id: d.id, name: d.name, date: BQDates.localDateKey(new Date()), walkers: ['abcdef123456'] })) };
      BQApi.walks = BQApi.walksYear = BQApi.myDogs = () => BQApi.settle(Response.json(fixtureWalks));
      applyDogsData(parseDogsData(window.__tourFixture));
      todayState = 'ready'; render(); // D1 今日紀錄讀到才排狗卡（#456）；導覽版面測試沒有 Worker，直接當作已讀到
      walksData = fixtureWalks; myWalks = parseMyWalks(fixtureWalks); myWalksState = 'ready';
    `);
    for (const demo of ['detail', 'view', 'tab', 'find']) {
      await check(`手機導覽 ${demo}：說明卡不遮擋示範目標、切換鈕不藏在搜尋框下`, async () => {
        closeGuideIn(win);
        win.eval("activeTab = 'walk'; findZone = 'all'; findCage = null; searchQuery = ''; render(); window.scrollTo(0, 500)");
        const title = { detail: '狗資料', view: '照片／列表', tab: '我溜過', find: '找狗' }[demo];
        await guideAt(title, win);
        await new Promise(r => setTimeout(r, 80));
        const result = win.eval(`(() => {
          const selector = { detail: '#detail', view: '#main .walk-tools .seg', tab: '#main .mc-head', find: '#main .find-map-card .find-map' }['${demo}'];
          const el = document.querySelector(selector);
          const a = document.querySelector('.tour-tip').getBoundingClientRect(), b = el.getBoundingClientRect();
          return { overlap: a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
            hiddenByHeader: '${demo}' === 'view' && b.top < appHeader.getBoundingClientRect().bottom,
            calendar: '${demo}' !== 'tab' || el.matches('.mc-head') };
        })()`);
        eq(result, { overlap: false, hiddenByHeader: false, calendar: true }, '手機 390×660：');
      });
    }
    await check('手機導覽：工具列縮小可見範圍時，說明卡跟著可見高度定位', async () => {
      Object.defineProperty(win, 'visualViewport', { configurable: true, value: { width: 390, height: 500, offsetTop: 24 } });
      await new Promise(r => setTimeout(r, 80));
      const r = frame.contentDocument.querySelector('.tour-tip').getBoundingClientRect();
      if (r.top < 24 || r.bottom > 524) throw new Error('說明卡超出可見範圍');
      delete win.visualViewport;
    });
    await check('加入主畫面教學：手機有最後一步，桌機與主畫面模式省略；兩種手機都有步驟', async () => {
      await guideAt('加入手機主畫面', win);
      eq(frame.contentDocument.querySelector('.tour-n').textContent, '10 / 10', '手機最後一步：');
      eq(frame.contentDocument.querySelector('h2#tourTitle').textContent, '加入手機主畫面', '教學標題：');
      const html = frame.contentDocument.querySelector('.tour-install').innerHTML;
      if (!html.includes('Safari') || !html.includes('Chrome') || !html.includes('加入主畫面')) throw new Error('缺少手機操作步驟');
      frame.style.width = '1280px';
      await new Promise(r => setTimeout(r, 80));
      eq(frame.contentDocument.querySelector('.tour-n').textContent, '10 / 10', '教學開著時旋轉／改寬度，不遺失最後一步：');
      await guideAt('溜狗表', win);
      eq(frame.contentDocument.querySelector('.tour-n').textContent, '1 / 9', '桌機：');
      frame.style.width = '390px';
      win.eval("window.matchMedia = q => q === '(display-mode: standalone)' ? { matches: true } : window.__tourMedia(q)");
      await guideAt('溜狗表', win);
      eq(frame.contentDocument.querySelector('.tour-n').textContent, '1 / 9', '主畫面模式：');
    });
  } finally {
    closeGuideIn(win);
    frame.remove();
  }
}
