// 假的 D1 今日溜狗（#558 起網站只走 D1 接受流程）：/api/walk 接受後記在 rows，/api/today 回同一份資料包。
// 套件自己的 route 遇到 walk／today 時呼叫 walk(body)、pack()；要模擬別的志工登記就 set(key, walker)。
// prior(dog)：復原時改回的上一次，預設空白（沒有上一次）。
module.exports = function fakeD1Walks({ today, prior = () => ({ date: '', walker: '' }) }) {
  let version = 0;
  const rows = new Map(), before = new Map();
  const keyOf = d => d.id || `名:${d.name}`;
  const pack = () => ({ ok: true, source: 'd1', date: today(), version, walks: [...rows.values()] });
  function set(key, walker, walkedDate = today()) {
    const row = { key, version: (rows.get(key)?.version || 0) + 1, walkedDate, walker, syncStatus: 'synced', at: new Date().toISOString() };
    rows.set(key, row); version++;
    return row;
  }
  // result(dog, row) 可回傳單狗結果改成失敗：{ status: 'unknown' } 等
  function walk(body, result = () => null) {
    const results = body.dogs.map(d => {
      const key = keyOf(d), old = rows.get(key);
      const override = result(d, body);
      if (override) return { id: d.id, name: d.name, ...override };
      // 修改、復原帶著手機看到的版本；伺服器已被別人改過就回衝突與現況
      if (body.action !== 'walk' && old && d.expectedVersion !== undefined && d.expectedVersion !== old.version)
        return { id: d.id, name: d.name, status: 'changed', version: old.version, current: { date: old.walkedDate, walker: old.walker } };
      let current;
      if (body.action === 'undo') current = before.get(key) || prior(d);
      else {
        const same = old && old.walkedDate === today();
        if (!same) before.set(key, old ? { date: old.walkedDate, walker: old.walker } : prior(d));
        // 同一天再登記（一起溜的人）接在原名單後面，跟 worker/src/walk-accept.js 一樣
        const split = s => String(s || '').split('、').filter(Boolean);
        const people = body.action === 'walk' && same ? [...split(old.walker), ...split(body.walker)] : split(body.walker);
        current = { date: today(), walker: [...new Set(people)].join('、') };
      }
      const row = set(key, current.walker, current.date);
      return { id: d.id, name: d.name, status: body.action === 'undo' ? 'restored' : 'written', accepted: true,
        requestId: body.requestId, operationDate: body.operationDate, version: row.version, current, syncStatus: 'synced', at: row.at };
    });
    const ok = results.every(r => r.accepted);
    return { ok, source: 'd1', today: today(), snapshot: pack(), results };
  }
  return { walk, pack, set, rows };
};
