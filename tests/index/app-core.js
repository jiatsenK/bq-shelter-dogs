function runTests() {
  return Promise.all([
    check('未來日期顯示「日期看不懂」，不顯示負的天數', () => {
      const badge = statusBadge({ name: 'x', walkedDate: new Date(2099, 0, 1), covered: false, note: '' }, TODAY);
      if (!badge.includes('日期看不懂') || badge.includes('-')) throw new Error(`標籤是 ${badge}`);
    }),
    check('勿溜：異體字也算，住院不算', () => {
      eq(specialFlag('勿遛，散步時勿溜太久'), { keywords: ['勿溜'], terms: ['勿溜', '勿遛'] });
      eq(specialFlag('住院區，胸背帶放住院'), null);
      eq(specialFlag('親人，好牽'), null);
      eq(specialFlag(''), null);
    }),
    check('勿溜：備註裡每個命中的字眼都標出來，其他文字照樣跳脫', () => {
      const note = '勿溜<先問>，下午再勿遛';
      eq(highlightNote(note, specialFlag(note).terms), '<mark>勿溜</mark>&lt;先問&gt;，下午再<mark>勿遛</mark>');
    }),
    check('勿溜的狗仍留在溜狗表，卡片有天數和備註原文；沒有特殊狀況分頁', () => {
      allDogs = [
        { cage: '住院區', id: '1', name: '測試甲', walkedDate: new Date(), covered: false, note: '住院' },
        { cage: 'A02', id: '2', name: '測試乙', walkedDate: new Date(), covered: false, note: '' },
        { cage: 'A03', id: '3', name: '測試丙', walkedDate: new Date(), covered: false, note: '勿遛' },
      ];
      groupMap = { '測試丙': new Set(['測試乙']) };
      searchQuery = '';
      const names = () => [...document.querySelectorAll('#main .card .name')].map(n => n.textContent).sort();
      activeTab = 'walk'; renderMain(); eq(names(), ['測試甲', '測試乙', '測試丙'].sort(), '溜狗表：');
      const cards = [...document.querySelectorAll('#main .card')];
      const card = n => cards.find(c => c.querySelector('.name').textContent === n);
      if (card('測試甲').querySelector('.warn-note')) throw new Error('住院區的測試甲不該有警示');
      const hei = card('測試丙');
      if (!hei.querySelector('.warn-note') || !hei.querySelector('.last .val.sage')) throw new Error('測試丙要有天數和警示備註');
      eq(hei.querySelector('.warn-note .text').innerHTML, '<mark>勿遛</mark>', '備註：');
      if (hei.querySelector('.body > .warn-note') || !hei.querySelector(':scope > .warn-note')) throw new Error('警示備註要橫跨整張卡片，不可擠在照片右側');
      searchQuery = '測試丙'; renderMain();
      if (!document.querySelector('#main .card .warn-note')) throw new Error('搜尋結果沒有警示備註');
      searchQuery = '';
    }),
    // ── #9 照片與介紹 ──
    check('照片：有編號用 photos/thumbs/{編號}.jpg 縮圖（原圖放 data-full 備用）且延後載入；沒編號直接顯示腳掌、不抓 photos/.jpg', () => {
      const box = document.createElement('div');
      box.innerHTML = photoThumb({ name: '宙斯', id: '202101234' });
      const img = box.querySelector('img');
      eq(img.getAttribute('src'), 'photos/thumbs/202101234.jpg');
      eq(img.dataset.full, 'photos/202101234.jpg', '備用原圖：');
      eq(img.getAttribute('loading'), 'lazy');
      // #305：縮圖讀不到改用原圖時，框上標 thumb-full（#646 起畫面不顯示小圓點，留給開發者工具查）
      img.onerror();
      eq(img.getAttribute('src'), 'photos/202101234.jpg');
      eq(img.parentNode.classList.contains('thumb-full'), true, '沒縮圖的標記：');
      eq(img.parentNode.classList.contains('no-photo'), false, '還有原圖可試：');
      box.innerHTML = photoThumb({ name: '金寶', id: '' });
      eq(box.querySelector('img'), null, '沒編號時的 img：');
      if (!box.querySelector('.thumb-fallback')) throw new Error('沒編號時沒有腳掌圖示');
    }),
    check('詳細資訊：dogs.json 有狗卡資訊才顯示，沒有就顯示提示', () => {
      const intro = dog => {
        const box = document.createElement('div');
        box.innerHTML = detailHtml(dog, TODAY);
        return box.querySelector('[data-section="intro"] .content');
      };
      eq(intro({ name: '宙斯', id: '202101234', cage: 'C03', walkedDate: null, covered: false, note: '', intro: '很親人' }).textContent, '很親人');
      eq(intro({ name: '比比', id: '202102346', cage: 'A08', walkedDate: null, covered: false, note: '', intro: '' }), null, '沒狗卡：');
    }),
    // ── #7 搜尋 ──
    check('搜尋：犬名部分符合即可，忽略空白、全形與大小寫', () => {
      const dog = { name: '測試 Lucky 丁' };
      eq(matchesSearch(dog, '試'), true);
      eq(matchesSearch(dog, 'lucky'), true, '大小寫：');
      eq(matchesSearch(dog, 'ＬＵＣＫＹ丁'), true, '全形、空白：');
      eq(matchesSearch(dog, '  '), true, '只有空白當作沒搜尋：');
      eq(matchesSearch(dog, '測試戊'), false);
    }),
    check('#646 主畫面搜尋：籠位、編號也算；籠位不管前面的 0', () => {
      const dog = { name: '小黑', cage: '新B05', id: '2025081801' };
      eq(matchesSearch(dog, '新B05'), true, '完整籠位：');
      eq(matchesSearch(dog, '新b5'), true, '省略 0、小寫：');
      eq(matchesSearch(dog, 'B05'), true, '部分籠位：');
      eq(matchesSearch(dog, '0818'), true, '部分編號：');
      eq(matchesSearch(dog, '新B6'), false, '別籠：');
      eq(matchesSearch({ name: '小白' }, '新B5'), false, '沒有籠位、編號：');
      allDogs = [{ cage: '新B05', id: '1', name: '小黑', walkedDate: null, covered: false, note: '' }, { cage: '舊A01', id: '2', name: '小白', walkedDate: null, covered: false, note: '' }];
      activeTab = 'walk'; searchQuery = '新B5'; renderMain();
      eq([...document.querySelectorAll('#main .card .name')].map(n => n.textContent), ['小黑'], '溜狗表搜尋籠位：');
      searchQuery = ''; renderMain();
    }),
    check('搜尋：只篩選目前分類，溜狗表數字跟著變、找狗不放數字，清空回到原本內容', () => {
      const daysAgo = n => new Date(Date.now() - n * 86400000);
      allDogs = [
        { cage: 'B01', id: '', name: '搜尋甲', walkedDate: daysAgo(1), covered: false, note: '' },
        { cage: 'B02', id: '', name: '搜尋乙', walkedDate: daysAgo(20), covered: false, note: '勿溜' },
        { cage: 'B02', id: '', name: '別隻丙', walkedDate: daysAgo(2), covered: false, note: '' },
      ];
      groupMap = {};
      const names = () => [...document.querySelectorAll('#main .card .name')].map(n => n.textContent);
      const counts = () => [...document.querySelectorAll('#tabs button .n')].map(n => n.textContent);
      const mainText = () => document.getElementById('main').textContent;
      try {
        searchQuery = '搜尋';
        activeTab = 'walk'; renderMain();
        eq(names(), ['搜尋乙', '搜尋甲'], '溜狗表（久沒遛的在前）：');
        eq(counts(), ['2', '', '', ''], '分類數字（找狗不放數字）：');
        if (!mainText().includes('搜尋「搜尋」：2 隻')) throw new Error('沒有顯示搜尋結果隻數');
        if (!document.querySelector('#main .card .warn-note')) throw new Error('勿溜的搜尋乙沒有警示備註');
        searchQuery = '<b>沒這隻'; activeTab = 'walk'; renderMain();
        eq(document.querySelector('#main .status-msg').innerHTML, '找不到「&lt;b&gt;沒這隻」');
        eq(counts(), ['0', '', '', ''], '查無時分類數字：');
        searchQuery = ''; renderMain();
        eq(names().length, 3, '清空後：');
        eq(counts(), ['3', '', '', ''], '清空後分類數字：');
      } finally { searchQuery = ''; activeTab = 'walk'; }
    }),
    check('搜尋：輸入即篩選；注音選字途中不篩選，選好字才更新', () => {
      allDogs = [{ cage: 'B01', id: '', name: '搜尋甲', walkedDate: null, covered: false, note: '' }];
      groupMap = {}; activeTab = 'walk';
      const input = document.getElementById('searchInput');
      try {
        input.value = 'ㄐ';
        input.dispatchEvent(new InputEvent('input', { isComposing: true }));
        eq(searchQuery, '', '選字途中：');
        input.value = '甲';
        input.dispatchEvent(new CompositionEvent('compositionend', { data: '甲' }));
        eq(searchQuery, '甲', '選好字：');
        eq(document.querySelectorAll('#main .card').length, 1);
        input.value = '';
        input.dispatchEvent(new InputEvent('input'));
        eq(searchQuery, '', '清空：');
      } finally { input.value = ''; searchQuery = ''; }
    }),
    check('#3 色標邊界（K 2026-10-09 改）：0～2 天綠、第 3 天起黃、第 5 天起紅', () => {
      const daysAgo = n => ({ name: '測試狗', walkedDate: new Date(2026, 8, 24 - n), covered: false });
      const level = n => computeStatus(daysAgo(n), TODAY).level;
      eq([0, 2, 3, 4, 5, 45].map(level), ['sage', 'sage', 'amber', 'amber', 'red', 'red']);
      const box = document.createElement('div');
      box.innerHTML = statusBadge(daysAgo(5), TODAY);
      eq(box.querySelector('.badge').className, 'badge red', '5 天徽章：');
      eq(box.querySelector('.badge').textContent, '5 天前', '5 天徽章文字：');
    }),
    check('#3 待巡房排序：沒紀錄最前，再由久到近，有人固定照顧最後；所有狗都在', () => {
      const d = (name, n, covered = false) => ({ name, walkedDate: n == null ? null : new Date(2026, 8, 24 - n), covered });
      const dogs = [d('甲', 3), d('乙', null, true), d('丙', 40), d('丁', null), d('戊', 0), d('己', 12)];
      eq(dueDogs(dogs, TODAY).map(x => x.name), ['丁', '丙', '己', '甲', '戊', '乙']);
    }),
    check('#10 唯讀：除搜尋框外沒有輸入框、勾選框、可編輯區塊；搜尋框有放大鏡與提示文字', () => {
      const doc = new DOMParser().parseFromString(INDEX_HTML, 'text/html');
      const inputs = [...doc.querySelectorAll('input, textarea, select, [contenteditable]')];
      eq(inputs.map(el => el.id), ['searchInput'], '可輸入元素：');
      const box = inputs[0];
      eq(box.type, 'search', '搜尋框型別：');
      eq(box.placeholder, '狗名、編號或籠位', '提示文字：');
      if (!box.parentElement.querySelector('use[href="#i-search"]')) throw new Error('搜尋框旁要有放大鏡圖示');
      if (doc.querySelector('form')) throw new Error('頁面不應有表單');
      const symbols = [...doc.querySelectorAll('symbol')].map(el => el.id).join(' ');
      // #28 起卡片可以點開詳細資訊，所以允許右箭頭（chevron）；編輯、勾選圖示仍不行
      // （#35「今天已溜」的打勾圖示叫 i-tick，只記在這支手機，不是編輯試算表）
      if (/edit|pencil|pen|check/i.test(symbols)) throw new Error(`不應有編輯或勾選圖示：${symbols}`);
    }),
    check('#10 唯讀：網站不直接寫試算表；寫入都送到 Worker（照片，#138 起溜了經 Worker 的 /walk 寫遛狗日期和誰遛的）', () => {
      // #478 起呼叫 /api 都經過 js/api.js 的 BQApi；app.js 不直接 fetch
      if (/\bfetch\(/.test(APP_JS)) throw new Error('app.js 不直接呼叫 fetch，要經過 BQApi');
      // V9（#141）拿掉我的備註，網站不再寫 /notes
      if (/\/notes/.test(APP_JS + PHOTO_JS + WELCOME_JS + API_JS)) throw new Error('我的備註已拿掉，不該再讀寫 /notes');
      // 寫入都送到同網址的 Worker（不是試算表）：照片（#48）、換代號（#96）、溜了與備註（#138、#281）、
      // 休養、入所介紹、出入所紀錄（#333；舊編號 #639 起在出入所表裡改）、常溜、身分（#267）、固定照顧、活動紀錄、開卡
      const writes = [...API_JS.matchAll(/(?:send|edit)\('(POST|PUT)', `?'?(\/[\w/-]+)|(?:send|edit)\(method, `(\/[\w-]+)|fetch\(`\$\{root\(\)\}(\/[\w-]+)/g)].map(m => m[2] || m[3] || m[4]).sort();
      eq(writes, ['/activities', '/cards/opened', '/favorites', '/fixed-care/', '/identity', '/intro/', '/photos', '/rest/', '/share', '/stays/', '/walk', '/walker-code', '/walks/mine'].sort(), 'BQApi 的寫入端點（/share 只記分享次數，ADR 0023）：');
      if (/script\.google\.com|sheets\.googleapis\.com|api\.github\.com|Authorization|Bearer/i.test(API_JS)) throw new Error('BQApi 不連 Google、GitHub，也不帶憑證');
      const code = APP_JS;
      const bad = [/method\s*:/i, /\bPOST\b|\bPUT\b|\bPATCH\b|\bDELETE\b/, /script\.google\.com|macros\/s\//, /sheets\.googleapis\.com/,
        /appendRow|setValue|batchUpdate|XMLHttpRequest|sendBeacon|indexedDB|sessionStorage|document\.cookie/];
      const hits = bad.filter(re => re.test(code)).map(String);
      eq(hits, [], '寫入相關字眼：');
      // #48 GitHub 寫入權限只在 Worker：網站程式不能有 token 或直接連 GitHub API
      const tokenHits = [/ghp_|gho_|github_pat_/, /api\.github\.com/, /Authorization|Bearer/i, /GITHUB_TOKEN/].filter(re => re.test(APP_JS)).map(String);
      eq(tokenHits, [], 'GitHub 憑證相關字眼：');
      // #35 起「今天已溜」存在這支手機的 localStorage，只准用 BQStore.keys.walkedToday；通關碼 ADR 0004 拿掉了
      eq([...code.matchAll(/\blocalStorage\s*[.[]|window\.localStorage/g)].length, 0, 'localStorage 由 BQStore 取用：');
      if (/\.(setItem|getItem|removeItem)\(/.test(code)) throw new Error('手機資料讀寫要經過 BQStore');
      // #32 起前端只讀 data/dogs.json，不直接連試算表；狗卡資訊也已經寫在 dogs.json 裡，不再抓 dogs/*.md
      // #62 另外讀我的備註：只從 Worker 的 /notes 或網站上的 data/my-notes.json 讀
      // #58 我最近溜過另外讀溜狗紀錄（#260 起是 api/walks）；ADR 0007 今日溜狗紀錄讀 api/today
      if (/readJsonObject|GALLERY_URL|\/gallery/.test(APP_JS)) throw new Error('相簿已拿掉（K 2026-10-09），不該再讀相簿清單');
      for (const read of ["'/dogs'", "'/walks'", "'/rest'", "'/today?source=d1'"]) if (!API_JS.includes(read)) throw new Error(`BQApi 要從 Worker 讀 ${read}（#247、#260、#250、ADR 0007）`);
      if (/docs\.google\.com|gviz/.test(APP_JS)) throw new Error('前端不應再連 Google 試算表');
    }),
    check('#10／#28 卡片沒有連結，也不會跳到別頁（點了只開詳細資訊）', () => {
      const box = document.createElement('div');
      box.innerHTML = dogCard({ name: '測試狗', cage: 'A01', id: '1', walkedDate: null, covered: false, note: '勿溜' }, TODAY);
      if (box.querySelector('a, [onclick], [href]:not(use)')) throw new Error('卡片裡不應有連結');
    }),
    check('#10 試算表文字一律跳脫：備註、犬名、籠位、編號、可一起遛、搜尋字', () => {
      const evil = '<img src=x onerror="window.__xss=1"><b>粗</b>&amp;';
      const dog = { name: evil, cage: evil, id: evil, walkedDate: null, covered: false, note: evil + '勿溜', intro: evil };
      const saved = [groupMap, allDogs, activeTab, searchQuery];
      try {
        groupMap = { [evil]: new Set([evil]) };
        const box = document.createElement('div');
        box.innerHTML = dogCard(dog, TODAY);
        eq(box.querySelectorAll('.body img, .body b').length, 0, '卡片裡被當成 HTML 的元素：');
        eq(box.querySelector('.name').textContent, evil, '犬名原文：');
        if (!box.querySelector('.warn-note .text').textContent.startsWith(evil)) throw new Error('備註要原樣顯示文字');
        box.innerHTML = detailHtml(dog, TODAY);
        eq(box.querySelectorAll('.info img, section img:not(.thumb img):not(.g-tile img), section b').length, 0, '詳細資訊裡被當成 HTML 的元素：');
        eq(box.querySelector('.buddy .bname').textContent, evil, '可一起遛原文：');
        eq(box.querySelector('[data-section="intro"] .content').textContent, evil, '狗卡資訊原文：');
        allDogs = [dog]; activeTab = 'walk'; searchQuery = '';
        render();
        eq(document.querySelectorAll('#main img:not(.thumb img)').length, 0, '清單被當成 HTML 的圖片：');
        searchQuery = evil; render();
        searchQuery = '<i>沒有這隻</i>'; render();
        if (document.querySelector('#main i')) throw new Error('搜尋字不應被當成 HTML');
        if (window.__xss) throw new Error('跳脫失敗，執行了試算表裡的程式');
      } finally {
        [groupMap, allDogs, activeTab, searchQuery] = saved;
        render();
      }
    }),
    // ── #28 卡片高密度化與詳細資訊 ──
    check('#28 警示關鍵字：勿溜、不要、攻擊、不親狗、不親任一命中就算，原文不改', () => {
      const hit = note => { const f = specialFlag(note); return f ? f.keywords : null; };
      eq(hit('不親狗，請單獨遛'), ['不親狗', '不親'], '不親狗：');
      eq(hit('會攻擊黑色狗'), ['攻擊']);
      eq(hit('不要跟小白一起遛'), ['不要']);
      eq(hit('勿溜，治療中'), ['勿溜']);
      eq(hit('勿蹓'), ['勿溜'], '舊有異體字照樣算：');
      eq(hit('親人，好牽，會撒嬌'), null, '一般備註：');
      const box = document.createElement('div');
      for (const note of ['不親狗，請單獨遛', '會攻擊黑色狗', '不要跟小白一起遛', '勿溜，治療中']) {
        box.innerHTML = dogCard({ name: '測試狗', cage: 'A01', id: '1', walkedDate: null, covered: false, note }, TODAY);
        eq(box.querySelector('.warn-note .text').textContent, note, '卡片第一層顯示原文：');
      }
    }),
    check('#28 同一筆備註命中多個關鍵字只顯示一次，字眼都標出來；也沒有固定文案的警示徽章', () => {
      const note = '不親狗，不要靠近，會攻擊';
      const box = document.createElement('div');
      box.innerHTML = dogCard({ name: '測試狗', cage: 'A01', id: '1', walkedDate: new Date(2026, 8, 20), covered: false, note }, TODAY);
      eq(box.querySelectorAll('.warn-note').length, 1, '警示數：');
      eq(box.querySelector('.warn-note .text').textContent, note);
      eq([...box.querySelectorAll('.warn-note mark')].map(m => m.textContent), ['不親狗', '不要', '攻擊'], '標出的字眼：');
      eq(box.querySelectorAll('.badge').length, 0, '沒有固定文案的徽章：');
      eq(box.querySelector('.last .val').textContent, '4天', '上次遛狗：');
      if (!box.querySelector('.warn-note use[href="#i-warn"]')) throw new Error('警示要有三角圖示，不能只靠顏色');
    }),
    check('#28 卡片第一層：照片、犬名、性別位置、上次遛狗、編號｜籠位同一行；一般備註只有小圖示，可一起遛、狗卡資訊不攤開', () => {
      const saved = [allDogs, groupMap];
      try {
        const dog = { name: '測試狗', cage: 'A01', id: '1', walkedDate: new Date(2026, 8, 24), covered: false, note: '親人，好牽', intro: '入所狗卡' };
        allDogs = [dog, { name: '好朋友', cage: 'A02', id: '2', walkedDate: null, covered: false, note: '' }];
        groupMap = { '測試狗': new Set(['好朋友']) };
        const box = document.createElement('div');
        box.innerHTML = dogCard(dog, TODAY);
        const card = box.querySelector('.card');
        eq(card.querySelector('.name').firstChild.textContent, '測試狗');
        if (!card.querySelector('.name .sex')) throw new Error('要預留性別位置');
        eq(card.querySelector('.last').textContent, '上次溜今天');
        eq(card.querySelector('.meta').textContent, '1|A01', '編號｜籠位：');
        if (card.querySelector('.has-note')) throw new Error('犬名旁不再顯示備註小圖示');
        const text = card.textContent;
        for (const s of ['親人', '好朋友', '入所狗卡']) if (text.includes(s)) throw new Error(`第一層不該出現「${s}」`);
        eq(card.dataset.dog, '0', '卡片對應的狗：');
      } finally { [allDogs, groupMap] = saved; }
    }),
    check('#28 上次遛狗：今天／幾天前／尚無紀錄／有人固定照顧，天數顏色照色標', () => {
      const box = document.createElement('div');
      const val = dog => { box.innerHTML = lastWalk(dog, TODAY); const v = box.querySelector('.val'); return [v.textContent, v.className]; };
      eq(val({ walkedDate: new Date(2026, 8, 24), covered: false }), ['今天', 'val sage']);
      eq(val({ walkedDate: new Date(2026, 8, 21), covered: false }), ['3天', 'val amber']); // K 2026-10-09 門檻：第 3 天起黃、第 5 天起紅
      eq(val({ walkedDate: new Date(2026, 7, 20), covered: false }), ['35天', 'val red']);
      eq(val({ walkedDate: null, covered: false }), ['沒有紀錄', 'val muted']);
      eq(val({ walkedDate: null, covered: true }), ['有人固定照顧', 'val sage small']);
    }),
    check('#400 天數欄：今天／X天，保留配色、欄寬與完整輔助文字', async () => {
      const host = document.createElement('div');
      host.style.setProperty('--green-bg', '#DFF0E4'); host.style.setProperty('--green-text', '#1E6B3C'); // Shadow DOM 不套用文件的 :root，補上正式網站色票
      host.style.width = '320px'; document.body.append(host);
      const root = host.attachShadow({ mode: 'open' });
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '../public/css/app.css';
      await new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject; root.append(link); });
      const box = document.createElement('div'); root.append(box);
      try {
        const dog = { name: '測試狗', cage: '舊A03', note: '', covered: false };
        box.innerHTML = [0, 1, 2, 3, 4, 5].map(days => dogCard({ ...dog, id: `test-days-${days}`, walkedDate: new Date(2026, 8, 24 - days) }, TODAY)).join('');
        const values = [...box.querySelectorAll('.val')];
        eq(values.map(v => v.textContent), ['今天', '1天', '2天', '3天', '4天', '5天']);
        eq(values.map(v => v.className), ['val sage', 'val sage', 'val sage', 'val amber', 'val amber', 'val red']);
        const typography = el => { const s = getComputedStyle(el); return [s.fontSize, s.fontWeight, s.lineHeight, s.textAlign]; };
        for (const v of values) {
          eq(typography(v), typography(values[3]));
          eq(typography(v.querySelector('b')), values.indexOf(v) === 0 ? ['20px', '700', '22px', 'center'] : typography(values[3].querySelector('b')));
          const last = v.closest('.last');
          eq(last.querySelector('.lbl'), null, '不顯示重複標題：'); eq(getComputedStyle(last).width, '70px'); eq(last.textContent, values.indexOf(v) === 0 ? '上次溜今天' : '上次溜' + values.indexOf(v) + '天前');
          if (v.scrollWidth > v.clientWidth) throw new Error('時間欄文字溢出');
        }
        eq(values.slice(0, 3).map(v => getComputedStyle(v.closest('.last')).backgroundColor), ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'], '近期日期不上底色：');
        eq(values.slice(0, 3).map(v => getComputedStyle(v.closest('.last')).color), ['rgb(30, 107, 60)', 'rgb(30, 107, 60)', 'rgb(30, 107, 60)'], '近期日期一致原綠字：');
        const centerY = el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
        const close = (a, b, msg) => { if (Math.abs(a - b) > 1) throw new Error(`${msg}：${a} / ${b}`); };
        box.insertAdjacentHTML('beforeend', dogCard({ ...dog, id: 'fixed-align', walkedDate: null, covered: true }, TODAY));
        const fixed = box.lastElementChild, covered = fixed.querySelector('.last');
        eq(covered.querySelector('.lbl'), null, '固定照顧沒有標題：');
        close(centerY(covered.querySelector('.val')), centerY(fixed.querySelector('.thumb')), '固定照顧整組對齊照片');
        const lines = covered.querySelectorAll('.nowrap');
        eq(lines[1].getBoundingClientRect().top - lines[0].getBoundingClientRect().bottom, 0, '固定照顧兩行不撐開：');
        const previousRest = restMap;
        try {
          restMap = { 'test-rest-align': { until: '2026-12-31' } };
          box.insertAdjacentHTML('beforeend', dogCard({ ...dog, id: 'test-rest-align' }, TODAY));
        } finally { restMap = previousRest; }
        const resting = box.lastElementChild;
        const restLabel = resting.querySelector('.lbl'), restValue = resting.querySelector('.val');
        eq(restLabel, null, '休養中沒有標題：');
        close(centerY(restValue), centerY(resting.querySelector('.thumb')), '休養中整組對齊照片');
        for (const days of [0, 1, 2, 3]) {
          box.insertAdjacentHTML('beforeend', dogCard({ ...dog, id: `flagged-align-${days}`, note: '不親狗', walkedDate: new Date(2026, 8, 24 - days) }, TODAY));
          const flagged = box.lastElementChild, normal = values[days].closest('.card');
          const offset = card => centerY(card.querySelector('.last b')) - centerY(card.querySelector('.thumb'));
          close(offset(flagged), offset(normal), `警示列 ${days} 天主要文字對齊`);
          close(offset(normal), 0, `一般列 ${days} 天主要文字對齊照片`);
        }
        if (covered.querySelector('.val').scrollWidth > covered.querySelector('.val').clientWidth) throw new Error('固定照顧文字溢出');
        eq(getComputedStyle(values[3].closest('.last')).backgroundColor, getComputedStyle(values[4].closest('.last')).backgroundColor);
      } finally { host.remove(); }
    }),
    check('#28 詳細資訊分成備註、（#62 我的備註、）可以一起溜的狗（照片＋犬名）、（#60 遛狗紀錄、）狗卡資訊', () => {
      const saved = [allDogs, groupMap];
      try {
        const dog = { name: '測試狗', cage: 'A01', id: '1', walkedDate: null, covered: false, note: '親人，好牽\n怕機車', intro: '入所狗卡' };
        allDogs = [dog, { name: '好朋友', cage: 'A02', id: '2', walkedDate: null, covered: false, note: '' }];
        groupMap = { '測試狗': new Set(['好朋友']) };
        const box = document.createElement('div');
        box.innerHTML = detailHtml(dog, TODAY);
        eq([...box.querySelectorAll('section h3')].map(h => h.firstChild.nextSibling.textContent), ['試算表備註', '同籠、可以一起溜的狗', '溜狗紀錄', '出入所紀錄', '介紹', '休養設定'].slice(0, box.querySelector('[data-section="rest"]') ? 6 : 5)); // #390、K 2026-10-26：出入所紀錄跟入所介紹同一段
        eq(box.querySelector('[data-section="note"] .content').textContent, '親人，好牽\n怕機車', '備註原文：');
        const buddy = box.querySelector('.buddy');
        eq(buddy.querySelector('img').getAttribute('src'), 'photos/thumbs/2.jpg', '一起溜的照片：');
        eq(buddy.querySelector('.bname').textContent, '好朋友');
        eq(box.querySelector('[data-section="intro"] .content').textContent, '入所狗卡');
        dog.note = ''; dog.intro = ''; groupMap = {};
        box.innerHTML = detailHtml(dog, TODAY);
        eq([...box.querySelectorAll('section .empty')].length, 3, '入所資料不再顯示兩段空提示：');
      } finally { [allDogs, groupMap] = saved; }
    }),
    check('#28 點狗卡開詳細資訊，點一起溜的狗換成那隻，關閉後回到清單', () => {
      const saved = [allDogs, groupMap, activeTab, searchQuery];
      try {
        allDogs = [
          { name: '測試甲', cage: 'A01', id: '1', walkedDate: null, covered: false, note: '' },
          { name: '測試乙', cage: 'A02', id: '2', walkedDate: null, covered: false, note: '' },
        ];
        groupMap = { '測試甲': new Set(['測試乙']), '測試乙': new Set(['測試甲']) };
        activeTab = 'walk'; searchQuery = '';
        renderMain();
        const before = [...document.querySelectorAll('#main .card .name')].map(n => n.textContent);
        document.querySelector('#main .card[data-dog="0"] .name').click();
        eq(document.getElementById('detailBackdrop').hidden, false, '開啟：');
        eq(document.getElementById('detailName').firstChild.textContent, '測試甲');
        document.querySelector('#detail .buddy').click();
        eq(document.getElementById('detailName').firstChild.textContent, '測試乙', '換成一起溜的狗：');
        hideDetail();
        eq(document.getElementById('detailBackdrop').hidden, true, '關閉：');
        eq([...document.querySelectorAll('#main .card .name')].map(n => n.textContent), before, '清單不變：');
        document.querySelector('#main .card[data-dog="1"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        eq(document.getElementById('detailName').firstChild.textContent, '測試乙', '鍵盤 Enter 也能開：');
        hideDetail();
      } finally {
        hideDetail();
        if (history.state && history.state.bqDetail) history.replaceState(null, '');
        [allDogs, groupMap, activeTab, searchQuery] = saved;
      }
    }),
    // ── #33 網站名稱、分類與滑動切換 ──
    check('#33 網站名稱改為「板收志工溜狗表」（標題、分頁名稱、加到主畫面）', () => {
      const doc = new DOMParser().parseFromString(INDEX_HTML, 'text/html');
      eq(doc.title, '板收志工溜狗表', '瀏覽器分頁：');
      eq(doc.querySelector('header h1').textContent, '板收志工溜狗表', '頁面標題：');
      eq(doc.querySelector('meta[name="apple-mobile-web-app-title"]').content, '板收志工溜狗表', 'iPhone 主畫面：');
      eq([MANIFEST.name, MANIFEST.short_name], ['板收志工溜狗表', '板收志工溜狗表'], 'Android 主畫面：');
    }),
    check('#33／#58 分類依序為溜狗表／今天已溜／我溜過，點分類可切換', () => {
      const saved = [allDogs, groupMap, activeTab, searchQuery];
      try {
        allDogs = [{ cage: 'A01', id: '1', name: '測試甲', walkedDate: null, covered: false, note: '' }];
        groupMap = {}; activeTab = 'walk'; searchQuery = '';
        render();
        const tabs = () => [...document.querySelectorAll('#tabs button')];
        eq(tabs().map(b => b.querySelector('.t').textContent), ['溜狗表', '常遛狗群', '我溜過', '資訊'], '分類（#99 加找狗）：');
        eq(tabs().map(b => b.querySelector('.n').textContent), ['1', '', '', ''], '數字（遛狗紀錄還沒讀；找狗不放數字）：');
        const active = () => tabs().filter(b => b.classList.contains('active')).map(b => b.dataset.tab);
        eq(active(), ['walk'], '預設：');
        eq(document.querySelectorAll('#main .card').length, 1, '溜狗表有狗卡：');
        tabs()[2].click();
        eq([activeTab, active()], ['mine', ['mine']], '點我溜過：');
        tabs()[0].click();
        eq(active(), ['walk'], '點回溜狗表：');
      } finally {
        [allDogs, groupMap, activeTab, searchQuery] = saved;
        render();
      }
    }),
    check('內容區與狗卡左右滑動都不換分類', () => {
      const saved = [allDogs, groupMap, activeTab, searchQuery];
      const main = document.getElementById('main');
      const touch = (target, x, y) => new Touch({ identifier: 1, target, clientX: x, clientY: y });
      const swipe = (target, dx) => {
        const start = touch(target, 200, 300), end = touch(target, 200 + dx, 305);
        target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start], changedTouches: [start] }));
        target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [end] }));
      };
      const active = () => [...document.querySelectorAll('#tabs button.active')].map(b => b.dataset.tab);
      try {
        allDogs = [{ cage: 'A01', id: '1', name: '測試甲', walkedDate: null, covered: false, note: '' }];
        groupMap = {}; activeTab = 'walk'; searchQuery = '';
        render();
        swipe(main, 100);
        eq(activeTab, 'walk', '第一頁向右滑不循環：');
        swipe(main.querySelector('.card'), -100);
        eq([activeTab, active()], ['walk', ['walk']], '狗卡滑動不換頁：');
        swipe(main, -100);
        eq([activeTab, active()], ['walk', ['walk']], '內容滑動不換頁：');
        switchTab('walk');
        searchQuery = '測試'; render();
        swipe(main, -100);
        eq([activeTab, searchQuery], ['walk', '測試'], '搜尋時也不換頁：');
      } finally {
        [allDogs, groupMap, activeTab, searchQuery] = saved;
        render();
      }
    }),
    check('詳細視窗 Tab 不跑到背景，重畫保留焦點，關閉回到原狗卡', () => {
      const saved = [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords];
      try {
        BQWalkUI.hideToast();
        document.getElementById('main').parentElement.classList.remove('hidden'); // 真瀏覽器裡 display:none 的元素不能拿到焦點
        allDogs = [{ id: 'focus-test', name: '焦點測試', cage: 'A01', note: '', covered: false, walkedDate: null }];
        groupMap = {}; activeTab = 'walk'; searchQuery = '';
        phoneStore = fakeStorage(); walkRecords = freshWalkRecords();
        render();
        const card = document.querySelector('#main .card');
        card.focus();
        showDetail(allDogs[0]);
        const key = shiftKey => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }));
        // V7（#112）起最後一個按鈕是底部列的「溜了」
        document.getElementById('groupWalk').focus(); key(false);
        // #46 起詳細資訊第一個按鈕是可放大的照片
        eq(document.activeElement === document.querySelector('#detail button'), true, '回到第一個按鈕：');
        key(true);
        eq(document.activeElement.id, 'groupWalk');
        document.getElementById('photoPick').focus();
        renderDetail();
        eq(document.activeElement.id, 'photoPick');
        document.getElementById('groupWalk').focus(); renderDetail();
        eq(document.activeElement.id, 'groupWalk', '重畫保留焦點：');
        hideDetail();
        eq(document.activeElement === card, true);
      } finally {
        hideDetail();
        document.getElementById('main').parentElement.classList.add('hidden');
        history.replaceState(null, '');
        [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords] = saved;
        render();
      }
    }),
    check('#30 檔案拆分：index.html 只有結構，樣式在 css/app.css、程式在 js/app.js', () => {
      const doc = new DOMParser().parseFromString(INDEX_HTML, 'text/html');
      if (doc.querySelector('style')) throw new Error('index.html 不應再有 <style>');
      // 頁首內嵌程式只有提早抓 dogs.json（見 runFastOpenTests），其他程式都在 js/（舊網址轉址 #129 在 #493 拿掉：GitHub Pages 已關閉）
      const scripts = [...doc.querySelectorAll('script')].filter(s => !s.textContent.includes('window.__dogsEarly'));
      eq(scripts.map(s => [s.getAttribute('type'), s.getAttribute('src')]), [['module', 'js/main.js']], 'ES module 入口：');
      if (scripts.some(s => s.textContent.trim())) throw new Error('index.html 不應有內嵌程式');
      if (!doc.querySelector('link[rel="stylesheet"][href="css/app.css"]')) throw new Error('要載入 css/app.css');
      if (doc.querySelector('#main .card')) throw new Error('狗狗資料不應寫死在 index.html');
    }),
    check('#34 搜尋框右側有 X 清除鈕，平常隱藏', () => {
      const doc = new DOMParser().parseFromString(INDEX_HTML, 'text/html');
      const btn = doc.querySelector('.search #searchClear');
      if (!btn) throw new Error('搜尋框裡要有 #searchClear');
      eq(btn.tagName, 'BUTTON', '元素：');
      eq(btn.type, 'button', '型別：');
      eq(btn.hasAttribute('hidden'), true, '一開始隱藏：');
      eq(btn.getAttribute('aria-label'), '清除搜尋', '無障礙標籤：');
      if (!btn.querySelector('use[href="#i-close"]')) throw new Error('要用 X 圖示');
    }),
    check('#34 有字才出現 X；點 X 清空並回到目前分類完整內容，不換分類', () => {
      const saved = [allDogs, groupMap, activeTab, searchQuery];
      const input = document.getElementById('searchInput');
      const clear = document.getElementById('searchClear');
      const names = () => [...document.querySelectorAll('#main .card .name')].map(n => n.textContent);
      const day = n => new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - n);
      try {
        allDogs = [
          { cage: 'B01', id: '', name: '清除甲', walkedDate: day(1), covered: false, note: '' },
          { cage: 'B02', id: '', name: '清除乙', walkedDate: day(2), covered: false, note: '' },
          { cage: 'B03', id: '', name: '清除丙', walkedDate: null, covered: false, note: '' },
        ];
        groupMap = {};
        activeTab = 'walk'; searchQuery = ''; input.value = ''; render();
        const full = names();
        eq(full.length, 3, '溜狗表完整：');
        eq(clear.hidden, true, '沒字時：');
        input.value = 'ㄐ';
        input.dispatchEvent(new InputEvent('input', { isComposing: true }));
        eq(clear.hidden, false, '選字途中也顯示：');
        input.value = '甲';
        input.dispatchEvent(new InputEvent('input'));
        eq(clear.hidden, false, '有字時：');
        eq(names(), ['清除甲'], '搜尋結果：');
        clear.click();
        eq(input.value, '', '文字清空：');
        eq(searchQuery, '', '搜尋條件清空：');
        eq(clear.hidden, true, 'X 隱藏：');
        eq(activeTab, 'walk', '分類不變：');
        eq(names(), full, '恢復完整內容：');
        input.value = '乙';
        input.dispatchEvent(new InputEvent('input'));
        input.value = '';
        input.dispatchEvent(new InputEvent('input'));
        eq(clear.hidden, true, '手動刪光也隱藏：');
        activeTab = 'mine'; render();
        input.value = '甲';
        input.dispatchEvent(new InputEvent('input'));
        clear.click();
        eq(activeTab, 'mine', '在我溜過清除也不換分類：');
      } finally {
        input.value = ''; clear.hidden = true;
        [allDogs, groupMap, activeTab, searchQuery] = saved;
      }
    }),
    // ── #32 前端改讀 data/dogs.json ──
    check('#32 dogs.json 轉成畫面資料：日期是當地日期、可以一起溜變成名單、沒犬名的略過', () => {
      const got = parseDogsData({
        version: 1, syncedAt: '2026-09-25T08:25:26+08:00',
        dogs: [
          { cage: 'C03', id: '202101234', name: '測試甲', walkedDate: '2026-09-16', covered: true, note: '勿溜', sex: 'female', intro: ' 很親人 ' },
          { cage: '住院區', id: '', name: '測試乙', walkedDate: null, covered: false, note: '' },
          { cage: 'A01', id: '1', name: '  ', walkedDate: '2026-09-16', covered: false, note: '' },
          null,
          { cage: 'A02', id: 3, name: '測試丙', walkedDate: '2026-02-30', walker: null, note: null },
        ],
        groups: { '測試甲': ['測試乙'], '測試乙': ['測試甲'], '測試丙': [] },
      });
      eq(got.dogs.map(d => d.name), ['測試甲', '測試乙', '測試丙'], '犬名：');
      const a = got.dogs[0];
      eq([a.cage, a.id, a.covered, a.note, a.sex, a.intro], ['C03', '202101234', true, '勿溜', '♀', '很親人'], '甲的欄位：');
      eq([got.dogs[1].sex, got.dogs[1].intro], ['', ''], '沒有狗卡：');
      eq([ymd(a.walkedDate), a.walkedDate.getHours()], ['2026/9/16', 0], '日期是當地午夜：');
      eq(got.dogs[1].walkedDate, null, '沒日期：');
      eq([got.dogs[2].id, got.dogs[2].covered, got.dogs[2].note, got.dogs[2].walkedDate], ['3', false, '', null], '缺值與不合理日期：');
      eq([...got.groups['測試甲']], ['測試乙'], '可以一起溜：');
      eq([...got.groups['測試丙']], [], '沒有一起溜的狗：');
      eq(got.syncedAt.toISOString(), '2026-09-25T00:25:26.000Z', '同步時間：');
    }),
    check('#32 dogs.json 沒有狗清單就算讀取失敗；少了可以一起溜只回空的', () => {
      for (const bad of [null, {}, { dogs: 'x' }]) {
        let threw = false;
        try { parseDogsData(bad); } catch (e) { threw = true; }
        if (!threw) throw new Error(`${JSON.stringify(bad)} 應該算失敗`);
      }
      const got = parseDogsData({ dogs: [{ cage: 'A01', id: '1', name: '測試甲', walkedDate: '2026-09-16', covered: false, note: '' }] });
      eq([got.dogs.length, got.groups, got.syncedAt], [1, null, null]);
    }),
    check('#32 天數判斷、排序跟以前讀試算表一樣（日期當天算今天，不差一天）', () => {
      const { dogs } = parseDogsData({ dogs: [
        { cage: 'A', id: '1', name: '甲', walkedDate: '2026-09-21', covered: false, note: '' },
        { cage: 'A', id: '2', name: '乙', walkedDate: null, covered: true, note: '' },
        { cage: 'A', id: '3', name: '丙', walkedDate: '2026-08-15', covered: false, note: '' },
        { cage: 'A', id: '4', name: '丁', walkedDate: null, covered: false, note: '' },
        { cage: 'A', id: '5', name: '戊', walkedDate: '2026-09-24', covered: false, note: '' },
      ] });
      eq(dueDogs(dogs, TODAY).map(d => d.name), ['丁', '丙', '甲', '戊', '乙'], '排序：');
      eq(dogs.map(d => computeStatus(d, TODAY).days), [3, undefined, 40, undefined, 0], '天數：');
    }),
    check('#32 index.html 先有標題、搜尋框、分類列，內容區只寫讀取中；沒有寫死狗狗資料', () => {
      const doc = new DOMParser().parseFromString(INDEX_HTML, 'text/html');
      if (!doc.querySelector('header h1') || !doc.getElementById('searchInput') || !doc.getElementById('tabs')) throw new Error('基本 UI 要在 index.html 裡');
      eq(doc.getElementById('main').textContent.trim(), '讀取中…', '內容區：');
      // V7（#111）起分類列在畫面最下面的底部列；搜尋框 2026-10-04 搬回頁首
      if (!doc.querySelector('#bottomBar #tabs') || !doc.querySelector('header.app #searchInput')) throw new Error('分類列要在底部列、搜尋框要在頁首');
    }),
    check('#32 repo 裡的 data/dogs.json 格式前端讀得懂', () => {
      if (!DOGS_JSON) throw new Error('讀不到 data/dogs.json');
      const got = parseDogsData(DOGS_JSON);
      eq(got.dogs.length, DOGS_JSON.dogs.length, '狗的數量：');
      if (!got.dogs.length) throw new Error('dogs.json 沒有狗');
      const badDate = DOGS_JSON.dogs.filter((d, i) => d.walkedDate && !got.dogs[i].walkedDate).map(d => d.walkedDate);
      eq(badDate, [], '讀不懂的日期：');
      if (!got.groups) throw new Error('dogs.json 沒有可以一起溜的資料');
      if (!got.syncedAt) throw new Error('dogs.json 沒有同步時間');
      if (!got.dogs.some(d => d.intro)) throw new Error('dogs.json 沒有狗卡資訊');
      if (!got.dogs.some(d => d.sex)) throw new Error('dogs.json 沒有性別');
    }),
    check('性別符號 ♂ 藍色、♀ 紅色；犬名旁不再有橘色備註圖示', () => {
      const box = document.createElement('div');
      const mark = sex => { box.innerHTML = sexMark({ sex }); return box.querySelector('.sex'); };
      eq(mark('♂').className, 'sex male', '♂ 的 class：');
      eq(mark('♀').className, 'sex female', '♀ 的 class：');
      eq(mark('').className, 'sex', '沒有性別：');
      if (INDEX_HTML.includes('i-memo')) throw new Error('index.html 還留著備註圖示');
      if (APP_JS.includes('has-note')) throw new Error('js/app.js 還會畫備註圖示');
    }),
  ]);
}


