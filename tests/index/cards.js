// 板收圖鑑（cards.html，K 2026-10-10）：js/cards.js 的純函式；你溜過的狗才拿得到卡，新的包成卡包
async function runCardsTests() {
  const code = await fetch('../public/js/cards.js').then(r => r.text());
  // 包在函式裡跑，不把 bq* 放進這頁的全域（測試頁沒有 #bqField，不會開始畫面）
  const C = await import('../../public/js/cards.js');
  const TODAY = new Date(2026, 9, 9);
  const data = {
    photoVersions: { 'photos/2017041502.jpg': 'abc' },
    dogs: [
      { id: '2017041502', name: '老將', cage: '新A07', sex: 'female', intro: '個性溫和，喜歡散步。怕機車聲' },
      { id: '2026090101', name: '新人', cage: 'C區13', sex: 'male', intro: '' },
      { id: '2022061001', name: '中堅', cage: '舊B05', intro: '' },
      { id: '', name: '(阿拉丁)', cage: '舊B16' },
      { id: '2023010101', name: '(暫住)', cage: '舊B16' },
      { id: '2021010101', name: '金卡', cage: '住院區', intro: '' },
    ],
  };
  const walks = [
    { id: '2022061001', date: '2026-10-01' }, { id: '2022061001', date: '2026-10-01' }, { id: '2022061001', date: '2026-10-03' },
    { id: '2017041502', date: '2026-10-02' }, { id: '2017041502', date: '2026-09-30' },
  ];
  const players = C.bqPlayers(data, walks, TODAY);
  const by = Object.fromEntries(players.map(p => [p.name, p]));
  await check('入所日（ADR 0011）：編號、舊編號、出入所紀錄三者取最早，圖鑑和溜狗表算出來一樣', () => {
    const cases = [
      { id: '2017090508', name: '墨西哥', formerIds: [], stays: [{ in: '2015-08-18', out: '', reason: '迷路' }, { in: '2016-03-01', out: '2016-05-01', reason: '' }] },
      { id: '2017090508', name: '舊編號最早', formerIds: ['2014010101'], stays: [{ in: '2015-08-18', out: '', reason: '' }] },
      { id: '2017090508', name: '編號最早', formerIds: [], stays: [{ in: '2018-01-01', out: '', reason: '' }] },
      { id: 'ABC', name: '只有紀錄', stays: [{ in: '2020-02-02', out: '', reason: '' }] },
    ];
    const fromCards = C.bqPlayers({ dogs: cases }, [], TODAY).map(p => p.intake && ymd(p.intake));
    const fromApp = parseDogsData({ dogs: cases }).dogs.map(d => ymd(BQDates.firstIntake(d)));
    eq(fromCards, ['2015/8/18', '2014/1/1', '2017/9/5', '2020/2/2'], '圖鑑：');
    eq(fromApp, fromCards, '溜狗表跟圖鑑一樣：');
  });
  await check('#271 已出所狗卡：在所期間是入所日到離所日，原因寫給人看；只有名字的卡沒有照片', () => {
    const list = C.bqAlumni({ dogs: [
      { id: '2020010101', number: '2020010101', name: '阿福', formerIds: ['2019010101'], stays: [], departed: '2026-10-10', reason: 'adopt', walkDays: 4, activities: 2 },
      { id: 'm1', number: '', name: '老黃', formerIds: [], stays: [], departed: '', reason: 'lost', walkDays: 0, activities: 1, nameOnly: true },
      { id: '', name: '壞資料' },
    ] });
    eq(list.map(a => [a.name, a.intake && ymd(a.intake), a.left && ymd(a.left), a.stay, a.reason, a.walkDays, a.activities, a.hasPhoto]), [
      ['阿福', '2019/1/1', '2026/10/10', '7年9個月', '被認養', 4, 2, null],
      ['老黃', null, null, '—', '原因待確認', 0, 1, false],
    ]);
  });
  await check('球員卡：沒編號、括號名字的列不算；背號照入隊順序（1 號最資深）', () => {
    eq(players.map(p => p.name), ['老將', '新人', '中堅', '金卡'], '球員：');
    eq(['老將', '金卡', '中堅', '新人'].map(n => by[n].number), ['1', '2', '3', '4'], '背號：');
  });
  await check('球員卡：等級看在所多久（7 年雷射、5 年金、3 年銀、其他普卡）；隊伍看犬舍', () => {
    eq(['老將', '金卡', '中堅', '新人'].map(n => by[n].tier.key), ['holo', 'gold', 'silver', 'base'], '等級：');
    eq([C.bqTier(7).key, C.bqTier(6.99).key, C.bqTier(3).key, C.bqTier(null).key], ['holo', 'gold', 'silver', 'base'], '邊界：');
    eq(['新A07', '舊B05', '母幼A3', 'C區13', '住院區', '外面'].map(c => C.bqTeamOf(c).key), ['new', 'old', 'mom', 'c', 'ward', 'free'], '隊伍：');
  });
  await check('球員卡：本月出賽一天算一次、只算這個月；在所多久寫年月或天', () => {
    eq([by['中堅'].monthOut, by['老將'].monthOut, by['新人'].monthOut], [2, 1, 0], '本月出賽：');
    eq([C.bqStay(new Date(2017, 3, 15), TODAY), C.bqStay(new Date(2026, 8, 1), TODAY), C.bqStay(new Date(2026, 8, 30), TODAY), C.bqStay(null, TODAY)], ['9年5個月', '1個月', '9天', '—'], '在所：');
  });
  await check('球員卡：照片版本號；收容所的話取介紹開頭一句（ADR 0022）', () => {
    eq([by['老將'].photo, by['老將'].hasPhoto, by['新人'].hasPhoto], ['photos/2017041502.jpg?v=abc', true, false], '照片：');
    eq([by['老將'].quote, C.bqQuote('2017年4月15日從板橋被拾獲入所。親人'), C.bqQuote(''), [...C.bqQuote('很'.repeat(50))].length], ['個性溫和，喜歡散步', '2017年4月15日從板橋被拾獲入所', '', 40], '一句話：');
  });
  await check('圖鑑年度獎項：出門王、最資深、最新入所都是資料算的', () => {
    eq(C.bqAwards(players, TODAY).map(a => [a.title, a.who.name, a.value]), [['出門王', '中堅', 2], ['最資深', '老將', 9], ['最新入所', '新人', 38]]);
  });
  await check('圖鑑年份跟著今天：卡號 BQ 後面是今年的末兩碼', () => {
    eq(C.bqYY(), String(C.BQ.today.getFullYear()).slice(2));
  });
  const ME = 'aaaaaaaaaaaa', ME2 = 'bbbbbbbbbbbb', OTHER = 'cccccccccccc';
  await check('圖鑑：我溜過的狗讀 Worker 的彙總（#344），不再另加手機記的試算表寫入', () => {
    const mine = C.bqMineFrom({ '2022061001': { times: 2, first: '2026-10-01', last: '2026-10-03' }, '2017041502': { times: 1, first: '2026-10-09', last: '2026-10-09' }, bad: { times: 1, first: 'x', last: 'y' } });
    eq([...mine.keys()].sort(), ['2017041502', '2022061001'], '溜過的：');
    eq([mine.get('2022061001').times, mine.get('2022061001').first.getDate(), mine.get('2022061001').last.getDate()], [2, 1, 3], '次數、第一次、最近：');
    eq(C.bqMineFrom(null).size, 0, '讀不到：');
    const st = fakeStorage();
    st.set('bq-walker-codes', JSON.stringify([ME, 'not-a-code']));
    eq(C.bqLoadCodes(st), [ME], '代號：');
  });
  await check('圖鑑：撕開過的記在這個瀏覽器、跟著代號走；新卡是溜過還沒撕的，最近溜的先出', () => {
    const mine = C.bqMineFrom({
      '2022061001': { times: 1, first: '2026-10-01', last: '2026-10-01' }, '2017041502': { times: 1, first: '2026-10-05', last: '2026-10-05' }, '2021010101': { times: 1, first: '2026-10-03', last: '2026-10-03' },
      '1999010101': { times: 1, first: '2026-10-03', last: '2026-10-03' },
    });
    const st = fakeStorage();
    const state = C.bqLoadOpened(st);
    eq(C.bqPending(players, mine, C.bqOpenedIds(state, [ME])).map(p => p.name), ['老將', '金卡', '中堅'], '新卡（出所的狗不算）：');
    C.bqMarkOpened(state, [ME, ME2], ['2017041502'], TODAY);
    C.bqSaveOpened(st, state);
    const back = C.bqLoadOpened(st);
    eq([[...C.bqOpenedIds(back, [ME2])], back.codes[ME]['2017041502']], [['2017041502'], '2026-10-09'], '存起來：');
    eq(C.bqPending(players, mine, C.bqOpenedIds(back, [ME])).map(p => p.name), ['金卡', '中堅'], '撕過的不再出：');
    eq(C.bqOpenedIds(back, [OTHER]).size, 0, '別人的圖鑑另外算：');
    st.set(C.BQ_OPENED_KEY, '{壞掉');
    eq(C.bqLoadOpened(st), { v: 1, codes: {} }, '壞掉重來：');
    eq(C.bqLoadOpened(null), { v: 1, codes: {} }, '沒有儲存空間：');
  });
  await check('圖鑑：多頁籤開卡合併保存，不蓋掉自己或別人的卡', () => {
    const st = fakeStorage(), a = C.bqLoadOpened(st), b = C.bqLoadOpened(st);
    C.bqMarkOpened(a, [ME], ['2017041502'], TODAY); C.bqSaveOpened(st, a);
    C.bqMarkOpened(b, [OTHER], ['2022061001'], TODAY); C.bqSaveOpened(st, b);
    C.bqMarkOpened(a, [ME], ['2021010101'], TODAY); C.bqSaveOpened(st, a);
    const saved = C.bqLoadOpened(st);
    eq([...C.bqOpenedIds(saved, [ME])].sort(), ['2017041502', '2021010101']);
    eq([...C.bqOpenedIds(saved, [OTHER])], ['2022061001']);
    eq(C.bqSaveOpened(BQStore.create({ getItem: () => null, setItem: () => { throw new Error('quota'); } }), a), false);
  });
  await check('圖鑑完整流程：舊卡移入後台、重開及跨裝置讀回、另一個人分開、寫入失敗可重試', async () => {
    const html = await fetch('../public/cards.html').then(r => r.text());
    const selected = DOGS_JSON.dogs.filter(d => d.id && !/^[(（]/.test(d.name)).slice(0, 7);
    const ME = 'abcdef123456', OTHER = '123456abcdef';
    const fixture = window.__cardFixture = {
      dogs: { ...DOGS_JSON, dogs: selected },
      walks: { walks: selected.map(d => ({ id: d.id, date: '2026-10-12', walkers: [ME, OTHER] })) },
      books: {}, fail: false,
    };
    const frames = [];
    async function device(code, legacy = [], clearIdentity = false) {
      const iframe = document.createElement('iframe'); frames.push(iframe); document.body.append(iframe);
      const startup = `<script>
        const store = new Map([['bq-walker-codes', '${JSON.stringify([code])}'], ['bq-zukan', '${JSON.stringify({ v: 1, codes: { [code]: Object.fromEntries(legacy.map(id => [id, '2026-10-10'])) } })}']]);
        Object.defineProperty(window, 'localStorage', { value: { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, v) } });
        if (${clearIdentity}) store.set('bq-walker-name', '原名');
      <\/script>`;
      // #478 假後端：api.js 載入後替換 BQApi 的端點，不替換瀏覽器 fetch
      const fakeBackend = `<script type="module">
        import { BQApi } from './js/api.js';
        import * as cards from './js/cards.js';
        for (const key of Object.keys(cards)) Object.defineProperty(window, key, { configurable: true, get: () => cards[key] });
        const f = parent.__cardFixture, ok = body => BQApi.settle(Response.json(body));
        BQApi.identity = async () => {
          await new Promise(r => setTimeout(r, 20));
          store.set('bq-walker-codes', '[]'); store.set('bq-walker-name', '');
          return ok({ ok: true, identity: { name: '舊回應', codes: ['${code}'] } });
        };
        BQApi.dogs = () => ok(f.dogs);
        BQApi.walks = () => ok(f.walks);
        BQApi.myDogs = codes => ok({ ok: true, dogs: Object.fromEntries(f.walks.walks.filter(w => w.walkers.some(c => codes.includes(c))).map(w => [w.id, { times: 1, first: w.date, last: w.date }])) });
        BQApi.saveOpenedCards = async (codes, ids) => {
          if (f.fail) return BQApi.settle(Response.json({ ok: false }, { status: 503 }));
          codes.forEach(c => { f.books[c] ||= {}; ids.forEach(id => { f.books[c][id] ||= '2026-10-13'; }); });
          return ok({ ok: true });
        };
        BQApi.openedCards = async code => (f.fail ? BQApi.settle(Response.json({ ok: false }, { status: 503 })) : ok({ ok: true, opened: { v: 1, codes: { [code]: f.books[code] || {} } } }));
        cards.bqInit();
      <\/script>`;
      await new Promise(resolve => {
        iframe.onload = resolve;
        iframe.srcdoc = html.replace('<head>', `<head><base href="${new URL('../public/', location.href)}">${startup}`).replace('<script type="module" src="js/cards-entry.js"><\/script>', fakeBackend);
      });
      const w = iframe.contentWindow;
      for (let i = 0; i < 100 && w.eval('BQ.remote') === 'loading' && w.eval('BQ.codes.length'); i++) await new Promise(r => setTimeout(r, 20));
      if (!clearIdentity) eq(w.eval('BQ.remote'), 'ready', '後台讀取成功：');
      return w;
    }
    try {
      const a = await device(ME, [selected[0].id]);
      eq(Object.keys(fixture.books[ME]), [selected[0].id], '移入舊卡：');
      const b = await device(ME); // 另一個裝置沒有 localStorage 舊卡
      eq(b.eval('BQ.pending.length'), 6);
      await a.eval('bqDeal()');
      eq(a.eval('BQ.pending.length'), 1);
      await b.eval('bqOpenField()');
      eq(b.eval('BQ.pending.length'), 1, '舊頁面開包前先讀後台：');
      fixture.fail = true;
      await b.eval('bqDeal()');
      eq(b.eval('BQ.pending.length'), 1, '失敗不把卡標成已開：');
      if (!b.document.getElementById('bqDealNote').textContent.includes('未儲存')) throw new Error('要顯示失敗原因');
      const failure = b.document.getElementById('bqPackNote');
      if (!failure.textContent.includes('重試') || b.getComputedStyle(failure).display === 'none') throw new Error('重試提示要在還沒開的卡包旁可見');
      fixture.fail = false;
      await b.eval('bqDeal()');
      eq(b.eval('BQ.pending.length'), 0);
      eq((await device(ME)).eval('BQ.pending.length'), 0, '關閉重開不重複：');
      const o = await device(OTHER);
      eq(o.eval('BQ.pending.length'), 7, '不同人的圖鑑分開：');
      await o.eval('bqOpenField()');
      eq(o.document.getElementById('bqAll').hidden, false, '超過一包才有一次全開：');
      o.eval('BQ.still = false; bqOpenPack()');
      eq(o.document.getElementById('bqSkip').hidden, false, '撕包時可以跳過：');
      await o.eval('bqSkip()');
      eq([o.eval('BQ.pending.length'), o.document.querySelectorAll('#bqHand .bq-card.dealt').length], [2, 5], '跳過動畫直接攤開、照樣存：');
      eq(Object.keys(fixture.books[OTHER]).length, 5);
      await o.eval('bqOpenAll()');
      eq([o.eval('BQ.pending.length'), Object.keys(fixture.books[OTHER]).length, o.document.getElementById('bqAll').hidden], [0, 7, true], '一次全開存進後台：');
      const cleared = await device(ME, [], true);
      eq(cleared.eval('BQ.codes.length'), 0, '慢回應不復活已清除的身分：');
      eq(cleared.localStorage.getItem('bq-walker-name'), null);
    } finally { frames.forEach(f => f.remove()); delete window.__cardFixture; }
  });
  await check('圖鑑只讀狗與遛狗資料，另透過開卡 API 儲存，不寫試算表', async () => {
    // 身分解析從 #623 R8 起經 identity.js，一起算進圖鑑用到的 API
    const identityCode = await fetch('../public/js/identity.js').then(r => r.text());
    const used = [...new Set([...(code + identityCode).matchAll(/BQApi\.(\w+)\(/g)].map(m => m[1]))].sort();
    eq(used, ['departedCards', 'dogs', 'identity', 'myDogs', 'openedCards', 'saveOpenedCards', 'walks'], '狗、歷史、我溜過的狗、身分解析、開卡與已出所（#271）：');
    if (!API_JS.includes("departedCards: () => get('/departed-cards'")) throw new Error('已出所只用 GET 讀');
    if (/\bfetch\(|script\.google\.com|sheets\.googleapis\.com|UPLOAD_URL/.test(code)) throw new Error('cards.js 只能經 BQApi 寫開卡 API');
    if (/storage(?:\?\.|\.)(?:set|writeJson)\((?!BQ_OPENED_KEY|BQ_CODES_KEY|BQStore\.keys\.walkerName)/.test(code)) throw new Error('cards.js 只能存撕開過的卡，不能改溜狗表的代號、今天已溜');
  });
  await check('首頁不再轉到球員卡；電腦版頁首有圖鑑入口，手機看不到', () => {
    if (/bq-desktop-app|location\.replace\('cards\.html'\)/.test(INDEX_HTML)) throw new Error('首頁不應該轉到 cards.html');
    const link = new DOMParser().parseFromString(INDEX_HTML, 'text/html').querySelector('header.app a.zukan-link[href="cards.html"]');
    if (!link) throw new Error('頁首要有圖鑑入口');
    const live = document.querySelector('header.app .zukan-link');
    if (live && !(typeof deskOn === 'function' && deskOn()) && getComputedStyle(live).display !== 'none') throw new Error('手機不顯示圖鑑入口');
  });
}
