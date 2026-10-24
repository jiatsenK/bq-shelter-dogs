

// 後端用戶端（#478，ADR 0017）：網頁呼叫 /api 只經過這裡，每個端點一個函式。
// 每個函式都回同一個形狀，不會丟錯：{ ok, status, data, error, message }
// - error：null 成功；'network' 連不上（含逾時中斷，status 0）；'http' 非 2xx；'format' 2xx 但不是 JSON
// - data：讀到的 JSON；非 2xx 也帶回伺服器說的原因（例如 { ok: false, error }），讀不到是 null
// - message：連不上或格式壞時瀏覽器給的原文，沿用舊畫面用它當錯誤訊息的地方
// 測試替換這裡的函式來假裝後端回應，不替換瀏覽器的 fetch
const BQApi = (() => {
  const JSON_TYPE = { 'Content-Type': 'application/json' };
  // 網站和 Worker 是同一個網址（#125），API 在 /api 底下；沒有網址（Node 測試、file://）回空字串，呼叫端據此關掉寫入
  const baseFor = loc => (loc && loc.origin && loc.origin !== 'null' ? `${loc.origin}/api` : '');
  const base = () => baseFor(globalThis.location);
  // 沒有網址時照舊用相對路徑 api/（srcdoc、file:// 跟著頁面的 base 走）
  const root = () => base() || 'api';
  const enc = encodeURIComponent;

  async function settle(pending) {
    let res;
    try { res = await pending; } catch (e) {
      const raw = (e && e.message) || String(e);
      // Safari 斷線是英文 Load failed，畫面上顯示中文（K 2026-10-23）
      return { ok: false, status: 0, data: null, error: 'network', message: raw === 'Load failed' ? '網頁載入失敗' : raw };
    }
    let data = null, message = '';
    try { data = await res.json(); } catch (e) { message = (e && e.message) || String(e); }
    if (!res.ok) return { ok: false, status: res.status, data, error: 'http', message };
    if (message) return { ok: false, status: res.status, data: null, error: 'format', message };
    return { ok: true, status: res.status, data, error: null, message: '' };
  }
  const get = (path, init) => settle(fetch(root() + path, init));
  const send = (method, path, body, init) => settle(fetch(root() + path, { method, headers: JSON_TYPE, body: JSON.stringify(body), ...init }));

  // 主頁 <head> 先發出的 api/dogs（index.html）在這裡接手，只用一次
  function dogs({ signal, cache = 'no-cache' } = {}) {
    const early = globalThis.window && window.__dogsEarly;
    if (early) window.__dogsEarly = null;
    return settle(early || fetch(root() + '/dogs', { cache, signal }));
  }

  return {
    base,
    baseFor,
    settle, // 把 fetch 的回應（或丟出的錯）整理成上面的形狀；測試的假後端也用它
    dogs,
    walks: () => get('/walks', { cache: 'no-cache' }),
    // 網址帶版本號，瀏覽器快取過就不再下載（ADR 0013）
    walksYear: (year, ver) => get(`/walks?year=${year}&v=${enc(ver)}`),
    myDogs: codes => send('POST', '/walks/mine', { codes }),
    todayWalks: ({ d1, signal } = {}) => get(`/today${d1 ? '?source=d1' : ''}`, { cache: 'no-cache', signal }),
    walkResult: (requestId, { signal } = {}) => get(`/walk/result?requestId=${enc(requestId)}`, { cache: 'no-cache', signal }),
    walk: payload => send('POST', '/walk', payload),
    walkers: () => get('/walkers', { cache: 'no-cache' }),
    walkerCodes: names => send('POST', '/walker-code', { names }),
    identity: (action, body) => send('POST', `/identity${action}`, body),
    favorites: query => get(`/favorites?${query}`, { cache: 'no-store' }),
    saveFavorite: op => send('PUT', '/favorites', op),
    openedCards: code => get(`/cards/opened?codes=${enc(code)}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) }),
    saveOpenedCards: (codes, ids) => send('PUT', '/cards/opened', { codes, ids }, { signal: AbortSignal.timeout(15000) }),
    rest: ({ signal } = {}) => get('/rest', { cache: 'no-cache', signal }),
    saveRest: (id, body) => send('PUT', `/rest/${enc(id)}`, body),
    saveFormer: (id, method, body) => send(method, `/former/${enc(id)}`, body),
    saveIntro: (id, body) => send('PUT', `/intro/${enc(id)}`, body),
    saveStays: (id, body) => send('PUT', `/stays/${enc(id)}`, body),
    saveFixedCare: (key, body) => send('PUT', `/fixed-care/${enc(key)}`, body),
    uploadPhoto: (id, blob, headers) => settle(fetch(`${root()}/photos/${enc(id)}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', ...headers }, body: blob })),
    saveGroup: body => send('POST', '/groups', body),
    activities: () => get('/activities', { cache: 'no-cache' }),
    saveActivity: (id, method, body) => send(method, `/activities${id ? `/${enc(id)}` : ''}`, body),
    departures: () => get('/departures/index', { cache: 'no-cache' }),
    departureYear: (year, ver) => get(`/departures?year=${enc(year)}&v=${enc(ver)}`),
    departedCards: () => get('/departed-cards', { cache: 'no-cache' }),
    edits: () => get('/edits?limit=200', { cache: 'no-cache' }),
  };
})();

export { BQApi };
