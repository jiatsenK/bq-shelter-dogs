// 今日溜狗紀錄（ADR 0007）：按溜了／復原寫試算表成功後記在 D1 的 v3_today_walks，其他手機每分鐘來讀今天的清單。
// 試算表是正本；這裡只是同步前的暫時消息，寫失敗只記 Worker 日誌，不影響按的人。

// 讀取在記憶體快取 15 秒（每份 Worker 各自一份），同時段很多手機來抓只讀一次 D1；有寫入就清掉
const TODAY_CACHE_MS = 15 * 1000;
let cache = null; // { at, date, db, walks }
export function resetTodayCache() { cache = null; }

const keyOf = d => d.id || (d.name ? `名:${d.name}` : '');
const ymdText = text => String(text || '').trim().replace(/\//g, '-').replace(/-(\d)(?=-|$)/g, '-0$1');

// 小程式的回應 → 每隻狗試算表現在的樣子 { key, walked, walkedDate, walker }；沒動到的狗（找不到等）略過
export function todayRows(action, dogs, results, today) {
  const rows = [];
  for (const r of results || []) {
    const dog = dogs.find(d => (d.id || '') === (r.id || '') && d.name === r.name);
    const key = dog && keyOf(dog);
    if (!key) continue;
    if ((action === 'walk' || action === 'edit') && (r.status === 'written' || r.status === 'already')) {
      const walker = r.wrote ? r.wrote.walker : (r.current && r.current.walker) || '';
      rows.push({ key, walked: 1, walkedDate: today, walker });
    } else if (action === 'undo' && r.status === 'restored' && dog.prev) {
      const p = dog.prev.date || {};
      const walkedDate = p.date || ymdText(p.text);
      rows.push({ key, walked: walkedDate === today ? 1 : 0, walkedDate: /^\d{4}-\d{2}-\d{2}$/.test(walkedDate) ? walkedDate : '', walker: dog.prev.walker || '' });
    } else if (r.status === 'changed' && r.current) {
      // 試算表已經被別人改過：小程式順便回了現況，一樣記下來
      const walkedDate = ymdText(r.current.date);
      rows.push({ key, walked: walkedDate === today ? 1 : 0, walkedDate: /^\d{4}-\d{2}-\d{2}$/.test(walkedDate) ? walkedDate : '', walker: r.current.walker || '' });
    }
  }
  return rows;
}

// 寫一次：今天這幾隻狗蓋掉；今天以前的順便清掉（沒有舊資料時不算寫入）
export async function saveTodayWalks(db, today, rows, now = Date.now()) {
  if (!db || !rows.length) return;
  cache = null;
  const at = new Date(now).toISOString();
  await db.batch([
    db.prepare('DELETE FROM v3_today_walks WHERE walk_date<?').bind(today),
    ...rows.map(r => db.prepare('INSERT INTO v3_today_walks(walk_date,dog_key,walked,walked_date,walker,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(walk_date,dog_key) DO UPDATE SET walked=excluded.walked,walked_date=excluded.walked_date,walker=excluded.walker,updated_at=excluded.updated_at')
      .bind(today, r.key, r.walked, r.walkedDate, r.walker, at)),
  ]);
}

// 今天的清單：[{ key, walked, walkedDate, walker, at }]；依日期加主鍵，只讀今天
export async function readTodayWalks(db, today, now = Date.now()) {
  if (cache && cache.db === db && cache.date === today && now - cache.at < TODAY_CACHE_MS) return cache.walks;
  const { results = [] } = await db.prepare('SELECT dog_key,walked,walked_date,walker,updated_at FROM v3_today_walks WHERE walk_date=?').bind(today).all();
  const walks = results.map(r => ({ key: r.dog_key, walked: !!r.walked, walkedDate: r.walked_date, walker: r.walker, at: r.updated_at }));
  cache = { at: now, date: today, db, walks };
  return walks;
}
