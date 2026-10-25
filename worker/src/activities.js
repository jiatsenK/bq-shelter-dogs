// 活動紀錄（#270，docs/adr/0002-activity-records.md）：動保小小兵、認養會每場出席的狗，存 D1 的 v3_activities／v3_activity_dogs。
// 任何人選好名字就能新增、修改、刪除（ADR 0004），index.js 記編輯紀錄。不寫試算表，同步不碰。
// 出席的狗用永久 ID（dog_id）；舊名單對不上的只存名字（dog_id 是 NULL），之後再接上。

export const ACTIVITY_KINDS = { kids: '動保小小兵', adoption: '認養會' };
export const ACTIVITY_MAX_DOGS = 60;
const DOG_NAME_MAX = 20;
// 最多可以先記一年後的活動（排好的場次）
const FUTURE_DAYS = 366;

export class ActivityError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function validDate(s, today) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (isNaN(d) || d.toISOString().slice(0, 10) !== s || s < '2000-01-01') return false;
  const last = new Date(`${today}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() + FUTURE_DAYS);
  return d <= last;
}

// 網站送來的一場：{ date, kind, dogs: [{ number } | { dogId } | { name }] }。不合格丟 ActivityError(400)
export function cleanActivity(input, today) {
  if (!input || typeof input !== 'object') throw new ActivityError(400, '格式不對');
  if (!validDate(input.date, today)) throw new ActivityError(400, '日期看不懂');
  if (!Object.hasOwn(ACTIVITY_KINDS, input.kind)) throw new ActivityError(400, '活動類型只能是動保小小兵或認養會');
  if (!Array.isArray(input.dogs)) throw new ActivityError(400, '出席名單格式不對');
  if (input.dogs.length > ACTIVITY_MAX_DOGS) throw new ActivityError(400, `一場最多 ${ACTIVITY_MAX_DOGS} 隻`);
  const dogs = input.dogs.map(d => {
    const text = k => (d && typeof d[k] === 'string' ? d[k].trim() : '');
    if (/^[0-9A-Za-z]{1,32}$/.test(text('dogId'))) return { dogId: text('dogId') };
    if (/^[0-9A-Za-z]{1,32}$/.test(text('number'))) return { number: text('number') };
    const name = text('name').replace(/\s+/g, ' ');
    if (name && [...name].length <= DOG_NAME_MAX) return { name };
    throw new ActivityError(400, `出席的狗要有編號或名字（名字最多 ${DOG_NAME_MAX} 字）`);
  });
  return { date: input.date, kind: input.kind, dogs };
}

const placeholders = list => list.map(() => '?').join(',');

// 編號／永久 ID → 狗；名字照原樣存（不猜同名的狗）。同一隻狗、同一個名字只留第一次。
// 回傳 [{ dogId, name }]，dogId 是 null 表示只有名字
export async function resolveDogs(db, dogs) {
  const numbers = dogs.filter(d => d.number).map(d => d.number);
  const ids = dogs.filter(d => d.dogId).map(d => d.dogId);
  const byNumber = new Map(), byId = new Map();
  if (numbers.length) {
    const { results = [] } = await db.prepare(`SELECT n.number, d.dog_id, d.name FROM v3_dog_numbers n JOIN v3_dogs d USING(dog_id) WHERE n.number IN (${placeholders(numbers)})`).bind(...numbers).all();
    for (const r of results) byNumber.set(r.number, r);
  }
  if (ids.length) {
    const { results = [] } = await db.prepare(`SELECT dog_id, name FROM v3_dogs WHERE dog_id IN (${placeholders(ids)})`).bind(...ids).all();
    for (const r of results) byId.set(r.dog_id, r);
  }
  const out = [], seen = new Set();
  for (const d of dogs) {
    const row = d.number ? byNumber.get(d.number) : d.dogId ? byId.get(d.dogId) : null;
    if ((d.number || d.dogId) && !row) throw new ActivityError(400, `找不到編號 ${d.number || d.dogId} 的狗，請重新整理後再選`);
    const dog = row ? { dogId: row.dog_id, name: row.name } : { dogId: null, name: d.name };
    const key = dog.dogId || `名:${dog.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dog);
  }
  return out;
}

// 狗現在的編號：最新的那個（編號前 8 碼是入所日，主清單上的就是最新的）；照 v3_numbers_dog 索引找，沒有編號是 ''
const DOG_ROWS = `SELECT a.activity_id, a.position, a.dog_id, COALESCE(d.name, a.name) AS name,
  COALESCE((SELECT MAX(n.number) FROM v3_dog_numbers n WHERE n.dog_id=a.dog_id), '') AS number
  FROM v3_activity_dogs a LEFT JOIN v3_dogs d USING(dog_id)`;

function shape(rows, dogRows) {
  const dogsOf = new Map();
  for (const r of dogRows) {
    if (!dogsOf.has(r.activity_id)) dogsOf.set(r.activity_id, []);
    dogsOf.get(r.activity_id).push({ dogId: r.dog_id || null, number: r.number || '', name: r.name });
  }
  return rows.map(r => ({ id: r.activity_id, date: r.activity_date, kind: r.kind, revision: r.revision, dogs: dogsOf.get(r.activity_id) || [] }));
}

