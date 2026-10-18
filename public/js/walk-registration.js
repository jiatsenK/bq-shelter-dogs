// #396：登記、追加同行人、復原共用規則；畫面與測試走同一個介面。
(function (root) {
  function createWalkRegistration(deps) {
    let queue = Promise.resolve();
    const pending = new Map(), requests = new WeakMap();
    const isSuccess = status => ['written', 'already', 'restored'].includes(status);
    const isRetryable = status => ['unknown', 'notSent'].includes(status);
    function dateKey(value) {
      const match = String(value || '').match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
      return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : '';
    }
    const isMine = (current, day, me) => current.date === day && deps.split(current.walker).map(deps.canonical).includes(deps.canonical(me));
    function canUndo(dog, day = deps.date()) {
      const item = deps.read(day)[deps.key(dog)];
      return !!(item && item.prev && item.wrote && (!item.current || item.current.walker === item.wrote.walker));
    }
    function register(dogs, options = {}) {
      const day = deps.date(), me = deps.walker();
      const seen = new Set();
      const entries = dogs.filter(d => d && deps.key(d) && !seen.has(deps.key(d)) && seen.add(deps.key(d)))
        .map(dog => ({ dog, key: deps.key(dog), id: dog.id || '', name: dog.name,
          walker: options.walker || deps.alias(dog) || me }));
      return enqueue({ entries, day, me, action: options.expected === undefined ? 'walk' : 'edit', expected: options.expected });
    }
    function undo(dogs) {
      const seen = new Set();
      return enqueue({ entries: dogs.filter(d => d && !seen.has(deps.key(d)) && seen.add(deps.key(d)))
        .map(dog => ({ dog, key: deps.key(dog), id: dog.id || '', name: dog.name })),
        day: deps.date(), me: deps.walker(), action: 'undo' });
    }
    function enqueue(request) {
      request.entries.forEach(e => pending.set(e.key, (pending.get(e.key) || 0) + 1));
      const work = queue.then(() => execute(request));
      const finished = work.finally(() => request.entries.forEach(e => {
        const n = pending.get(e.key) - 1;
        if (n) pending.set(e.key, n); else pending.delete(e.key);
      }));
      queue = finished.catch(() => {});
      return finished;
    }
    async function execute(request) {
      const { entries, day, me, action, expected } = request;
      const groups = [];
      for (const entry of entries) {
        let group = groups.find(g => g.walker === entry.walker);
        if (!group) groups.push(group = { walker: entry.walker, entries: [] });
        group.entries.push(entry);
      }
      const statuses = new Map();
      let error = '', off = false;
      for (const group of groups) {
        const records = deps.read(day);
        const sendable = action === 'undo' ? group.entries.filter(e => canUndo(e.dog, day)) : group.entries;
        group.entries.filter(e => !sendable.includes(e)).forEach(e => statuses.set(e.key, 'changed'));
        if (!sendable.length) continue;
        const payload = { action, ...(action === 'undo' ? {} : { walker: group.walker }), dogs: sendable.map(e => {
          if (action === 'undo') {
            // 首次真正送出時才取得快照（可能須等前筆登記），重試不讀後來的內容。
            const item = e.undo || (e.undo = structuredClone(records[e.key]));
            return { id: e.id, name: e.name, prev: structuredClone(item.prev), wrote: structuredClone(item.wrote) };
          }
          return { id: e.id, name: e.name, ...(expected === undefined ? {} : { expected }) };
        }) };
        let out;
        try { out = await deps.send(payload); }
        catch { out = { ok: false, error: '網路不通' }; }
        out ||= { ok: false };
        error = out.error || error;
        off ||= !!out.off;
        const updated = { ...deps.read(day) }, confirmed = [];
        for (const e of sendable) {
          // 一狗必須恰有一筆可辨識結果；缺漏、重複或不合法回應均不能宣稱成功。
          const matches = out.ok && Array.isArray(out.results) ? out.results.filter(r => r && (r.id || '') === e.id && r.name === e.name) : [];
          let raw = matches.length === 1 ? matches[0] : null;
          if (raw && ['written', 'already'].includes(raw.status) && typeof (raw.wrote?.walker ?? raw.current?.walker) !== 'string') raw = null;
          const allowed = action === 'undo' ? ['restored', 'changed', 'notFound', 'missing', 'badAction'] : ['written', 'already', 'changed', 'notFound', 'missing', 'badAction'];
          const status = out.off ? 'notSent' : raw && allowed.includes(raw.status) ? raw.status : 'unknown';
          statuses.set(e.key, status);
          const old = updated[e.key];
          if (status === 'written' || status === 'already') {
            const current = { date: dateKey(out.today || day), walker: raw.wrote?.walker ?? raw.current?.walker ?? '' };
            updated[e.key] = { id: e.id, name: e.name, prev: expected !== undefined ? raw.prev : old?.prev || raw.prev,
              wrote: raw.wrote || old?.wrote, current,
              mine: isMine(current, day, me) };
          } else if (status === 'restored' && old) {
            const date = old.prev.date || {};
            const current = { date: dateKey(date.date || date.text), walker: old.prev.walker };
            updated[e.key] = { id: e.id, name: e.name, current, mine: isMine(current, day, me) };
          } else if (status === 'changed') {
            updated[e.key] = { ...old, id: e.id, name: e.name,
              ...(raw.current ? { current: { ...raw.current, date: dateKey(raw.current.date) },
                mine: isMine({ ...raw.current, date: dateKey(raw.current.date) }, day, me) } : {}) };
            // 衝突後不再使用舊快照復原。
            delete updated[e.key].prev; delete updated[e.key].wrote;
          }
          if (isSuccess(status) || (status === 'changed' && raw.current)) confirmed.push(e);
        }
        deps.save(updated, day);
        if (confirmed.length) deps.apply(confirmed.map(e => e.dog), updated, day, confirmed.filter(e => statuses.get(e.key) === 'restored').map(e => e.dog));
      }
      const rows = entries.map(e => ({ dog: e.dog, status: statuses.get(e.key) || 'notSent', canUndo: canUndo(e.dog, day) }));
      const result = { rows, error, off, successful: rows.filter(r => isSuccess(r.status)).map(r => r.dog),
        retryDogs: rows.filter(r => isRetryable(r.status)).map(r => r.dog) };
      requests.set(result, request);
      return result;
    }
    function retry(result) {
      const request = requests.get(result);
      if (!request) throw new Error('找不到這次登記');
      const entries = request.entries.filter((e, i) => isRetryable(result.rows[i].status));
      return enqueue({ ...request, entries });
    }
    return { register, retry, undo, canUndo, pending: dog => pending.has(deps.key(dog)) };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createWalkRegistration };
  else root.createWalkRegistration = createWalkRegistration;
})(globalThis);
