import { BQStore } from './store.js';
import { createWalkRegistration } from './walk-registration.js';

// #480：D1 登記流程與手機上的同行人紀錄；不讀取畫面，由呼叫端呈現結果。
const BQWalks = (() => {
  function createRecords(deps) {
    const { store, dates } = deps;
    const keyOf = deps.key;
    const { companions: COMPANIONS_KEY, walkWith: WALK_WITH_KEY } = BQStore.keys;
    const COMPANIONS_MAX = 8;
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
    return { loadCompanions, loadWalkWith, addWalkWith, clearWalkWith };
  }
  function create(deps) {
    const dates = deps.dates, api = deps.api, records = deps.records;
    const registration = createWalkRegistration({
      ...deps,
      readRequests: () => deps.store().readJson(BQStore.keys.walkRequests) || {},
      saveRequests: items => {
        const store = deps.store();
        const persisted = store.writeJson(BQStore.keys.walkRequests, items);
        if (!persisted || JSON.stringify(store.readJson(BQStore.keys.walkRequests)) !== JSON.stringify(items)) throw new Error('無法保留登記識別，尚未送出');
      },
      lookupRequest: id => fetchStatus(signal => api.walkResult(id, { signal })),
      send: async payload => {
        if (!deps.enabled() || deps.getWriteState() === 'off' || (payload.action !== 'undo' && !payload.walker)) return { off: true };
        if (deps.offline?.()) return { notSent: true, error: '沒網路' };
        const r = await api.walk(payload);
        if (r.error === 'network') throw new Error(r.message);
        const out = r.data;
        if (r.status === 503 && out?.code === 'off') { deps.setWriteState('off'); return { off: true }; }
        if (!r.ok || !out?.ok) return { ...out, ok: false, httpStatus: r.status, error: out?.error || `HTTP ${r.status}` };
        deps.setWriteState('on');
        return out;
      },
      apply: (dogs, day, restored) => {
        if (restored.length) records().clearWalkWith(restored, dates.parseYmd(day));
        deps.apply(dogs, day, restored);
      },
    });
    async function loadToday(getDogs) {
      const read = registration.beginRead();
      try {
        if (!deps.enabled()) return false;
        const payload = await fetchStatus(signal => api.todayWalks({ signal }));
        if (payload?.source !== 'd1' || !Array.isArray(payload.walks)) return false;
        registration.receiveToday(payload, getDogs(), read);
        return true;
      } catch { return false; } // 抓不到就維持現況，下次再試。
    }
    function walkCandidates(dogs) {
      return dogs.filter((dog, i) => dog && deps.key(dog) && !registration.state(dog).mine && !registration.pending(dog) && dogs.indexOf(dog) === i);
    }
    async function startWalk(dogs, retry = null) {
      const result = await (retry ? registration.retry(retry) : registration.register(dogs));
      const failed = result.rows.filter(r => r.status !== 'written').map(r => r.dog);
      return Object.assign(result, { failed, message: registrationText(result) });
    }
    async function addCompanions(dogs, names, retry = null) {
      const result = await (retry ? registration.retry(retry) : registration.register(dogs, { walker: names.join('、') }));
      records().addWalkWith(result.successful, names);
      return Object.assign(result, { message: result.successful.length === result.rows.length ? `已加上 ${names.join('、')}` : registrationText(result) });
    }
    return { ...registration, loadToday, walkCandidates, startWalk, addCompanions };
  }
  // #643：分清楚「確定沒登記到」（沒送出、被拒絕）和「還不知道有沒有登記到」（送出了沒收到確認），寫出原因和下一步
  function registrationText(result) {
    const parts = [];
    if (result.successful.length) parts.push(`已登記 ${result.successful.length} 隻`);
    const names = rows => rows.map(r => r.dog.name).join('、');
    const why = rows => { const e = [...new Set(rows.map(r => r.error).filter(Boolean))].join('、'); return e ? `（${e}）` : ''; };
    const missed = result.rows.filter(r => r.status === 'notSent');
    const unknown = result.rows.filter(r => r.status === 'unknown');
    const changed = result.rows.filter(r => r.status === 'changed');
    if (missed.length) parts.push(`${names(missed)} 沒登記到${why(missed)}，${missed.every(r => r.error === '沒網路') ? '有訊號再按一次' : '再按一次'}`);
    if (unknown.length) parts.push(`${names(unknown)} 還不知道有沒有登記到${why(unknown)}，按「再試一次」確認`);
    if (changed.length) parts.push(`${names(changed)} 沒登記到：紀錄已經被改過，沒有蓋掉別人的紀錄`);
    return parts.join('；');
  }
  // 全部復原成功只換提示條文字；有衝突或未確認才另外說明
  function undoFeedback(result) {
    const changed = result.rows.filter(r => r.status === 'changed').map(r => r.dog);
    const left = result.rows.filter(r => !['restored', 'changed'].includes(r.status)).map(r => r.dog);
    const parts = [];
    if (result.successful.length) parts.push(`已復原 ${result.successful.length} 隻`);
    if (changed.length) parts.push(`${changed.map(d => d.name).join('、')} 紀錄已經被改過，沒有蓋掉別人的紀錄`);
    if (left.length) parts.push(`${left.map(d => d.name).join('、')} 尚未確認${result.error ? '：' + result.error : ''}，尚未復原`);
    return { text: parts.join('；'), show: !!changed.length || !!left.length };
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

export { BQWalks };
