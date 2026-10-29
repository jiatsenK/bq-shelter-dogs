// 會替換 fetch、呼叫 init 的測試一項一項跑，才不會跟其他測試互相干擾
async function runSerialTests() {
  const saved = [allDogs, groupMap, activeTab, searchQuery, loadState, loadWarning];
  const main = document.getElementById('main');
  const tabNames = () => [...document.querySelectorAll('#tabs [data-tab] .t')].map(t => t.textContent);
  const names = () => [...document.querySelectorAll('#main .card .name')].map(n => n.firstChild.textContent);
  const tick = () => new Promise(r => setTimeout(r, 0));
  const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  const DATA = {
    version: 1, syncedAt: '2026-09-25T08:05:00+08:00',
    dogs: [
      { cage: 'A01', id: '9001', name: '讀取甲', walkedDate: null, covered: false, note: '' },
      { cage: 'A02', id: '9002', name: '讀取乙', walkedDate: '2020-01-01', covered: false, note: '' },
    ],
    groups: { '讀取甲': ['讀取乙'], '讀取乙': ['讀取甲'] },
  };
  // fake(端點名) 回傳狗清單的回應；其他端點也走同一個假後端
  const install = fake => fakeApi(name => fake(name));
  const reset = () => { allDogs = []; groupMap = {}; activeTab = 'walk'; searchQuery = ''; };
  try {
    await check('#32 開網頁先出現分類列與「讀取中」，資料到了才畫狗卡', async () => {
      reset();
      let release;
      const calls = install(() => new Promise(r => { release = () => r(json(DATA)); }));
      const done = init();
      eq(tabNames(), ['溜狗表', '常溜狗群', '我溜過', '資訊'], '讀取中就有分類：');
      eq(main.textContent.trim(), '讀取中…', '讀取中：');
      document.querySelector('#tabs [data-tab="mine"]').click();
      eq(activeTab, 'mine', '讀取中也能切到我溜過：');
      document.querySelector('#tabs [data-tab="walk"]').click();
      eq(main.textContent.trim(), '讀取中…', '切回溜狗表仍在讀取：');
      release(); await done; await tick();
      eq(calls.filter(c => c[0] !== 'walkers')[0][0], 'dogs', '讀的資料（#141 溜狗人名字另外跟 Worker 拿）：');
      BQWelcome.close(); // init 會開開頭畫面，測試不需要
      eq(names(), ['讀取甲', '讀取乙'], '狗卡（沒紀錄的在前）：');
      // 顯示成這台裝置的當地時間（在台灣就是 9/25 08:05）
      const t = new Date(DATA.syncedAt);
      eq(document.getElementById('updatedLabel').textContent,
        `資料更新 ${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`, '同步時間：');
      eq([...groupMap['讀取甲']], ['讀取乙'], '可以一起溜：');
      // #62 起讀完狗狗資料後另外讀我的備註（Worker 的 /notes、不行再讀 data/my-notes.json），不算在內
      eq(calls.map(([name]) => name).filter(n => !['walks', 'rest', 'walkers', 'todayWalks'].includes(n)), ['dogs'], '只讀 /api/dogs，不再逐隻抓 dogs/*.md：');
    });
    await check('#32／#247 狗的資料讀取失敗（含 D1 出錯回 503）：標題、搜尋、分類都在，內容區顯示錯誤，可重新讀取', async () => {
      reset();
      document.getElementById('updatedLabel').textContent = '';
      for (const fake of [() => new Response(JSON.stringify({ ok: false, code: 'db', error: '資料庫暫時讀不到狗的資料，請稍後再試' }), { status: 503 }), () => new Response('Not Found', { status: 404 }), () => { throw new TypeError('Failed to fetch'); }, () => new Response('{壞掉')]) {
        install(fake);
        await init();
        eq(tabNames(), ['溜狗表', '常溜狗群', '我溜過', '資訊'], '分類：');
        eq(main.querySelector('.status-msg').firstChild.textContent, '狗的資料讀不到，請確認網路後按「重新讀取」。', '錯誤訊息：');
        eq(document.querySelectorAll('#main .card').length, 0, '沒有狗卡：');
      }
      install(() => json(DATA));
      document.getElementById('retryBtn').click();
      await tick(); await tick();
      eq(names().length, 2, '按重新讀取後：');
    });
    await check('#32 dogs.json 少了可以一起溜：狗卡照常顯示，上方提醒', async () => {
      reset();
      const { groups, ...noGroups } = DATA;
      install(() => json(noGroups));
      await init(); await tick();
      eq(names().length, 2, '狗卡：');
      if (!main.querySelector('.alert-box.warn')) throw new Error('要提醒可以一起溜讀不到');
      eq(JSON.stringify(groupMap), '{}', '可以一起溜：');
    });
  } finally {
    restoreApi();
    [allDogs, groupMap, activeTab, searchQuery, loadState, loadWarning] = saved;
    BQWelcome.close(); // init 會開開頭畫面（後面的網頁設成不能點），關掉才不影響後面的測試
    render();
  }
}

