// 返回鍵與焦點圈（public/js/overlays.js，#623 R6）：假的 history、window、document，不開瀏覽器
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendModule } from './frontend-module-test-helper.mjs';

// 模組在 vm 裡建立的物件原型不同，比內容就好
const plain = v => JSON.parse(JSON.stringify(v ?? null));

function fakePage() {
  const entries = [null];
  let at = 0;
  const listeners = [];
  const calls = [];
  const urls = []; // 每一筆換到的網址（ADR 0024）；沒給網址記 undefined
  const history = {
    get state() { return entries[at]; },
    pushState(state, title, url) { entries.splice(at + 1); entries.push(state); at++; calls.push(['push', state]); urls.push(['push', url]); },
    replaceState(state, title, url) { entries[at] = state; calls.push(['replace', state]); urls.push(['replace', url]); },
    back() { calls.push(['back']); if (at > 0) at--; for (const fn of listeners) fn({ state: entries[at] }); },
  };
  const window = { addEventListener: (type, fn) => { if (type === 'popstate') listeners.push(fn); } };
  const document = { activeElement: null };
  return { globals: { history, window, document }, entries, calls, urls, document };
}

async function load() {
  const page = fakePage();
  const overlays = await loadFrontendModule('overlays.js', page.globals);
  return { ...page, overlays };
}

function layer(open = false) {
  const l = { open, hidden: 0, isOpen: () => l.open, hide: () => { l.hidden++; l.open = false; } };
  return l;
}

test('按返回先關最上面那層：平面圖放大 → 裁切 → 燈箱 → 在哪 → 詳細資訊，都沒開才換頁籤', async () => {
  const { overlays, globals } = await load();
  const names = ['detail', 'where', 'lightbox', 'crop', 'findZoom']; // 故意倒著註冊，順序不看註冊先後
  const ls = Object.fromEntries(names.map(n => [n, layer(true)]));
  for (const n of names) overlays.registerOverlay(n, ls[n]);
  const navigated = [];
  overlays.bindOverlays(e => navigated.push(e.state));
  const closed = [];
  for (let i = 0; i < 5; i++) {
    globals.history.pushState({ x: i });
    globals.history.back();
    closed.push(names.find(n => ls[n].hidden && !closed.includes(n)));
  }
  assert.deepEqual(closed, ['findZoom', 'crop', 'lightbox', 'where', 'detail']);
  assert.deepEqual(navigated, []);
  globals.history.pushState({ bqNavigation: true, tab: 'mine' });
  globals.history.pushState({ bqNavigation: true, tab: 'info' });
  globals.history.back();
  assert.deepEqual(navigated, [{ bqNavigation: true, tab: 'mine' }]);
});

test('開一層記 { bqDetail: true }；關的時候有這筆就走上一頁，沒有就直接關', async () => {
  const { overlays, globals, calls } = await load();
  const detail = layer();
  overlays.registerOverlay('detail', detail);
  overlays.bindOverlays(() => assert.fail('有開著的層就不換頁籤'));
  overlays.pushOverlay('detail');
  detail.open = true;
  assert.deepEqual(plain(globals.history.state), { bqDetail: true });
  overlays.closeOverlay('detail');
  assert.equal(detail.hidden, 1, '上一頁觸發返回鍵處理，關掉詳細資訊');
  assert.deepEqual(calls.map(c => c[0]), ['push', 'back']);
  detail.open = true;
  overlays.closeOverlay('detail'); // 歷史紀錄已經不是這層（例如從在哪換過來）
  assert.equal(detail.hidden, 2);
  assert.deepEqual(calls.map(c => c[0]), ['push', 'back'], '沒有多走一次上一頁');
});

test('forgetOverlay 只換掉自己那層的歷史紀錄', async () => {
  const { overlays, globals } = await load();
  overlays.pushOverlay('where');
  overlays.forgetOverlay('detail');
  assert.deepEqual(plain(globals.history.state), { bqWhere: true });
  overlays.forgetOverlay('where');
  assert.equal(globals.history.state, null);
  assert.throws(() => overlays.pushOverlay('nope'), /沒有這一層/);
});

test('pushPage 先記好目前這頁再多一筆；backFrom 是自己這頁才走上一頁', async () => {
  const { overlays, globals, calls, entries } = await load();
  overlays.bindOverlays(() => {});
  overlays.pushPage({ bqNavigation: true, tab: 'walk' }, { bqNavigation: true, tab: 'info' });
  assert.deepEqual(plain(entries), [{ bqNavigation: true, tab: 'walk' }, { bqNavigation: true, tab: 'info' }]);
  let other = 0;
  overlays.backFrom(s => s?.infoPage, () => other++);
  assert.equal(other, 1);
  overlays.backFrom(s => s && s.bqNavigation, () => other++);
  assert.equal(other, 1);
  assert.equal(calls.at(-1)[0], 'back');
  assert.deepEqual(plain(globals.history.state), { bqNavigation: true, tab: 'walk' });
});

function keyEvent(key, shiftKey = false) {
  return { key, shiftKey, prevented: false, preventDefault() { this.prevented = true; } };
}
function items(document, n) {
  return Array.from({ length: n }, (_, i) => ({ i, opts: [], focus(o) { this.opts.push(o); document.activeElement = this; } }));
}

