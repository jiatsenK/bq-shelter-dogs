import { FIND_CAGES, findCageOf, findPickCage, findZoneOf, whereClose, whereOpen } from './find.js';
import { appState, deskState, findState } from './page-state.js';
import { appHeader, closeDetail, esc, icon, loadWalkView, render, saveWalkView, showDetail, switchTab } from './app.js';
import { deskOn } from './desk.js';
import { BQWelcome } from './welcome.js';
import { hideAnalysis } from './analysis.js';
import { BQStore } from './store.js';

// 導覽介面只公開 BQTour；步驟、示範、計時器與定位狀態均留在模組內。
const BQTour = (() => {
  // ── 使用說明導覽（K 2026-10-09：直接用實際的網頁；一個說明一個動作，用手指示範）──
  // 畫面變暗、只亮要說明的地方，旁邊小框一句話；有 demo 的步驟，手指會點一下示範那個動作。
  // 「溜了」只換畫面上的樣子，不會送出、不寫試算表；打開詳細資訊、在哪、換分頁本來就不改資料，真的做，換下一步時收回。
  // 說明文字都在 TOUR_STEPS（K 2026-10-09 在 Issue #171 改的字；「狗狗」照名詞表改「狗」，K 同意）；target 依序找，第一個找得到的就亮它，
  // 都找不到（資料還沒讀到、列表模式沒有籠位）時小框放在畫面中間
  const TOUR_STEPS = [
    { target: ['#main .card[data-dog]', '#main .row-dog[data-dog]', '#main .desk-table tbody tr'], title: '溜狗表', text: '依照上次溜狗時間排序，越久沒溜的狗會排越前面。' },
    { target: ['#main .card[data-dog] .last', '#main .row-dog[data-dog] .r-date', '#main .desk-table tbody .dr-day'], title: '上次溜狗天數', text: '顯示距離上次溜狗的天數過了幾天。' },
    { target: ['#main .card[data-dog] .name', '#main .row-dog[data-dog] .r-name', '#main .desk-table tbody .dr-name button'], title: '狗資料', text: '點擊名稱，可以查看照片和詳細紀錄。', demo: 'detail' },
    { target: ['#main .card[data-dog] .walk-btn', '#main .row-dog[data-dog] .walk-btn', '#main .desk-table tbody .dr-ck'], title: '溜狗登記', text: '溜完按「溜了」，就會自動記錄日期和名字。', deskText: '勾選溜過的狗（可以勾好幾隻），再按下面的「今天 溜了」，就會一起記錄日期和名字。', demo: 'walk' },
    { target: ['#main .card[data-dog] .walk-btn', '#main .row-dog[data-dog] .walk-btn', '#main .desk-table tbody .dr-name button'], title: '取消登記', text: '如果按錯，再按一次「已溜」就可以取消。', deskText: '如果登記錯了，按提示條的「復原」，或點狗名打開詳細資訊按「已溜」取消。', demo: 'unwalk' },
    { target: ['#main .card[data-dog] .cage-pill', '#main .row-dog[data-dog] .r-cage', '#main .desk-table tbody .dr-cage'], title: '籠位查詢', text: '點擊籠位，就能在平面圖查看位置。', demo: 'where' },
    { target: ['#main .walk-tools .seg', '#main .dt-view'], title: '照片／列表', text: '右上角可以切換：有照片的狗卡，或一列一隻、比較好掃過去的列表。', deskTitle: '全表／最近 30 天', deskText: '全表下面可以切換「最近 30 天」，看每隻狗這一個月哪幾天有出門。', demo: 'view' },
    { target: ['#tabs [data-tab="mine"]'], title: '我溜過', text: '查看自己溜過的狗。', demo: 'tab' },
    { target: ['#main [data-where]', '#main .card .meta', '#main .row-dog .r-cage'], title: '找狗', text: '點籠位查看狗的位置，也可以看平面圖。', demo: 'find' },
    { target: [], title: '加入手機主畫面', text: '下次點手機桌面的圖示，就能直接開啟網站。', install: true },
  ];
  function tourStepCount() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const count = standalone || window.innerWidth >= 1100 ? TOUR_STEPS.length - 1 : TOUR_STEPS.length;
    return Math.max(count, tour ? tour.step + 1 : 0); // 安裝說明開著時旋轉手機，不讓最後一步變成超出範圍。
  }
  function tourInstallHtml() {
    return `<div class="tour-install">
      <p><strong>iPhone</strong>：用 Safari 開啟網站，點「分享」→「加入主畫面」→「加入」。若有「打開為網頁 App」，請開啟。</p>
      <p><strong>Android</strong>：用 Chrome 開啟網站，點右上角「⋮」→「安裝並建立捷徑」（或「新增至主畫面」），依提示選「安裝」或「建立捷徑」。</p>
      <p>在 LINE 裡開啟時，先選「用瀏覽器開啟」；建議使用一般分頁。</p>
    </div>`;
  }
  let tour = null; // { step, again, shown: 示範後改亮的地方, undo: 收回示範, timers }
  function tourTarget(step) {
    for (const sel of TOUR_STEPS[step].target) {
      // 籠位示範只用舊／新犬舍有逐籠位置的狗；亮的籠位與示範打開的是同一隻。
      const el = TOUR_STEPS[step].demo === 'where'
        ? [...document.querySelectorAll(sel)].find(el => {
          const d = tourCageDog(el);
          return d && ['old', 'new'].includes(findZoneOf(d)) && findCageOf(d);
        })
        : document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }
  function tourCageDog(el) {
    const row = el && el.closest('[data-dog], [data-desk-dog]');
    const i = el && el.dataset.dogI !== undefined ? el.dataset.dogI
      : row && (row.dataset.dog !== undefined ? row.dataset.dog : row.dataset.deskDog);
    return i != null ? appState.allDogs[Number(i)] : null;
  }
  // 示範用的狗：溜狗表最上面那隻
  function tourDog() {
    const el = document.querySelector('#main .card[data-dog], #main .row-dog[data-dog]');
    return el ? appState.allDogs[Number(el.dataset.dog)] : null;
  }
  // 只換畫面上「溜了」按鈕和色籤的樣子（不送出）；收回時 render() 畫回原本的
  function tourFakeWalk(state) {
    const row = document.querySelector('#main .card[data-dog], #main .row-dog[data-dog]');
    const btn = row && row.querySelector('.walk-btn');
    if (!btn) return;
    if (state === 'pending') { btn.className = 'walk-btn pending'; btn.textContent = '登記中'; return; }
    btn.className = 'walk-btn done';
    btn.innerHTML = `${icon('tick')}已溜`;
    const val = row.querySelector('.last .val');
    if (val) { val.className = 'val sage'; val.textContent = '今天'; }
  }
  const TOUR_DEMOS = {
    detail: { run: () => { const d = tourDog(); if (d) showDetail(d); }, show: '#detail', undo: () => { if (appState.detailDog) closeDetail(); } },
    walk: { run: () => { tourFakeWalk('pending'); tourLater(() => { tourFakeWalk('done'); placeTour(); }, 700); }, undo: () => render() },
    unwalk: { before: () => tourFakeWalk('done'), run: () => render(), undo: () => render() },
    where: { run: el => { const d = tourCageDog(el); if (d) whereOpen(d); }, show: '#whereSheet', undo: () => { if (findState.whereDog) whereClose(); } },
    // 照片／列表（K 2026-10-09）：示範切到另一種，收回時切回原本的
    view: {
      // 電腦版沒有照片／列表：示範切到「最近 30 天」再切回全表
      run: () => {
        if (typeof deskOn === 'function' && deskOn()) { tour.view = 'desk'; deskState.deskView = 'days30'; render(); return; }
        tour.view = loadWalkView(); saveWalkView(tour.view === 'list' ? 'photo' : 'list'); render();
      },
      show: '#main .walk-tools .seg, #main .dt-view',
      undo: () => {
        if (tour && tour.view === 'desk') { deskState.deskView = 'sheet'; tour.view = null; }
        else if (tour && tour.view) { saveWalkView(tour.view); tour.view = null; }
        render();
      },
    },
    tab: { run: el => { if (el) switchTab(el.dataset.tab); }, show: '#main .mc-head, #main .status-msg, #main .who-box', undo: () => switchTab('walk') },
    // 找狗（K 2026-10-09）：切過去後再隨便點平面圖上一個有狗的籠子，下面列出那一籠的狗。
    // 全圖不畫籠子（critique 2026-10-09），所以先點一區放大，再點那一區的籠子
    find: {
      run: () => switchTab('find'),
      show: '#main .find-map-card .find-map',
      then: [
        { at: tourZoneWithDogs, run: g => { findState.findZone = g.dataset.findZone; findState.findCage = null; render(); } },
        { at: tourCageWithDogs, run: g => findPickCage(g.dataset.findCage) },
      ],
      undo: () => { findState.findCage = null; findState.findZone = 'all'; switchTab('walk'); },
    },
  };
  // 全圖上隨便一個有逐籠、又有狗的區（找狗示範用）
  function tourZoneWithDogs() {
    const zones = [...document.querySelectorAll('#main g[data-find-zone]')].filter(g => {
      const key = g.dataset.findZone;
      return appState.allDogs.some(d => findZoneOf(d) === key && FIND_CAGES.cages.some(c => c.zone === key && c.id === findCageOf(d)));
    });
    return zones.length ? zones[Math.floor(Math.random() * zones.length)] : null;
  }
  // 放大的那一區裡隨便一個有狗的籠子（找狗示範用）
  function tourCageWithDogs() {
    const cages = [...document.querySelectorAll(`#main g[data-find-zone="${findState.findZone}"] g[data-find-cage]`)].filter(g => g.querySelector('rect.fm-cage.has'));
    return cages.length ? cages[Math.floor(Math.random() * cages.length)] : null;
  }
  function tourLater(fn, ms) {
    if (!tour) return;
    tour.timers.push(setTimeout(() => { if (tour) fn(); }, ms));
  }
  // 收回這一步的示範（換步、再看一次、結束時）
  function tourReset() {
    if (!tour) return;
    tour.timers.forEach(clearTimeout);
    tour.timers = [];
    tour.shown = null;
    const undo = tour.undo;
    tour.undo = null;
    if (undo) undo();
    const finger = document.querySelector('#tour .tour-finger');
    if (finger) finger.className = 'tour-finger';
  }
  // 手指出現 → 點一下 → 做那個動作；手機設定減少動態效果時不播，直接顯示做完的樣子
  function tourPlay() {
    const demo = TOUR_DEMOS[TOUR_STEPS[tour.step].demo];
    if (!demo) return;
    if (TOUR_STEPS[tour.step].demo === 'where' && !tourTarget(tour.step)) return;
    if (demo.before) { tour.undo = demo.undo; demo.before(); placeTour(); }
    const taps = [{ at: () => tourTarget(tour.step), run: el => { tour.undo = demo.undo; demo.run(el); if (demo.show) tour.shown = demo.show; } }];
    if (demo.then) taps.push(...[].concat(demo.then));
    const tap = t => { const el = t.at(); if (el) t.run(el); placeTour(); };
    const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) return taps.forEach(tap);
    const finger = document.querySelector('#tour .tour-finger');
    let when = 500;
    for (const t of taps) {
      let el = null;
      tourLater(() => {
        el = t.at();
        if (!el || !finger) return;
        const r = el.getBoundingClientRect();
        Object.assign(finger.style, { left: `${r.left + r.width / 2}px`, top: `${r.top + r.height / 2}px` });
        finger.className = 'tour-finger on';
      }, when);
      tourLater(() => finger && finger.classList.add('press'), when + 500);
      tourLater(() => { if (el) t.run(el); placeTour(); }, when + 650);
      tourLater(() => { if (finger) finger.className = 'tour-finger'; }, when + 1000);
      when += 1700;
    }
  }
  function startTour(again = false) {
    BQWelcome.close();
    if (appState.activeTab !== 'walk' || appState.analysisOpen) {
      if (appState.analysisOpen && typeof hideAnalysis === 'function') hideAnalysis();
      switchTab('walk');
    }
    window.scrollTo(0, 0);
    tour = { step: 0, again, shown: null, undo: null, timers: [] };
    renderTour(true);
  }
  function endTour() {
    tourReset();
    try { appState.phoneStore && appState.phoneStore.set(BQStore.keys.onboarded, '1'); } catch (e) { /* 存不了下次再看一次 */ }
    tour = null;
    renderTour();
  }
  // 目標不在畫面上（被頁首或底部列擋住）就捲過去
  function scrollTourTarget(el) {
    const r = el.getBoundingClientRect();
    const top = appHeader ? appHeader.getBoundingClientRect().bottom : 0;
    const bar = document.getElementById('bottomBar');
    if (bar && bar.contains(el)) return; // 底部分類列一直在畫面上，不用捲
    const bottom = bar ? bar.getBoundingClientRect().top : window.innerHeight;
    if (r.top < top + 8) window.scrollBy(0, r.top - top - 16);
    else if (r.bottom > bottom - 8) window.scrollBy(0, r.bottom - bottom + 16);
  }
  function tourViewport() {
    const v = window.visualViewport;
    return { top: v ? v.offsetTop : 0, height: v ? v.height : window.innerHeight, width: v ? v.width : window.innerWidth };
  }
  function tourShownTarget() {
    if (!tour || !tour.shown) return null;
    for (const selector of tour.shown.split(',')) {
      const el = document.querySelector(selector.trim());
      if (el) return el;
    }
    return null;
  }
  function placeTour() {
    const box = document.getElementById('tour');
    if (!box || !tour) return;
    const hole = box.querySelector('.tour-hole');
    const tip = box.querySelector('.tour-tip');
    const root = document.documentElement;
    const viewport = tourViewport();
    const viewBottom = viewport.top + viewport.height;
    const wide = viewport.width >= 600 && viewport.height < 500;
    root.classList.toggle('tour-wide', wide);
    root.style.setProperty('--tour-viewport-height', `${viewport.height}px`);
    root.style.setProperty('--tour-viewport-top', `${viewport.top}px`);
    const whereDemo = tour.shown === '#whereSheet' && !!findState.whereDog;
    const detailDemo = tour.shown === '#detail' && !!appState.detailDog;
    // 籠位面板固定在底部，先替上方說明卡留空間，再量面板位置（小螢幕也不重疊）。
    root.classList.toggle('tour-where-demo', whereDemo);
    root.classList.toggle('tour-detail-demo', detailDemo);
    root.style.setProperty('--tour-tip-height', `${tip.offsetHeight}px`);
    const el = tourShownTarget() || tourTarget(tour.step);
    box.classList.toggle('no-target', !el);
    if (!el) { tip.style.top = ''; return; }
    if (!whereDemo && !detailDemo && el.closest('#main') && el.getBoundingClientRect().top < (appHeader ? appHeader.getBoundingClientRect().bottom : viewport.top) + 8) scrollTourTarget(el);
    const r = el.getBoundingClientRect();
    const pad = 6;
    // 只亮畫面裡看得到的部分（換到我溜過、找狗時亮整個內容區）
    const top = Math.max(r.top - pad, viewport.top), bottom = Math.min(r.bottom + pad, viewBottom);
    const rect = [r.left - pad, top, r.width + pad * 2, Math.max(bottom - top, 0)].map(v => `${Math.round(v)}px`);
    if (hole.dataset.rect !== rect.join()) { // 位置沒變就不動，免得每一格都重排
      hole.dataset.rect = rect.join();
      Object.assign(hole.style, { left: rect[0], top: rect[1], width: rect[2], height: rect[3] });
    }
    const h = tip.offsetHeight;
    let y;
    if (wide) y = viewport.top + (viewport.height - h) / 2;
    else if (whereDemo || detailDemo) y = viewport.top + 12;
    else if (r.bottom + pad + 12 + h <= viewBottom - 12) y = r.bottom + pad + 12;
    else if (r.top - pad - 12 - h >= viewport.top + 12) y = r.top - pad - 12 - h;
    else if (bottom - top > viewport.height * 0.55) y = viewBottom - h - 96;
    else if (r.top + r.height / 2 < viewport.top + viewport.height / 2) y = r.bottom + pad + 12;
    else y = r.top - pad - 12 - h; // 在下半部（例如底部分類列），小框放上面
    const tipTop = `${Math.round(Math.max(viewport.top + 12, Math.min(viewBottom - h - 12, y)))}px`;
    if (tip.style.top !== tipTop) tip.style.top = tipTop;
  }
  // 導覽開著時每一格都重新對位置（K 2026-10-09 黃框歪了）：頁首範圍字晚一格出現、狗卡重畫、在哪面板滑上來，
  // 內容都會移動，只在捲動、重畫時對一次會跟不上
  let tourFrame = 0;
  function tourLoop() {
    if (!tour) { tourFrame = 0; return; }
    placeTour();
    tourFrame = requestAnimationFrame(tourLoop);
  }
  function queueTour() { if (tour && !tourFrame) tourFrame = requestAnimationFrame(tourLoop); }
  function renderTour(stepChanged = false) {
    let box = document.getElementById('tour');
    document.documentElement.classList.toggle('tour-open', !!tour);
    if (!tour) {
      if (box) box.remove();
      document.documentElement.classList.remove('tour-where-demo', 'tour-detail-demo', 'tour-wide');
      document.documentElement.style.removeProperty('--tour-tip-height');
      document.documentElement.style.removeProperty('--tour-viewport-height');
      document.documentElement.style.removeProperty('--tour-viewport-top');
      BQWelcome.setInert(null);
      return;
    }
    if (!box) {
      box = document.createElement('div');
      box.id = 'tour';
      box.className = 'tour';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-labelledby', 'tourTitle');
      document.body.appendChild(box);
      box.addEventListener('click', e => {
        const b = e.target.closest('[data-tour]');
        if (!b || !tour) return;
        const act = b.dataset.tour;
        if (act === 'replay') { tourReset(); placeTour(); tourPlay(); return; }
        if (act === 'done') return endTour();
        tourReset();
        tour.step = act === 'next' ? tour.step + 1 : Math.max(0, tour.step - 1);
        renderTour(true);
      });
      box.addEventListener('keydown', e => {
        e.stopPropagation(); // 導覽蓋在最上面，後面網頁的按鍵處理不要接到
        if (e.key === 'Escape') endTour();
      });
    }
    BQWelcome.setInert(box);
    queueTour();
    if (!stepChanged && box.querySelector('.tour-tip')) return placeTour(); // 資料重畫時只重新對位置
    const i = tour.step;
    const desk = typeof deskOn === 'function' && deskOn();
    // 電腦版（K 2026-10-10）：沒有溜了按鈕、照片／列表，改說勾選登記、最近 30 天
    const st = desk ? { ...TOUR_STEPS[i], title: TOUR_STEPS[i].deskTitle || TOUR_STEPS[i].title, text: TOUR_STEPS[i].deskText || TOUR_STEPS[i].text } : TOUR_STEPS[i];
    const count = tourStepCount();
    const last = i === count - 1;
    box.innerHTML = `<div class="tour-hole"></div><div class="tour-finger"></div>
      <div class="tour-tip">
        <div class="tour-head"><h2 id="tourTitle" tabindex="-1">${esc(st.title)}</h2><button type="button" class="tour-skip" data-tour="done">${tour.again ? '關閉' : '略過'}</button></div>
        <p>${esc(st.text)}</p>
        ${st.install ? tourInstallHtml() : ''}
        <div class="tour-foot">
          <span class="tour-n">${i + 1} / ${count}</span>
          ${st.demo ? '<button type="button" class="tour-replay" data-tour="replay">再看一次</button>' : ''}
          ${i > 0 ? '<button type="button" class="tour-back" data-tour="back">上一步</button>' : ''}
          <button type="button" class="tour-next" data-tour="${last ? 'done' : 'next'}">${last ? (tour.again ? '看完了' : '開始使用') : '下一步'}</button>
        </div>
      </div>`;
    const el = tourTarget(i);
    if (el) scrollTourTarget(el);
    placeTour();
    box.querySelector('h2').focus({ preventScroll: true }); // 換一步後讀螢幕的人才知道到了哪裡
    tourPlay();
  }
  return { start: startTour, queue: queueTour };
})();

export { BQTour };