// 全部場次，新到舊。ADR 0009 的做法：每次只讀版本號那 1 列（活動、狗名／編號各一個），沒變就回記憶體裡的名單；
// 有人改了活動或同步改了狗，才整份重讀（一年約 24 場）
let cache = null; // { db, ver, list }
async function versionOf(db) {
  const v = await db.prepare('SELECT (SELECT ver FROM v3_activity_versions WHERE id=1) AS act, (SELECT small FROM v3_pack_versions WHERE id=1) AS dogs').first();
  return v && v.act !== null ? `${v.act}|${v.dogs}` : null;
}
export async function readActivities(db) {
  const ver = await versionOf(db);
  if (ver && cache && cache.db === db && cache.ver === ver) return cache.list;
  const [acts, dogs] = await db.batch([
    db.prepare('SELECT activity_id, activity_date, kind, revision FROM v3_activities ORDER BY activity_date DESC, activity_id'),
    db.prepare(`${DOG_ROWS} ORDER BY a.activity_id, a.position`),
  ]);
  const list = shape(acts.results || [], dogs.results || []);
  cache = ver ? { db, ver, list } : null;
  return list;
}

export async function readActivity(db, id) {
  const [acts, dogs] = await db.batch([
    db.prepare('SELECT activity_id, activity_date, kind, revision FROM v3_activities WHERE activity_id=?').bind(id),
    db.prepare(`${DOG_ROWS} WHERE a.activity_id=? ORDER BY a.position`).bind(id),
  ]);
  return shape(acts.results || [], dogs.results || [])[0] || null;
}

// 編輯紀錄存的樣子：日期、類型、出席的狗名；dogIds 是同順序的永久 ID（只有名字的是 null），誤刪時照它接回原本的狗
export function activityLog(a) {
  return a && { date: a.date, kind: a.kind, dogs: a.dogs.map(d => d.name), dogIds: a.dogs.map(d => d.dogId || null) };
}

const insertDogs = (db, id, dogs) => dogs.map((d, i) => db.prepare('INSERT INTO v3_activity_dogs(activity_id,position,dog_id,name) VALUES(?,?,?,?)').bind(id, i, d.dogId, d.name));

// audit（管理網站，#567）：({ before, after }, 條件 SQL, 條件參數) → 紀錄的 statements，跟活動修改放同一個 batch，
// 紀錄寫不進去就整批回復。條件確保別人先改了／刪了時不留紀錄。志工網站不傳，照舊由 index.js 事後記。
const auditOf = (audit, change, when = '1', args = []) => (audit ? audit(change, when, args) : []);
const unchangedWhen = 'EXISTS(SELECT 1 FROM v3_activities WHERE activity_id=? AND revision=?)';

export async function createActivity(db, { date, kind, dogs }, audit) {
  const id = crypto.randomUUID().replace(/-/g, '');
  await db.batch([
    db.prepare('INSERT INTO v3_activities(activity_id,activity_date,kind) VALUES(?,?,?)').bind(id, date, kind),
    ...insertDogs(db, id, dogs),
    ...auditOf(audit, { before: null, after: { date, kind, dogs } }),
  ]);
  return readActivity(db, id);
}

const CHANGED = '這場活動剛被別人改過，請重新整理後再改';
// 先確認還是打開時看到的那一版（revision），整批寫；中途被別人改了整批回復
async function readUnchanged(db, id, revision) {
  const before = await readActivity(db, id);
  if (!before) throw new ActivityError(404, '找不到這場活動（可能已經被刪掉），請重新整理');
  if (before.revision !== revision) throw new ActivityError(409, CHANGED);
  return before;
}
const guard = (db, id, revision) => db.prepare('INSERT INTO v3_activity_guard SELECT CASE WHEN revision=? THEN 1 ELSE 0 END FROM v3_activities WHERE activity_id=?').bind(revision, id);

async function batchUnlessChanged(db, statements) {
  try {
    return await db.batch(statements);
  } catch (e) {
    if (/CHECK constraint|FOREIGN KEY/i.test(e.message)) throw new ActivityError(409, CHANGED);
    throw e;
  }
}

export async function updateActivity(db, id, revision, { date, kind, dogs }, audit) {
  const before = await readUnchanged(db, id, revision);
  await batchUnlessChanged(db, [
    guard(db, id, revision),
    ...auditOf(audit, { before, after: { date, kind, dogs } }, unchangedWhen, [id, revision]),
    db.prepare('UPDATE v3_activities SET activity_date=?, kind=?, revision=revision+1 WHERE activity_id=?').bind(date, kind, id),
    db.prepare('DELETE FROM v3_activity_dogs WHERE activity_id=?').bind(id),
    ...insertDogs(db, id, dogs),
    db.prepare('DELETE FROM v3_activity_guard'),
  ]);
  return { before, after: await readActivity(db, id) };
}

export async function deleteActivity(db, id, revision, audit) {
  const before = await readUnchanged(db, id, revision);
  const results = await batchUnlessChanged(db, [
    guard(db, id, revision),
    ...auditOf(audit, { before, after: null }, unchangedWhen, [id, revision]),
    db.prepare('DELETE FROM v3_activities WHERE activity_id=?').bind(id),
    db.prepare('DELETE FROM v3_activity_guard'),
  ]);
  // 讀完到寫入之間被別人刪掉：什麼都沒刪，不回成功（只在管理網站檢查，志工網站行為不變）
  if (audit && !results.at(-2).meta.changes) throw new ActivityError(404, '找不到這場活動（可能已經被刪掉），請重新整理');
  return { before };
}
