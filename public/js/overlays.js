// 覆蓋層與返回鍵（#623 R6）：開一層就多一筆歷史紀錄，手機按「返回」只關最上面那層，不離開網頁。
// 各模組只註冊自己那層怎麼判斷開著、怎麼關；按返回先關哪一層集中寫在 BACK_ORDER，新增覆蓋層改這裡。
// 不依賴其他模組，主頁與圖鑑都能匯入。

// 按返回時由上往下找第一層開著的關掉；右邊是歷史紀錄裡的標記（{ bqDetail: true } 這種形狀不變）
const BACK_ORDER = [
  ['findZoom', 'bqFindZoom'], // 平面圖全螢幕（find.js）
  ['crop', 'bqCrop'],         // 照片裁切（photo.js）
  ['lightbox', 'bqPhoto'],    // 燈箱（app.js）
  ['where', 'bqWhere'],       // 在哪面板（find.js）
  ['detail', 'bqDetail'],     // 詳細資訊（detail.js）
];
const STATE_KEY = Object.fromEntries(BACK_ORDER);
const layers = {};

// 寫歷史紀錄；網址寫不進去（嵌在 srcdoc 的測試頁這類不同網址的文件）時照樣記狀態，只是不換網址
export function writeHistory(method, state, url) {
  try { history[method](state, '', url); } catch (e) { history[method](state, ''); }
}

function keyOf(name) {
  if (!STATE_KEY[name]) throw new Error(`沒有這一層：${name}`);
  return STATE_KEY[name];
}

// layer：{ isOpen, hide }；hide 只關畫面、還原焦點，不碰歷史紀錄
export function registerOverlay(name, layer) {
  keyOf(name);
  layers[name] = layer;
}

// 開一層：多一筆歷史紀錄，返回鍵會先關它。url 是這層自己的網址（詳細資訊的 #dog/<編號>，ADR 0024），沒給就維持底下那一頁。
// 目前這筆已經是這層（往前回到它的紀錄、重新打開）就不再多疊一筆
export function pushOverlay(name, url) {
  const state = { [keyOf(name)]: true };
  writeHistory(history.state && history.state[keyOf(name)] ? 'replaceState' : 'pushState', state, url || undefined);
}

// 這層開著、換看別的內容（詳細資訊換一隻狗）：只換網址，不多一筆
export function replaceOverlayUrl(name, url) {
  if (url && history.state && history.state[keyOf(name)]) writeHistory('replaceState', history.state, url);
}

// 最上面這筆是不是覆蓋層：是的話網址屬於那一層，畫面重畫時不改
export function overlayOnTop() {
  return !!history.state && BACK_ORDER.some(([, key]) => history.state[key]);
}

// 有沒有任何一層開著
export function anyOverlayOpen() {
  return BACK_ORDER.some(([name]) => layers[name] && layers[name].isOpen());
}

// 關一層：這層有歷史紀錄就走上一頁（popstate 會接著 hide），沒有就直接關
export function closeOverlay(name) {
  if (history.state && history.state[keyOf(name)]) history.back();
  else layers[name].hide();
}

// 這層已經用別的方式關掉、接著要換到別的畫面：把它的歷史紀錄換掉，按返回不會再回到這層
export function forgetOverlay(name) {
  if (history.state && history.state[keyOf(name)]) history.replaceState(null, '');
}

// 每一筆頁面紀錄的網址（ADR 0024）：bindOverlays 時由主頁給，圖鑑沒給就維持原網址
let pageUrl = () => undefined;

// 換掉目前這一筆，不新增（電腦版資訊換過子頁再轉成手機按回資訊）；網址跟著換，landing 標記保留
export function replacePage(state) {
  const landing = history.state && history.state.bqLanding ? { bqLanding: true } : {};
  writeHistory('replaceState', { ...state, ...landing }, pageUrl(state));
}

// 頁籤、資訊子頁：先把目前這頁記好，再多一筆新的，返回回到 current。
// 打開網頁的那一筆（bqLanding）換掉狀態後仍標著；新的那筆是網站自己多的，不是 landing
export function pushPage(current, next) {
  const landing = history.state && history.state.bqLanding ? { bqLanding: true } : {};
  const { bqLanding, ...pushed } = next;
  writeHistory('replaceState', { ...current, ...landing }, pageUrl(current));
  writeHistory('pushState', pushed, pageUrl(pushed));
}

// 目前的歷史紀錄是自己這頁（ours 判斷）就走上一頁，不是就直接 otherwise。
// 打開網頁的那一筆走上一頁會離開網站，一律 otherwise
export function backFrom(ours, otherwise) {
  if (ours(history.state) && !history.state.bqLanding) history.back();
  else otherwise();
}

// 返回鍵：先關最上面的覆蓋層；都沒開才交給 navigate（頁籤、資訊子頁）。
// urlOf(state)：頁面紀錄的狀態換成網址（ADR 0024）
export function bindOverlays(navigate, urlOf) {
  if (urlOf) pageUrl = state => (state ? urlOf(state) : undefined);
  window.addEventListener('popstate', e => {
    for (const [name] of BACK_ORDER) {
      const layer = layers[name];
      if (layer && layer.isOpen()) { layer.hide(); return; }
    }
    navigate(e);
  });
}

// 焦點圈：Tab 只在 items 之間轉，由呼叫的人決定 items（已濾掉隱藏、停用的）。
// 預設每次都自己移到下一個／上一個；edgesOnly 只在頭尾繞回，中間照瀏覽器原本的順序（詳細資訊裡還有連結）
export function trapFocus(e, items, { edgesOnly = false, preventScroll = true } = {}) {
  if (e.key !== 'Tab' || !items.length) return;
  const focus = el => el.focus(preventScroll ? { preventScroll: true } : undefined);
  const at = items.indexOf(document.activeElement);
  if (edgesOnly) {
    const first = items[0], last = items[items.length - 1];
    if (at < 0 || (e.shiftKey && at === 0) || (!e.shiftKey && at === items.length - 1)) {
      e.preventDefault();
      focus(e.shiftKey ? last : first);
    }
    return;
  }
  e.preventDefault();
  focus(items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length]);
}
