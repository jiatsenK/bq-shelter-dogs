// 可能是同一隻（#774，ADR 0025）：確認消失的一般狗跟表上可能是同一隻的狗配成一組，管理者在資料頁按「合併」或「不是同一隻」。
// - 確認消失時（dog-list.js reconcileMissing）：同籠位、還在表上，而且同名或剛新出現（added_at 不早於第一次不見前 NEW_BEFORE_MS）的狗。
// - 確認之後才在同籠新建狗（dog-list.js applyMain）：GONE_KEEP_MS 內在這個籠位確認消失、還是待核對的狗。
// 這兩種寫入都放進呼叫端原本的 batch；INSERT OR IGNORE，按過「不是同一隻」的那一列留著，同一組不再建立。
// 每建一組記一筆修改紀錄「可能是同一隻」（#775 資料頁「系統自動判斷」列表）：紀錄排在配對前面，條件加「這一組還沒有」，跟配對同進同出。
// 合併照現有的合併狗（dog-merge.js），合併時把這一組記成已合併；配對本身不搬資料。
import { batchIf, isConflict } from './conditional-batch.js';
import { editError } from './dog-edit.js';
import { editLogWrites, SYSTEM_EDITOR } from './editlog.js';
import { nameKey } from './departure-rules.js';

// 先新增另一隻、才刪舊的那列（複製一列改好再刪舊的）：新的那隻在舊的第一次不見前一小時內加的也算「新出現」。
// 再早加的多半是原本就同籠的狗
export const NEW_BEFORE_MS = 3600000;
// 確認消失後這麼久內同籠新建狗才配對；再晚多半是真的新狗
export const GONE_KEEP_MS = 7 * 86400000;
const HEX = /^[a-f0-9]{32}$/;
const same = (a, b) => nameKey(a).toLowerCase() === nameKey(b).toLowerCase();
const NO_PAIR = 'NOT EXISTS(SELECT 1 FROM v3_dog_pairs WHERE gone_dog_id=? AND dog_id=?)';
// 「可能是同一隻」的紀錄：改前＝消失的那列（待核對那隻），改後＝表上那隻；when 是配對那句的條件
const pairLog = (db, at, gone, dog, [when, ...args]) => editLogWrites(db, { at, name: SYSTEM_EDITOR, kind: 'pair', dogId: gone.dog_id, number: gone.number,
  before: { name: gone.name, number: gone.number, cage: gone.cage }, after: { dogId: dog.dog_id, name: dog.name, number: dog.number, cage: dog.cage }, source: 'sheet' },
[`${NO_PAIR} AND ${when}`, gone.dog_id, dog.dog_id, ...args]);

// 確認消失 m（主清單複本的一列）時一起寫的句子：記下籠位、跟同籠可能是同一隻的狗配對。
// 條件「那一列已經不在」：確認的 DELETE 沒寫到（別的請求改過那列）就都不寫。list：同一批還在表上的列
export function goneWrites(db, m, list, at) {
  const gone = 'NOT EXISTS(SELECT 1 FROM v3_sheet_main WHERE row_index=? AND dog_id=?)';
  const since = Date.parse(m.missing_at) - NEW_BEFORE_MS;
  const pairs = list.filter(d => d.dog_id !== m.dog_id && d.cage === m.cage
    && (same(d.name, m.name) || (d.added_at && Date.parse(d.added_at) >= since)));
  return [
    db.prepare(`INSERT INTO v3_sheet_gone(dog_id,cage,gone_at) SELECT ?,?,? WHERE ${gone} ON CONFLICT(dog_id) DO UPDATE SET cage=excluded.cage,gone_at=excluded.gone_at`)
      .bind(m.dog_id, m.cage, at, m.row_index, m.dog_id),
    ...pairs.flatMap(d => [...pairLog(db, at, m, d, [gone, m.row_index, m.dog_id]),
      db.prepare(`INSERT OR IGNORE INTO v3_dog_pairs(gone_dog_id,dog_id,created_at) SELECT ?,?,? WHERE ${gone}`)
        .bind(m.dog_id, d.dog_id, at, m.row_index, m.dog_id)]),
  ];
}

// 同籠新建狗 dog（{ dog_id, name, number, cage }）時一起寫的句子：最近在這個籠位確認消失、還是待核對（狗還在、不在主清單、沒有離所紀錄）的狗。
// 紀錄要寫進待核對那隻的名字，先讀一次 v3_sheet_gone（照籠位走索引，只有新建狗才讀；新狗一週幾隻）
const STILL_GONE = `EXISTS(SELECT 1 FROM v3_dogs WHERE dog_id=g.dog_id) AND NOT EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=g.dog_id)
  AND NOT EXISTS(SELECT 1 FROM v3_dog_departures WHERE dog_id=g.dog_id)`;
