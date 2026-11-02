// 待核對的狗記成已出所（K 2026-10-30）：待核對（不在主清單、沒有離所紀錄）原本只能合併，真的出所、離所沒記到的狗卡在那裡。
// - 管理者在資料頁按「記成已出所」，填離所日、原因（departDog）。
// - 狗清單同步收到「已出所」那一列、主清單複本已經沒有這隻時（確認消失之後才送到），用編號找到待核對的狗照樣記離所（dog-list.js applyDeparted）。
// 兩邊都寫一列 v3_dog_departures，判斷與寫法在 dog-standing.js。
import { batchIf, isConflict } from './conditional-batch.js';
import { dogRevisionIs, editError } from './dog-edit.js';
import { editLogWrites } from './editlog.js';
import { taiwanYmd } from './sync-plan.js';
import { pendingDog, pendingDepartureWrite, shownNumber } from './dog-standing.js';

const HEX = /^[a-f0-9]{32}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const DEPART_REASONS = ['adopt', 'death', 'other'];

// 管理者按「記成已出所」：input { revision, date, reason }。編號用這隻狗最新的編號；沒編號的狗不開放（#560 沒編號的不記離所）。
// 跟抽屜同一個 revision 擋；已經不是待核對（同步先記了、被合併、回到主清單）回 409
export async function departDog(db, dogId, input, { actor } = {}, now = Date.now()) {
  if (!HEX.test(dogId)) throw editError(404, '找不到這隻狗');
  if (!actor?.subject || !actor?.email) throw editError(403, '操作者未確認');
  if (!input || Object.keys(input).sort().join(',') !== 'date,reason,revision' || !Number.isSafeInteger(input.revision))
    throw editError(400, '請重新讀取後再記');
  const today = taiwanYmd(now);
  const { date, reason } = input;
  if (typeof date !== 'string' || !YMD.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || date > today)
    throw editError(400, '離所日請填今天以前的日期');
  if (!DEPART_REASONS.includes(reason)) throw editError(400, '離所原因請選認養、離世或其他');
  const dog = await db.prepare(`SELECT d.name,s.revision,${shownNumber('d.dog_id')} AS number,${pendingDog('d.dog_id')} AS pending
    FROM v3_dogs d JOIN v3_dog_edit_state s USING(dog_id) WHERE d.dog_id=?`).bind(dogId).first();
  if (!dog) throw editError(404, '找不到這隻狗');
  if (!dog.pending) throw editError(409, '這隻狗已經不是待核對，請重新讀取');
  if (!dog.number) throw editError(409, '沒有編號的狗不能記成已出所，請先在出入所紀錄補編號');
  if (dog.revision !== input.revision) throw editError(409, '這隻狗的資料已變更，請重新讀取後再記');
  const at = new Date(now).toISOString();
  const after = { number: dog.number, date, reason };
  const writes = [
    pendingDepartureWrite(db, { dogId, number: dog.number, date, dateSource: 'manual', today, reason }),
    ...editLogWrites(db, { at, name: '管理者', kind: 'depart', dogId, number: dog.number, before: null, after, source: 'access',
      actor: { requestId: crypto.randomUUID(), subject: actor.subject, email: actor.email } }),
  ];
  try { await batchIf(db, [dogRevisionIs(dogId, input.revision), { sql: pendingDog(), args: [dogId, dogId] }], writes); }
  catch (error) { if (isConflict(error, { unique: true })) throw editError(409, '這隻狗的資料剛被改過，請重新讀取後再記'); throw error; }
  return { dogId, departure: after };
}
