// #99 找狗：搜尋全部的狗（犬名、編號、籠位、舊編號）、籠位對到平面圖分區、區域篩選隻數
// 頁首「更新」按鈕（#512）：狗清單有人編輯就直接進 D1，按了只重讀 D1，不再 POST /sync
async function runSyncButtonTests() {
  const saved = [allDogs, groupMap, activeTab, searchQuery, dataSyncedAt];
  const btn = document.createElement('button');
  const toast = () => (document.querySelector('#toast .toast-text') || {}).textContent;
  const dogsFile = (at, name) => ({ version: 1, syncedAt: at, groups: {}, dogs: [{ name, id: '2024032902', cage: '新A03', walkedDate: null }] });
  try {
    activeTab = 'walk'; searchQuery = '';
    dataSyncedAt = new Date('2026-09-27T13:24:18+08:00');
    await check('更新按鈕：只重讀狗清單、今日紀錄與名單，不叫同步；換上資料、顯示更新時間', async () => {
      const calls = fakeApi(name => name === 'dogs' ? apiJson(dogsFile('2026-09-27T15:02:00+08:00', '新狗')) : new Response('{}', { status: 404 }));
      await refreshData(btn);
      await new Promise(r => setTimeout(r, 0));
      const names = calls.map(c => c[0]);
      eq(names[0], 'dogs', '先讀狗清單：');
      eq(names.filter(n => /^(sync|save|upload)/.test(n)), [], '只讀不寫：');
      eq(allDogs.map(d => d.name), ['新狗']);
      const t = new Date('2026-09-27T15:02:00+08:00'); // 測試機器時區不一定是台灣
      eq(document.getElementById('updatedLabel').textContent, `資料更新 ${t.getMonth() + 1}/${t.getDate()} ${pad2(t.getHours())}:${pad2(t.getMinutes())}`);
      eq(toast(), '資料已更新');
      eq(btn.classList.contains('syncing'), false, '轉圈停了：');
    });
    await check('更新按鈕：讀不到就提示、保留原本的資料', async () => {
      fakeApi(() => new Response('{}', { status: 502 }));
      await refreshData(btn);
      eq(toast(), '暫時讀不到資料，請稍後再更新');
      eq(allDogs.map(d => d.name), ['新狗']);
      eq(btn.classList.contains('syncing'), false, '轉圈停了：');
    });
    await check('更新按鈕在頁首', () => {
      if (!/id="syncBtn"[^>]*aria-label="更新資料"/.test(INDEX_HTML)) throw new Error('index.html 沒有更新按鈕');
    });
  } finally {
    [allDogs, groupMap, activeTab, searchQuery, dataSyncedAt] = saved;
    restoreApi(); BQWalkUI.hideToast();
  }
}

