window.__BQ_TEST__ = true;
const results = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => results.push({ name, ok: true }),
    e => results.push({ name, ok: false, msg: e && e.message ? e.message : String(e) }));
}
function eq(actual, expected, label = '') {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}預期 ${b}，實際 ${a}`);
}
const ymd = d => d ? `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}` : null;

const TODAY = new Date(2026, 8, 24, 10);
// #35 測試用的假 localStorage：測試頁跟網站同網域，不能動到志工手機上真正的「今天已溜」
function freshWalkRecords() {
  return BQWalks.createRecords({ store: () => phoneStore, dates: BQDates, key: walkKey });
}
function fakeStorage() {
  const data = {};
  return BQStore.create({ getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; } });
}
// #478 假後端：替換 BQApi 的每個端點，不替換瀏覽器 fetch。fake(端點名, ...參數) 回 Response，丟錯表示斷線；
// 要走真的端點就回 API_REAL[端點名](...參數)。回傳呼叫紀錄 [[端點名, ...參數]]。restoreApi() 換回真的
// Legacy unit cases retain the explicit all-open settings fixture; the feature-settings suite tests real settings loading and failures.
const API_KEEP = ['base', 'baseFor', 'settle', 'featureSettings'];
let API_REAL = null;
function fakeApi(fake) {
  if (!API_REAL) API_REAL = { ...BQApi };
  const calls = [];
  for (const k of Object.keys(API_REAL)) if (!API_KEEP.includes(k)) {
    BQApi[k] = (...args) => {
      calls.push([k, ...args]);
      let v;
      try { v = fake(k, ...args); } catch (e) { return BQApi.settle(Promise.reject(e)); } // 跟替換 fetch 時一樣同步呼叫
      return Promise.resolve(v).then(r => (r instanceof Response ? BQApi.settle(r) : r), e => BQApi.settle(Promise.reject(e)));
    };
  }
  return calls;
}
function restoreApi() { if (API_REAL) Object.assign(BQApi, API_REAL); }
// D1 登記是非同步的：等到 fn() 成立，最多約 1 秒
async function until(fn, label = '') {
  for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); }
  throw new Error(`${label}等不到`);
}
// #558 起溜了只走 D1。整頁共用一個假 D1：版本一路遞增，登記狀態留在 walkRegistration 裡跨測試，
// 測試開始時用 fakeD1.forget(狗) 改回狗清單的日期與名字，或 fakeD1.show(狗, 名單) 當作今天已有人溜。
const fakeD1 = (() => {
  let version = Date.now();
  const rows = new Map(), before = new Map();
  const today = () => BQDates.localDateKey(new Date());
  const pack = () => ({ ok: true, source: 'd1', date: today(), version: version++, walks: [...rows.values()] });
  function set(key, walker, walkedDate = today()) {
    const row = { key, version: version++, walkedDate, walker, syncStatus: 'synced', at: new Date().toISOString() };
    rows.set(key, row);
    return row;
  }
  // override(dog, body) 回傳單狗結果時改成那個結果，例如 { status: 'unknown' }
  function walk(body, override = () => null) {
    const results = body.dogs.map(d => {
      const key = d.id || `名:${d.name}`, old = rows.get(key), dog = allDogs.find(x => walkKey(x) === key) || d;
      const forced = override(d, body);
      if (forced) return { id: d.id, name: d.name, ...forced };
      if (body.action !== 'walk' && old && d.expectedVersion !== undefined && d.expectedVersion !== old.version)
        return { id: d.id, name: d.name, status: 'changed', version: old.version, current: { date: old.walkedDate, walker: old.walker } };
      let current;
      if (body.action === 'undo') current = before.get(key) || d1Base(dog);
      else {
        const same = old && old.walkedDate === today();
        if (!same) before.set(key, old ? { date: old.walkedDate, walker: old.walker } : d1Base(dog));
        // 同一天再登記（一起溜的人）接在原名單後面，跟 worker/src/walk-accept.js 一樣
        const people = body.action === 'walk' && same ? [...splitWalkers(old.walker), ...splitWalkers(body.walker)] : splitWalkers(body.walker);
        current = { date: today(), walker: [...new Set(people)].join('、') };
      }
      const row = set(key, current.walker, current.date);
      return { id: d.id, name: d.name, status: body.action === 'undo' ? 'restored' : 'written', accepted: true,
        requestId: body.requestId, operationDate: body.operationDate, version: row.version, current, syncStatus: 'synced', at: row.at };
    });
    return { ok: results.every(r => r.accepted), source: 'd1', today: today(), snapshot: pack(), results };
  }
  function receive(dogs) { walkRegistration.receiveToday(pack(), dogs); }
  function forget(dogs) {
    for (const d of dogs) { const base = d1Base(d); set(walkKey(d), base.walker, base.date); before.delete(walkKey(d)); }
    receive(dogs);
  }
  function show(dogs, walker) { for (const d of dogs) set(walkKey(d), walker); receive(dogs); }
  // fakeApi 用：walk、todayWalks 走假 D1，其他端點交給 other
  const api = (other = () => apiJson({ ok: true })) => (name, ...args) =>
    name === 'walk' ? apiJson(walk(args[0])) : name === 'todayWalks' ? apiJson(pack()) : other(name, ...args);
  return { walk, pack, set, forget, show, api, rows };
})();
const apiJson = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let INDEX_HTML = ''; // index.html 原始碼，#10 唯讀檢查用
// 導覽以實際按鈕換步，不讀寫內部狀態；減少動態效果讓測試穩定。
function closeGuideIn(win = window) {
  win.document.querySelector('#tour [data-tour="done"]')?.click();
}
async function guideAt(title, win = window) {
  closeGuideIn(win);
  const media = win.matchMedia;
  win.matchMedia = q => q.includes('prefers-reduced-motion') ? { matches: true } : media.call(win, q);
  try {
    win.eval('openGuide()');
    for (let i = 0; i < 10; i++) {
      if (win.document.querySelector('#tourTitle')?.textContent === title) {
        await new Promise(r => setTimeout(r, 30)); return;
      }
      const next = win.document.querySelector('#tour [data-tour="next"]');
      if (!next) break;
      next.click(); await new Promise(r => setTimeout(r, 30));
    }
    throw new Error('找不到導覽步驟：' + title);
  } finally { win.matchMedia = media; }
}
function guideSpotlights(el) {
  // 測試頁沒有載入導覽 CSS，讀取定位後的內嵌樣式；高度可能被可見範圍裁掉。
  const hole = document.querySelector('#tour .tour-hole');
  const target = el.getBoundingClientRect();
  const left = parseFloat(hole.style.left), right = left + parseFloat(hole.style.width);
  return Math.abs(left - target.left) < 10 && Math.abs(right - target.right) < 10;
}

let TOUR_JS = '';
let WELCOME_JS = '';
let PHOTO_JS = '';
let FAVORITES_JS = '';
let WALK_UI_JS = '';
let APP_JS = '';    // js/app.js 原始碼（#30 拆檔後程式在這裡）
let API_JS = '';    // js/api.js 原始碼（#478 呼叫 /api 都在這裡）
let ANALYSIS_JS = ''; // js/analysis.js 原始碼（#59 分析頁）
let FIND_JS = '';    // js/find.js 原始碼（#99 找狗）
let SITE_JS = '';    // js/site-config.js 原始碼（這間收容所的設定）
let MANIFEST = {};   // manifest.webmanifest，#33 主畫面名稱檢查用
let DOGS_JSON = null; // data/dogs.json，#32 格式檢查用

function show() {
  const failed = results.filter(r => !r.ok);
  const summary = document.getElementById('summary');
  summary.textContent = failed.length ? `${failed.length} 項失敗，${results.length - failed.length} 項通過` : `全部 ${results.length} 項通過`;
  summary.className = failed.length ? 'fail' : 'pass';
  document.getElementById('results').innerHTML = results.map(r =>
    `<li class="${r.ok ? 'pass' : 'fail'}">${r.ok ? '✓' : '✗'} ${esc(r.name)}${r.ok ? '' : `<br>${esc(r.msg)}`}</li>`).join('');
}
