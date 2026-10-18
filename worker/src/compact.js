import { identitiesForCodes } from './identity.js';
import { readIntakeEvents, readAllIntakeEvents } from './intake.js';
import { readAllStays } from './stays.js';
// 精簡 D1（v3_ 表，#245／#247）：網站要的狗清單從這裡讀，形狀跟原本的 data/dogs.json 一樣。
// 表結構見 db/compact-schema.sql、docs/COMPACT_D1.md

// 只讀主清單上的狗（ADR 0014）：入所、休養照主鍵讀，不整張讀，讀取量不隨離所的狗變多
const ON_MAIN = 'dog_id IN (SELECT dog_id FROM v3_sheet_main)';

// 主清單欄位 → dogs.json 欄位；formerIds 只在有舊編號時出現（跟同步寫出來的 JSON 一樣）。
// 舊編號直接讀 v3_dog_numbers（同一隻狗的其他編號，#289 網站補了馬上看得到）
const MAIN_FIELDS = [
  ['cage', 'cage'], ['id', 'number'], ['name', 'name'], ['walkedDate', 'walked_date'], ['covered', 'covered'],
  ['myWalked', 'my_walked'], ['note', 'note'], ['sex', 'sex'], ['intro', 'd1_intro'], ['myWalkedDate', 'my_walked_date'],
];
const BOOLEANS = new Set(['covered', 'myWalked']);