// #91 首頁照片：第一屏照片優先載入；walks.json 讀完不重畫清單
async function runFirstScreenTests() {
  const saved = [allDogs, groupMap, activeTab, searchQuery, myWalks, myWalksState, phoneStore, walkRecords];
  try {
    phoneStore = fakeStorage(); walkRecords = freshWalkRecords();
    allDogs = Array.from({ length: 10 }, (_, i) => ({ name: `首屏${i}`, id: String(9700 + i), cage: 'A01', walkedDate: null, covered: false, note: '', intro: '', sex: '' }));
    groupMap = {}; searchQuery = ''; activeTab = 'walk';
    render();
    await check('#91 溜狗表前 8 張照片立即載入、高優先，之後的延後載入', () => {
      const imgs = [...document.querySelectorAll('#main .card .thumb img')];
      eq(imgs.map(i => i.getAttribute('loading')), [...Array(8).fill(null), 'lazy', 'lazy'], 'loading：');
      eq(imgs.slice(0, 8).every(i => i.getAttribute('fetchpriority') === 'high'), true, '高優先：');
    });
    await check('#91 walks.json 讀完：在溜狗表只更新「我溜過」的數字，照片元素不換掉', async () => {
      const first = document.querySelector('#main .card .thumb img');
      fakeApi(() => apiJson({ version: 1, walks: [{ id: '9700', name: '首屏0', date: '2026-09-24', mine: true, walkers: ['aaaaaaaaaaaa'] }] }));
      walkerCodesMemory = ['aaaaaaaaaaaa'];
      let savedCodes = null;
      try { savedCodes = localStorage.getItem(WALKER_CODES_KEY); localStorage.removeItem(WALKER_CODES_KEY); } catch (e) { /* 無痕模式 */ }
      try { await loadMyWalks(); } finally {
        walkerCodesMemory = null;
        try { if (savedCodes != null) localStorage.setItem(WALKER_CODES_KEY, savedCodes); } catch (e) { /* 無痕模式 */ }
      }
      eq(document.querySelector('#main .card .thumb img'), first, '同一個照片元素：');
      eq(document.querySelector('#tabs [data-tab="mine"] .n').textContent, '1', '我溜過數字：');
    });
    check('#91 不載入 Google Fonts，改用手機內建字型', () => {
      if (/fonts\.googleapis|fonts\.gstatic/.test(INDEX_HTML)) throw new Error('index.html 還在載入 Google Fonts');
    });
    check('#93 性別用內嵌 SVG 圖示、有可讀標籤，不再用 ♂♀ 文字', () => {
      const box = document.createElement('div');
      const mark = sex => { box.innerHTML = sexMark({ sex }); return box.querySelector('.sex'); };
      eq(mark('♂').querySelector('use').getAttribute('href'), '#i-male', '♂ 圖示：');
      eq(mark('♂').getAttribute('aria-label'), '公', '♂ 標籤：');
      eq(mark('♀').querySelector('use').getAttribute('href'), '#i-female', '♀ 圖示：');
      eq(mark('♀').getAttribute('aria-label'), '母', '♀ 標籤：');
      if (/[♂♀]/.test(mark('♂').textContent + mark('♀').textContent)) throw new Error('不應再用 ♂♀ 文字');
      eq(mark('').innerHTML, '', '沒有性別不放內容：');
      for (const id of ['i-male', 'i-female']) {
        if (!INDEX_HTML.includes(`<symbol id="${id}"`)) throw new Error(`index.html 缺 ${id} 圖示`);
      }
    });
  } finally {
    restoreApi();
    [allDogs, groupMap, activeTab, searchQuery, myWalks, myWalksState, phoneStore, walkRecords] = saved;
  }
}


async function runFastOpenTests() {
  const css = await fetch('../public/css/app.css').then(r => r.text());
  const rule = sel => (css.match(new RegExp(`\\n${sel.replace('.', '\\.')} \\{([^}]*)\\}`)) || [])[1] || '';
  await check('手機開啟加速：index.html 在 css 前面就開始抓 dogs.json', () => {
    const at = INDEX_HTML.indexOf("window.__dogsEarly = fetch('api/dogs'");
    if (at < 0) throw new Error('index.html 沒有提早抓 dogs.json');
    if (at > INDEX_HTML.indexOf('<link rel="stylesheet" href="css/app.css">')) throw new Error('要放在 css 前面，不然會等 css 下載完才執行');
    if (!/document\.addEventListener\('DOMContentLoaded', init\)/.test(APP_JS)) throw new Error('init 要等 find.js、analysis.js 也載入完才開始');
  });
  await check('手機開啟加速：loadDogsData 第一次用提早抓的那份（BQApi.dogs 接手），之後照常抓', async () => {
    const body = JSON.stringify({ syncedAt: '2026-09-30T00:00:00Z', dogs: [{ name: '提早', id: '9800', cage: 'A01' }] });
    try {
      window.__dogsEarly = Promise.resolve(new Response(body));
      eq((await loadDogsData()).dogs.map(d => d.name), ['提早'], '第一次：');
      eq(window.__dogsEarly, null, '第一次用完清掉：');
      // 測試頁的靜態伺服器沒有 /api/dogs，照常抓就會拿到 404
      let again = '';
      try { await loadDogsData(); } catch (e) { again = e.message; }
      eq(again, '讀取狗的資料失敗（HTTP 404）。', '第二次（更新）照常抓：');
      window.__dogsEarly = Promise.reject(new TypeError('offline'));
      let msg = '';
      try { await loadDogsData(); } catch (e) { msg = e.message; }
      eq(msg, '連不到網站，可能是網路中斷。', '提早抓失敗一樣顯示連不到：');
    } finally {
      window.__dogsEarly = null;
    }
  });
  await check('手機開啟加速：狗卡、找狗籠位列在畫面外先不排版', () => {
    for (const sel of ['.card', '.find-row']) {
      if (!/content-visibility: auto;/.test(rule(sel))) throw new Error(`${sel} 沒有 content-visibility: auto`);
      if (!/contain-intrinsic-size: auto \d+px;/.test(rule(sel))) throw new Error(`${sel} 沒有 contain-intrinsic-size（捲動會跳）`);
    }
  });
}
