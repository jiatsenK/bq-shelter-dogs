// #480：寫試算表流程與手機紀錄；不讀取畫面，由呼叫端呈現結果。
const BQWalks = (() => {
  function createRecords(deps) {
    const { store, dates } = deps;
    const keyOf = deps.key;
    const { walkedToday: WALKED_KEY, sheetWrites: SHEET_WRITES_KEY, companions: COMPANIONS_KEY, walkWith: WALK_WITH_KEY } = BQStore.keys;
    const COMPANIONS_MAX = 8;
    let walkedMemory = null, sheetWritesMemory = null;
    function loadWalkedIds(today = new Date()) {
      let data = walkedMemory;
      try {
        data = store().readJson(WALKED_KEY, data);
      } catch (e) { /* 讀不到就用這次開網頁期間的紀錄 */ }
      if (!data || data.date !== dates.localDateKey(today) || !Array.isArray(data.ids)) return [];
      return data.ids.map(String);
    }
    function saveWalkedIds(ids, today = new Date()) {
      walkedMemory = { date: dates.localDateKey(today), ids: [...ids] };
      store().writeJson(WALKED_KEY, walkedMemory);
    }
    function recordWalked(dogs, on, today = new Date()) {
      const before = loadWalkedIds(today);
      const ids = [...before];
      const changed = [];
      for (const dog of dogs) {
        const key = dog && keyOf(dog);
        if (!key || ids.includes(key) === on || changed.includes(dog)) continue;
        if (on) ids.unshift(key);
        else ids.splice(ids.indexOf(key), 1);
        changed.push(dog);
      }
      if (changed.length) saveWalkedIds(ids, today);
      return { changed, undo: () => saveWalkedIds(before, today) };
    }
    function loadCompanions() {
      const v = store().readJson(COMPANIONS_KEY);
      return Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, COMPANIONS_MAX) : [];
    }
    function loadWalkWith(today = new Date()) {
      const v = store().readJson(WALK_WITH_KEY);
      return v && v.date === dates.localDateKey(today) && v.map && typeof v.map === 'object' ? v.map : {};
    }
    function addWalkWith(dogs, names, today = new Date()) {
      const map = loadWalkWith(today);
      for (const d of dogs) { const k = keyOf(d); if (k) map[k] = [...new Set([...(map[k] || []), ...names])]; }
      store().writeJson(WALK_WITH_KEY, { date: dates.localDateKey(today), map });
      store().writeJson(COMPANIONS_KEY, [...new Set([...names, ...loadCompanions()])].slice(0, COMPANIONS_MAX));
    }
    function clearWalkWith(dogs, today = new Date()) {
      const map = loadWalkWith(today);
      for (const d of dogs) delete map[keyOf(d)];
      store().writeJson(WALK_WITH_KEY, { date: dates.localDateKey(today), map });
    }
    function loadSheetWrites(today = new Date()) {
      let data = sheetWritesMemory;
      try {
        data = store().readJson(SHEET_WRITES_KEY, data);
      } catch (e) { /* 讀不到就用記憶體裡的 */ }
      return data && data.date === dates.localDateKey(today) && data.items && typeof data.items === 'object' ? { ...data.items } : {};
    }
    function saveSheetWrites(items, today = new Date()) {
      sheetWritesMemory = { date: dates.localDateKey(today), items };
      try {
        if (store()) store().writeJson(SHEET_WRITES_KEY, sheetWritesMemory);
      } catch (e) { /* 存不了就只記在記憶體 */ }
    }
    return { loadWalkedIds, saveWalkedIds, recordWalked, loadCompanions, loadWalkWith, addWalkWith, clearWalkWith, loadSheetWrites, saveSheetWrites };
  }
  function create(deps) {
    const dates = deps.dates, api = deps.api, records = deps.records;
    const registration = createWalkRegistration({
      ...deps,
      get d1() { return deps.d1; },
      local: day => records().loadWalkedIds(dates.parseYmd(day)),
      saveLocal: (ids, day) => records().saveWalkedIds(ids, dates.parseYmd(day)),
      companions: (dog, day) => records().loadWalkWith(dates.parseYmd(day))[deps.key(dog)] || [],
      read: day => records().loadSheetWrites(dates.parseYmd(day)),
      save: (items, day) => records().saveSheetWrites(items, dates.parseYmd(day)),
      readRequests: () => deps.store().readJson(BQStore.keys.walkRequests) || {},
      saveRequests: items => {
        const store = deps.store();
        const persisted = store.writeJson(BQStore.keys.walkRequests, items);
        if (!persisted || JSON.stringify(store.readJson(BQStore.keys.walkRequests)) !== JSON.stringify(items)) throw new Error('無法保留登記識別，尚未送出');
      },
      lookupRequest: id => fetchStatus(signal => api.walkResult(id, { signal })),
      send: async payload => {
        if (!deps.enabled() || deps.getWriteState() === 'off' || (payload.action !== 'undo' && !payload.walker)) return { off: true };
        const r = await api.walk(payload);
        if (r.error === 'network') throw new Error(r.message);
        const out = r.data;
        if (r.status === 503 && out?.code === 'off') { deps.setWriteState('off'); return { off: true }; }
        if (!r.ok || !out?.ok) return { ...out, ok: false, httpStatus: r.status, error: out?.error || `HTTP ${r.status}` };
        deps.setWriteState('on');
        return out;
      },
      apply: (dogs, items, day, restored) => {
        if (restored.length) records().clearWalkWith(restored, dates.parseYmd(day));
        deps.apply(dogs, items, day, restored);
      },
    });
    async function write(dogs, on, walker = null, expected = undefined) {
      if (!deps.enabled() || deps.getWriteState() === 'off' || (on && !walker && !deps.walker())) return { value: null };
      const result = await (on ? registration.register(dogs, { walker, expected }) : registration.undo(dogs));
      if (result.off || !result.rows.length) return { value: null };
      const failed = result.rows.filter(r => !['written', 'already', 'restored'].includes(r.status));
      return { value: !failed.length, result,
        failure: failed.length ? failed.some(r => r.status === 'unknown') ? 'network' : 'missed' : '',
        message: failed.length ? on || failed.some(r => r.status === 'changed') ? registrationText(result) : '試算表沒改回來' : '' };
    }
    async function loadToday(getDogs) {
      const read = registration.beginRead();
      try {
        if (!deps.enabled()) return false;
        const payload = await fetchStatus(signal => api.todayWalks({ d1: deps.d1, signal }));
        if (deps.d1 && (payload?.source !== 'd1' || !Array.isArray(payload.walks))) return false;
        registration.receiveToday(payload, getDogs(), read);
        return true;
      } catch { return false; } // 抓不到就維持現況，下次再試。
    }
    function walkCandidates(dogs) {
      return dogs.filter((dog, i) => dog && deps.key(dog) && !registration.state(dog).mine && !registration.pending(dog) && dogs.indexOf(dog) === i);
    }
    async function startWalk(dogs, retry = null) {
      if (!deps.d1) records().recordWalked(dogs, true, dates.parseYmd(deps.date()));
      const result = await (retry ? registration.retry(retry) : registration.register(dogs));
      if (result.off) return result; // 保留僅記手機的備援。
      const failed = result.rows.filter(r => !['written', 'already'].includes(r.status)).map(r => r.dog);
      records().recordWalked(failed, false, dates.parseYmd(deps.date()));
      return Object.assign(result, { failed, message: registrationText(result) });
    }
    async function addCompanions(dogs, names, retry = null) {
      const result = await (retry ? registration.retry(retry) : registration.register(dogs, { walker: names.join('、') }));
      records().addWalkWith(result.successful, names);
      return Object.assign(result, { message: result.successful.length === result.rows.length && !result.off ? `已加上 ${names.join('、')}` : registrationText(result) });
    }
    return { ...registration, write, loadToday, walkCandidates, startWalk, addCompanions };
  }
  function registrationText(result) {
    const parts = [];
    if (result.successful.length) parts.push(`已登記 ${result.successful.length} 隻`);
    const failed = result.rows.filter(r => !['written', 'already'].includes(r.status));
    if (failed.length) {
      parts.push('未全部登記成功');
      const unknown = failed.filter(r => r.status === 'unknown');
      const missing = failed.filter(r => ['notFound', 'missing'].includes(r.status));
      const changed = failed.filter(r => r.status === 'changed');
      if (unknown.length) parts.push(`${unknown.map(r => r.dog.name).join('、')} 尚未確認登記結果${result.error ? '（' + result.error + '）' : ''}`);
      if (missing.length) parts.push(`試算表找不到 ${missing.map(r => r.dog.name).join('、')}，請自己填`);
      if (changed.length) parts.push(`${changed.map(r => r.dog.name).join('、')} ${result.source === 'd1' ? '紀錄' : '在試算表'}已經被改過，沒有蓋掉別人的紀錄`);
      if (result.off) parts.push('目前無法寫入試算表，尚未登記');
    }
    return parts.join('；');
  }
  function undoFeedback(result) {
    const changed = result.rows.filter(r => r.status === 'changed').map(r => r.dog);
    const left = result.rows.filter(r => !['restored', 'changed'].includes(r.status)).map(r => r.dog);
    const parts = [];
    const d1 = result.source === 'd1';
    if (result.successful.length) parts.push(d1 ? `已復原 ${result.successful.length} 隻` : `已從試算表復原 ${result.successful.length} 隻`);
    if (changed.length) parts.push(`${changed.map(d => d.name).join('、')} ${d1 ? '紀錄' : '在試算表'}已經被改過，沒有蓋掉別人的紀錄`);
    if (left.length) parts.push(`${left.map(d => d.name).join('、')} ${d1 ? '尚未確認' : '試算表沒改回來'}${result.error ? '：' + result.error : ''}，尚未復原`);
    const text = parts.join('；');
    return { text, show: !d1 || !!changed.length || !!left.length };
  }
  // 包含讀取回應內容的時間；沿用原本 8 秒中止規則。
  async function fetchStatus(call) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const r = await call(controller.signal);
      if (r.error === 'http') throw new Error(`HTTP ${r.status}`);
      if (r.error) throw new Error(r.message);
      return r.data;
    } finally { clearTimeout(timeout); }
  }
  return { createRecords, create, registrationText, undoFeedback, fetchStatus };
})();
