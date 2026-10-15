// 精簡 D1（v3_ 表，#245／#247）：網站要的狗清單從這裡讀，形狀跟原本的 data/dogs.json 一樣。
// 表結構見 db/compact-schema.sql、docs/COMPACT_D1.md

// 主清單欄位 → dogs.json 欄位；formerIds 只在有舊編號時出現（跟同步寫出來的 JSON 一樣）
const MAIN_FIELDS = [
  ['cage', 'cage'], ['id', 'number'], ['name', 'name'], ['walkedDate', 'walked_date'], ['covered', 'covered'],
  ['myWalked', 'my_walked'], ['note', 'note'], ['sex', 'sex'], ['intro', 'intro'], ['myWalkedDate', 'my_walked_date'],
];
const BOOLEANS = new Set(['covered', 'myWalked']);

// 同一個 batch 讀，同步正在整份換掉複本時不會讀到一半新一半舊。主清單是空的就丟錯：沒有狗一定是資料出問題
export async function readDogsPayload(db) {
  const [main, walkers, former, groups, notes] = await db.batch([
    db.prepare('SELECT * FROM v3_sheet_main ORDER BY row_index'),
    db.prepare('SELECT row_index, walker_code FROM v3_sheet_main_walkers ORDER BY row_index, position'),
    db.prepare('SELECT row_index, number FROM v3_sheet_former_numbers ORDER BY row_index, position'),
    db.prepare('SELECT column_index, name FROM v3_sheet_groups ORDER BY column_index, row_index'),
    db.prepare('SELECT label, text FROM v3_sheet_changes ORDER BY row_index'),
  ]);
  const rows = main.results || [];
  if (!rows.length) throw new Error('v3_sheet_main 沒有資料');
  const listBy = (res, field) => {
    const map = new Map();
    for (const r of res.results || []) {
      if (!map.has(r.row_index)) map.set(r.row_index, []);
      map.get(r.row_index).push(r[field]);
    }
    return map;
  };
  const walkersOf = listBy(walkers, 'walker_code');
  const formerOf = listBy(former, 'number');
  const dogs = rows.map(row => {
    const dog = {};
    for (const [key, column] of MAIN_FIELDS) dog[key] = BOOLEANS.has(key) ? Boolean(row[column]) : row[column];
    dog.walkers = walkersOf.get(row.row_index) || [];
    if (formerOf.has(row.row_index)) dog.formerIds = formerOf.get(row.row_index);
    return dog;
  });
  return {
    version: rows[0].version,
    syncedAt: rows[0].synced_at,
    dogs,
    groups: groupMap(groups.results || []),
    sheetNotes: (notes.results || []).filter(n => n.text).map(n => ({ label: n.label, text: n.text })),
  };
}

// 「常遛狗群」每一欄是一群：每隻狗對到同群的其他狗，好幾群就合起來（跟 scripts/sync-sheet.mjs 的 parseGroups 一樣）
function groupMap(cells) {
  const columns = new Map();
  for (const c of cells) {
    if (!columns.has(c.column_index)) columns.set(c.column_index, []);
    columns.get(c.column_index).push(c.name);
  }
  const out = {};
  for (const names of columns.values()) {
    for (const name of names) {
      const set = new Set(out[name] || []);
      for (const other of names) if (other !== name) set.add(other);
      out[name] = [...set];
    }
  }
  return out;
}

// 狀態頁：新表有沒有接上、各幾筆
export async function compactStatus(db) {
  try {
    const n = async t => (await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()).n;
    return `D1 新表（狗 ${await n('v3_dogs')}、主清單 ${await n('v3_sheet_main')}、溜狗紀錄 ${await n('v3_walks')}）`;
  } catch (e) {
    return 'D1（新表還沒建）';
  }
}

// 編號 → 永久狗 ID；不認得的編號不在回傳的 Map 裡
export async function dogIdsFor(db, numbers) {
  const out = new Map();
  if (!numbers.length) return out;
  const { results = [] } = await db.prepare(`SELECT number, dog_id FROM v3_dog_numbers WHERE number IN (${numbers.map(() => '?').join(',')})`).bind(...numbers).all();
  for (const r of results) out.set(r.number, r.dog_id);
  return out;
}
