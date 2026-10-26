// ── #59 分析頁（js/analysis.js）──
async function runAnalysisTests() {
  const T = new Date(2026, 8, 25, 10);
  const tick = () => new Promise(r => setTimeout(r, 0));
  const D = (name, id, cage, walkedDaysAgo, extra = {}) => ({
    name, id, cage, note: '', covered: false, intro: '', sex: '',
    walkedDate: walkedDaysAgo == null ? null : new Date(2026, 8, 25 - walkedDaysAgo), ...extra });
  const dogs = [
    D('甲長', '2017070102', '新A07', 3, { sex: '♂', intro: '親人' }),       // 9 年
    D('乙長', '2020010101', '新A02', 12, { sex: '♀' }),                      // 6 年多，12 天沒遛
    D('丙長', '2025092501', '舊B04', 40, { sex: '♀', intro: 'x' }),          // 剛好滿 1 年
    D('小一', '2025092601', 'C區11', 0, { sex: '♂' }),                       // 差一天滿 1 年
    D('小二', '2026072001', 'C區12', 8),                                       // 2 個月
    D('無日', '2019050501', '舊B01', null),                                    // 沒遛狗紀錄、沒人照顧
    D('照顧', '2019050502', '舊B03', null, { covered: true }),                 // 沒日期但有人照顧
    D('沒號', '', '新獨04', 1),
    D('怪號', 'A123', '住院區', 2),
    D('未來', '2027010101', '母幼A', 2),
  ];
  const rows = analysisRows(dogs, T);
  const names = list => list.map(r => (r.dog || r).name);
  await check('#59 入所日期取編號前 8 碼；非 10 碼數字、不合理或未來日期不算', () => {
    eq(ymd(intakeDate({ id: '2024032902' }, T)), '2024/3/29');
    eq([intakeDate({ id: '' }, T), intakeDate({ id: 'A123' }, T), intakeDate({ id: '20240230011' }, T),
      intakeDate({ id: '2024023001' }, T), intakeDate({ id: '2027010101' }, T)], [null, null, null, null, null]);
    eq([monthsBetween(new Date(2026, 2, 29), new Date(2026, 3, 28)), monthsBetween(new Date(2026, 2, 29), new Date(2026, 3, 29))], [0, 1], '滿月照日曆：');
    eq([zoneOf('新A07'), zoneOf('C區12'), zoneOf('住院區'), zoneOf('')], ['新A', 'C區', '住院區', '未填籠位']);
  });
  await check('#59 入所多久分布（2026-10-08 入所年度分布拿掉，跟這張同一份資料）', () => {
    eq(stayDistribution(rows).map(b => b.count), [1, 0, 1, 1, 0, 0, 4]);
    eq(stayDistribution(rows).map(b => b.label)[6], '5 年以上');
    eq(typeof intakeYears, 'undefined', '入所年度分布已拿掉：');
  });
  await check('#59 在所最久 Top N：依入所日由早到晚，沒入所日期的不列', () => {
    eq(names(longestStay(rows, 3)), ['甲長', '無日', '照顧']);
    eq(longestStay(rows).length, 7, '只有 7 隻有入所日期：');
  });
  await check('#59 各區平均在所時間（由久到短）、長期在所比例（滿 1 年）', () => {
    const z = zoneAverages(rows);
    eq(z.map(x => `${x.zone}:${x.count}`), ['新A:2', '舊B:3', 'C區:2']);
    const days = (y, m, d) => Math.floor((T - new Date(y, m - 1, d)) / 86400000);
    eq(Math.round(z[0].avgDays), Math.round((days(2017, 7, 1) + days(2020, 1, 1)) / 2), '新A 平均：');
    eq(longStayShare(rows), { long: 5, total: 7, pct: 5 / 7 * 100 });
  });
  await check('#59 公母在所時間差異只算有性別的狗，並顯示缺幾隻', () => {
    const s = sexComparison(rows);
    eq([s.male.count, s.female.count, s.missing], [2, 2, 6]);
    eq([s.male.long, s.female.long], [1, 2], '滿 1 年：');
    eq(s.female.medianDays, s.female.avgDays, '兩隻時中位數＝平均：');
  });
  await check('#59 資料完整度：各項缺幾隻、是哪幾隻；照片查完才列', () => {
    const c = dataCompleteness(rows, null);
    eq(c.items.map(i => `${i.label}:${names(i.dogs).join('/')}`), [
      '沒有編號:沒號', '編號看不出入所日期:怪號/未來', '沒有溜狗日期:無日/照顧',
      '沒有性別:小二/無日/照顧/沒號/怪號/未來', '沒有介紹:乙長/小一/小二/無日/照顧/沒號/怪號/未來']);
    const photos = new Map(dogs.filter(d => d.id).map(d => [d.id, d.name !== '乙長']));
    eq(names(dataCompleteness(rows, photos).items[5].dogs), ['乙長', '沒號'], '沒有照片：');
  });
  await check('#59 分析頁從頁首圖示打開：各項都有，點狗名開詳細資訊；不受搜尋影響；照片用 HEAD 查、不下載；返回回到原分類', async () => {
    const saved = [allDogs, groupMap, activeTab, searchQuery, photoCheck, historyData];
    const realFetch = window.fetch;
    const calls = [];
    let apiCalls = [];
    try {
      // 照片不是 /api，HEAD 查照片仍替換瀏覽器 fetch；後端呼叫替換 BQApi
      window.fetch = async (url, opt) => { calls.push([url, opt && opt.method]); return new Response(null, { status: url.includes('2017070102') ? 200 : 404 }); };
      apiCalls = fakeApi(() => new Response(null, { status: 404 }));
      allDogs = dogs; groupMap = {}; searchQuery = '甲長'; photoCheck = null; historyData = null; activeTab = 'mine';
      render();
      const doc = new DOMParser().parseFromString(INDEX_HTML, 'text/html');
      const btn = doc.querySelector('header .brand #analysisBtn');
      if (btn) throw new Error('分析入口已移到底部資訊');
      eq([...document.querySelectorAll('#tabs button')].map(b => b.dataset.tab), ['walk', 'groups', 'mine', 'info'], '分析不佔分類：');
      showAnalysis();
      eq([analysisOpen, document.documentElement.classList.contains('analysis-open'), activeTab], [true, true, 'mine'], '打開分析：');
      eq(document.querySelectorAll('[data-info-page]').length, 5, '資訊五類（含活動 #270）：');
      infoPage = 'stay'; render();
      const titles = [...document.querySelectorAll('#main .a-card h2')].map(h => h.textContent);
      eq(titles.length, 4, '五張統計＋離所（#345 拿掉本月溜狗；（2026-10-08 distill 拿掉滿 1 年圓環、入所年度分布）：');
      if (titles.includes('長期在所＋近期少遛')) throw new Error('K 說長期在所＋少遛不需要');
      ['入所多久分布', '在所最久 Top 10', '各區平均在所時間',
        '公母在所時間差異'].forEach(t => { if (!titles.includes(t)) throw new Error(`少了 ${t}`); });
      if (![...document.querySelectorAll('#main .a-card')].find(c => c.querySelector('h2').textContent.includes('入所多久分布')).querySelector('.a-hint').textContent.includes('滿 1 年的')) throw new Error('入所多久分布要寫滿 1 年幾隻');
      eq(document.querySelectorAll('#main .a-ring').length, 0, '不再有圓環：');
      infoPage = 'quality'; render();
      if (!document.getElementById('main').textContent.includes('檢查中')) throw new Error('照片還沒查完要顯示檢查中');
      const photoCalls = calls.filter(([u]) => u.startsWith('photos/'));
      eq(photoCalls.every(([, m]) => m === 'HEAD'), true, '照片只用 HEAD：');
      eq(photoCalls.length, 9, '每個編號查一次：');
      // #345 拿掉本月溜狗：分析頁不再讀溜狗紀錄
      eq(calls.filter(([u]) => !u.startsWith('photos/')).length, 0, '照片以外不直接 fetch：');
      eq([...new Set(apiCalls.map(c => c[0]))].sort(), ['activities', 'departures'], '分析頁只多讀離所名冊索引（#163、#363）和活動紀錄（#270），不讀溜狗紀錄和其他檔：');
      await tick(); await tick(); await tick();
      const photoRow = [...document.querySelectorAll('#main .a-miss')].find(el => el.textContent.includes('沒有照片'));
      if (!photoRow || !photoRow.textContent.includes('9 隻')) throw new Error(`沒有照片列：${photoRow && photoRow.textContent}`);
      infoPage = 'stay'; render();
      document.querySelector('#main .a-dog').click();
      eq(detailDog && detailDog.name, '甲長', '點 Top 1 開詳細資訊：');
      hideDetail();
      eq(analysisOpen, true, '關詳細資訊後還在分析頁：');
      infoPage = '';
      history.replaceState(null, ''); // 測試頁不真的按返回，直接關
      document.getElementById('analysisBack').click();
      eq([analysisOpen, document.documentElement.classList.contains('analysis-open'), activeTab], [false, false, 'mine'], '返回回到原本的分類：');
      if (document.querySelector('#main .a-card')) throw new Error('返回後不該還有統計卡片');
    } finally {
      window.fetch = realFetch; restoreApi();
      hideDetail();
      hideAnalysis();
      history.replaceState(null, '');
      [allDogs, groupMap, activeTab, searchQuery, photoCheck, historyData] = saved;
      render();
    }
  });
  await check('#59 分析程式只讀：網路呼叫只有 HEAD 查照片與讀溜狗、離所紀錄（#60、#260），不寫入、不存資料', () => {
    const code = ANALYSIS_JS.replace("fetch(photoSrc({ id }), { method: 'HEAD', cache: 'no-cache' })", '')
      .replace("fetch('website-updates.json', { cache: 'no-cache' })", '')
      // #421 網站更新只在本機留一份上次讀到的內容，先顯示再背景檢查
      .replace('localStorage.getItem(WEBSITE_UPDATES_CACHE)', '').replace('localStorage.setItem(WEBSITE_UPDATES_CACHE, JSON.stringify(entries))', '');
    // #60 讀溜狗紀錄、離所紀錄：只用 BQApi 讀的端點；#363 點離所的狗才拿那一年（網址帶版本號，瀏覽器快取）
    eq([...new Set([...ANALYSIS_JS.matchAll(/BQApi\.(\w+)\(/g)].map(m => m[1]))].sort(), ['departureYear', 'departures', 'walks'], '#60 #260 溜狗紀錄、離所紀錄從 Worker 讀：');
    for (const read of ["get('/walks'", "get('/departures/index'", 'get(`/departures?year=']) if (!API_JS.includes(read)) throw new Error(`BQApi 要用 GET 讀 ${read}`);
    if (/['`]data\/(history|walks|departures)/.test(code)) throw new Error('#260 起不再讀 data/ 的溜狗紀錄、快照、離所');
    const bad = [/fetch\(/, /method\s*:/i, /\bPOST\b|\bPUT\b|\bPATCH\b|\bDELETE\b/, /localStorage|sessionStorage|indexedDB|XMLHttpRequest|sendBeacon/];
    eq(bad.filter(re => re.test(code)).map(String), [], '寫入相關字眼：');
    if (!/from ['"]\.\/app\.js['"]/.test(ANALYSIS_JS)) throw new Error('分析頁要明確匯入主頁能力');
  });
}

// ── #60 分析頁：遛狗歷史（模擬 28 天的資料）──
async function runHistoryTests() {
  const T = new Date(2026, 9, 22, 10);
  const W = (id, name, date) => ({ id, name, date });
  const every2 = []; for (let d = new Date(2026, 8, 26); d <= new Date(2026, 9, 22); d.setDate(d.getDate() + 2)) every2.push(`2026-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  const walks = parseWalks({ walks: [
    W('2020010101', '歷甲', '2026-09-20'), W('2020010102', '歷乙', '2026-09-10'), // 開始累積前的「最後一次」
    ...every2.map(d => W('2020010101', '歷甲', d)), W('2020010101', '歷甲', '2026-10-22'), // 同一天兩筆只算一次
    W('2020010102', '歷乙', '2026-10-01'), W('2020010102', '歷乙', '2026-10-15'),
    W('', '歷無號', '2026-09-25'), W('', '歷無號', '2026-10-02'), W('', '歷無號', '2026-10-09'),
    W('2019010101', '已離所', '2026-09-30'), W('x', 'x', '日期壞掉'),
  ] });
  const dog = (name, id, cage, walked) => ({ name, id, cage, note: '', covered: false, intro: '', sex: '', walkedDate: walked ? BQDates.parseYmd(walked) : null });
  const dogs = [dog('歷甲', '2020010101', '新A01', '2026-10-22'), dog('歷乙', '2020010102', '新A02', '2026-10-15'),
    dog('歷丙', '2020010103', '舊B01', null), dog('歷無號', '', 'C區11', '2026-10-09')];
  const dates = historyStartDates({ historyStart: '2026-09-25' });
  const span = historySpan(dates, T);
  await check('#60 #260 開始記錄日與累積天數：從 api/walks 的 historyStart 算起；壞掉或沒有就是還沒開始', () => {
    eq(dates, ['2026-09-25']);
    eq([historyStartDates({ historyStart: '壞掉' }), historyStartDates({}), historyStartDates(null)], [[], [], []]);
    eq([ymd(span.start), span.days], ['2026/9/25', 28]);
    eq(historySpan(['2026-09-25'], new Date(2026, 8, 30, 21)).days, 6, '一週內：');
    eq(walks.length, 23, '日期壞掉的略過：');
  });
  await check('#60 每隻狗的遛狗紀錄：最近 30 天每天有沒有遛、開始記錄前標未記錄；同一天只算一次；沒編號用犬名', () => {
    const h = dogWalkHistory(dogs[0], walks, span.start, T);
    eq(h.cells.length, 30);
    eq([ymd(h.cells[0].date), ymd(h.cells[29].date)], ['2026/9/23', '2026/10/22'], '範圍：');
    eq(h.cells.filter(c => !c.recorded).map(c => ymd(c.date)), ['2026/9/23', '2026/9/24'], '開始記錄前：');
    eq([h.count, +h.avgGap.toFixed(3), h.maxGap], [14, +(32 / 14).toFixed(3), 6], '歷甲：');
    const b = dogWalkHistory(dogs[1], walks, span.start, T);
    eq([b.count, b.avgGap, b.maxGap], [2, 17.5, 21], '歷乙（9/10 那筆只當第一段間隔起點）：');
    eq(Object.values(dogWalkHistory(dogs[2], walks, span.start, T)).slice(1), [0, null, null], '沒遛過：');
    const d = dogWalkHistory(dogs[3], walks, span.start, T);
    eq([d.count, d.avgGap, d.maxGap], [3, 7, 7], '沒編號：');
    // #345 間隔只用近期溜狗紀錄（上個月 1 號到今天）；範圍內沒溜顯示超過 62 天
    const old = parseWalks({ walks: [W('2020010109', '歷舊', '2026-08-20'), W('2020010109', '歷舊', '2026-09-05'), W('2020010109', '歷舊', '2026-09-12'),
      W('2020010108', '歷久', '2026-08-01')] });
    const s0 = historySpan(['2026-07-01'], T).start;
    const o = dogWalkHistory(dog('歷舊', '2020010109', 'A', null), old, s0, T);
    eq([o.avgGap, o.maxGap], [7, 7], '上個月 1 號前的紀錄不算間隔：');
    eq(dogWalkHistory(dog('歷久', '2020010108', 'A', null), old, s0, T).maxGap, 'over', '範圍內沒溜：');
    eq(+recentStart(new Date(2027, 0, 5)), +new Date(2026, 11, 1), '1 月的範圍從去年 12/1：');
  });
  await check('#60 分析頁不放歷史與快照；詳細資訊有這隻狗最近 30 天的遛狗紀錄；不出現志工名字', async () => {
    const saved = [allDogs, groupMap, activeTab, searchQuery, photoCheck, historyData];
    const realDate = Date;
    try {
      fakeApi(() => new Response(null, { status: 404 }));
      window.Date = class extends realDate { constructor(...a) { super(...(a.length ? a : [2026, 9, 22, 10])); } static now() { return +new realDate(2026, 9, 22, 10); } };
      photoCheck = { done: true, map: new Map() };
      allDogs = dogs; groupMap = {}; searchQuery = ''; activeTab = 'walk';
      const titles = () => [...document.querySelectorAll('#main .a-card h2')].map(h => h.textContent);
      historyData = { state: 'ready', walks, dates };
      showAnalysis();
      ['依日期看快照', '各犬遛狗頻率', '平均多久被遛一次', '遛狗趨勢', '各區長期遛狗狀況'].forEach(t => { if (titles().includes(t)) throw new Error(`K 說不要 ${t}`); });
      if (document.querySelector('#main select, #main .a-divider')) throw new Error('分析頁不要快照選單');
      if (/志工|walker/.test(document.getElementById('main').innerHTML)) throw new Error('不能出現志工');
      hideAnalysis(); history.replaceState(null, '');
      // 詳細資訊
      showDetail(dogs[0]);
      let sec = document.querySelector('#detail [data-section="walks"]');
      if (!sec) throw new Error('詳細資訊要有遛狗紀錄');
      eq([...document.querySelectorAll('#detail .detail-section')].map(s => s.dataset.section).slice(-4), ['walks', 'intro', 'fixed-care', 'rest'], '位置在合併後的入所介紹前：');
      eq([...document.querySelectorAll('#detail .detail-section')].map(s => s.dataset.section).slice(0, 2), ['last', 'note'], 'V9（#141）上次溜／溜狗人在最前面，接著試算表備註：');
      // 減法（10-10 K：格子很棒但眼花）：預設只有一行字，按「看每一天」才展開格子
      eq([sec.querySelectorAll('.w-grid').length, document.getElementById('walksToggle').getAttribute('aria-expanded'), sec.querySelector('.w-more').textContent], [0, 'false', '看每一天'], '預設收起來：');
      document.getElementById('walksToggle').click();
      sec = document.querySelector('#detail [data-section="walks"]');
      eq([document.getElementById('walksToggle').getAttribute('aria-expanded'), sec.querySelector('.w-more').textContent], ['true', '收起'], '展開：');
      eq([sec.querySelectorAll('.w-grid .on').length, sec.querySelectorAll('.w-grid .none').length, sec.querySelectorAll('.w-grid span').length], [14, 2, 30], '格子：');
      eq([...sec.querySelectorAll('.w-sum b')].map(b => b.textContent), ['14', '2.3', '6'], '數字（一行字，不是三格）：');
      eq(sec.querySelectorAll('.w-num').length, 0, '沒有統計卡：');
      if (!sec.textContent.includes('從 2026/9/25 開始記錄')) throw new Error('要寫從哪天開始記錄');
      hideDetail(); history.replaceState(null, '');
      historyData = { state: 'loading', walks: [], dates: [] };
      showDetail(dogs[0]);
      eq(document.querySelector('#detail [data-section="walks"] .empty').textContent, '讀取中…', '還沒讀到：');
      hideDetail(); history.replaceState(null, '');
    } finally {
      restoreApi(); window.Date = realDate;
      hideAnalysis(); hideDetail(); history.replaceState(null, '');
      [allDogs, groupMap, activeTab, searchQuery, photoCheck, historyData] = saved;
      render();
    }
  });
}

// ── 分析頁「← 分析」（K 2026-10-09；本月溜狗 #345 拿掉）──
async function runMonthWalkTests() {
  check('K 2026-10-09 分析頁的返回在頁首（← 分析），內容區不再有另一個返回和標題', () => {
    // 測試頁不是真的 index.html：檢查 index.html 原始碼的頁首
    if (!/<header class="app">[\s\S]*class="head-back" id="analysisBack"[\s\S]*<h2 class="head-title">資訊<\/h2>/.test(INDEX_HTML)) throw new Error('頁首要有返回和標題');
    if (/class="a-top"|class="a-back"/.test(analysisPageHtml(new Date()))) throw new Error('內容區不該再有返回');
  });
}

async function runV7PagesTests() {
  const saved = [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, myWalks, myWalksState, analysisOpen];
  try {
    phoneStore = fakeStorage(); walkRecords = freshWalkRecords();
    const now = new Date(); // 畫面用今天的日期算天數，這裡也用今天，測試不會隔天就壞
    const day = n => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
    const dog = (name, id, cage, days) => ({ name, id, cage, walkedDate: days == null ? null : day(days), covered: false, note: '', intro: '', sex: '', formerIds: [] });
    allDogs = [
      dog('測試甲', '2024032901', '舊A03', 40), dog('測試乙', '2024032902', '舊A03', 12), dog('測試丙', '2024032903', '新A05', 2),
      dog('測試丁', '2024032904', '新B01', 8), dog('測試戊', '2024032905', '新B02', null),
    ];
    groupMap = { '測試甲': new Set(['測試丁']) };
    searchQuery = ''; analysisOpen = false;
    await check('#114 我溜過：在所的狗，你溜過 N／總數', () => {
      myWalksState = 'ready';
      myWalks = [
        { id: '2024032901', name: '測試甲', date: day(1), ymd: 'a' }, { id: '2024032901', name: '測試甲', date: day(3), ymd: 'b' },
        { id: '2024032903', name: '測試丙', date: day(3), ymd: 'b' }, { id: '1999010101', name: '已離所', date: day(5), ymd: 'c' },
      ];
      const html = myProgressHtml(myWalks);
      const box = document.createElement('div'); box.innerHTML = html;
      eq(box.querySelector('.row b').textContent, '2 / 5 隻', '已離所的不算、同一隻只算一次：');
      eq(box.querySelector('.bar i').style.width, '40%');
    });
    await check('#114 分析頁：不再是整塊藍底（critique 2026-10-09 大數字也不框成格子）', async () => {
      const css = await fetch('../public/css/app.css').then(r => r.text());
      if (!/\.a-hero\s*\{/.test(css)) throw new Error('找不到 .a-hero');
      if (/\.a-hero\s*\{[^}]*gradient/.test(css)) throw new Error('分析頁還有藍色漸層');
    });
  } finally {
    [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, myWalks, myWalksState, analysisOpen] = saved;
  }
}

// K 2026-10-05 正式站回報：只有自己一人時沒有 ×（按錯要能取消）、「岑」被接成「岑、K」、別人溜的跑進我溜過
// K 2026-10-08：詳細資訊大照片跟狗卡照片統一正方形（置中裁切）
// #163 #164 離所：data/departures.json 讀進來、年度統計、名冊篩選、詳細資訊的離所模式
async function runDepartureTests() {
  const saved = [allDogs, UPLOAD_URL, departuresData, depRoster, historyData];
  const tick = () => new Promise(r => setTimeout(r, 0));
  const OCT8 = new Date(2026, 9, 8, 10);
  const entry = (id, name, date, reason, extra = {}) => ({ id, name, date, sex:'male', dateSource: 'sheet', seen: date, reason, matched: reason === 'adopt' ? '被認養' : reason === 'death' ? '過世' : '', flags: reason === 'unknown' ? ['not-in-sheet'] : [],
    last: { cage: 'C區35', id, name, walkedDate: '2026-09-30', note: '親人', sex: 'male', intro: '入所介紹文字' }, ...extra });
  const DATA = { version: 1, departures: [
    entry('2026021301', '雪寶', '2026-10-01', 'adopt', { returned: '2026100801' }),
    entry('2024101903', '仲基', '2026-09-26', 'death'),
    entry('2026092401', '豆花', '2026-10-02', 'unknown', { dateSource: 'seen' }),
    entry('2017070102', 'LUCY', '2025-11-02', 'adopt', { last: { id: '2017070102', name: 'LUCY', formerIds: ['2015010101'] } }),
    entry('2017090423', '沒日期', null, 'other'),
    { id: '', name: '壞資料' },
  ] };
  try {
    const list = parseDeparturesData(DATA);
    await check('#163 departures.json 讀成離所的狗：跟在所的狗同樣子，多一個 departure；沒編號的略過', () => {
      eq(list.map(d => d.name), ['雪寶', '仲基', '豆花', 'LUCY', '沒日期']);
      eq([list[0].sex, list[0].cage, list[0].intro, ymd(list[0].walkedDate)], ['♂', 'C區35', '入所介紹文字', '2026/9/30']);
      eq([list[0].departure.reason, ymd(list[0].departure.date), list[0].departure.returned], ['adopt', '2026/10/1', '2026100801']);
      eq(list[3].formerIds, ['2015010101']);
    });
    await check('#163 年度統計：每年各類幾隻、總數＝四類相加；沒日期的另外算', () => {
      const { years, noDate } = departureYears(list);
      eq(years.map(y => [y.year, y.total, y.adopt, y.death, y.other, y.unknown]), [[2025, 1, 1, 0, 0, 0], [2026, 3, 1, 1, 0, 1]]);
      eq(noDate, 1);
    });
    await check('#164 名冊篩選：狗名、編號、舊編號搜尋，年份、原因可以一起用；新的在前', () => {
      eq(filterDepartures(list).map(d => d.name), ['豆花', '雪寶', '仲基', 'LUCY', '沒日期']);
      eq(filterDepartures(list, { query: '雪' }).map(d => d.name), ['雪寶']);
      eq(filterDepartures(list, { query: '2015010101' }).map(d => d.name), ['LUCY']);
      eq(filterDepartures(list, { year: '2026', reason: 'adopt' }).map(d => d.name), ['雪寶']);
      eq(filterDepartures(list, { reason: 'unknown' }).map(d => d.name), ['豆花']);
    });
    await check('#163 分析頁離所區：今年一行數字（2026-10-08 distill 拿掉三張數字卡）、兩年以上才有每年直條、名冊按鈕', () => {
      departuresData = { state: 'ready', list }; depRoster = depRosterDefault();
      eq(depRoster.open, true, '#446 名冊預設展開：');
      depRoster.open = false;
      const box = document.createElement('div');
      box.innerHTML = departureSectionHtml(OCT8);
      eq(box.querySelectorAll('.a-kpi').length, 0, '沒有數字卡：');
      eq(box.querySelector('.dep-line').textContent, '2026 年離所 3 隻（認養 1、離世 1、待確認 1）');
      eq([...box.querySelectorAll('[data-dep-year]')].map(c => c.dataset.depYear), ['2025', '2026']);
      departuresData = { state: 'ready', list: list.filter(d => d.departure.date && d.departure.date.getFullYear() === 2026) };
      box.innerHTML = departureSectionHtml(OCT8);
      eq(box.querySelectorAll('[data-dep-year]').length, 0, '只有一年時不畫直條：');
      departuresData = { state: 'ready', list };
      box.innerHTML = departureSectionHtml(OCT8);
      eq(box.querySelector('#depToggle').textContent, '看離所名冊（5 隻）');
      depRoster.open = true;
      box.innerHTML = departureSectionHtml(OCT8);
      eq(box.querySelectorAll('[data-dep-dog]').length, 5);
      eq(box.querySelector('#depToggle').textContent, '收起離所名冊', '#446 展開時仍可收起：');
      eq(box.querySelector('[data-dep-dog] .badge').textContent, '待確認');
    });
    await check('#363 名冊索引：搜尋全部年份；點舊年份的狗才拿那一年的詳細資料，拿過不再拿，拿不到用索引那筆', async () => {
      const index = { version: 1, years: { 2025: '3', 2026: '7', none: '1' }, dogs: DATA.departures.filter(e => e.id).map(e => {
        const dog = { id: e.id, name: (e.last && e.last.name) || e.name, date: e.date, dateSource: e.dateSource, reason: e.reason };
        if (e.returned) dog.returned = e.returned;
        if (e.last && e.last.formerIds) dog.formerIds = e.last.formerIds;
        return dog;
      }) };
      const calls = [];
      const keep = [analysisOpen, detailDog];
      const main = document.getElementById('main'), html = main.innerHTML;
      try {
        let fail = false;
        fakeApi((name, year, ver) => {
          calls.push([year, ver]);
          if (fail) return new Response(null, { status: 503 });
          return apiJson({ ok: true, version: 1, year, departures: DATA.departures.filter(e => e.id && (e.date ? e.date.slice(0, 4) : 'none') === year) });
        });
        departureDetails.clear();
        departuresData = { state: 'ready', list: parseDeparturesData(index), years: index.years };
        depRoster = { open: true, query: '', year: 'all', reason: 'all' };
        eq(departureYears(departuresData.list).years.map(y => [y.year, y.total]), [[2025, 1], [2026, 3]], '長條圖照常：');
        analysisOpen = true;
        main.innerHTML = departureSectionHtml(OCT8);
        const search = document.getElementById('depSearch');
        search.value = '2015010101'; search.dispatchEvent(new Event('input', { bubbles: true }));
        const rows = main.querySelectorAll('[data-dep-dog]');
        eq([...rows].map(r => r.querySelector('.a-dog-name').textContent), ['LUCY'], '舊編號搜得到舊年份的狗：');
        eq(calls, [], '搜尋不拿詳細資料：');
        rows[0].click();
        for (let i = 0; i < 5; i++) await tick();
        eq(calls, [['2025', '3']], '點了才拿那一年：');
        eq([detailDog.name, detailDog.cage, detailDog.intro, detailDog.departure.reason], ['LUCY', '', '', 'adopt'], '開的是詳細資料：');
        const lucy = await departureDetail(departuresData.list.find(d => d.name === 'LUCY'));
        eq(lucy.formerIds, ['2015010101']);
        const snow = await departureDetail(departuresData.list.find(d => d.name === '雪寶'));
        eq([snow.cage, snow.intro], ['C區35', '入所介紹文字'], '索引沒有的籠位、介紹從詳細資料來：');
        await departureDetail(departuresData.list.find(d => d.name === '仲基'));
        eq(calls.length, 2, '同一年拿過不再拿：');
        fail = true;
        const noDate = departuresData.list.find(d => d.name === '沒日期');
        eq(await departureDetail(noDate), noDate, '拿不到用索引那筆：');
        eq(calls[2], ['none', '1']);
        fail = false;
        eq((await departureDetail(noDate)).cage, 'C區35', '拿不到下次再拿：');
      } finally {
        restoreApi();
        hideDetail();
        [analysisOpen, detailDog] = keep;
        main.innerHTML = html;
        departureDetails.clear();
      }
    });
    await check('#163 還沒有離所紀錄、讀不到時不壞', () => {
      departuresData = { state: 'ready', list: [] };
      if (!departureSectionHtml(OCT8).includes('還沒有離所紀錄')) throw new Error('要說還沒有');
      departuresData = { state: 'error', list: [] };
      if (!departureSectionHtml(OCT8).includes('讀不到')) throw new Error('要說讀不到');
    });
    await check('#164 離所的詳細資訊：標原因和日期、判讀依據只寫關鍵字；沒有溜了、在哪、☆、換照片、同籠', () => {
      UPLOAD_URL = 'https://example.test/upload';
      allDogs = [{ name: '雪寶', id: '2026100801', cage: 'A1', walkedDate: null, covered: false, note: '', intro: '', sex: '', formerIds: ['2026021301'] }];
      historyData = { state: 'ready', dates: [], walks: [] };
      const box = document.createElement('div');
      detailWalksOpen = true; // 溜狗紀錄展開才看得到「10/1 離所」
      box.innerHTML = detailHtml(list[0], OCT8);
      detailWalksOpen = false;
      eq(box.querySelector('.chips .badge').textContent, '已認養 · 10/1');
      const dep = box.querySelector('[data-section="departure"]').textContent;
      if (!dep.includes('已出所分頁寫了「被認養」') || !dep.includes('C區35')) throw new Error(dep);
      eq(!!box.querySelector('[data-departed-back]'), true, '再入所要能跳到現在那隻：');
      for (const sel of ['.walk-btn', '#groupWalk', '#detailWhere', '#favToggle', '#photoPick', '[data-section="cage"]', '[data-section="group"]', '.who-plus']) {
        if (box.querySelector(sel)) throw new Error(`不該有 ${sel}`);
      }
      eq(!!box.querySelector('#detailClose'), true);
      eq(box.querySelector('[data-section="walks"] .w-axis').lastElementChild.textContent, '10/1 離所');
      box.innerHTML = detailHtml(list[2], OCT8);
      if (!box.textContent.includes('從試算表消失的那天') || !box.textContent.includes('已出所分頁找不到這隻狗')) throw new Error('待確認要寫原因');
    });
  } finally {
    [allDogs, UPLOAD_URL, departuresData, depRoster, historyData] = saved;
  }
}