export async function newDogPairs(db, dog, now) {
  const at = new Date(now).toISOString();
  const { results = [] } = await db.prepare(`SELECT g.dog_id,g.cage,d.name,(SELECT MIN(number) FROM v3_dog_numbers WHERE dog_id=g.dog_id) AS number
    FROM v3_sheet_gone g JOIN v3_dogs d ON d.dog_id=g.dog_id WHERE g.cage=? AND g.gone_at>=? AND g.dog_id<>? AND ${STILL_GONE}`)
    .bind(dog.cage, new Date(now - GONE_KEEP_MS).toISOString(), dog.dog_id).all();
  const still = `EXISTS(SELECT 1 FROM v3_sheet_gone g WHERE g.dog_id=? AND ${STILL_GONE})`;
  return results.flatMap(g => [...pairLog(db, at, { ...g, number: g.number || '' }, dog, [still, g.dog_id]),
    db.prepare(`INSERT OR IGNORE INTO v3_dog_pairs(gone_dog_id,dog_id,created_at) SELECT ?,?,? WHERE ${still}`).bind(g.dog_id, dog.dog_id, at, g.dog_id)]);
}

// 合併狗時一起寫：併掉的是這一組的待核對那隻、留下表上那隻，就記成已合併（從抽屜選同一組合併也算）。
// 併掉的那隻不再是待核對，籠位紀錄一起刪：取消合併拆回來後也不會再跟同籠新狗配對
export const mergedPairWrites = (db, targetId, sourceId, at) => [
  db.prepare("UPDATE v3_dog_pairs SET status='merged',decided_at=? WHERE gone_dog_id=? AND dog_id=? AND status='pending'").bind(at, sourceId, targetId),
  db.prepare('DELETE FROM v3_sheet_gone WHERE dog_id=?').bind(sourceId),
];

// 等確認的配對：待核對那隻還在、不在主清單、沒有離所紀錄，表上那隻還在主清單。一句、最新在上
const PENDING = `FROM v3_dog_pairs p JOIN v3_dogs g ON g.dog_id=p.gone_dog_id
  JOIN v3_sheet_main m ON m.row_index=(SELECT MIN(row_index) FROM v3_sheet_main WHERE dog_id=p.dog_id)
  WHERE p.status='pending' AND NOT EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=p.gone_dog_id)
  AND NOT EXISTS(SELECT 1 FROM v3_dog_departures WHERE dog_id=p.gone_dog_id)`;
export async function readPairs(db) {
  const { results = [] } = await db.prepare(`SELECT p.gone_dog_id,p.dog_id,p.created_at,g.name AS gone_name,m.name,m.number,m.cage ${PENDING} ORDER BY p.created_at DESC,p.gone_dog_id,p.dog_id`).all();
  const pairs = results.map(r => ({ goneDogId: r.gone_dog_id, dogId: r.dog_id, createdAt: r.created_at, goneName: r.gone_name, name: r.name, number: r.number, cage: r.cage }));
  return { count: pairs.length, pairs };
}

// 不是同一隻：這一組記成不是同一隻、記一筆修改紀錄，同一個 batch；已經不是等確認（別人先按了、已合併）就 409
export async function rejectPair(db, goneDogId, dogId, { actor } = {}, now = Date.now()) {
  if (!HEX.test(goneDogId) || !HEX.test(dogId)) throw editError(400, '找不到這組配對');
  if (!actor?.subject || !actor?.email) throw editError(403, '操作者未確認');
  const pair = await db.prepare(`SELECT p.gone_dog_id,g.name AS gone_name,m.name,m.number,m.cage ${PENDING} AND p.gone_dog_id=? AND p.dog_id=?`).bind(goneDogId, dogId).first();
  if (!pair) throw editError(404, '這組配對已經處理過或不在了，請重新讀取');
  const at = new Date(now).toISOString();
  const writes = [
    db.prepare("UPDATE v3_dog_pairs SET status='not_same',decided_at=? WHERE gone_dog_id=? AND dog_id=?").bind(at, goneDogId, dogId),
    ...editLogWrites(db, { at, name: '管理者', kind: 'not_same', dogId: goneDogId, before: { name: pair.gone_name },
      after: { dogId, name: pair.name, number: pair.number, cage: pair.cage }, source: 'access',
      actor: { requestId: crypto.randomUUID(), subject: actor.subject, email: actor.email } }),
  ];
  const pending = { sql: "SELECT status='pending' FROM v3_dog_pairs WHERE gone_dog_id=? AND dog_id=?", args: [goneDogId, dogId] };
  try { await batchIf(db, [pending], writes); }
  catch (error) { if (isConflict(error)) throw editError(409, '這組配對剛被處理過，請重新讀取'); throw error; }
  return { goneDogId, dogId, status: 'not_same' };
}
