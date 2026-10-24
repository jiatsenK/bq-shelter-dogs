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
const API_KEEP = ['base', 'baseFor', 'settle'];
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
