// ── V5.2（#75 再次入所、#76 標題精簡、#79 收起）──
async function runV52Tests() {
  const saved = [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords];
  const T = new Date(2026, 8, 25, 10);
  try {
    const { dogs } = parseDogsData({ dogs: [
      { name: '再入甲', id: '2026051203', cage: '新B08', walkedDate: '2026-09-10', formerIds: ['2018041318', ''] },
      { name: '一般乙', id: '2024010501', cage: '母幼A', walkedDate: '2026-09-01' },
      { name: '一般丙', id: '2023040701', cage: '母幼A', walkedDate: '2026-09-20' },
      { name: '新來丁', id: '', cage: '住院區', walkedDate: null },
    ] });
    allDogs = dogs; groupMap = {}; activeTab = 'walk'; searchQuery = '';
    phoneStore = fakeStorage(); walkRecords = freshWalkRecords();

    await check('#75／#639 再次入所：讀 formerIds、詳細資訊一行一件事列出入所紀錄、分析在所時間從第一次算', () => {
      eq([dogs[0].formerIds, dogs[1].formerIds], [['2018041318'], []]);
      eq(ymd(intakeDate(dogs[0], T)), '2018/4/13', '入所日取最早：');
      eq(ymd(intakeDate(dogs[1], T)), '2024/1/5', '沒舊編號照舊：');
      const html = detailHtml(dogs[0], T);
      const box = document.createElement('div');
      box.innerHTML = html;
      const lines = () => [...box.querySelectorAll('[data-section="intro"] .stay-lines li')].map(li => li.textContent);
      eq(lines(), ['2018/04/13入所', '2026/05/12入所'], '一個編號一行入所，照日期排、不逐行重複編號：');
      eq(box.querySelector('[data-section="intro"] h3').firstChild.nextSibling.textContent, '出入所紀錄', '標題叫出入所紀錄：');
      if (box.querySelector('.stay-lines').textContent.includes('次入所')) throw new Error('不標第幾次入所');
      if (detailHtml(dogs[1], T).includes('stay-lines')) throw new Error('只有目前編號不列');
      // 有離所紀錄：離所那行照離所紀錄的日期與原因；入所那行是手填的入所原因；沒離所紀錄的手填離所原因（K 2026-10-26）
      const [left] = parseDogsData({ dogs: [{ id: '2026051203', name: '再入', cage: 'A', stays: [
        { number: '', in: '2015-01-02', out: '2016-03-04', reason: '被棄養', outReason: '轉所' },
        { number: '2018041318', in: '2018-04-13', out: '2020-05-14', reason: '迷路', departed: true, departure: '認養' },
        { number: '2026051203', in: '2026-05-12', out: '', reason: '' },
      ] }] }).dogs;
      box.innerHTML = detailHtml(left, T);
      eq(lines(), ['2015/01/02入所被棄養', '2016/03/04離所轉所', '2018/04/13入所迷路', '2020/05/14離所認養', '2026/05/12入所'], '入所／離所放在原因前面：');
      eq(box.querySelectorAll('.stays-table, .reentry').length, 0, '編號下面不再有表：');
    });

    await check('#76 詳細資訊標題沒有說明文字；分析頁沒有散布圖、Top 10 沒有長條', () => {
      const box = document.createElement('div');
      box.innerHTML = detailHtml(dogs[1], T);
      const h = sec => box.querySelector(`[data-section="${sec}"] h3`);
      eq(h('note').textContent.trim(), '試算表備註');
      eq(h('note').querySelector('.sub'), null, '沒有說明文字：');
      eq(box.querySelector('[data-section="mynote"]'), null, 'V9（#141）拿掉我的備註：');
      const a = document.createElement('div');
      a.innerHTML = analysisHtml(dogs, T);
      eq([a.querySelector('.a-scatter'), a.querySelector('.a-dog-bar'), typeof stayVsWalk], [null, null, 'undefined']);
      if (a.textContent.includes('入所時間 × 最近未遛天數')) throw new Error('散布圖要拿掉');
      eq(a.querySelectorAll('.a-dog').length, 3, 'Top 10 仍列出有入所日期的狗：');
    });

    await check('#78 讀取中顯示卡片骨架（螢幕閱讀器仍讀得到讀取中）；照片載入完才淡入', () => {
      loadState = 'loading';
      try { render(); } finally { loadState = 'ready'; }
      const main = document.getElementById('main');
      eq([main.querySelectorAll('.card.skeleton').length, main.textContent.trim()], [6, '讀取中…']);
      if (!photoThumb(dogs[0]).includes(`onload="this.classList.add('loaded')"`)) throw new Error('照片要淡入');
      render();
    });
  } finally {
    hideDetail(); BQWalkUI.hideToast();
    [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords] = saved;
    render();
  }
}

