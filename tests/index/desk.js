// 電腦版溜狗表（K 2026-10-10）：簡報＋全表、勾選一次登記、異動紀錄；js/desk.js 最後才載入，前面的測試照手機版跑
async function runDeskTests() {
  const code = await fetch('../public/js/desk.js').then(r => r.text());
  const module = await import('../../public/js/desk.js');
  const { expose } = await import('../fixtures/module-globals.js');
  module.startDesk();
  expose([module]);
  const saved = [allDogs, activeTab, searchQuery, sheetNotes, phoneStore, walkRecords, restMap, BQWalkUI.setWalked];
  const TODAY = new Date();
  const ago = n => new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - n);
  const mk = (name, id, cage, days, note = '') => ({ name, id, cage, walkedDate: days == null ? null : ago(days), covered: false, note, intro: '', sex: '', formerIds: [] });
  try {
    phoneStore = fakeStorage(); walkRecords = freshWalkRecords(); restMap = {};
    allDogs = [mk('桌紅', '2026010101', '新A10', 9, '會攻擊其他狗'), mk('桌黃', '2026010102', '舊B05', 3), mk('桌綠', '2026010103', 'C區13', 1), mk('桌無', '2026010104', '母幼A', null)];
    sheetNotes = [{ label: '備註1', text: '1/7新獨10奈威移至新B03休養' }, { label: '', text: '10/1阿湯移至C區35' }];
    await check('電腦版：區域照籠位分、異動紀錄開頭的日期拆出來', () => {
      eq(['新A10', '舊B05', '母幼A', 'C區13', '住院區', '外面'].map(c => deskZoneOf({ cage: c })), ['new', 'old', 'mom', 'c', 'ward', 'other']);
      eq([deskNoteParts('10/1阿湯移至C區35'), deskNoteParts('2026/3/31 妙麗 昆布'), deskNoteParts('沒有日期')],
        [{ date: '10/1', rest: '阿湯移至C區35' }, { date: '2026/3/31', rest: '妙麗 昆布' }, { date: '', rest: '沒有日期' }]);
    });
    await check('電腦版：dogs.json 的 sheetNotes 讀進來（空的、壞的拿掉）', () => {
      eq(parseDogsData({ dogs: [], sheetNotes: [{ label: '備註1', text: ' x ' }, { text: '' }, null, { text: 'y' }] }).sheetNotes, [{ label: '備註1', text: 'x' }, { label: '', text: 'y' }]);
      eq(parseDogsData({ dogs: [] }).sheetNotes, []);
    });
    await check('電腦版：簡報各幾隻、全表一列一隻（警示字紅色）、異動紀錄新的在上面', () => {
      const doc = new DOMParser().parseFromString(deskWalkHtml(TODAY, '', dueDogs(allDogs, TODAY)), 'text/html');
      eq([...doc.querySelectorAll('.db-count b')].map(b => b.textContent), ['1', '1', '1', '1'], '紅、黃、綠、沒紀錄：');
      eq([...doc.querySelectorAll('tbody .dr-name button')].map(b => b.textContent), ['桌無', '桌紅', '桌黃', '桌綠'], '跟手機溜狗表同一個順序：');
      eq(doc.querySelectorAll('[data-desk-check]').length, 4, '每隻都能勾：');
      eq(doc.querySelector('tr.flagged .dr-note mark').textContent, '攻擊', '警示字：');
      eq([...doc.querySelectorAll('.ds-notes li')].map(li => li.textContent), ['10/1阿湯移至C區35', '1/7新獨10奈威移至新B03休養'], '新的在上面：');
      eq(doc.querySelector('.desk-batch'), null, '還沒勾就沒有登記列：');
    });
    await check('電腦版：最近 30 天有 30 格，今天框起來', () => {
      deskView = 'days30';
      deskWalkDays = new Map(); deskWalkFirst = '';
      const doc = new DOMParser().parseFromString(deskWalkHtml(TODAY, '', dueDogs(allDogs, TODAY)), 'text/html');
      eq([doc.querySelectorAll('thead th.dr-d').length, doc.querySelectorAll('thead th.dr-d.today').length], [30, 1]);
      const row = [...doc.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes('桌綠'));
      eq(row.querySelectorAll('i.on').length, 1, '上次溜那天塗色：');
      deskView = 'sheet';
    });
    await check('電腦版最近 30 天（K 2026-10-12）：格子寫誰遛的第一個字、好幾個人加一點、滑過去看全名；換不到名字只有綠格', () => {
      const saved = [walkerCodeNames];
      const green = allDogs.find(d => d.id === '2026010103');
      try {
        deskView = 'days30';
        const k = n => BQDates.localDateKey(ago(n));
        walkerCodeNames = { aaa: '嘉文', bbb: '岑' };
        // 上次溜那天的「誰遛的」來自 D1 今日紀錄（狗清單同步進 D1 的那一格）
        fakeD1.set(walkKey(green), '俐葶', BQDates.localDateKey(effectiveWalkDate(green, TODAY)));
        walkRegistration.receiveToday(fakeD1.pack(), [green]);
        deskWalkDays = new Map([['2026010103', new Map([[k(5), new Set(['aaa', 'bbb'])], [k(8), new Set(['zzz'])], [k(1), new Set()]])]]);
        deskWalkFirst = k(20);
        const doc = new DOMParser().parseFromString(deskWalkHtml(TODAY, '', dueDogs(allDogs, TODAY)), 'text/html');
        const row = [...doc.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes('桌綠'));
        const cell = n => row.querySelectorAll('td.dr-d')[29 - n];
        eq([cell(5).querySelector('i').textContent, cell(5).querySelector('i').classList.contains('multi'), cell(5).title], ['嘉', true, `${ago(5).getMonth() + 1}/${ago(5).getDate()} 嘉文、佳岑`], '兩個人：');
        eq([cell(1).querySelector('i').textContent, cell(1).title.endsWith(' 俐葶')], ['俐', true], '上次溜那天用試算表的誰遛的：');
        eq([cell(8).querySelector('i.on').textContent, cell(8).title.endsWith(' 有溜')], ['', true], '換不到名字：');
        eq(cell(3).title, '', '沒溜：');
      } finally { [walkerCodeNames] = saved; fakeD1.forget([green]); deskWalkDays = null; deskWalkFirst = ''; deskView = 'sheet'; }
    });
    await check('電腦版：勾兩隻按「今天 溜了」一次交給 BQWalkUI.setWalked（照舊只寫遛狗日期、誰遛的），勾的清掉', () => {
      if (!deskOn()) return; // 測試的瀏覽器不夠寬就不測畫面
      const calls = [];
      BQWalkUI.setWalked = (dogs, on) => calls.push([dogs.map(d => d.name), on]);
      activeTab = 'walk'; searchQuery = ''; render();
      const boxes = [...main.querySelectorAll('[data-desk-check]')];
      boxes[1].click(); boxes[2].click();
      eq(main.querySelector('.desk-batch .dbx-n b').textContent, '2', '登記列：');
      main.querySelector('[data-desk-go]').click();
      eq(calls, [[['桌紅', '桌黃'], true]], '一次登記：');
      eq([deskChecked.size, main.querySelector('.desk-batch')], [0, null], '清掉：');
    });
    await check('電腦版不再有補資料（#568：管理網站取代）：表格只剩全表、最近 30 天；照片、介紹從詳細資訊改', () => {
      const doc = new DOMParser().parseFromString(deskWalkHtml(TODAY, '', dueDogs(allDogs, TODAY)), 'text/html');
      eq([...doc.querySelectorAll('[data-desk-view]')].map(b => b.dataset.deskView), ['sheet', 'days30'], '表格種類：');
      eq([doc.querySelector('.desk-fill, [data-fill-photo], [data-fill-intro], [data-desk-fill]'), /deskFill|data-fill/.test(code)], [null, false], '沒有補資料畫面與程式：');
    });
    await check('這間收容所的設定集中在 js/site-config.js（10-10 K：以後其他收容所可以搬去用）：門檻、警示字、分區不寫死在別的檔', () => {
      eq([AMBER_DAYS, RED_DAYS, SPECIAL_KEYWORDS === SITE.warnKeywords, DESK_ZONES === SITE.zones], [SITE.days.amber, SITE.days.red, true, true], '都讀 SITE：');
      eq(SITE.zones.map(z => [z.key, z.test('新 A10'), z.test('c區13')]), [['new', true, false], ['old', false, false], ['mom', false, false], ['c', false, true], ['ward', false, false]], '分區比對（去空白、C 區不分大小寫）：');
      if (!/from ['"]\.\/site-config\.js['"]/.test(APP_JS)) throw new Error('主頁要明確匯入 SITE');
      if (/const (AMBER_DAYS|RED_DAYS) = [0-9]/.test(APP_JS) || APP_JS.includes('[\'勿溜\'')) throw new Error('js/app.js 不該再寫死門檻或警示字');
    });
    await check('電腦版全表（10-10 K）：同一欄再點一次反過來排、三角形跟著換；點整列開詳細資訊，勾選那一格不算', () => {
      if (!deskOn()) return;
      try {
        deskView = 'sheet'; deskSort = 'days'; deskSortRev = false; deskZone = 'all';
        activeTab = 'walk'; searchQuery = ''; render();
        const rows = () => [...main.querySelectorAll('.desk-table tbody tr.dr .dr-name button')].map(b => b.textContent);
        const head = k => main.querySelector(`[data-desk-sort="${k}"]`).closest('th');
        const days = rows();
        eq([head('days').getAttribute('aria-sort'), head('days').classList.contains('desc')], ['descending', true], '天數預設最久的在上面：');
        main.querySelector('[data-desk-sort="days"]').click();
        eq([rows(), head('days').getAttribute('aria-sort'), head('days').classList.contains('asc')], [days.slice().reverse(), 'ascending', true], '再點一次反過來：');
        main.querySelector('[data-desk-sort="cage"]').click();
        const cages = rows();
        eq([head('cage').getAttribute('aria-sort'), head('days').getAttribute('aria-sort'), deskSortRev], ['ascending', 'none', false], '換一欄從預設方向開始：');
        main.querySelector('[data-desk-sort="cage"]').click();
        eq([rows(), head('cage').getAttribute('aria-sort')], [cages.slice().reverse(), 'descending'], '籠位也能反過來：');
        const row = main.querySelector('.desk-table tbody tr.dr');
        row.querySelector('.dr-ck').click();
        eq(detailDog, null, '勾選那一格不開：');
        row.querySelector('.dr-note').click();
        eq(detailDog === allDogs[Number(row.dataset.deskDog)], true, '點備註那一格也開這隻狗：');
        hideDetail(); history.replaceState(null, '');
      } finally { deskSort = 'days'; deskSortRev = false; render(); }
    });
    await check('電腦版只靠 BQWalkUI.setWalked 登記，自己不送資料', () => {
      // #568 補資料刪除後，電腦版只讀溜狗紀錄；照片、介紹在詳細資訊改（依志工編輯開關）
      eq([...new Set([...code.matchAll(/BQApi\.(\w+)\(/g)].map(m => m[1]))].sort(), ['walks'], '只讀溜狗紀錄：');
      if (/\bfetch\(|method\s*:|sheet-write|['"]\/walk\b|script\.google/.test(code)) throw new Error('js/desk.js 不應該自己送資料或寫試算表');
    });
  } finally {
    deskChecked.clear(); deskView = 'sheet';
    [allDogs, activeTab, searchQuery, sheetNotes, phoneStore, walkRecords, restMap, BQWalkUI.setWalked] = saved;
    render();
  }
}
