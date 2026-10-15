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
  // 介紹是 D1 自己存的（#250 網站改了馬上看得到），不用主清單複本上同步帶來的那份
  const [main, walkers, former, groups, notes] = await db.batch([
    db.prepare("SELECT m.*, COALESCE(i.intro, '') AS intro FROM v3_sheet_main m LEFT JOIN v3_intros i USING(dog_id) ORDER BY m.row_index"),
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

// 開卡讀回：每個代號 → { 編號: 開卡日 }。編號用主清單上現在的那個，已出所的狗用它最大的編號
export async function openedBooks(db, codes) {
  const sql = `SELECT COALESCE(
      (SELECT m.number FROM v3_sheet_main m WHERE m.dog_id = c.dog_id AND m.number <> '' ORDER BY m.row_index LIMIT 1),
      (SELECT MAX(n.number) FROM v3_dog_numbers n WHERE n.dog_id = c.dog_id)) AS id, c.opened_on
    FROM v3_card_opened c WHERE c.walker_code = ?`;
  const rows = await db.batch(codes.map(code => db.prepare(sql).bind(code)));
  const books = {};
  codes.forEach((code, i) => { books[code] = Object.fromEntries((rows[i].results || []).filter(r => r.id).map(r => [r.id, r.opened_on])); });
  return books;
}

// 主清單上現在的編號優先，已出所的狗用最大的編號
const NUMBER_OF = `COALESCE(
  (SELECT m.number FROM v3_sheet_main m WHERE m.dog_id = t.dog_id AND m.number <> '' ORDER BY m.row_index LIMIT 1),
  (SELECT MAX(n.number) FROM v3_dog_numbers n WHERE n.dog_id = t.dog_id))`;

// 休養設定（#250）：編號 → { until, reason }，跟原本的 data/rest.json 一樣（不含 updatedAt）
export async function readRest(db) {
  const { results = [] } = await db.prepare(`SELECT ${NUMBER_OF} AS id, t.until_date, t.reason FROM v3_rest t`).all();
  return Object.fromEntries(results.filter(r => r.id).map(r => [r.id, { until: r.until_date, reason: r.reason }]));
}

// 寫休養：rest 是 null 就結束休養。編號不認得回 false
export async function saveRest(db, number, rest) {
  const dogId = (await dogIdsFor(db, [number])).get(number);
  if (!dogId) return false;
  if (rest) await db.prepare('INSERT INTO v3_rest(dog_id,until_date,reason) VALUES(?,?,?) ON CONFLICT(dog_id) DO UPDATE SET until_date=excluded.until_date,reason=excluded.reason').bind(dogId, rest.until, rest.reason).run();
  else await db.prepare('DELETE FROM v3_rest WHERE dog_id=?').bind(dogId).run();
  return true;
}

// 寫入所介紹：空字串就清掉。編號不認得回 false
export async function saveIntro(db, number, text) {
  const dogId = (await dogIdsFor(db, [number])).get(number);
  if (!dogId) return false;
  if (text) await db.prepare('INSERT INTO v3_intros(dog_id,intro) VALUES(?,?) ON CONFLICT(dog_id) DO UPDATE SET intro=excluded.intro').bind(dogId, text).run();
  else await db.prepare('DELETE FROM v3_intros WHERE dog_id=?').bind(dogId).run();
  return true;
}
