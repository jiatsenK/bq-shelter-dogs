import { identitiesForCodes } from './identity.js';
// 精簡 D1（v3_ 表，#245／#247）：網站要的狗清單從這裡讀，形狀跟原本的 data/dogs.json 一樣。
// 表結構見 db/compact-schema.sql、docs/COMPACT_D1.md

// 主清單欄位 → dogs.json 欄位；formerIds 只在有舊編號時出現（跟同步寫出來的 JSON 一樣）
const MAIN_FIELDS = [
  ['cage', 'cage'], ['id', 'number'], ['name', 'name'], ['walkedDate', 'walked_date'], ['covered', 'covered'],
  ['myWalked', 'my_walked'], ['note', 'note'], ['sex', 'sex'], ['intro', 'd1_intro'], ['myWalkedDate', 'my_walked_date'],
];
const BOOLEANS = new Set(['covered', 'myWalked']);

// 同一個 batch 讀，同步正在整份換掉複本時不會讀到一半新一半舊。主清單是空的就丟錯：沒有狗一定是資料出問題
export async function readDogsPayload(db) {
  // 介紹是 D1 自己存的（#250 網站改了馬上看得到），不用主清單複本上同步帶來的那份
  const [main, walkers, former, groups, notes] = await db.batch([
    db.prepare("SELECT m.*, COALESCE(i.intro, '') AS d1_intro FROM v3_sheet_main m LEFT JOIN v3_intros i USING(dog_id) ORDER BY m.row_index"),
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

// 舊收藏的編號／名字只在能唯一對應時轉成永久 ID，不猜同名狗。
export async function favoriteAliases(db) {
  const [numbers, names] = await db.batch([
    db.prepare('SELECT number, dog_id FROM v3_dog_numbers'),
    db.prepare('SELECT name, MIN(dog_id) AS dog_id FROM v3_dogs GROUP BY name HAVING COUNT(*) = 1'),
  ]);
  return Object.fromEntries([
    ...(numbers.results || []).map(r => [r.number, r.dog_id]),
    ...(names.results || []).map(r => [`名:${r.name}`, r.dog_id]),
  ]);
}

export async function readFavorites(db, codes) {
  const people = await identitiesForCodes(db, codes);
  const rows = await db.prepare(`SELECT DISTINCT dog_id FROM v3_volunteer_favorites WHERE volunteer_id IN (${people.map(() => '?').join(',')})`).bind(...people.map(p => p.volunteerId)).all();
  return { ids: (rows.results || []).map(r => r.dog_id), aliases: await favoriteAliases(db) };
}

export async function saveFavorite(db, codes, dogId, on, date) {
  if (!await db.prepare('SELECT dog_id FROM v3_dogs WHERE dog_id = ?').bind(dogId).first()) return false;
  const people = await identitiesForCodes(db, codes);
  await db.batch((on ? people.slice(0, 1) : people).map(person => on
    ? db.prepare('INSERT OR IGNORE INTO v3_volunteer_favorites(volunteer_id,dog_id,added_on) VALUES((SELECT volunteer_id FROM v3_identity_names WHERE code=?),?,?)').bind(person.codes[0], dogId, date)
    : db.prepare('DELETE FROM v3_volunteer_favorites WHERE volunteer_id=(SELECT volunteer_id FROM v3_identity_names WHERE code=?) AND dog_id=?').bind(person.codes[0], dogId)));
  return true;
}

// 開卡讀回：每個代號 → { 編號: 開卡日 }。編號用主清單上現在的那個，已出所的狗用它最大的編號
export async function openedBooks(db, codes) {
  const sql = `SELECT COALESCE(
      (SELECT m.number FROM v3_sheet_main m WHERE m.dog_id = c.dog_id AND m.number <> '' ORDER BY m.row_index LIMIT 1),
      (SELECT MAX(n.number) FROM v3_dog_numbers n WHERE n.dog_id = c.dog_id)) AS id, c.opened_on
    FROM v3_volunteer_cards c WHERE c.volunteer_id = ?`;
  const people = await Promise.all(codes.map(async code => (await identitiesForCodes(db, [code]))[0]));
  const rows = await db.batch(people.map(p => db.prepare(sql).bind(p.volunteerId)));
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

// 寫休養：rest 是 null 就結束休養。編號不認得回 null，存好回 { dogId, before }（改前的設定，編輯紀錄用）
export async function saveRest(db, number, rest) {
  const dogId = (await dogIdsFor(db, [number])).get(number);
  if (!dogId) return null;
  const old = await db.prepare('SELECT until_date, reason FROM v3_rest WHERE dog_id=?').bind(dogId).first();
  const before = old ? { until: old.until_date, reason: old.reason } : null;
  if (rest) await db.prepare('INSERT INTO v3_rest(dog_id,until_date,reason) VALUES(?,?,?) ON CONFLICT(dog_id) DO UPDATE SET until_date=excluded.until_date,reason=excluded.reason').bind(dogId, rest.until, rest.reason).run();
  else await db.prepare('DELETE FROM v3_rest WHERE dog_id=?').bind(dogId).run();
  return { dogId, before };
}

// 寫入所介紹：空字串就清掉。編號不認得回 null，存好回 { dogId, before }（改前的介紹，沒有是 ''）
export async function saveIntro(db, number, text) {
  const dogId = (await dogIdsFor(db, [number])).get(number);
  if (!dogId) return null;
  const old = await db.prepare('SELECT intro FROM v3_intros WHERE dog_id=?').bind(dogId).first();
  const before = old ? old.intro : '';
  if (text) await db.prepare('INSERT INTO v3_intros(dog_id,intro) VALUES(?,?) ON CONFLICT(dog_id) DO UPDATE SET intro=excluded.intro').bind(dogId, text).run();
  else await db.prepare('DELETE FROM v3_intros WHERE dog_id=?').bind(dogId).run();
  return { dogId, before };
}

// 離所紀錄（#259）：形狀跟原本的 data/departures.json 的 departures 一樣，依日期新到舊、同一天依編號
export async function readDepartures(db) {
  const [deps, items] = await db.batch([
    db.prepare('SELECT * FROM v3_departures'),
    db.prepare('SELECT number, kind, value FROM v3_departure_items ORDER BY number, kind, position'),
  ]);
  const listOf = new Map();
  for (const r of items.results || []) {
    const key = `${r.number}|${r.kind}`;
    if (!listOf.has(key)) listOf.set(key, []);
    listOf.get(key).push(r.value);
  }
  const list = (deps.results || []).map(r => {
    const entry = {
      id: r.number, name: r.name, date: r.departed_date, dateSource: r.date_source, seen: r.seen_date,
      reason: r.reason, matched: r.matched, flags: listOf.get(`${r.number}|flag`) || [],
    };
    if (r.returned_number !== null) entry.returned = r.returned_number;
    if (r.last_number !== null) {
      const last = { cage: r.last_cage, id: r.last_number, name: r.last_name, walkedDate: r.last_walked_date, note: r.last_note, sex: r.last_sex, intro: r.last_intro };
      if (listOf.has(`${r.number}|former`)) last.formerIds = listOf.get(`${r.number}|former`);
      if (listOf.has(`${r.number}|group`)) last.groups = listOf.get(`${r.number}|group`);
      entry.last = last;
    }
    return entry;
  });
  return list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.id.localeCompare(b.id));
}

// 溜狗歷史從這天開始累積（第一份每日快照，原本的 data/history/index.json 第一個日期）；之前的紀錄只是當時的「最後一次」
export const HISTORY_START = '2026-09-25';

// 溜狗紀錄（#260）：形狀跟原本的 data/walks.json 一樣，一隻狗一天一筆，依日期排；沒記人的舊紀錄沒有 walkers
export async function readWalks(db) {
  const { results = [] } = await db.prepare('SELECT dog_id,walk_date,walker_code,dog_number,dog_name FROM v3_walks ORDER BY walk_date,dog_number,dog_name,position').all();
  const days = new Map();
  for (const r of results) {
    const key = `${r.dog_id}|${r.walk_date}`;
    if (!days.has(key)) days.set(key, { id: r.dog_number, name: r.dog_name, date: r.walk_date });
    if (r.walker_code !== null) (days.get(key).walkers ||= []).push(r.walker_code);
  }
  return { version: 1, historyStart: HISTORY_START, walks: [...days.values()] };
}

// 主清單上有編號的狗：編號 → 犬名（照片、備註確認編號用）。主清單是空的就丟錯，不當成「沒有狗」
export async function readMainNames(db) {
  const { results = [] } = await db.prepare("SELECT number,name FROM v3_sheet_main WHERE number<>'' ORDER BY row_index").all();
  if (!results.length) throw new Error('v3_sheet_main 沒有資料');
  return new Map(results.map(r => [r.number, r.name]));
}