async function runFindTests() {
  const saved = [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, findView, findZone, findCage];
  try {
    phoneStore = fakeStorage(); walkRecords = freshWalkRecords();
    const dog = (name, id, cage, extra = {}) => ({ name, id, cage, walkedDate: null, covered: false, note: '', intro: '', sex: '', formerIds: [], ...extra });
    allDogs = [
      dog('小白', '2024032902', '新A03'), dog('阿黑', '2021010101', '新獨12'), dog('花花', '2020050501', '新B10'),
      dog('老大', '2019070701', '舊B04', { formerIds: ['2017090423'] }), dog('咪寶', '2021030913', 'C區11'),
      dog('布布', '2022020202', '住院區'), dog('滿滿', '2025022703', '母幼A'), dog('神秘', '2023010101', '後院'),
    ];
    groupMap = {}; searchQuery = ''; findView = 'list'; findZone = 'all';
    const names = list => list.map(d => d.name);
    await check('#99 籠位對到平面圖分區（K 2026-09-26 確認）', () => {
      eq(allDogs.map(findZoneOf), ['new', 'new', 'new', 'old', 'pup', 'iso', 'mom', 'other']);
    });
    await check('#99 搜尋犬名、編號後四碼、籠位、舊編號都找得到', () => {
      eq(names(findList('小白', 'all')), ['小白'], '犬名：');
      eq(names(findList('2902', 'all')), ['小白'], '編號後四碼：');
      eq(names(findList('舊b04', 'all')), ['老大'], '籠位（不分大小寫）：');
      eq(names(findList('新 A03', 'all')), ['小白'], '籠位（忽略空白）：');
      eq(names(findList('2017090423', 'all')), ['老大'], '舊編號：');
      eq(names(findList('找不到', 'all')), [], '找不到：');
    });
    await check('#99 依區域（圖上由上到下）再依籠位排：新A、新B、新獨', () => {
      eq(names(findList('', 'all')), ['小白', '花花', '阿黑', '布布', '滿滿', '咪寶', '老大', '神秘']);
    });
    await check('#99 搜尋範圍是全部的狗：今天已溜、收起的也找得到', () => {
      fakeD1.show([allDogs[0]], '志工我');
      try { eq(names(findList('小白', 'all')), ['小白']); } finally { fakeD1.forget([allDogs[0]]); }
    });
    await check('#99 找狗分頁：區域按鈕的隻數跟著搜尋變，點區域只列那區', () => {
      activeTab = 'find'; searchQuery = '新';
      render();
      const chip = key => document.querySelector(`#main [data-find-zone="${key}"] small`);
      eq(document.querySelector('#main [data-find-zone="all"]'), null, 'V9（#141）預設就是全部，沒有「全部」鈕：');
      eq(chip('new').textContent, '3', '新犬舍：');
      eq(document.querySelector('#tabs [data-tab="find"]'), null, '找狗不在底部分類：');
      searchQuery = '';
      document.querySelector('#main [data-find-zone="pup"]').click();
      eq([...document.querySelectorAll('#main .find-dog .find-name .n')].map(n => n.textContent), ['咪寶'], 'C區：');
      document.querySelector('#main [data-find-zone="pup"]').click();
      eq(findZone, 'all', '再點一次取消：');
    });
    await check('#99 平面圖：每區顯示隻數，對不到的籠位放在圖下方', () => {
      findView = 'map'; findZone = 'all'; activeTab = 'find';
      render();
      eq(document.querySelector('#main g[data-find-zone="iso"]').getAttribute('aria-label'), '隔離區 1 隻');
      eq(document.querySelector('#main g[data-find-zone="new"]').getAttribute('aria-label'), '新犬舍區 3 隻');
      if (!document.querySelector('#main .find-unmapped [data-find-zone="other"]')) throw new Error('沒有「其他籠位」按鈕');
      for (const id of ['i-grid', 'i-map']) {
        if (!INDEX_HTML.includes(`<symbol id="${id}"`)) throw new Error(`index.html 缺 ${id} 圖示`);
      }
      if (!/from ['"]\.\/app\.js['"]/.test(FIND_JS)) throw new Error('找狗頁要明確匯入主頁能力');
    });
    await check('#99 找狗不顯示未遛天數與「已遛」按鈕', () => {
      const html = findRowsHtml(allDogs, '');
      if (/data-walk|上次遛狗|天前/.test(html)) throw new Error(html);
    });
    await check('#102 平面圖放大：全螢幕畫橫的、－／＋ 調大小、點區域關掉並選那一區', () => {
      findView = 'map'; findZone = 'all'; activeTab = 'find'; searchQuery = '';
      render();
      // V9（#141 第 12 項）平面圖下面不放「放大」鈕；全螢幕放大的程式還在，直接呼叫測
      if (document.getElementById('findZoomOpen')) throw new Error('平面圖下面不該有「放大」鈕');
      findZoomShow(null);
      const box = document.getElementById('findZoom');
      eq(box.hidden, false, '打開：');
      const [, , w, h] = box.querySelector('.find-zoom-map svg').getAttribute('viewBox').split(' ').map(Number);
      if (!(w > h)) throw new Error(`全螢幕要橫的，viewBox ${w}×${h}`);
      eq(box.querySelector('[data-zoom-step="-1"]').disabled, true, '最小時不能再縮：');
      box.querySelector('[data-zoom-step="1"]').click();
      eq(box.querySelector('.find-zoom-pct').textContent, '150%', '放大一級：');
      eq(box.querySelector('.find-zoom-map').style.width, '150%', '地圖寬度：');
      box.querySelector('g[data-find-zone="iso"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      eq([box.hidden, findZone, findView, activeTab], [true, 'iso', 'map', 'find'], '點隔離區：');
      const pageMap = document.querySelector('#main svg.find-map');
      if (!pageMap) throw new Error('頁面上沒有平面圖：' + document.getElementById('main').innerHTML.slice(0, 200));
      const [, , mw, mh] = pageMap.getAttribute('viewBox').split(' ').map(Number);
      if (!(mw > mh)) throw new Error('頁面上的平面圖仍是橫的');
      if (!INDEX_HTML.includes('<symbol id="i-zoom"')) throw new Error('index.html 缺 i-zoom 圖示');
    });
    await check('逐籠平面圖（K 2026-09-27 手繪標註）：舊犬舍四排、新犬舍三排', () => {
      eq(allDogs.map(findCageOf), ['新A3', '新獨12', '新B10', '舊B4', null, null, null, null], '籠位對到籠子：');
      const ids = FIND_CAGES.cages.map(c => c.id);
      eq([ids.filter(i => i.startsWith('舊')).length, ids.filter(i => i.startsWith('新')).length], [42, 32], '籠子數：');
      // 橫的看板座標：x 由左到右、y 由上到下
      const land = id => findToLand(FIND_CAGES.cages.find(c => c.id === id).rect);
      const [a11, a21, a1, a10, b1, b11, b21] = ['舊A11', '舊A21', '舊A1', '舊A10', '舊B1', '舊B11', '舊B21'].map(land);
      if (!(a21[1] < a11[1] && a10[1] < a1[1] && b21[1] < b11[1])) throw new Error('舊犬舍每排應該 1 號在下、往上數');
      if (!(a11[0] < a1[0] && a1[0] < b1[0] && b1[0] < b11[0])) throw new Error('舊犬舍由左到右應該是 A11–21、A1–10、B1–10、B11–21');
      const [nb1, nb10, na1, d1, d12] = ['新B1', '新B10', '新A1', '新獨1', '新獨12'].map(land);
      if (!(nb1[1] < na1[1] && na1[1] < d1[1])) throw new Error('新犬舍由上到下應該是新B、新A、新獨');
      if (!(nb1[0] < nb10[0] && d1[0] < d12[0])) throw new Error('新犬舍應該左到右 1 號起');
      if (!(d1[2] < nb1[2])) throw new Error('新獨應該比較窄');
      // 全圖不畫籠子（critique 2026-10-09），放大一區才畫
      findView = 'map'; findZone = 'new'; activeTab = 'find'; searchQuery = '';
      render();
      eq(document.querySelectorAll('#main rect.fm-cage').length, 74, '頁面平面圖畫出每個籠子：');
      eq(document.querySelectorAll('#main rect.fm-cage.has').length, 4, '有狗的籠子：');
    });
    await check('逐籠平面圖：點籠子只列那籠的狗、再點回整區；搜尋時找到的籠子亮橘色、其他淡掉', () => {
      findView = 'map'; findZone = 'new'; findCage = null; activeTab = 'find'; searchQuery = '';
      render();
      const heads = () => [...document.querySelectorAll('#main .find-dog .find-name .n')].map(n => n.textContent);
      document.querySelector('#main g[data-find-cage="新B10"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      eq([findZone, findCage, heads()], ['new', '新B10', ['花花']], '點新B10：');
      eq(document.querySelector('#main .find-zone-head h2').textContent, '新犬舍區・新B10', '標題：');
      if (!document.querySelector('#main g[data-find-cage="新B10"] rect').classList.contains('on')) throw new Error('點的籠子沒亮');
      document.querySelector('#main g[data-find-cage="新B1"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      eq(document.querySelector('#main .status-msg').textContent, '這籠目前沒有狗', '空籠：');
      document.querySelector('#main g[data-find-cage="新B1"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      eq([findZone, findCage, heads().length], ['new', null, 3], '再點一次回整區：');
      findZone = 'all'; searchQuery = '小白';
      render();
      eq([...document.querySelectorAll('#main rect.fm-cage.on')].length, 1, '搜尋找到一籠：');
      if (!document.querySelector('#main g[data-find-cage="新A3"] rect').classList.contains('on')) throw new Error('搜尋的籠子沒亮');
      if (!document.querySelector('#main g[data-find-cage="舊B4"] rect').classList.contains('fade')) throw new Error('其他籠子沒淡掉');
      searchQuery = '';
    });
  } finally {
    const box = document.getElementById('findZoom');
    if (box) box.remove();
    findZoomState = null;
    document.documentElement.classList.remove('find-zoom-open');
    [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, findView, findZone, findCage] = saved;
  }
}

// V7 #111：分類和搜尋在底部列；狗卡上的籠位點了跳「在哪」面板（平面圖放大到那一區、那一籠橘框、找路的話）
async function runWhereTests() {
  const saved = [allDogs, groupMap, phoneStore, walkRecords, activeTab, searchQuery, UPLOAD_URL, sheetWriteState, walkerNameMemory];
  const wait = () => new Promise(r => setTimeout(r, 60));
  try {
    phoneStore = fakeStorage(); walkRecords = freshWalkRecords();
    const dog = (name, id, cage, days) => ({ name, id, cage, walkedDate: days == null ? null : new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - days), covered: false, note: '', intro: '', sex: '', formerIds: [] });
    allDogs = [
      dog('測試甲', '2024032901', '舊A03', 12), dog('測試乙', '2024032902', '舊A03', 3), dog('測試丙', '2024032903', '新獨11', 40),
      dog('測試丁', '2024032904', '住院區', 2), dog('測試戊', '2024032905', '後院', 1),
    ];
    fakeD1.forget(allDogs);
    groupMap = {};
    await check('#111 底部列：搜尋框和分類列在畫面最下面，分類有圖示', () => {
      const doc = new DOMParser().parseFromString(INDEX_HTML, 'text/html');
      const bar = doc.getElementById('bottomBar');
      if (!bar || bar.compareDocumentPosition(doc.getElementById('main')) & Node.DOCUMENT_POSITION_FOLLOWING) throw new Error('底部列要在內容區後面');
      if (doc.querySelector('header #tabs, #bottomBar #searchInput')) throw new Error('分類不放頁首；搜尋框 2026-10-04 起在頁首、不在底部列');
      buildTabs({});
      eq([...document.querySelectorAll('#tabs button')].map(b => !!b.querySelector('svg.icon')), [true, true, true, true], '每個分類都有圖示：');
    });
    await check('#111 找路的話：舊犬舍由下往上數、新犬舍由左往右數，不分籠的區說進去找', () => {
      const how = cage => whereDirections({ cage }).how;
      eq(how('舊A3'), '進舊犬舍走左邊第二排，從下面數第 3 籠', '舊A3：');
      eq(how('舊A15'), '進舊犬舍走最左排，從下面數第 5 籠', '舊A15：');
      eq(how('舊B07'), '進舊犬舍走右邊第二排，從下面數第 7 籠', '舊B07：');
      eq(how('舊B12'), '進舊犬舍走最右排，從下面數第 2 籠', '舊B12：');
      eq(how('新B04'), '新犬舍上排，從左邊數第 4 籠', '新B04：');
      eq(how('新A2'), '新犬舍中間排，從左邊數第 2 籠', '新A2：');
      eq(how('新獨11'), '新犬舍下排小籠，從左邊數第 11 籠', '新獨11：');
      eq(how('住院區'), '隔離區不分籠，進去找「住院區」', '住院區：');
    });
    await check('#111 狗卡籠位：平面圖上有的做成「在哪」膠囊按鈕放在編號前面，對不到的照舊只寫字', () => {
      activeTab = 'walk'; searchQuery = ''; render();
      const card = i => document.querySelector(`#main .card[data-dog="${i}"]`);
      eq(!!card(0).querySelector('[data-where]'), true, '舊A03：');
      eq(!!card(3).querySelector('[data-where]'), true, '住院區：');
      eq(!!card(4).querySelector('[data-where]'), false, '後院：');
      eq([card(0).querySelector('.meta').firstElementChild.textContent, card(0).querySelector('.meta .id').textContent], ['舊A03', '2024032901'], '籠位膠囊在前、編號在後：');
    });
    await check('#111 點籠位開在哪面板：放大那一區、那一籠橘框、同籠的狗，不開詳細資訊', async () => {
      activeTab = 'walk'; render();
      document.querySelector('#main .card[data-dog="0"] [data-where]').click();
      const box = document.getElementById('whereBackdrop');
      eq([whereDog === allDogs[0], box.hidden, detailDog], [true, false, null], '開面板、沒開詳細資訊：');
      eq(box.querySelector('#whereTitle').textContent, '舊犬舍區・舊A03', '標題：');
      eq(box.querySelector('.where-how').textContent, '進舊犬舍走左邊第二排，從下面數第 3 籠', '找路：');
      eq(box.querySelectorAll('.where-ring').length, 1, '那一籠橘框：');
      eq(box.querySelector('.mates').textContent, '同籠還有 測試乙', '同籠：');
      eq(box.querySelector('.where-days').textContent, `上次溜 ${computeStatus(allDogs[0], new Date()).days} 天前`, '天數（跟狗卡同一種說法）：');
      box.querySelector('#whereClose').click();
      await wait();
      eq([whereDog, box.hidden], [null, true], '關閉：');
    });
    await check('#111 在哪面板按「溜了」記進今天已溜並關掉；按「詳細資訊」換開詳細資訊', async () => {
      activeTab = 'walk';
      UPLOAD_URL = 'https://worker.test'; sheetWriteState = 'unknown'; saveWalkerName('志工我'); fakeApi(fakeD1.api());
      render();
      document.querySelector('#main .card[data-dog="2"] [data-where]').click();
      const box = document.getElementById('whereBackdrop');
      eq(box.querySelector('.mates').textContent, '這籠只有牠', '獨自一籠：');
      box.querySelector('[data-where-walk="add"]').click();
      await until(() => walkedToday().has(allDogs[2]), 'D1 接受：');
      eq([whereDog, box.hidden, walkedToday().has(allDogs[2])], [null, true, true], '溜了：');
      BQWalkUI.hideToast(); restoreApi(); fakeD1.forget([allDogs[2]]);
      document.querySelector('#main .card[data-dog="3"] [data-where]').click();
      eq(document.querySelectorAll('#whereBackdrop .where-ring').length, 0, '住院區不分籠，沒有橘框：');
      document.getElementById('whereDetail').click();
      eq([whereDog, detailDog === allDogs[3]], [null, true], '詳細資訊：');
      closeDetail();
      await wait();
    });
    await check('#112 詳細資訊：上面大照片，下面狗名、天數／籠位／入所標籤', () => {
      showDetail(allDogs[0]);
      const box = document.getElementById('detail');
      const head = box.querySelector('.detail-head');
      eq(head.firstElementChild.classList.contains('hero'), true, '照片在最上面：');
      eq([...head.querySelectorAll('.chips .badge')].map(b => b.textContent.trim()).slice(1), ['舊A03', '入所 2024/3'], '籠位、入所標籤：');
      hideDetail();
    });
    await check('#112 詳細資訊底部固定列：關閉、在哪、溜了；在哪開面板、Esc 只關面板', async () => {
      showDetail(allDogs[1]);
      const bar = document.querySelector('#detail .detail-bar');
      eq([...bar.querySelectorAll('button')].map(b => b.id), ['detailClose', 'detailWhere', 'groupWalk'], '按鈕：');
      if (document.querySelector('.detail-head #detailClose')) throw new Error('右上角不再放關閉');
      bar.querySelector('#detailWhere').click();
      eq([whereDog === allDogs[1], detailDog === allDogs[1]], [true, true], '面板開在詳細資訊上面：');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait();
      eq([whereDog, detailDog === allDogs[1]], [null, true], 'Esc 只關面板：');
      document.getElementById('detailClose').click();
      await wait();
      eq(detailDog, null, '關閉：');
      showDetail(allDogs[4]);
      eq(!!document.getElementById('detailWhere'), false, '平面圖上沒有的籠位不顯示在哪：');
      hideDetail();
    });
  } finally {
    if (whereDog) whereHide();
    if (detailDog) hideDetail();
    restoreApi();
    [allDogs, groupMap, phoneStore, walkRecords, activeTab, searchQuery, UPLOAD_URL, sheetWriteState, walkerNameMemory] = saved;
  }
}

async function runFindV7Tests() {
  const saved = [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, findView, findZone, findCage];
  const frame = () => new Promise(r => requestAnimationFrame(() => r()));
  const waitViewBox = async (want, label, timeout = 2000) => {
    const started = performance.now();
    while (true) {
      const got = document.querySelector('#main svg.find-map').getAttribute('viewBox').split(' ').map(Number);
      if (got.length === want.length && got.every((n, i) => n === want[i])) return;
      if (performance.now() - started > timeout) throw new Error(`等候逾時：${label}；預期 ${want.join(' ')}，實際 ${got.join(' ')}`);
      await frame();
    }
  };
  try {
    phoneStore = fakeStorage(); walkRecords = freshWalkRecords();
    const dog = (name, id, cage) => ({ name, id, cage, walkedDate: null, covered: false, note: '', intro: '', sex: '', formerIds: [] });
    allDogs = [dog('測試甲', '2024032901', '舊A03'), dog('測試乙', '2024032902', '新A05'), dog('測試丙', '2024032903', '後院')];
    groupMap = {}; searchQuery = ''; activeTab = 'find'; findView = 'list'; findZone = 'all'; findCage = null;
    await check('#113 找狗：照片／平面圖一排、區域一排（K 2026-09-28）', () => {
      render();
      const bar = document.querySelector('#main .find-bar');
      eq([...bar.children].map(el => el.className), ['find-top', 'find-chips'], '兩排（列表模式）：');
    });
    await check('#113 平面圖：選一區就放大到那一區，「看全圖」回到整張', async () => {
      findView = 'map'; findZone = 'all'; render();
      const full = findMapBox(null);
      const vb = () => document.querySelector('#main svg.find-map').getAttribute('viewBox').split(' ').map(Number);
      await waitViewBox(full, '平面圖顯示全圖');
      eq(vb(), full, '沒選區是整張：');
      document.querySelector('#main g[data-find-zone="old"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const box = findMapBox('old');
      eq(vb(), full, '剛點下去還是整張（接著動畫放大）：');
      if (!(box[2] < full[2] && box[3] < full[3])) throw new Error('放大範圍沒有比較小');
      if (Math.abs(box[2] / box[3] - full[2] / full[3]) > 0.01) throw new Error('放大範圍長寬比要跟整張一樣，地圖框才不會跳');
      const [zx, zy, zw, zh] = findTurn(FIND_ZONES.find(z => z.key === 'old').rect);
      if (box[0] > zx || box[1] > zy || box[0] + box[2] < zx + zw || box[1] + box[3] < zy + zh) throw new Error('放大範圍沒包住整區');
      await waitViewBox(box, '平面圖放大到選取區域');
      eq(vb(), box, '動畫結束停在那一區：');
      document.querySelector('#main g[data-find-zone="old"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      eq(findZone, 'old', '放大後點圖上的區不會取消：');
      document.querySelector('#main g[data-find-cage="舊A3"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      eq([findZone, findCage, vb()], ['old', '舊A3', box], '點籠子維持放大：');
      document.querySelector('#main .find-map-all').click();
      eq([findZone, findCage], ['all', null], '看全圖：');
      await waitViewBox(full, '平面圖回到全圖');
      eq(vb(), full, '縮回整張：');
      eq(!!document.querySelector('#main .find-map-all'), false, '整張時不顯示看全圖：');
    });
    await check('#113 找狗搜尋：地圖在上、結果在下，都在同一區就放大過去，點一隻開在哪', async () => {
      findView = 'list'; findZone = 'all'; findCage = null; searchQuery = '測試甲'; render();
      const main = document.getElementById('main');
      const map = main.querySelector('.find-map-card'), grid = main.querySelector('.find-rows');
      if (!map || !grid) throw new Error('列表模式搜尋也要有地圖和結果');
      if (!(map.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING)) throw new Error('地圖要在結果上面');
      if (!main.querySelector('g[data-find-cage="舊A3"] rect').classList.contains('on')) throw new Error('找到的籠子沒亮');
      eq(main.querySelector('svg.find-map').dataset.to, findMapBox('old').join(' '), '只在舊犬舍就放大到舊犬舍：');
      main.querySelector('.find-dog').click();
      eq([whereDog && whereDog.name, detailDog], ['測試甲', null], '點一隻開在哪、不開詳細資訊：');
      whereHide();
      searchQuery = '測試'; render();
      eq(document.querySelector('#main svg.find-map').dataset.to, findMapBox(null).join(' '), '不同區就看整張：');
      searchQuery = '測試丙'; render();
      document.querySelector('#main .find-dog').click();
      eq([whereDog, detailDog && detailDog.name], [null, '測試丙'], '平面圖上沒有的籠位開詳細資訊：');
      hideDetail();
      searchQuery = '沒有這隻'; render();
      if (!document.querySelector('#main .status-msg').textContent.includes('找不到「沒有這隻」')) throw new Error('找不到的說明不見了');
      searchQuery = ''; findView = 'list'; render();
      eq(!!document.querySelector('#main .find-map-card'), false, '沒搜尋的列表模式不放地圖：');
    });
  } finally {
    if (whereDog) whereHide();
    if (detailDog) hideDetail();
    [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, findView, findZone, findCage] = saved;
  }
}

async function runCageMateTests() {
  const saved = [allDogs, groupMap, phoneStore, walkRecords];
  try {
    phoneStore = fakeStorage(); walkRecords = freshWalkRecords();
    const dog = (name, id, cage) => ({ name, id, cage, walkedDate: null, covered: false, note: '', intro: '', sex: '', formerIds: [] });
    allDogs = [
      dog('小白', '2024032901', '新A03'), dog('阿黑', '2024032902', '新A03'), dog('花花', '2024032903', '新 A03'),
      dog('老大', '2024032904', '新A04'), dog('布布', '2024032905', '住院區'), dog('咪寶', '2024032906', '住院區'),
      dog('滿滿', '2024032907', '母幼A'), dog('宙斯', '2024032908', '母幼A'),
    ];
    fakeD1.forget(allDogs);
    groupMap = {};
    await check('同籠：籠位一樣（忽略空白）才算，不含自己；「○○區」不算同籠', () => {
      eq(cageMates(allDogs[0]).map(d => d.name), ['阿黑', '花花'], '新A03：');
      eq(cageMates(allDogs[3]), [], '獨自一籠：');
      eq(cageMates(allDogs[4]), [], '住院區：');
      eq(cageMates(allDogs[6]), [], '母幼區各自一籠：');
    });
    await check('同籠、可以一起溜合成一段（10-10 減法）：同一隻只出現一次，同籠的排前面、標「同籠」，一樣可以勾選一起記', () => {
      const savedGroups = groupMap;
      try {
        // 阿黑同籠又登記可以一起溜；獨行不同籠、只有登記
        groupMap = { ...groupMap, [allDogs[0].name]: new Set([allDogs[1].name, allDogs[3].name]) };
        const html = detailHtml(allDogs[0], TODAY);
        const box = document.createElement('div');
        box.innerHTML = html;
        if (box.querySelector('[data-section="cage"]')) throw new Error('不該再有另一段同籠的狗');
        const sec = box.querySelector('[data-section="group"]');
        eq([...sec.querySelectorAll('.bname')].map(n => n.textContent), ['阿黑', '花花', allDogs[3].name], '不重複、同籠在前：');
        eq([...sec.querySelectorAll('.buddy-tile')].map(t => !!t.querySelector('.mate-tag')), [true, true, false], '同籠的標出來：');
        eq(sec.querySelectorAll('.pick').length, 3, '勾選圓圈：');
        const name = walkerNameMemory; saveWalkerName('志工我');
        fakeD1.show([allDogs[1]], '志工我');
        const box2 = document.createElement('div');
        box2.innerHTML = togetherSection(allDogs[0], walkedToday());
        fakeD1.forget([allDogs[1]]); saveWalkerName(name);
        eq(box2.querySelectorAll('.pick').length, 2, '今天已溜的不顯示圓圈：');
        if (!box2.querySelector('.walked-tag')) throw new Error('今天已溜的要標「今天已溜」');
        groupMap = savedGroups;
        box2.innerHTML = togetherSection(allDogs[3], new Set());
        eq([box2.querySelectorAll('.buddy-tile').length, box2.querySelector('.empty').textContent], [0, '沒有同籠，也沒有登記可以一起溜的狗'], '都沒有：');
      } finally { groupMap = savedGroups; }
    });
    await check('V7 小修正：詳細資訊不再有中間的「在哪裡」卡片，底部「在哪」照樣開面板', () => {
      const html = detailHtml(allDogs[0], TODAY);
      if (/data-section="where"|find-where|findMiniZoom|看同區的狗/.test(html)) throw new Error('「在哪裡」卡片還在');
      showDetail(allDogs[0]);
      document.getElementById('detailWhere').click();
      eq(whereDog === allDogs[0], true, '底部在哪開面板：');
      whereHide();
      if (history.state && history.state.bqWhere) history.replaceState(null, '');
      hideDetail();
    });
  } finally {
    [allDogs, groupMap, phoneStore, walkRecords] = saved;
  }
}

// #154 找狗改成列表＋平面圖，拿掉照片格子（K 2026-10-04：找狗靠文字與位置，認狗靠小照片）
async function runFindListTests() {
  const saved = [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, findView, findZone, findCage];
  try {
    phoneStore = fakeStorage(); walkRecords = freshWalkRecords();
    const dog = (name, id, cage, extra = {}) => ({ name, id, cage, walkedDate: null, covered: false, note: '', intro: '', sex: '', formerIds: [], ...extra });
    allDogs = [
      dog('列表甲', '2024100401', '新A03', { sex: '♀' }), dog('列表乙', '2024100402', '新A03', { sex: '♂' }),
      dog('列表丙很長很長很長的名字', '2024100403', '新A05'), dog('列表丁', '2024100404', '舊B04', { note: '勿溜' }),
    ];
    groupMap = {}; searchQuery = ''; activeTab = 'find'; findView = 'list'; findZone = 'all'; findCage = null;
    const main = document.getElementById('main');
    await check('2026-10-08 找狗只有平面圖／列表兩種，一打開是平面圖；平面圖不再多一排區域，只留 ★ 我的常溜', async () => {
      const code = await fetch('../public/js/find.js').then(r => r.text());
      if (!/findState\.findView = 'map';/.test(code)) throw new Error('打開找狗應該是平面圖');
      findView = 'map'; render();
      eq([...main.querySelectorAll('[data-find-view]')].map(b => b.textContent.trim()), ['平面圖', '列表'], '顯示方式：');
      eq([!!main.querySelector('.find-map-card'), [...main.querySelectorAll('.find-chip')].map(c => c.dataset.findZone)], [true, ['fav']], '平面圖＋常溜：');
      findView = 'list'; render();
      eq(main.querySelector('[data-find-view="list"]').getAttribute('aria-pressed'), 'true', '列表：');
      eq([!!main.querySelector('.find-grid'), !!main.querySelector('.find-map-card')], [false, false], '沒有照片格子、沒有地圖：');
    });
    await check('2026-10-08 開始搜尋就搜全部的狗，之前選的區不留著', () => {
      findView = 'map'; findZone = 'old'; findCage = null; searchQuery = ''; render();
      searchQuery = '列表'; render();
      eq(findZone, 'all', '區域回到全部：');
      eq(main.querySelectorAll('.find-dog').length, 4, '四隻都找到：');
      searchQuery = ''; findView = 'list'; findZone = 'all'; render();
    });
    await check('#154 列表一區一段、一籠一列：籠位在左，同籠的狗排在同一列', () => {
      render();
      eq([...main.querySelectorAll('.find-zone-head h2')].map(h => h.textContent), ['新犬舍區', '舊犬舍區'], '分段：');
      const rows = [...main.querySelectorAll('.find-row')].map(r => [r.querySelector('.find-row-cage').textContent,
        [...r.querySelectorAll('.find-dog .find-name .n')].map(n => n.textContent)]);
      eq(rows, [['新A03', ['列表乙', '列表甲']], ['新A05', ['列表丙很長很長很長的名字']], ['舊B04', ['列表丁']]], '籠位列：');
      const dogBtn = main.querySelector('.find-dog');
      eq([!!dogBtn.querySelector('.thumb'), dogBtn.querySelector('img').getAttribute('width'), !!dogBtn.querySelector('.sex.male')], [true, '32', true], '小照片＋性別：');
      eq(!!main.querySelectorAll('.find-row')[2].querySelector('.find-row-warn'), true, '備註有注意字眼標驚嘆號：');
    });
    await check('#154 名字長也不截斷（換行）', () => {
      render();
      const n = [...main.querySelectorAll('.find-dog .find-name .n')].find(x => x.textContent.includes('很長'));
      const cs = getComputedStyle(n);
      if (cs.textOverflow === 'ellipsis' || cs.whiteSpace === 'nowrap') throw new Error('名字被截斷');
    });
    await check('#154 點狗開詳細資訊', () => {
      render();
      main.querySelectorAll('.find-dog')[1].click();
      eq(detailDog && detailDog.name, '列表甲');
      hideDetail();
    });
    await check('#154 搜尋：命中的字標黃；只對到編號時把編號列出來', () => {
      searchQuery = '列表丁'; render();
      eq(main.querySelector('.find-rows .find-dog mark').textContent, '列表丁', '名字標黃：');
      eq(!!main.querySelector('.find-rows .find-row-id'), false, '對到名字不列編號：');
      searchQuery = '0402'; render();
      eq(main.querySelector('.find-rows .find-row-id mark').textContent, '0402', '編號標黃：');
      searchQuery = '新a05'; render();
      eq(main.querySelector('.find-rows .find-row-cage mark').textContent, '新A05', '籠位標黃：');
    });
    await check('#154 平面圖選一區：下面一樣是籠位列', () => {
      searchQuery = ''; findView = 'map'; findZone = 'new'; render();
      eq([...main.querySelectorAll('.find-row-cage')].map(c => c.textContent), ['新A03', '新A05']);
    });
  } finally {
    if (detailDog) hideDetail();
    [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, findView, findZone, findCage] = saved;
  }
}

// critique 2026-10-09：找狗全圖只放大區名，下面列最久沒溜的狗（黃、紅、沒紀錄）
async function runFindOverviewTests() {
  const saved = [allDogs, activeTab, searchQuery, findZone, findView, findCage];
  const T = new Date();
  const ymd = n => { const x = new Date(T.getFullYear(), T.getMonth(), T.getDate() - n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const dog = (name, id, cage, walkedDate) => parseDogsData({ dogs: [{ id, name, cage, note: '', covered: false, walkedDate }] }).dogs[0];
  try {
    allDogs = [dog('剛溜', '2024100901', '新A01', ymd(1)), dog('四天', '2024100902', '新A02', ymd(4)), dog('沒紀錄', '2024100903', '舊A01', ''), dog('十天', '2024100904', '舊A02', ymd(10))];
    activeTab = 'find'; searchQuery = ''; findZone = 'all'; findView = 'map'; findCage = null;
    render();
    const main = document.getElementById('main');
    await check('找狗全圖：只放大區名（籠子小字收起來），下面列最久沒溜的狗，不列 0–2 天的', () => {
      eq(!!main.querySelector('.find-map.overview'), true, '全圖：');
      eq(main.querySelectorAll('rect.fm-cage').length, 0, '全圖不畫籠子（K 2026-10-09 iPhone 上太擠）：');
      eq([...main.querySelectorAll('.card .name')].map(n => n.firstChild.textContent), ['沒紀錄', '十天', '四天'], '最久沒溜的狗：');
    });
    await check('找狗放大到一區時不是全圖，也不列最久沒溜的狗', () => {
      findZone = 'new'; render();
      eq([!!main.querySelector('.find-map.overview'), main.querySelectorAll('.card[data-dog]').length], [false, 0]);
    });
  } finally {
    [allDogs, activeTab, searchQuery, findZone, findView, findCage] = saved; render();
  }
}
