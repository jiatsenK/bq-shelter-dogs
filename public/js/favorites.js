import { BQStore } from './store.js';
import { appState } from './page-state.js';
import { WALKER_CODES_KEY, loadMyCodes, loadWalkerName, parseMyWalks, render, renderDetail, saveWalkerName, walkKey } from './app.js';
import { BQApi } from './api.js';
import { BQWelcome } from './welcome.js';
import { BQWalkUI } from './walk-ui.js';

// 我的常溜同步：每個實例保留自己的快取與待送佇列，只公開 BQFavorites。
// 執行時使用 app 的手機資料、身分及重畫入口；API 與儲存格式維持不變。
const BQFavorites = (() => {
  function create() {
    // ── 我的常溜（#267）：逐隻增刪，絕不把手機上的舊整份清單蓋到 D1 ──
    const FAVS_KEY = BQStore.keys.favs;
    const FAV_SYNC_KEY = BQStore.keys.favsSync;
    let favSyncMemory = null;
    let favSyncQueue = Promise.resolve();
    function favState() {
      if (!favSyncMemory) {
        const saved = appState.phoneStore.readJson(FAV_SYNC_KEY);
        favSyncMemory = saved && saved.v === 1 ? saved : { v: 1, aliases: {}, books: {}, pending: [] };
      }
      return favSyncMemory;
    }
    function saveFavState() { appState.phoneStore.writeJson(FAV_SYNC_KEY, favState()); }
    function localFavs() { const v = appState.phoneStore.readJson(FAVS_KEY); return Array.isArray(v) ? v.map(String) : []; }
    function favoriteIds() {
      const state = favState(), codes = loadMyCodes();
      const ids = new Set(state.books[codes.join(',')] || []);
      for (const op of state.pending) {
        if (!op.codes.some(c => codes.includes(c))) continue;
        if (op.on) ids.add(op.dogId); else ids.delete(op.dogId);
      }
      return ids;
    }
    function loadFavs() {
      const ids = favoriteIds(), aliases = favState().aliases;
      return [...new Set([...localFavs(), ...appState.allDogs.filter(d => ids.has(aliases[walkKey(d)])).map(walkKey)])];
    }
    function isFav(dog) { const k = walkKey(dog); return !!k && loadFavs().includes(k); }
    function toggleFav(dog) {
      const k = walkKey(dog);
      if (!k) return;
      const on = !isFav(dog), codes = loadMyCodes(), state = favState();
      state.localVersions ||= {};
      state.localVersions[k] = (state.localVersions[k] || 0) + 1;
      saveFavState();
      const dogId = state.aliases[k];
      if (codes.length && dogId) {
        // 讀取合併所有名字；取消時也要取消各個名字底下的這隻狗。
        state.pending.push({ codes: [codes[0]], dogId, on });
        appState.phoneStore.writeJson(FAVS_KEY, localFavs().filter(x => state.aliases[x] !== dogId && x !== k));
        saveFavState();
      } else {
        appState.phoneStore.writeJson(FAVS_KEY, on ? [k, ...localFavs()] : localFavs().filter(x => x !== k));
      }
      syncFavs();
    }

    // 核心只操作收藏狀態；儲存、傳輸由呼叫者提供，不依賴畫面或瀏覽器。
    async function reconcileFavorites(state, codes, io) {
      const out = await io.read(codes);
      if (io.codes().join(',') !== codes.join(',')) return;
      // 只收到常溜的狗和問到的舊鍵（#406）；還沒送出的操作用到的對照留著
      const waiting = new Set(state.pending.map(op => op.dogId));
      state.aliases = { ...Object.fromEntries(Object.entries(state.aliases).filter(([, id]) => waiting.has(id))), ...out.aliases };
      const bookKey = codes.join(',');
      state.books[bookKey] = out.ids;
      for (const key of io.local()) {
        const dogId = state.aliases[key];
        if (!dogId) continue;
        let op = state.pending.slice().reverse().find(op => op.dogId === dogId && op.codes.includes(codes[0]));
        if (!op || !op.on) {
          op = { codes: [codes[0]], dogId, on: true };
          state.pending.push(op);
        }
        op.legacy ||= {};
        op.legacy[key] = state.localVersions?.[key] || 0;
      }
      io.save();
      while (state.pending.length) {
        const op = state.pending[0];
        await io.write({ codes: op.codes, dogId: op.dogId, on: op.on });
        // 只清除此筆搬移的原始收藏；等待期間新按的訪客收藏保留。
        io.removeLegacy(key => Object.hasOwn(op.legacy || {}, key)
          && (state.localVersions?.[key] || 0) === op.legacy[key]);
        state.pending.shift();
        if (op.codes.some(c => codes.includes(c))) {
          const ids = new Set(state.books[bookKey]);
          if (op.on) ids.add(op.dogId); else ids.delete(op.dogId);
          state.books[bookKey] = [...ids];
        }
        io.save();
      }
    }

    async function favoriteRequest(codes, op) {
      // 手機還有舊格式（編號／狗名）常溜時才帶 key，讓 Worker 換成狗 ID
      const r = op ? await BQApi.saveFavorite({ ...op, codes: op.codes.slice(0, 1) })
        : await BQApi.favorites('codes=' + encodeURIComponent(codes[0]) + localFavs().map(k => '&key=' + encodeURIComponent(k)).join(''));
      if (r.error === 'network' || !r.data) throw new Error(r.message);
      const out = r.data;
      if (!r.ok || !out.ok || (!op && (!Array.isArray(out.ids) || !out.aliases))) throw new Error('常溜同步失敗');
      return out;
    }

    function syncFavs() {
      // 串行保留點擊順序；失敗的操作下次打開或恢復連線再試。
      favSyncQueue = favSyncQueue.then(async () => {
        let codes = loadMyCodes();
        if (!codes.length || !appState.UPLOAD_URL) return;
        const original = codes.join(','), name = loadWalkerName();
        if (name) {
          const out = await BQWelcome.request('', { name });
          if (loadMyCodes().join(',') !== original || loadWalkerName() !== name) return;
          saveWalkerName(out.identity.name);
          appState.walkerCodesMemory = out.identity.codes;
          try { appState.phoneStore?.writeJson(WALKER_CODES_KEY, out.identity.codes); } catch (e) { /* 本次仍可使用 */ }
          codes = out.identity.codes;
          appState.myWalks = appState.walksData ? parseMyWalks(appState.walksData, codes) : [];
        }
        await reconcileFavorites(favState(), codes, {
          codes: loadMyCodes, local: localFavs, save: saveFavState,
          read: codes => favoriteRequest(codes), write: op => favoriteRequest(null, op),
          removeLegacy: matches => appState.phoneStore.writeJson(FAVS_KEY, localFavs().filter(key => !matches(key))),
        });
        if (loadMyCodes().join(',') === codes.join(',')) { render(); renderDetail(); }
      }).catch(() => {
        if (loadMyCodes().length) BQWalkUI.showToast('常溜暫存在這支手機，連線恢復後會再同步');
      });
      return favSyncQueue;
    }

    return { loadFavs, isFav, toggleFav, syncFavs, whenIdle: () => favSyncQueue };
  }
  return { create };
})();

export { BQFavorites };