// #558 起溜了只走 D1：要等回應的登記測試依序跑，不和上面同時進行的檢查互相改 allDogs
async function runD1PickTests() {
  await check('沒有編號的狗也有「已遛」，改用犬名送出', async () => {
    const saved = [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, UPLOAD_URL, sheetWriteState, walkerNameMemory];
    try {
      phoneStore = fakeStorage(); walkRecords = freshWalkRecords();
      UPLOAD_URL = 'https://worker.test'; sheetWriteState = 'unknown'; saveWalkerName('志工我');
      const calls = fakeApi(fakeD1.api());
      allDogs = [
        { name: '新來甲', cage: 'B04', id: '', walkedDate: null, covered: false, note: '' },
        { name: '', cage: 'B05', id: '', walkedDate: null, covered: false, note: '' },
      ];
      groupMap = {}; activeTab = 'walk'; searchQuery = '';
      render();
      eq(document.querySelectorAll('#main [data-walk="add"]').length, 1, '有犬名就有按鈕，連犬名都沒有才沒有：');
      fakeD1.forget(allDogs.filter(walkKey));
      document.querySelector('#main .card[data-dog="0"] [data-walk="add"]').click();
      await until(() => walkedNow(allDogs[0]), '登記：');
      eq(calls.filter(c => c[0] === 'walk').map(c => c[1].dogs), [[{ id: '', name: '新來甲' }]], '用犬名送：');
      await until(() => document.querySelectorAll('#main [data-walk="back"]').length === 1, '變已溜、可取消：');
    } finally {
      BQWalkUI.hideToast(); restoreApi();
      [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, UPLOAD_URL, sheetWriteState, walkerNameMemory] = saved;
      render();
    }
  });
  await check('#35 可以一起溜：勾選後按一次，連同這隻一起記；已溜的不顯示圓圈', async () => {
    const saved = [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, UPLOAD_URL, sheetWriteState, walkerNameMemory];
    try {
      phoneStore = fakeStorage(); walkRecords = freshWalkRecords();
      UPLOAD_URL = 'https://worker.test'; sheetWriteState = 'unknown'; saveWalkerName('志工我');
      fakeApi(fakeD1.api());
      allDogs = [
        { name: '測試甲', cage: 'A01', id: '9711', walkedDate: null, covered: false, note: '' },
        { name: '測試乙', cage: 'A02', id: '9712', walkedDate: null, covered: false, note: '' },
        { name: '測試丙', cage: 'A03', id: '9713', walkedDate: null, covered: false, note: '' },
        { name: '測試丁', cage: 'A04', id: '', walkedDate: null, covered: false, note: '' },
      ];
      fakeD1.forget(allDogs);
      const walked = () => allDogs.filter(d => walkedNow(d)).map(d => d.name);
      groupMap = { '測試甲': new Set(['測試乙', '測試丙', '測試丁']) };
      activeTab = 'walk'; searchQuery = '';
      render();
      showDetail(allDogs[0]);
      const box = document.getElementById('detail');
      eq(box.querySelectorAll('.pick').length, 3, '沒編號的也有勾選圓圈：');
      eq(box.querySelector('#groupWalk').textContent.trim(), '溜了', '沒勾選時只記這隻：');
      box.querySelector('.pick[data-pick="9712"]').click();
      eq(box.querySelector('.pick[data-pick="9712"]').classList.contains('on'), true, '勾選：');
      eq(box.querySelector('#groupWalk').textContent.trim(), '和勾選的 1 隻都溜了', '按鈕文字：');
      box.querySelector('#groupWalk').click();
      await until(() => walked().length === 2, '一次記兩隻：');
      eq(walked(), ['測試甲', '測試乙'], '一次記兩隻：');
      await until(() => box.querySelectorAll('.pick').length === 2, '已溜的不再顯示圓圈：');
      eq(document.getElementById('detailBackdrop').hidden, false, '記完詳細資訊還開著：');
      eq(box.querySelectorAll('.pick').length, 2, '已溜的不再顯示圓圈：');
      eq(box.querySelectorAll('.walked-tag').length, 1, '已溜的標「今天已溜」：');
      eq(!!box.querySelector('#groupWalk'), false, '這隻已溜又沒勾選時不顯示按鈕：');
      box.querySelector('.pick[data-pick="9713"]').click();
      eq(box.querySelector('#groupWalk').textContent.trim(), '勾選的 1 隻都溜了', '這隻已溜，只記勾選的：');
      box.querySelector('#groupWalk').click();
      await until(() => walked().length === 3, '記下丙：');
      await until(() => !document.getElementById('toast').hidden && !document.getElementById('toast').querySelector('.toast-undo').hidden, '提示條有復原：');
      document.getElementById('toast').querySelector('.toast-undo').click();
      await until(() => walked().length === 2, '復原：');
      eq(walked(), ['測試甲', '測試乙'], '復原：');
      box.querySelector('.buddy').click();
      eq(document.getElementById('detailName').firstChild.textContent, '測試乙', '輕點照片照舊換看那隻：');
    } finally {
      hideDetail(); BQWalkUI.hideToast(); restoreApi();
      if (history.state && history.state.bqDetail) history.replaceState(null, '');
      [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, UPLOAD_URL, sheetWriteState, walkerNameMemory] = saved;
      render();
    }
  });
}