test('焦點圈：每次自己移到下一個，頭尾繞回；不是 Tab 或沒有按鈕就不管', async () => {
  const { overlays, document } = await load();
  const list = items(document, 3);
  document.activeElement = list[2];
  const e = keyEvent('Tab');
  overlays.trapFocus(e, list);
  assert.equal(document.activeElement, list[0]);
  assert.ok(e.prevented);
  assert.deepEqual(plain(list[0].opts), [{ preventScroll: true }]);
  overlays.trapFocus(keyEvent('Tab', true), list);
  assert.equal(document.activeElement, list[2]);
  document.activeElement = null; // 焦點在外面：往後到第一個
  overlays.trapFocus(keyEvent('Tab'), list);
  assert.equal(document.activeElement, list[0]);
  const esc = keyEvent('Escape');
  overlays.trapFocus(esc, list);
  assert.equal(esc.prevented, false);
  const empty = keyEvent('Tab');
  overlays.trapFocus(empty, []);
  assert.equal(empty.prevented, false);
  overlays.trapFocus(keyEvent('Tab'), list, { preventScroll: false });
  assert.deepEqual(list[1].opts, [undefined], '圖鑑沿用不帶 preventScroll 的 focus()');
});

test('焦點圈 edgesOnly：中間交給瀏覽器，只在頭尾或焦點在外面時繞回（詳細資訊）', async () => {
  const { overlays, document } = await load();
  const list = items(document, 3);
  document.activeElement = list[1];
  const middle = keyEvent('Tab');
  overlays.trapFocus(middle, list, { edgesOnly: true });
  assert.equal(middle.prevented, false);
  assert.equal(document.activeElement, list[1]);
  document.activeElement = list[2];
  overlays.trapFocus(keyEvent('Tab'), list, { edgesOnly: true });
  assert.equal(document.activeElement, list[0]);
  overlays.trapFocus(keyEvent('Tab', true), list, { edgesOnly: true });
  assert.equal(document.activeElement, list[2]);
  document.activeElement = null;
  overlays.trapFocus(keyEvent('Tab', true), list, { edgesOnly: true });
  assert.equal(document.activeElement, list[2]);
});

test('網址（ADR 0024）：覆蓋層帶自己的網址，已經是這層就不再多一筆；換內容只換網址', async () => {
  const { overlays, globals, urls, entries } = await load();
  overlays.registerOverlay('detail', layer());
  overlays.pushOverlay('detail', '#dog/1');
  overlays.replaceOverlayUrl('detail', '#dog/2');
  overlays.pushOverlay('detail', '#dog/2');
  assert.deepEqual(urls, [['push', '#dog/1'], ['replace', '#dog/2'], ['replace', '#dog/2']]);
  assert.equal(entries.length, 2, '只多一筆');
  assert.equal(overlays.overlayOnTop(), true);
  overlays.pushOverlay('lightbox');
  assert.deepEqual(urls.at(-1), ['push', undefined], '燈箱不帶網址，維持底下那一頁');
  globals.history.replaceState({ bqNavigation: true, tab: 'walk' });
  assert.equal(overlays.overlayOnTop(), false);
});

test('網址（ADR 0024）：頁面紀錄照狀態算網址；打開網頁那一筆留著 bqLanding，網站裡的「回…」不走出網站', async () => {
  const { overlays, globals, urls, entries, calls } = await load();
  overlays.bindOverlays(() => {}, s => (s.tab ? `#${s.tab}${s.infoPage ? '/' + s.infoPage : ''}` : undefined));
  globals.history.replaceState({ bqNavigation: true, tab: 'info', infoPage: 'stay', bqLanding: true });
  let otherwise = 0;
  overlays.backFrom(s => s.infoPage, () => otherwise++);
  assert.equal(otherwise, 1, 'landing 那筆不按上一頁');
  assert(!calls.some(c => c[0] === 'back'));
  overlays.pushPage({ bqNavigation: true, tab: 'info', infoPage: '' }, { ...globals.history.state, infoPage: 'departures' });
  assert.deepEqual(plain(entries), [
    { bqNavigation: true, tab: 'info', infoPage: '', bqLanding: true },
    { bqNavigation: true, tab: 'info', infoPage: 'departures' },
  ], '目前這筆仍是 landing，新的那筆不是');
  assert.deepEqual(urls.slice(-2), [['replace', '#info'], ['push', '#info/departures']]);
  overlays.backFrom(s => s.infoPage, () => otherwise++);
  assert.equal(otherwise, 1);
  assert(calls.some(c => c[0] === 'back'), '網站自己多的那筆照常按上一頁');
});

test('網址寫不進去（srcdoc 這類文件）時照樣記狀態', async () => {
  const { overlays, globals, entries } = await load();
  const push = globals.history.pushState;
  globals.history.pushState = (state, title, url) => { if (url) throw new Error('SecurityError'); push(state, title, url); };
  overlays.registerOverlay('detail', layer());
  overlays.pushOverlay('detail', '#dog/1');
  assert.deepEqual(plain(entries.at(-1)), { bqDetail: true });
});
