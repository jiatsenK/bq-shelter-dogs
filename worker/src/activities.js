// 活動紀錄（docs/adr/0002-activity-records.md，#270）：動保小小兵、認養會每場出席的狗，存 D1。
// 任何選好名字的人都能新增、修改、刪除；每次改動記一筆編輯紀錄（kind 'activity'，改前→改後是整場內容）。
// 出席可以只有名字（舊名單對不上狗），dogId 是 null；之後補建狗卡再接上。

export const ACTIVITY_KINDS = { kids: '動保小小兵', adoption: '認養會' };
export const ACTIVITY_DOGS_MAX = 100;
const NAME_MAX = 20;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ActivityError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// 全部場次，新到舊：[{ id, date, kind, dogs: [{ dogId, name, number }] }]
// 對上狗的顯示現在的名字和最新編號（在所的才有編號）；只有名字的照存的名字
export async function readActivities(db) {
  const [acts, dogs] = await db.batch([
    db.prepare('SELECT id,activity_date,kind FROM v3_activities'),
    db.prepare(`SELECT a.activity_id,a.position,a.dog_id,a.name,d.name AS dog_name,m.number
      FROM v3_activity_dogs a LEFT JOIN v3_dogs d ON d.dog_id=a.dog_id LEFT JOIN v3_sheet_main m ON m.dog_id=a.dog_id`),
  ]);
  const byId = new Map((acts.results || []).map(r => [r.id, { id: r.id, date: r.activity_date, kind: r.kind, dogs: [] }]));
  const rows = (dogs.results || []).sort((a, b) => a.position - b.position);
  for (const r of rows) {
    const act = byId.get(r.activity_id);
    if (act) act.dogs.push({ dogId: r.dog_id || null, name: r.dog_name || r.name, number: r.number || '' });
  }
  return [...byId.values()].sort((a, b) => (a.date === b.date ? a.kind.localeCompare(b.kind) : a.date < b.date ? 1 : -1));
}

async function readOne(db, id) {
  return (await readActivities(db)).find(a => a.id === id) || null;
}

// 網站送來的 { date, kind, dogs: [{ dogId } | { number } | { name }] } → 檢查並把編號換成永久 ID
export async function cleanActivity(db, input) {
  const date = typeof input?.date === 'string' ? input.date : '';
  if (!DATE.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z'))) throw new ActivityError(400, '活動日期格式不對');
  if (!Object.hasOwn(ACTIVITY_KINDS, input.kind)) throw new ActivityError(400, '活動類型只能是動保小小兵或認養會');
  if (!Array.isArray(input.dogs) || input.dogs.length > ACTIVITY_DOGS_MAX) throw new ActivityError(400, `出席名單最多 ${ACTIVITY_DOGS_MAX} 隻`);
  const dogs = [];
  const seen = new Set();
  for (const d of input.dogs) {
    let dogId = null, name = '';
    if (typeof d?.dogId === 'string' && d.dogId) {
      const row = await db.prepare('SELECT dog_id,name FROM v3_dogs WHERE dog_id=?').bind(d.dogId).first();
      if (!row) throw new ActivityError(400, '出席名單有找不到的狗，請重新整理後再試');
      ({ dog_id: dogId, name } = row);
    } else if (typeof d?.number === 'string' && d.number) {
      const row = await db.prepare('SELECT d.dog_id,d.name FROM v3_dog_numbers n JOIN v3_dogs d ON d.dog_id=n.dog_id WHERE n.number=?').bind(d.number).first();
      if (!row) throw new ActivityError(400, `找不到編號 ${d.number} 的狗`);
      ({ dog_id: dogId, name } = row);
    } else {
      name = typeof d?.name === 'string' ? d.name.trim() : '';
      if (!name || [...name].length > NAME_MAX) throw new ActivityError(400, `狗名要 1–${NAME_MAX} 個字`);
    }
    const key = dogId || 'name:' + name;
    if (seen.has(key)) continue;
    seen.add(key);
    dogs.push({ dogId, name });
  }
  return { date, kind: input.kind, dogs };
}

function writeStatements(db, id, act) {
  return act.dogs.map((d, i) => db.prepare('INSERT INTO v3_activity_dogs(activity_id,position,dog_id,name) VALUES(?,?,?,?)').bind(id, i, d.dogId, d.name));
}

// 新增一場，回傳讀回的內容
export async function createActivity(db, act) {
  const row = await db.prepare('INSERT INTO v3_activities(activity_date,kind) VALUES(?,?) RETURNING id').bind(act.date, act.kind).first();
  if (act.dogs.length) await db.batch(writeStatements(db, row.id, act));
  return readOne(db, row.id);
}

// 整場換掉（日期、類型、出席名單）；回傳 { before, after }，找不到回 null
export async function updateActivity(db, id, act) {
  const before = await readOne(db, id);
  if (!before) return null;
  await db.batch([
    db.prepare('UPDATE v3_activities SET activity_date=?,kind=? WHERE id=?').bind(act.date, act.kind, id),
    db.prepare('DELETE FROM v3_activity_dogs WHERE activity_id=?').bind(id),
    ...writeStatements(db, id, act),
  ]);
  return { before, after: await readOne(db, id) };
}

// 刪除一場；回傳刪掉前的內容（編輯紀錄留著，誤刪靠它還原），找不到回 null
export async function deleteActivity(db, id) {
  const before = await readOne(db, id);
  if (!before) return null;
  await db.batch([
    db.prepare('DELETE FROM v3_activity_dogs WHERE activity_id=?').bind(id),
    db.prepare('DELETE FROM v3_activities WHERE id=?').bind(id),
  ]);
  return before;
}
