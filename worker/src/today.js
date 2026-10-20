// 今日溜狗紀錄（ADR 0007）：按溜了／復原寫試算表成功後記在 D1 的 v3_today_walks，其他手機每分鐘來讀今天的清單。
// 試算表是正本；這裡只是同步前的暫時消息，寫失敗只記 Worker 日誌，不影響按的人。

// 讀取看版本號（ADR 0009）：每次只讀 1 列 v3_data_versions.today，跟記憶體裡的版本、日期一樣就回快取；
// 版本號由觸發器在 v3_today_walks 有變動時加 1，所以別台 Worker 機器寫入、同步清資料，這裡都看得到
let cache = null; // { version, date, db, walks }
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
  const at = new Date(now).toISOString();
  await db.batch([
    db.prepare('DELETE FROM v3_today_walks WHERE walk_date<?').bind(today),
    ...rows.map(r => db.prepare('INSERT INTO v3_today_walks(walk_date,dog_key,walked,walked_date,walker,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(walk_date,dog_key) DO UPDATE SET walked=excluded.walked,walked_date=excluded.walked_date,walker=excluded.walker,updated_at=excluded.updated_at')
      .bind(today, r.key, r.walked, r.walkedDate, r.walker, at)),
  ]);
}

// 今天的清單：[{ key, walked, walkedDate, walker, at }]；依日期加主鍵，只讀今天
export async function readTodayWalks(db, today) {
  const version = await db.prepare('SELECT today FROM v3_data_versions WHERE id=1').first('today');
  if (version == null) throw new Error('沒有 today 版本號');
  if (cache && cache.db === db && cache.date === today && cache.version === version) return cache.walks;
  const { results = [] } = await db.prepare('SELECT dog_key,walked,walked_date,walker,updated_at FROM v3_today_walks WHERE walk_date=?').bind(today).all();
  const walks = results.map(r => ({ key: r.dog_key, walked: !!r.walked, walkedDate: r.walked_date, walker: r.walker, at: r.updated_at }));
  cache = { version, date: today, db, walks };
  return walks;
}

// 撤銷溜了（ADR 0016）：手機沒有復原證據時，從 D1 溜狗紀錄找這隻狗今天以前最後一次（日期、那天的名字），寫回試算表用。
// 主鍵是 (dog_id, walk_date, position)，只讀這隻狗最近幾列；從沒溜過回空白。找不到這隻狗回 null
export async function previousWalk(db, dog, today) {
  const found = dog.id
    ? await db.prepare('SELECT dog_id FROM v3_dog_numbers WHERE number=?').bind(dog.id).all()
    : await db.prepare("SELECT dog_id FROM v3_sheet_main WHERE number='' AND name=?").bind(dog.name).all();
  const ids = [...new Set((found.results || []).map(r => r.dog_id))];
  if (ids.length !== 1) return null;
  const { results: rows = [] } = await db.prepare('SELECT walk_date,walker_code FROM v3_walks WHERE dog_id=? AND walk_date<? ORDER BY walk_date DESC,position LIMIT 20').bind(ids[0], today).all();
  if (!rows.length) return { date: { text: '' }, walker: '' };
  const date = rows[0].walk_date;
  const codes = [...new Set(rows.filter(r => r.walk_date === date).map(r => r.walker_code).filter(Boolean))];
  const names = new Map();
  if (codes.length) {
    const marks = codes.map(() => '?').join(',');
    const { results = [] } = await db.prepare(`SELECT code,name FROM v3_identity_names WHERE code IN (${marks}) UNION ALL SELECT c.code,v.name FROM v3_volunteer_codes c JOIN v3_volunteers v USING(volunteer_id) WHERE c.code IN (${marks})`).bind(...codes, ...codes).all();
    for (const r of results) if (!names.has(r.code)) names.set(r.code, r.name);
  }
  // 對不到名字的代號（舊資料）略過，不寫代號進試算表
  return { date: { date }, walker: [...new Set(codes.map(c => names.get(c)).filter(Boolean))].join('、') };
}