// ── 警示排版、詳細資訊籠位可點（K 2026-10-09）──
async function runWarnLayoutTests() {
  const saved = [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords];
  const main = document.getElementById('main');
  const box = main.parentElement;
  try {
    box.classList.remove('hidden');
    allDogs = [
      { id: '9701', name: '警示甲', cage: '新A03', note: '不親狗，會咬', covered: false, walkedDate: new Date(2026, 0, 1) },
      { id: '9702', name: '一般乙', cage: '新A04', note: '', covered: false, walkedDate: new Date(2026, 0, 2) },
    ];
    groupMap = {}; activeTab = 'walk'; searchQuery = '';
    phoneStore = fakeStorage(); walkRecords = freshWalkRecords();
    render();
    await check('K 2026-10-09 警示排版：警示只排在照片到按鈕那一欄下面，不蓋過天數欄；天數字跟名字同一列', async () => {
      const card = main.querySelector('.card.flagged');
      if (!card.querySelector(':scope > .warn-note')) throw new Error('警示要是卡片的直接子元素，才排得到第二列');
      // 測試頁沒有載 css/app.css，所以檢查樣式規則本身
      const css = await fetch('../public/css/app.css').then(r => r.text());
      ['.card:not(.skeleton) .last { grid-column: 1; grid-row: 1; }',
        '.card:not(.skeleton) > .warn-note { grid-column: 2 / -1; grid-row: 2;',
        '.card.flagged:not(.skeleton)::before {',
        '.card.flagged:not(.skeleton):has(.last .val.red)::before { background: var(--tab-red); }'].forEach(rule => {
        if (!css.includes(rule)) throw new Error('少了樣式：' + rule);
      });
    });
    await check('K 2026-10-09 詳細資訊的籠位標籤可以點，點了開平面圖（在哪）', () => {
      showDetail(allDogs[0]);
      const badge = document.querySelector('#detail .cage-badge[data-where]');
      if (!badge || badge.tagName !== 'BUTTON') throw new Error('籠位要是按鈕');
      badge.click();
      const where = document.querySelector('.where-sheet');
      if (!where || where.hidden) throw new Error('沒有開在哪面板');
      if (typeof whereClose === 'function') whereClose();
      hideDetail();
    });
  } finally {
    if (typeof whereClose === 'function') whereClose();
    hideDetail();
    box.classList.add('hidden');
    history.replaceState(null, '');
    [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords] = saved;
    render();
  }
}

