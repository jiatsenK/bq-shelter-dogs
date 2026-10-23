// 手機資料的儲存邊界；鍵名與內容沿用既有格式（ADR 0001、#479）。
const BQStore = (() => {
  const keys = Object.freeze({
    walkerCodes: 'bq-walker-codes',
    walkedToday: 'bq-walked-today',
    favs: 'bq-favs',
    favsSync: 'bq-favs-sync',
    walkerName: 'bq-walker-name',
    sheetWrites: 'bq-sheet-writes',
    companions: 'bq-companions',
    walkWith: 'bq-walk-with',
    walkRequests: 'bq-walk-requests',
    walkFav: 'bq-walk-fav',
    walkView: 'bq-walk-view',
    onboarded: 'bq-onboarded',
    nameLater: 'bq-name-later',
    zukan: 'bq-zukan',
    websiteUpdates: 'bq-website-updates',
    editsCache: 'bq-edits-cache',
  });
  function create(storage) {
    const memory = new Map();
    const pending = new Set(); // 寫不進去的鍵先用記憶體，避免仍可讀的舊值蓋掉它。
    function get(key) {
      if (!pending.has(key)) {
        try {
          if (storage) {
            const value = storage.getItem(key);
            memory.set(key, value);
            return value;
          }
        } catch { /* 讀不到時使用這次開著網頁期間的紀錄 */ }
      }
      return memory.get(key) ?? null;
    }
    function save(key, value) {
      memory.set(key, value);
      pending.add(key);
      try {
        if (!storage) return false;
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
        pending.delete(key);
        return true;
      } catch { return false; }
    }
    const set = (key, value) => save(key, String(value));
    const remove = key => save(key, null);
    const readJson = (key, fallback = null) => {
      try { const raw = get(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
    };
    const writeJson = (key, value) => set(key, JSON.stringify(value));
    return { get, set, remove, readJson, writeJson };
  }
  let storage = null;
  try { storage = globalThis.localStorage; } catch { /* 無痕模式可能連取得儲存空間都不允許 */ }
  return { ...create(storage), create, keys };
})();
