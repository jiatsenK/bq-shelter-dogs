// 今日溜狗的舊流程（ADR 0007 的 v3_today_walks）已隨 #558 退場，這裡只剩撤銷時找上一次溜狗。

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