// #86 詳細資訊按鈕改在外框綁一次（事件委派）
async function runDetailWiringTests() {
  const saved = [allDogs, groupMap, phoneStore, walkRecords];
  try {
    await check('#86 重畫很多次，按一下還是只做一次；找不到的一起溜狗按鈕不能按', () => {
      phoneStore = fakeStorage(); walkRecords = freshWalkRecords();
      allDogs = [{ name: '委派甲', id: '9601', cage: 'A01', note: '', intro: '', sex: '' },
        { name: '委派乙', id: '9602', cage: 'A01', note: '', intro: '', sex: '' }];
      groupMap = { '委派甲': new Set(['委派乙', '不在名單']) };
      pickedBuddies.clear();
      showDetail(allDogs[0]);
      renderDetail(); renderDetail(); renderDetail();
      document.querySelector('#detail .pick[data-pick="9602"]').click();
      eq([...pickedBuddies], ['9602'], '勾一次：');
      const ghost = [...document.querySelectorAll('#detail .buddy')].find(b => b.textContent.includes('不在名單'));
      eq(ghost.disabled, true, '不在名單的狗：');
      document.querySelector('#detail .buddy[data-dog="1"]').click();
      eq(detailDog, allDogs[1], '點照片換看那隻：');
      pickedBuddies.clear();
      hideDetail();
    });
    await check('#86 詳細資訊關掉後主照片才載入完，不會出錯', () => {
      const box = document.createElement('div');
      box.innerHTML = '<div data-zoom><img></div><button id="photoPick"></button>';
      document.body.appendChild(box);
      detailDog = { name: '晚到', id: '9603' };
      labelPhotoPick(box);
      detailDog = null; box.remove();
      box.querySelector('img').dispatchEvent(new Event('load')); // 以前這裡會丟錯
    });
  } finally {
    [allDogs, groupMap, phoneStore, walkRecords] = saved;
  }
}

// 同籠的狗（K 2026-09-27）：跟「可以一起溜」一樣的格子，可勾選一起記
// 固定名詞（GLOSSARY.md）：畫面上的字不再出現舊說法；註解、警示關鍵字（勿遛）、試算表欄名「誰遛的」除外
async function runTermTests() {
  await check('固定名詞：畫面上的字用「溜、放回、長期收起、狗名、入所介紹」，不再出現舊說法', () => {
    const shown = src => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .replace(/常遛狗群|勿遛|勿蹓|「誰遛的」|'誰遛的'|上次遛/g, ''); // K 2026-10-13 指定左側標題「上次遛」
    const old = ['遛', '移回', '一直收起', '今天先收起', '犬名', '犬隻', '狗狗', '狗卡資訊', '平均隔', '最久隔', '日期異常', '尚無', '已存到 Git', '代號服務'];
    const hits = [];
    for (const [file, src] of [['index.html', INDEX_HTML.replace(/<!--[\s\S]*?-->/g, '')], ['app.js', APP_JS], ['tour.js', TOUR_JS], ['photo.js', PHOTO_JS], ['walk-ui.js', WALK_UI_JS], ['welcome.js', WELCOME_JS], ['favorites.js', FAVORITES_JS], ['analysis.js', ANALYSIS_JS], ['find.js', FIND_JS]]) {
      const text = shown(src);
      for (const w of old) if (text.includes(w)) hits.push(`${file}：${w}`);
    }
    eq(hits, [], '還有舊說法：');
  });
}