// 不含同步時間（ADR 0014，見 readSyncedAt）。同一個 batch 讀，同步正在整份換掉複本時不會讀到一半新一半舊。主清單是空的就丟錯：沒有狗一定是資料出問題
export async function readDogsPayload(db) {
  // 介紹是 D1 自己存的（#250 網站改了馬上看得到），不用主清單複本上同步帶來的那份
  const [main, walkers, former, groups, notes] = await db.batch([
    db.prepare("SELECT m.*, COALESCE(i.intro, '') AS d1_intro FROM v3_sheet_main m LEFT JOIN v3_intros i USING(dog_id) ORDER BY m.row_index"),
    db.prepare('SELECT row_index, walker_code FROM v3_sheet_main_walkers ORDER BY row_index, position'),
    db.prepare("SELECT m.row_index, n.number FROM v3_sheet_main m JOIN v3_dog_numbers n USING(dog_id) WHERE n.number <> m.number ORDER BY m.row_index, n.number"),
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
  const intake = await readAllIntakeEvents(db, ON_MAIN);
  const intakeOf = new Map();
  for (const r of intake.results || []) {
    if (!intakeOf.has(r.dog_id)) intakeOf.set(r.dog_id, []);
    intakeOf.get(r.dog_id).push({ number: r.number, date: r.event_date, event: r.event });
  }
  const staysOf = await readAllStays(db, ON_MAIN);
  const dogs = rows.map(row => {
    const dog = {};
    for (const [key, column] of MAIN_FIELDS) dog[key] = BOOLEANS.has(key) ? Boolean(row[column]) : row[column];
    dog.walkers = walkersOf.get(row.row_index) || [];
    if (formerOf.has(row.row_index)) dog.formerIds = formerOf.get(row.row_index);
    if (intakeOf.has(row.dog_id)) dog.intakeEvents = intakeOf.get(row.dog_id);
    if (staysOf.has(row.dog_id)) dog.stays = staysOf.get(row.dog_id);
    return dog;
  });
  return {
    version: rows[0].version,
    dogs,
    groups: groupMap(groups.results || []),
    groupColumns: groupColumns(groups.results || [], await groupLabels(db)),
    sheetNotes: (notes.results || []).filter(n => n.text).map(n => ({ label: n.label, text: n.text })),
  };
}

// 上一次同步的時間（ADR 0014，#361）：存在 v3_sync_state，改它不會讓 small 資料包失效。
// 還沒有這列（新版同步還沒跑過）就用主清單第 0 列舊的那份；表還沒建也一樣
export const SYNCED_AT_KEY = 'synced_at';
export async function readSyncedAt(db) {
  const sql = `SELECT COALESCE((SELECT value FROM v3_sync_state WHERE key='${SYNCED_AT_KEY}'), (SELECT synced_at FROM v3_sheet_main WHERE row_index=0)) AS v`;
  try {
    return (await db.prepare(sql).first('v')) ?? '';
  } catch (e) {
    if (!/no such table/i.test(e.message)) throw e;
    return (await db.prepare('SELECT synced_at FROM v3_sheet_main WHERE row_index=0').first('synced_at')) ?? '';
  }
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

// 群名表是 K 2026-10-16 才加的：第一次同步建表之前讀不到，當成都沒有群名，狗清單照常給
async function groupLabels(db) {
  try {
    return new Map(((await db.prepare('SELECT column_index, label FROM v3_sheet_group_labels').all()).results || []).map(r => [r.column_index, r.label]));
  } catch (e) {
    return new Map();
  }
}

// 狗群頁用：每一欄一群 { column（試算表第幾欄，0 起）, label, names }，照欄排；只有群名沒有狗的欄也列出來
function groupColumns(cells, labels) {
  const columns = new Map();
  for (const c of cells) {
    if (!columns.has(c.column_index)) columns.set(c.column_index, []);
    columns.get(c.column_index).push(c.name);
  }
  for (const column of labels.keys()) if (!columns.has(column)) columns.set(column, []);
  return [...columns.keys()].sort((a, b) => a - b).map(column => ({ column, label: labels.get(column) || '', names: columns.get(column) }));
}

// 編號 → 永久狗 ID；不認得的編號不在回傳的 Map 裡
export async function dogIdsFor(db, numbers) {
  const out = new Map();
  if (!numbers.length) return out;
  const { results = [] } = await db.prepare(`SELECT number, dog_id FROM v3_dog_numbers WHERE number IN (${numbers.map(() => '?').join(',')})`).bind(...numbers).all();
  for (const r of results) out.set(r.number, r.dog_id);
  return out;
}

// 編號／名字 → 永久 ID，只查常溜的狗和手機問的舊格式鍵對到的狗（#406）；名字只在能唯一對應時轉，不猜同名狗。
export async function favoriteAliases(db, dogIds, keys = []) {
  const marks = list => list.map(() => '?').join(',');
  const uniqueNames = where => `SELECT name, MIN(dog_id) AS dog_id FROM v3_dogs WHERE name IN (${where}) GROUP BY name HAVING COUNT(*) = 1`;
  const numbers = keys.filter(k => !k.startsWith('名:')), names = keys.filter(k => k.startsWith('名:')).map(k => k.slice(2));
  const found = [];
  if (numbers.length) found.push(db.prepare(`SELECT dog_id FROM v3_dog_numbers WHERE number IN (${marks(numbers)})`).bind(...numbers));
  if (names.length) found.push(db.prepare(uniqueNames(marks(names))).bind(...names));
  const ids = [...new Set([...dogIds, ...(found.length ? await db.batch(found) : []).flatMap(r => (r.results || []).map(x => x.dog_id))])];
  if (!ids.length) return {};
  const [nums, named] = await db.batch([
    db.prepare(`SELECT number, dog_id FROM v3_dog_numbers WHERE dog_id IN (${marks(ids)})`).bind(...ids),
    db.prepare(uniqueNames(`SELECT name FROM v3_dogs WHERE dog_id IN (${marks(ids)})`)).bind(...ids),
  ]);
  return Object.fromEntries([
    ...(nums.results || []).map(r => [r.number, r.dog_id]),
    ...(named.results || []).map(r => [`名:${r.name}`, r.dog_id]),
  ]);
}

export async function readFavorites(db, codes, keys = []) {
  const people = await identitiesForCodes(db, codes);
  const rows = await db.prepare(`SELECT DISTINCT dog_id FROM v3_volunteer_favorites WHERE volunteer_id IN (${people.map(() => '?').join(',')})`).bind(...people.map(p => p.volunteerId)).all();
  const ids = (rows.results || []).map(r => r.dog_id);
  return { ids, aliases: await favoriteAliases(db, ids, keys) };
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

// 休養設定（#250）：編號 → { until, reason }，跟原本的 data/rest.json 一樣（不含 updatedAt），依編號排。
// scope（ADR 0014）：沒給是全部；'main' 是主清單上的狗；出所年份（departureYear）是那年離所、現在不在主清單上的狗
export async function readRest(db, scope) {
  const where = !scope ? '' : scope === 'main' ? ` WHERE t.${ON_MAIN}`
    : ` WHERE t.dog_id IN (SELECT dog_id FROM v3_departures WHERE ${departedIn(scope)}) AND NOT t.${ON_MAIN}`;
  const { results = [] } = await db.prepare(`SELECT ${NUMBER_OF} AS id, t.until_date, t.reason FROM v3_rest t${where}`).all();
  return sortedRest(results.filter(r => r.id).map(r => [r.id, { until: r.until_date, reason: r.reason }]));
}
export const sortedRest = entries => Object.fromEntries(entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));

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
export async function saveIntro(db, number, text, events) {
  const dogId = (await dogIdsFor(db, [number])).get(number);
  if (!dogId) return null;
  const old = await db.prepare('SELECT intro FROM v3_intros WHERE dog_id=?').bind(dogId).first();
  const before = old ? old.intro : '';
  if (events !== undefined) {
    const numbers = [...new Set(events.map(e => e.number).filter(Boolean))];
    const owners = await dogIdsFor(db, numbers);
    if (numbers.some(n => owners.get(n) !== dogId)) return { invalid: '事件編號不屬於這隻狗，請重新整理後確認' };
    const beforeEvents = await readIntakeEvents(db, dogId);
    await db.batch([
      text ? db.prepare('INSERT INTO v3_intros(dog_id,intro) VALUES(?,?) ON CONFLICT(dog_id) DO UPDATE SET intro=excluded.intro').bind(dogId, text)
        : db.prepare('DELETE FROM v3_intros WHERE dog_id=?').bind(dogId),
      db.prepare('DELETE FROM v3_intake_events WHERE dog_id=?').bind(dogId),
      ...events.map((e, position) => db.prepare('INSERT INTO v3_intake_events(dog_id,position,number,event_date,event) VALUES(?,?,?,?,?)').bind(dogId, position, e.number, e.date, e.event)),
    ]);
    return { dogId, before: { text: before, events: beforeEvents } };
  }
  if (text) await db.prepare('INSERT INTO v3_intros(dog_id,intro) VALUES(?,?) ON CONFLICT(dog_id) DO UPDATE SET intro=excluded.intro').bind(dogId, text).run();
  else await db.prepare('DELETE FROM v3_intros WHERE dog_id=?').bind(dogId).run();
  return { dogId, before };
}

// 舊編號（#289，ADR 0005）：誰都能補、都能刪；編輯紀錄由 Worker 記（ADR 0004）。
// 回 { ok: true, dogId } 或 { status, error }；number 是這隻狗現在（或任何一個）認得的編號
export async function addFormerNumber(db, number, former) {
  const ids = await dogIdsFor(db, [number, former]);
  const dogId = ids.get(number);
  if (!dogId) return { status: 404, error: '找不到這個編號的狗' };
  if (ids.has(former)) {
    if (ids.get(former) === dogId) return { status: 409, error: '這隻狗已經有這個編號了' };
    const other = await db.prepare('SELECT name FROM v3_dogs WHERE dog_id=?').bind(ids.get(former)).first('name');
    return { status: 409, error: `${former} 已經是另一隻狗（${other || '沒有名字'}）的編號，要合併請找 K` };
  }
  await db.prepare('INSERT INTO v3_dog_numbers(number,dog_id) VALUES(?,?)').bind(former, dogId).run();
  return { ok: true, dogId };
}

// 刪舊編號：只能刪這隻狗的，不能刪主清單上現在用的編號
export async function removeFormerNumber(db, number, former) {
  const ids = await dogIdsFor(db, [number, former]);
  const dogId = ids.get(number);
  if (!dogId) return { status: 404, error: '找不到這個編號的狗' };
  if (ids.get(former) !== dogId) return { status: 404, error: '這隻狗沒有這個舊編號' };
  if (await db.prepare('SELECT 1 FROM v3_sheet_main WHERE number=?').bind(former).first()) return { status: 409, error: '這是主清單上現在用的編號，不能刪' };
  await db.batch([
    db.prepare('DELETE FROM v3_sheet_former_numbers WHERE number=?').bind(former),
    db.prepare('DELETE FROM v3_dog_numbers WHERE number=?').bind(former),
  ]);
  return { ok: true, dogId };
}

// 出入所紀錄（#333，ADR 0011）：整份覆蓋，空陣列就刪掉這一列。before 是送出的人改之前看到的內容，
// 跟 D1 現在的不一樣（別人剛改過）就回 409，用條件式 SQL 確保兩支手機同時送也不會蓋掉。
// 回 { ok, dogId, before } 或 { status, error }；before 是 null 表示原本沒有紀錄
export async function saveStays(db, number, before, stays) {
  const dogId = (await dogIdsFor(db, [number])).get(number);
  if (!dogId) return { status: 404, error: '找不到這個編號的狗' };
  const conflict = { status: 409, error: '別人剛改過，請重新整理再改' };
  const old = before.length ? JSON.stringify(before) : null;
  const next = stays.length ? JSON.stringify(stays) : null;
  if (old === next) {
    const now = await db.prepare('SELECT stays_json FROM v3_stays WHERE dog_id=?').bind(dogId).first('stays_json');
    return (now ?? null) === old ? { ok: true, dogId, before: old && before } : conflict;
  }
  let r;
  if (!old) r = await db.prepare('INSERT INTO v3_stays(dog_id,stays_json) VALUES(?,?) ON CONFLICT(dog_id) DO NOTHING').bind(dogId, next).run();
  else if (!next) r = await db.prepare('DELETE FROM v3_stays WHERE dog_id=? AND stays_json=?').bind(dogId, old).run();
  else r = await db.prepare('UPDATE v3_stays SET stays_json=? WHERE dog_id=? AND stays_json=?').bind(next, dogId, old).run();
  if (!r.meta || !r.meta.changes) return conflict;
  return { ok: true, dogId, before: old && before };
}

// 出所年份（ADR 0014）：出所日的前 4 個字，日期不明是 'none'；跟 db/compact-schema.sql 觸發器的 CASE 一樣
export const departureYear = date => (date ? date.slice(0, 4) : 'none');
// 那一年的離所紀錄（WHERE 條件）：走 departed_date 索引。year 只會是版本號 JSON 的鍵，用 JSON 字串放進 SQL
function departedIn(year) {
  if (year === 'none') return "(departed_date IS NULL OR departed_date='')";
  const next = year.slice(0, -1) + String.fromCharCode(year.charCodeAt(year.length - 1) + 1);
  return `departed_date>=${sqlText(year)} AND departed_date<${sqlText(next)}`;
}
const sqlText = text => `'${String(text).replace(/'/g, "''")}'`;
// 依日期新到舊、同一天依編號
export const sortDepartures = list => list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.id.localeCompare(b.id));

// 離所紀錄（#259）：形狀跟原本的 data/departures.json 的 departures 一樣，依日期新到舊、同一天依編號。
// year 有給（ADR 0014）只讀那一年出所的
export async function readDepartures(db, year) {
  const where = year ? ` WHERE ${departedIn(year)}` : '';
  const inYear = column => year ? `${column} IN (SELECT ${column} FROM v3_departures${where})` : '';
  const [deps, items] = await db.batch([
    db.prepare(`SELECT * FROM v3_departures${where}`),
    db.prepare(`SELECT number, kind, value FROM v3_departure_items${year ? ` WHERE ${inYear('number')}` : ''} ORDER BY number, kind, position`),
  ]);
  const staysOf = await readAllStays(db, inYear('dog_id'));
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
    if (staysOf.has(r.dog_id)) entry.stays = staysOf.get(r.dog_id);
    if (r.last_number !== null) {
      const last = { cage: r.last_cage, id: r.last_number, name: r.last_name, walkedDate: r.last_walked_date, note: r.last_note, sex: r.last_sex, intro: r.last_intro };
      if (listOf.has(`${r.number}|former`)) last.formerIds = listOf.get(`${r.number}|former`);
      if (listOf.has(`${r.number}|group`)) last.groups = listOf.get(`${r.number}|group`);
      entry.last = last;
    }
    return entry;
  });
  return sortDepartures(list);
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
