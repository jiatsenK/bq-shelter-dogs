

// #396：登記、追加同行人、復原共用規則；畫面與測試走同一個介面。
// #558 起溜了、修改、復原只走 D1 接受流程（ADR 0018），舊的寫回試算表路徑已刪。

function createWalkRegistration(deps) {
  let queue = Promise.resolve();
  const pending = new Map(), requests = new WeakMap();
  const accepted = new Map();
  // #445：D1 復原先顯示登記前的樣子，等 D1 回應再以回應為準；priors 是這支手機登記前看到的上次溜狗
  const priors = new Map(), restoring = new Map();
  let acceptedVersion = -1;
  const isSuccess = status => ['written', 'restored'].includes(status);
  const isRetryable = status => ['unknown', 'notSent'].includes(status);
  function dateKey(value) {
    const match = String(value || '').match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
    return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : '';
  }
  const isMine = (current, day, me = deps.walker()) => current.date === day && !!me
    && deps.split(current.walker).map(deps.canonical).some(n => [me, ...(deps.names?.() || [])].map(deps.canonical).includes(n));
  const walkersOf = walker => [...new Set(deps.split(walker).map(deps.canonical).filter(Boolean))];
  function state(dog, day = deps.date()) {
    const restore = restoring.get(deps.key(dog));
    if (restore) return { date: restore.date, walker: restore.walker,
      walkers: walkersOf(restore.walker),
      today: restore.date === day, mine: false, canRevert: false, restoring: true };
    const authoritative = accepted.get(deps.key(dog));
    if (authoritative) return { date: authoritative.walkedDate, walker: authoritative.walker,
      walkers: walkersOf(authoritative.walker),
      today: authoritative.walkedDate === day, mine: isMine({ date: authoritative.walkedDate, walker: authoritative.walker }, day),
      canRevert: authoritative.walkedDate === day && !!deps.walker() && deps.split(authoritative.walker).length === 1,
      syncStatus: authoritative.syncStatus, version: authoritative.version };
    // #460：只認伺服器的資料；還沒經過新流程的狗用 D1 狗清單的日期與名字
    const base = deps.base?.(dog) || {}, date = dateKey(base.date), walker = String(base.walker || '');
    return { date, walker, walkers: walkersOf(walker),
      today: date === day, mine: isMine({ date, walker }, day),
      canRevert: date === day && !!deps.walker() && deps.split(walker).length === 1 };
  }
  function today(dogs, day = deps.date()) {
    return dogs.filter(d => state(d, day).today).map(dog => ({ dog, ...state(dog, day) }));
  }
  // ADR 0016：今天只剩一個名字，可請 Worker 從溜狗紀錄找上一次再撤銷（任何人）
  function canRevert(dog, day = deps.date()) { return state(dog, day).canRevert; }
  function beginRead() { return { day: deps.date() }; }
  function receiveToday(payload, dogs, read = beginRead()) {
    const day = deps.date();
    if (payload?.source !== 'd1') return false;
    if (read.day !== day || payload.date !== day || !Number.isInteger(payload.version) || payload.version < acceptedVersion || !Array.isArray(payload.walks)) return false;
    acceptedVersion = payload.version;
    const changed = [];
    for (const row of payload.walks) {
      const dog = dogs.find(d => deps.key(d) === row.key), old = accepted.get(row.key);
      if (!dog || !Number.isInteger(row.version) || row.version < (old?.version || 0)) continue;
      accepted.set(row.key, row); changed.push(dog);
    }
    if (changed.length) deps.apply(changed, day, []);
    return !!changed.length;
  }
  function register(dogs, options = {}) {
    const day = deps.date(), me = deps.walker();
    const seen = new Set();
    const entries = dogs.filter(d => d && deps.key(d) && !seen.has(deps.key(d)) && seen.add(deps.key(d)))
      .map(dog => ({ dog, key: deps.key(dog), id: dog.id || '', name: dog.name,
        walker: options.walker || deps.alias(dog) || me, expectedVersion: state(dog, day).version ?? 0 }));
    if (options.expected === undefined) entries.forEach(e => {
      const before = state(e.dog, day);
      if (!before.today) priors.set(e.key, { date: before.date, walker: before.walker });
    });
    return enqueue({ entries, day, me, action: options.expected === undefined ? 'walk' : 'edit', expected: options.expected });
  }
  function undo(dogs) {
    const seen = new Set(), day = deps.date();
    return enqueue({ entries: dogs.filter(d => d && !seen.has(deps.key(d)) && seen.add(deps.key(d)))
      .map(dog => ({ dog, key: deps.key(dog), id: dog.id || '', name: dog.name, expectedVersion: state(dog).version ?? 0,
        prior: priorOf(dog, day) })),
      day, me: deps.walker(), action: 'undo' });
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
    if (request.action === 'undo') request.entries.forEach(e => { if (e.prior) restoring.set(e.key, e.prior); });
    const work = queue.then(() => execute(request));
    const finished = work.finally(() => request.entries.forEach(e => {
      if (restoring.get(e.key) === e.prior) restoring.delete(e.key);
      const n = pending.get(e.key) - 1;
      if (n) pending.set(e.key, n); else pending.delete(e.key);
    }));
    queue = finished.catch(() => {});
    return finished;
  }
  // 整群也逐狗送單狗請求（D1 以狗為序列化單位），部分成功逐狗回報。
  async function execute(request) {
    const rows = [], errors = [];
    for (const entry of request.entries) {
      const one = await acceptOne(request, entry);
      rows.push(one.row);
      if (one.error) errors.push(one.error);
    }
    const response = { rows, error: [...new Set(errors)].join('；'),
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
      return { row: { dog: entry.dog, status: 'notSent' }, error: '無法保留登記識別，尚未送出' };
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
      deps.apply([entry.dog], deps.date(), valid && payload.action === 'undo' ? [entry.dog] : []);
    }
    const completed = valid && payload.action === request.action && (request.action !== 'edit'
      || payload.walker === entry.walker && payload.editor === request.me);
    return { row: { dog: entry.dog, status: completed ? result.status : valid || conflict || rejected ? 'changed' : 'unknown' },
      error: valid && !completed ? '前次操作已確認，請先確認目前紀錄' : completed ? '' : out?.error || '' };
  }
  function retry(result) {
    const request = requests.get(result);
    if (!request) throw new Error('找不到這次登記');
    const entries = request.entries.filter((e, i) => isRetryable(result.rows[i].status));
    return enqueue({ ...request, entries });
  }
  return { register, retry, undo, canRevert, state, today, beginRead, receiveToday, pending: dog => pending.has(deps.key(dog)) };
}

export { createWalkRegistration };