// critique 2026-10-09 P1：往下捲時頁首的標題那一行捲走，搜尋框留在畫面上；分析頁頁首整個留著
async function runHeaderTuckTests() {
  const css = await fetch('../public/css/app.css').then(r => r.text());
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:absolute;left:-9999px;width:390px;height:844px;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><style>${css}</style><body>${INDEX_HTML.match(/<header class="app">[\s\S]*?<\/header>/)[0]}<main style="height:3000px"></main></body>`);
  doc.close();
  const win = frame.contentWindow;
  const header = doc.querySelector('header.app');
  // 跟 js/app.js 的 syncHeaderTuck 一樣算
  header.style.setProperty('--brand-h', `${Math.round(parseFloat(win.getComputedStyle(header).paddingTop) + doc.querySelector('.brand').offsetHeight)}px`);
  try {
    await check('頁首收起：往下捲時標題那一行捲走，搜尋框還貼在畫面最上面', () => {
      win.scrollTo(0, 900);
      eq(header.getBoundingClientRect().top < -30, true, '標題那一行要捲走：');
      eq(Math.round(doc.getElementById('searchInput').getBoundingClientRect().top) >= 0, true, '搜尋框要看得到：');
    });
    await check('頁首收起：分析頁的頁首整個留著（返回、分析按鈕在標題那一行）', () => {
      doc.documentElement.classList.add('analysis-open');
      win.scrollTo(0, 900);
      eq(Math.round(header.getBoundingClientRect().top), 0);
    });
  } finally {
    frame.remove();
  }
}

// K 2026-10-09 病歷夾色籤：頁首範圍字（畫面上第一隻到最後一隻多久沒溜）、網址列顏色
async function runRangeTests() {
  const TODAY = new Date();
  const ymdDash = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const dog = (walkedDate, covered = false) => parseDogsData({ dogs: [{ id: '2024100901', name: '範圍', cage: '舊A01', note: '', covered, walkedDate }] }).dogs[0];
  const ago = n => ymdDash(new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - n));
  await check('籠位查詢導覽：略過沒有籠號的區，只用舊／新犬舍有效籠位，示範與亮的狗一致', async () => {
    const saved = [allDogs, activeTab, searchQuery, loadWalkView()];
    try {
      activeTab = 'walk'; searchQuery = ''; saveWalkView('photo');
      for (const cage of ['舊A03', '新B04']) {
        allDogs = [{ ...dog(ago(20)), id: 'demo0', cage: '母幼' }, { ...dog(ago(10)), id: 'demo1', cage }, { ...dog(ago(5)), id: 'demo2', cage: '舊A99' }];
        render();
        await guideAt('籠位查詢');
        eq(whereDog, allDogs[1], '亮的籠位與打開的狗一致：');
        if (!document.getElementById('whereTitle').textContent.includes(cage)) throw new Error('面板應顯示實際籠號');
        closeGuideIn();
      }
      allDogs = [{ ...dog(ago(20)), cage: '母幼' }]; render();
      await guideAt('籠位查詢');
      eq([whereDog, document.querySelector('#tour').classList.contains('no-target')], [null, true], '沒有有效籠號時不拿其他區示範：');
    } finally {
      closeGuideIn();
      if (whereDog) whereClose();
      saveWalkView(saved[3]); [allDogs, activeTab, searchQuery] = saved; render();
    }
  });
  await check('2026-10-09 範圍字：跟狗卡同一種說法（N 天前、今天、沒有紀錄）', () => {
    eq([dayWord(dog(ago(45)), TODAY), dayWord(dog(ago(0)), TODAY), dayWord(dog(''), TODAY)], ['45 天前', '今天', '沒有紀錄']);
  });
  await check('2026-10-09 範圍字：頭尾兩隻；一樣只寫一次；沒有狗就不寫', () => {
    eq(rangeText(['45 天前', '20 天前', '4 天前']), '畫面上：45 天前 ～ 4 天前');
    eq(rangeText(['2 天前', '2 天前']), '畫面上：2 天前');
    eq(rangeText([]), '');
  });
  await check('2026-10-09 頁首有範圍字的位置；網址列顏色是檔案綠', () => {
    const doc = new DOMParser().parseFromString(INDEX_HTML, 'text/html');
    eq(!!doc.querySelector('header.app #rangeLabel[hidden]'), true, '範圍字在頁首、一開始藏著：');
    eq(doc.querySelector('meta[name="theme-color"]').getAttribute('content'), '#1F5C4D', 'theme-color：');
    eq(MANIFEST.theme_color, '#1F5C4D', '主畫面捷徑：');
  });
  await check('2026-10-09 導覽示範「溜了」只換畫面上的樣子：不送出、不記成已溜，收回後畫回原本', async () => {
    const saved = [allDogs, activeTab, searchQuery];
    let calls = [];
    try {
      allDogs = [dog(ago(12))]; activeTab = 'walk'; searchQuery = ''; render();
      calls = fakeApi(() => new Response('{}'));
      await guideAt('溜狗登記');
      await new Promise(r => setTimeout(r, 800));
      const btn = () => document.querySelector('#main .card[data-dog] .walk-btn');
      eq([btn().textContent.trim(), calls.length, walkedToday().has(allDogs[0])], ['已溜', 0, false], '畫面變已溜、沒送出、沒記：');
      closeGuideIn();
      eq(btn().textContent.trim(), '溜了', '收回：');
    } finally {
      closeGuideIn();
      [allDogs, activeTab, searchQuery] = saved; restoreApi(); render();
    }
  });
  await check('K 2026-10-09 導覽教切換照片／列表：亮右上角切換鈕，示範切過去，收回切回原本的', async () => {
    const saved = [allDogs, activeTab, searchQuery, loadWalkView()];
    try {
      allDogs = [dog(ago(12))]; activeTab = 'walk'; searchQuery = ''; saveWalkView('photo'); render();
      await guideAt('照片／列表');
      eq(guideSpotlights(document.querySelector('#main .walk-tools .seg')), true, '亮切換鈕：');
      eq([loadWalkView(), !!document.querySelector('#main .row-dog')], ['list', true], '示範切到列表：');
      closeGuideIn();
      eq([loadWalkView(), !!document.querySelector('#main .card[data-dog]')], ['photo', true], '收回切回照片：');
    } finally {
      closeGuideIn();
      saveWalkView(saved[3]);
      [allDogs, activeTab, searchQuery] = saved; render();
    }
  });
}

async function runCritique3Tests() {
  const saved = [allDogs, groupMap, phoneStore, walkRecords, dataSyncedAt, walkerNamesOffline];
  try {
    phoneStore = fakeStorage(); walkRecords = freshWalkRecords();
    const mk = (name, id, note) => ({ name, id, cage: '新A04', walkedDate: null, covered: false, note, intro: '', sex: '', formerIds: [] });
    allDogs = [mk('測試兇', '2024100801', '不要推他身體移位，會兇想咬人'), mk('測試乖', '2024100802', '')];
    groupMap = {};
    await check('介面評估第三輪：在哪面板有警示的狗看得到警示，沒有的不顯示', () => {
      if (!specialFlag(allDogs[0].note)) throw new Error('測試資料應該要有警示');
      const box = document.createElement('div');
      box.innerHTML = whereHtml(allDogs[0]);
      if (!box.querySelector('.warn-note')) throw new Error('有警示的狗沒有警示');
      if (!box.querySelector('.warn-note').textContent.includes('會兇想咬人')) throw new Error('警示要有備註原文');
      box.innerHTML = whereHtml(allDogs[1]);
      eq(box.querySelector('.warn-note'), null, '沒有警示的狗：');
    });
    await check('介面評估第三輪：確認上傳不用沒定義的 --green（會變亮綠）', async () => {
      const css = await fetch('../public/css/app.css').then(r => r.text());
      if (/var\(--green\s*,/.test(css)) throw new Error('還有 var(--green, …)');
    });
    await check('介面評估第三輪：提示條出現時內容底部多留空白，收起就拿掉', () => {
      BQWalkUI.showToast('測試');
      if (!document.body.classList.contains('toast-on')) throw new Error('沒有 toast-on');
      BQWalkUI.hideToast();
      if (document.body.classList.contains('toast-on')) throw new Error('收起後還有 toast-on');
    });
    await check('介面評估第三輪：沒網路時頁首和溜狗人會說沒網路', () => {
      const label = document.getElementById('updatedLabel');
      dataSyncedAt = new Date(2026, 9, 8, 9, 1);
      walkerNamesOffline = true; renderUpdatedLabel();
      eq(label.textContent, '沒網路・資料 10/8 09:01', '沒網路：');
      if (!BQWalkUI.walkerChipsHtml(allDogs[1], [], new Date()).includes('讀不到（沒網路）')) throw new Error('溜狗人沒說沒網路');
      walkerNamesOffline = false; renderUpdatedLabel();
      eq(label.textContent, '資料更新 10/8 09:01', '有網路：');
      eq(BQWalkUI.walkerChipsHtml(allDogs[1], [], new Date()), '<span class="lw-none">—</span>', '有網路沒名字：');
    });
  } finally {
    [allDogs, groupMap, phoneStore, walkRecords, dataSyncedAt, walkerNamesOffline] = saved;
    renderUpdatedLabel();
    BQWalkUI.hideToast();
  }
}
