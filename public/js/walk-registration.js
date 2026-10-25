

// #396：登記、追加同行人、復原共用規則；畫面與測試走同一個介面。

const MAX_DOGS_PER_SEND = 10; // 與 worker/src/index.js 的 WALK_MAX_DOGS 一致
function createWalkRegistration(deps) {
  let queue = Promise.resolve();
  const pending = new Map(), requests = new WeakMap();
  const accepted = new Map();
  // #445：D1 復原先顯示登記前的樣子，等 D1 回應再以回應為準；priors 是這支手機登記前看到的上次溜狗
  const priors = new Map(), restoring = new Map();
  let acceptedVersion = -1;
  let revision = 0, readSequence = 0, acceptedToday = 0;
  const changedAt = new Map();
  const now = () => deps.now?.() ?? Date.now();
  const isSuccess = status => ['written', 'already', 'restored'].includes(status);
  const isRetryable = status => ['unknown', 'notSent'].includes(status);
  function dateKey(value) {
    const match = String(value || '').match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
    return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : '';
  }
  const isMine = (current, day, me = deps.walker()) => current.date === day && !!me
    && deps.split(current.walker).map(deps.canonical).some(n => [me, ...(deps.names?.() || [])].map(deps.canonical).includes(n));
  function activeItem(dog, day) {
    const item = deps.read(day)[deps.key(dog)];
    const since = deps.syncedAt?.() || 0;
    // 舊版沒有時間證據，不能推定它比已同步正本新。
    return since && (!item?.observedAt || item.observedAt <= since) ? null : item;
  }
  const walkersOf = walker => [...new Set(deps.split(walker).map(deps.canonical).filter(Boolean))];
  function state(dog, day = deps.date()) {
    const restore = restoring.get(deps.key(dog));
    if (restore) return { date: restore.date, walker: restore.walker,
      walkers: walkersOf(restore.walker),
      today: restore.date === day, mine: false, canUndo: false, canRevert: false, restoring: true };
    const authoritative = accepted.get(deps.key(dog));
    if (authoritative) return { date: authoritative.walkedDate, walker: authoritative.walker,
      walkers: walkersOf(authoritative.walker),
      today: authoritative.walkedDate === day, mine: isMine({ date: authoritative.walkedDate, walker: authoritative.walker }, day),
      canUndo: false, canRevert: authoritative.walkedDate === day && !!deps.walker() && deps.split(authoritative.walker).length === 1,
      syncStatus: authoritative.syncStatus, version: authoritative.version };
    if (deps.d1) {
      // #460：D1 模式只認伺服器的資料；本機已溜、寫入紀錄與試算表即時名單都不能反駁。
      const base = deps.base?.(dog) || {}, date = dateKey(base.date), walker = String(base.walker || '');
      return { date, walker, walkers: walkersOf(walker),
        today: date === day, mine: isMine({ date, walker }, day), canUndo: false,
        canRevert: date === day && !!deps.walker() && deps.split(walker).length === 1 };
    }
    const item = activeItem(dog, day);
    const base = deps.base?.(dog) || {};
    const expired = !item && !!deps.read(day)[deps.key(dog)];
    const local = !expired && (deps.local?.(day) || []).includes(deps.key(dog));
    const current = item?.current || (local ? { date: day, walker: [base.walker, deps.walker() || '你', ...(deps.companions?.(dog, day) || [])].filter(Boolean).join('、') } : base);
    const date = dateKey(current.date), walker = String(current.walker || '');
    return { date, walker, walkers: walkersOf(walker),
      today: date === day, mine: item?.current ? isMine({ date, walker }, day) : local || isMine({ date, walker }, day), canUndo: canUndo(dog, day),
      canRevert: canRevert(dog, day, { date, walker }) };
  }
  function today(dogs, day = deps.date()) {
    return dogs.filter(d => accepted.has(deps.key(d)) || deps.d1 ? state(d, day).today : activeItem(d, day)?.current || (dateKey(deps.base?.(d)?.date) === day && deps.base(d).walker))
      .map(dog => ({ dog, ...state(dog, day) }));
  }
  function canUndo(dog, day = deps.date()) {
    if (deps.d1 || accepted.has(deps.key(dog))) return false;
    const item = deps.read(day)[deps.key(dog)];
    const current = activeItem(dog, day) ? item.current : deps.base?.(dog);
    return !!(item && item.prev && item.wrote && (!current || (current.walker === item.wrote.walker
      && (!(item.wrote.date || item.current?.date) || dateKey(current.date) === dateKey(item.wrote.date || item.current.date)))));
  }
  // ADR 0016：沒有本機復原證據，但今天只剩一個名字，可請 Worker 從溜狗紀錄找上一次再撤銷（任何人）
  function canRevert(dog, day = deps.date(), current = null) {
    if (deps.d1 || accepted.has(deps.key(dog))) return state(dog, day).canRevert;
    if (canUndo(dog, day)) return false;
    const now_ = current || state(dog, day);
    return now_.date === day && deps.split(now_.walker).length === 1;
  }
  function beginRead() { return { day: deps.date(), revision, sequence: ++readSequence, at: now() }; }
  // 日期、名字、本機名單與復原證據一併套用；傳輸與 DOM 不參與規則。
  function setCurrent(records, dog, current, day, evidence = {}, observedAt = now()) {
    const key = deps.key(dog), old = records[key];
    records[key] = { ...old, ...evidence, id: dog.id || '', name: dog.name,
      current: { date: dateKey(current.date), walker: String(current.walker || '') }, observedAt };
    records[key].mine = isMine(records[key].current, day);
    if (old?.current && (old.current.date !== records[key].current.date || old.current.walker !== records[key].current.walker)
      && !Object.hasOwn(evidence, 'wrote')) {
      delete records[key].prev; delete records[key].wrote;
    }
    changedAt.set(`${day}:${key}`, ++revision);
  }
  function saveCurrent(records, dogs, day, restored = []) {
    if (day !== deps.date()) return;
    deps.save(records, day);
    if (deps.saveLocal) {
      const ids = new Set(deps.local(day));
      for (const dog of dogs) {
        const key = deps.key(dog);
        if (records[key]?.mine) ids.add(key); else ids.delete(key);
      }
      deps.saveLocal([...ids], day);
    }
    if (dogs.length) deps.apply(dogs, records, day, restored);
  }
  function receiveToday(payload, dogs, read = beginRead()) {
    const day = deps.date();
    if (payload?.source === 'd1') {
      if (read.day !== day || payload.date !== day || !Number.isInteger(payload.version) || payload.version < acceptedVersion || !Array.isArray(payload.walks)) return false;
      acceptedVersion = payload.version;
      const changed = [];
      for (const row of payload.walks) {
        const dog = dogs.find(d => deps.key(d) === row.key), old = accepted.get(row.key);
        if (!dog || !Number.isInteger(row.version) || row.version < (old?.version || 0)) continue;
        accepted.set(row.key, row); changed.push(dog);
      }
      if (changed.length) deps.apply(changed, deps.read(day), day, []);
      return !!changed.length;
    }
    if (deps.d1) return false; // 舊 today 回應不再是正本
    if (read.day !== day || payload?.date !== day || !Array.isArray(payload.walks) || read.sequence < acceptedToday) return false;
    acceptedToday = read.sequence;
    const records = { ...deps.read(day) }, changed = [];
    for (const row of payload.walks) {
      if (accepted.has(row?.key)) continue;
      const dog = dogs.find(d => deps.key(d) === row?.key), at = Date.parse(row?.at);
      if (!dog || !Number.isFinite(at) || at <= (deps.syncedAt?.() || 0)
        || (changedAt.get(`${day}:${row.key}`) || 0) > read.revision
        || at < (records[row.key]?.observedAt || 0)) continue;
      setCurrent(records, dog, { date: row.walkedDate, walker: row.walker }, day, {}, at);
      changed.push(dog);
    }
    if (changed.length) saveCurrent(records, changed, day);
    return !!changed.length;
  }
  // 試算表名單是正本（K 2026-10-20：不管在網站按還是直接改試算表，都要同步）。
  // dates 有那隻狗的「遛狗日期」就連日期一起換；sheetAt 是 Worker 讀試算表的時間，比它新的今日紀錄才蓋得過名單。
  function receiveNames(names, dogs, read = beginRead(), dates = {}, sheetAt = read.at) {
    if (deps.d1 || read.day !== deps.date()) return false;
    const records = { ...deps.read(read.day) }, changed = [], dropped = [];
    const local = new Set(deps.local?.(read.day) || []);
    for (const dog of dogs) {
      const key = deps.key(dog), item = records[key];
      if (accepted.has(key)) continue;
      if ((changedAt.get(`${read.day}:${key}`) || 0) > read.revision || pending.has(key)) continue;
      const hasDate = Object.hasOwn(dates, key); // 有這個 key、值是空的＝試算表清掉了
      const sheetDate = hasDate ? dateKey(dates[key]) : '';
      const active = activeItem(dog, read.day);
      if (item?.current && active) {
        if (!Object.hasOwn(names, key) && !hasDate) continue;
        if ((item.observedAt || 0) > sheetAt) continue; // 名單讀得比這筆早，還沒包含它
        const walker = Object.hasOwn(names, key) ? String(names[key] || '') : item.current.walker;
        const date = hasDate ? sheetDate : item.current.date;
        if (item.current.walker === walker && dateKey(item.current.date) === date) continue;
        setCurrent(records, dog, { date, walker }, read.day, {}, sheetAt);
        changed.push(dog);
      } else if (local.has(key) && sheetDate === read.day
        && !isMine({ date: sheetDate, walker: String(names[key] || '') }, read.day)) {
        // 這支手機記著「今天我溜了」，但試算表今天寫的是別人：以試算表為準
        local.delete(key);
        dropped.push(dog);
      }
    }
    if (dropped.length && deps.saveLocal) deps.saveLocal([...local], read.day);
    if (changed.length) saveCurrent(records, changed, read.day);
    else if (dropped.length) deps.apply(dropped, records, read.day, []);
    return !!(changed.length || dropped.length);
  }
  function register(dogs, options = {}) {
    const day = deps.date(), me = deps.walker();
    const seen = new Set();
    const entries = dogs.filter(d => d && deps.key(d) && !seen.has(deps.key(d)) && seen.add(deps.key(d)))
      .map(dog => ({ dog, key: deps.key(dog), id: dog.id || '', name: dog.name,
        walker: options.walker || deps.alias(dog) || me, expectedVersion: state(dog, day).version ?? 0 }));
    if (deps.d1 && options.expected === undefined) entries.forEach(e => {
      const before = state(e.dog, day);
      if (!before.today) priors.set(e.key, { date: before.date, walker: before.walker });
    });
    return enqueue({ entries, day, me, action: options.expected === undefined ? 'walk' : 'edit', expected: options.expected,
      d1: !!deps.d1 });
  }
  // options.revert：沒有本機證據的狗改請 Worker 找上一次（ADR 0016）
  function undo(dogs, options = {}) {
    const seen = new Set(), day = deps.date();
    return enqueue({ entries: dogs.filter(d => d && !seen.has(deps.key(d)) && seen.add(deps.key(d)))
      .map(dog => ({ dog, key: deps.key(dog), id: dog.id || '', name: dog.name, expectedVersion: state(dog).version ?? 0,
        prior: deps.d1 ? priorOf(dog, day) : null })),
      day: deps.date(), me: deps.walker(), action: 'undo', revert: !!options.revert, d1: !!deps.d1 });
  }
  // 登記前的樣子：這支手機登記時記下的，沒有就用狗清單還不是今天的日期；都沒有就等 D1 回應
  function priorOf(dog, day) {
    const key = deps.key(dog), base = deps.base?.(dog) || {};
    if (priors.has(key)) return { ...priors.get(key) }; // 每筆復原各自一份，清除時才分得出是誰設的
    const date = dateKey(base.date);
    return date && date !== day ? { date, walker: String(base.walker || '') } : null;
  }
  function enqueue(request) {
    request.entries.forEach(e => pending.set(e.key, (pending.get(e.key) || 0) + 1));
    if (request.d1 && request.action === 'undo') request.entries.forEach(e => { if (e.prior) restoring.set(e.key, e.prior); });
    const work = queue.then(() => execute(request));
    const finished = work.finally(() => request.entries.forEach(e => {
      if (restoring.get(e.key) === e.prior) restoring.delete(e.key);
      const n = pending.get(e.key) - 1;
      if (n) pending.set(e.key, n); else pending.delete(e.key);
    }));
    queue = finished.catch(() => {});
    return finished;
  }
  async function execute(request) {
    if (request.d1) return executeAccepted(request);
    const { entries, day, me, action, expected, revert } = request;
    const groups = [];
    for (const entry of entries) {
      // #498：Worker 一次最多 10 隻；整群超過就內部拆批，不成為志工的群組大小限制。
      let group = groups.find(g => g.walker === entry.walker && g.entries.length < MAX_DOGS_PER_SEND);
      if (!group) groups.push(group = { walker: entry.walker, entries: [] });
      group.entries.push(entry);
    }
    const statuses = new Map();
    let error = '', off = false;
    for (const group of groups) {
      const records = deps.read(day);
      const sendable = action === 'undo' ? group.entries.filter(e => canUndo(e.dog, day) || (revert && (e.undo || canRevert(e.dog, day)))) : group.entries;
      group.entries.filter(e => !sendable.includes(e)).forEach(e => statuses.set(e.key, 'changed'));
      if (!sendable.length) continue;
      const payload = { action, ...(action === 'undo' ? (me ? { walker: me } : {}) : { walker: group.walker }), dogs: sendable.map(e => {
        if (action === 'undo') {
          // 首次真正送出時才取得快照（可能須等前筆登記），重試不讀後來的內容；沒有本機證據時只帶現在的名單給 Worker 比對
          const item = e.undo || (e.undo = canUndo(e.dog, day) ? structuredClone(records[e.key]) : { wrote: { walker: state(e.dog, day).walker } });
          return { id: e.id, name: e.name, ...(item.prev ? { prev: structuredClone(item.prev) } : {}), wrote: structuredClone(item.wrote) };
        }
        return { id: e.id, name: e.name, ...(expected === undefined ? {} : { expected }) };
      }) };
      const writeStarted = beginRead();
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
        const newer = old?.current && (changedAt.get(`${day}:${e.key}`) || 0) > writeStarted.revision
          && old.observedAt >= writeStarted.at;
        const applyCurrent = (current, evidence = {}) => setCurrent(updated, e.dog, newer ? old.current : current,
          day, evidence, newer ? old.observedAt : now());
        if (status === 'written' || status === 'already') {
          const current = { date: dateKey(out.today || day), walker: raw.wrote?.walker ?? raw.current?.walker ?? '' };
          applyCurrent(current, { prev: expected !== undefined ? raw.prev : old?.prev || raw.prev,
            wrote: raw.wrote || old?.wrote });
        } else if (status === 'restored' && (old || raw.prev)) {
          const previous = raw.prev || (e.undo || old).prev || {}, date = previous.date || {};
          const current = { date: dateKey(date.date || date.text), walker: previous.walker };
          applyCurrent(current, { prev: undefined, wrote: undefined });
        } else if (status === 'changed') {
          if (raw.current) applyCurrent(raw.current);
          else updated[e.key] = { ...old, id: e.id, name: e.name };
          // 衝突後不再使用舊快照復原。
          delete updated[e.key].prev; delete updated[e.key].wrote;
        }
        if (isSuccess(status) || (status === 'changed' && raw.current)) confirmed.push(e);
      }
      if (day === deps.date()) saveCurrent(updated, confirmed.map(e => e.dog), day, confirmed.filter(e => statuses.get(e.key) === 'restored').map(e => e.dog));
    }
    const rows = entries.map(e => ({ dog: e.dog, status: statuses.get(e.key) || 'notSent', canUndo: canUndo(e.dog, day) }));
    const result = { rows, error, off, successful: rows.filter(r => isSuccess(r.status)).map(r => r.dog),
      retryDogs: rows.filter(r => isRetryable(r.status)).map(r => r.dog) };
    requests.set(result, request);
    return result;
  }
  // 整群也逐狗送單狗請求（D1 以狗為序列化單位），部分成功逐狗回報。
  async function executeAccepted(request) {
    const rows = [], errors = [];
    for (const entry of request.entries) {
      const one = await acceptOne(request, entry);
      rows.push(one.row);
      if (one.error) errors.push(one.error);
    }
    const response = { rows, error: [...new Set(errors)].join('；'), off: false,
      successful: rows.filter(r => isSuccess(r.status)).map(r => r.dog),
      retryDogs: rows.filter(r => isRetryable(r.status)).map(r => r.dog), source: 'd1' };
    requests.set(response, request);
    return response;
  }
  async function acceptOne(request, entry) {
    const key = entry.key;
    const saved = { ...(deps.readRequests?.() || {}) };
    // 尚未查明的原要求優先；換名字或午夜都不能將它變成另一筆登記。
    const payload = saved[key] || entry.payload || { action: request.action, requestId: crypto.randomUUID(), operationDate: request.day,
      walker: request.action === 'undo' ? request.me : entry.walker,
      ...(request.action === 'edit' ? { editor: request.me } : {}),
      dogs: [{ id: entry.id, name: entry.name, ...(request.action !== 'walk' ? { expectedVersion: entry.expectedVersion } : {}) }] };
    entry.payload = payload;
    saved[key] = payload;
    try { deps.saveRequests?.(saved); } catch {
      return { row: { dog: entry.dog, status: 'notSent', canUndo: false }, error: '無法保留登記識別，尚未送出' };
    }
    let out;
    try { out = payload.operationDate !== deps.date() && deps.lookupRequest ? await deps.lookupRequest(payload.requestId) : await deps.send(payload); } catch { out = null; }
    // 有回應（含失敗）就以 D1 為準；同一隻後面還排著別筆復原時，只清自己設的
    if (entry.prior && restoring.get(key) === entry.prior) restoring.delete(key);
    const matches = out?.source === 'd1' && Array.isArray(out.results) ? out.results.filter(r => r.id === entry.id && r.name === entry.name) : [];
    const result = matches.length === 1 ? matches[0] : null;
    const valid = out?.ok && result?.accepted === true && result.status === (payload.action === 'undo' ? 'restored' : 'written') && result.requestId === payload.requestId && result.operationDate === payload.operationDate
      && Number.isInteger(result.version) && typeof result.current?.date === 'string' && typeof result.current.walker === 'string';
    const conflict = !out?.ok && result?.status === 'changed' && Number.isInteger(result.version)
      && typeof result.current?.date === 'string' && typeof result.current.walker === 'string';
    const rejected = !out?.ok && [400, 403, 404, 409].includes(out?.httpStatus);
    if ((valid || conflict) && out.snapshot) receiveToday(out.snapshot, [entry.dog]);
    if (valid || conflict) {
      const old = accepted.get(key);
      if (!old || result.version > old.version) accepted.set(key, { key, version: result.version, walkedDate: result.current.date,
        walker: result.current.walker, syncStatus: result.syncStatus, at: result.at });
    }
    if (valid || conflict || rejected) {
      delete saved[key];
      // 清除失敗仍保留原識別，下次可安全查詢／重送，不影響已接受結果。
      try { deps.saveRequests?.(saved); } catch { /* 保留原要求供下次查明。 */ }
      deps.apply([entry.dog], deps.read(deps.date()), deps.date(), valid && payload.action === 'undo' ? [entry.dog] : []);
    }
    const completed = valid && payload.action === request.action && (request.action !== 'edit'
      || payload.walker === entry.walker && payload.editor === request.me);
    return { row: { dog: entry.dog, status: completed ? result.status : valid || conflict || rejected ? 'changed' : 'unknown', canUndo: false },
      error: valid && !completed ? '前次操作已確認，請先確認目前紀錄' : completed ? '' : out?.error || '' };
  }
  function retry(result) {
    const request = requests.get(result);
    if (!request) throw new Error('找不到這次登記');
    const entries = request.entries.filter((e, i) => isRetryable(result.rows[i].status));
    return enqueue({ ...request, entries });
  }
  return { register, retry, undo, canUndo, canRevert, state, today, beginRead, receiveToday, receiveNames, pending: dog => pending.has(deps.key(dog)) };
}

export { MAX_DOGS_PER_SEND, createWalkRegistration };
