// 合併兩隻狗（K 2026-10-26，#621 方案乙）：試算表改編號或先打名字後補編號，D1 會多出一隻狗；管理者在管理網站把多出來的那隻併到留下的那隻。
// - 被併的那隻不能在主清單上（主清單上的狗由試算表管）。兩隻都帶讀取時的版本，任何一隻在預覽後變過就 409。
// - 掛在被併那隻身上的列全部搬到留下的那隻。溜狗紀錄不丟：同一天兩邊都有時，被併那隻的志工接在後面（同一位志工不重複記）。
//   只能留一份的（介紹、休養、同一個編號的離所紀錄、同一位志工的常溜／開卡）留「留下那隻」的，預覽列出會丟的內容。
//   出入所紀錄（ADR 0021）兩邊全部接在一起：編號跟著搬，手填的紀錄併成留下那隻的一列（replaces），留下那隻原本那列存在紀錄裡，取消合併放回去。
// - 被併那隻從 v3_dogs 刪掉；它原本的每一列存成一筆 v3_edit_log（kind=merge），取消合併照這份快照整筆拆回來（K 選「刪掉、留快照可還原」）。
// - 一個 D1 batch：每張表固定 1–2 句（整批列用 json_each 帶進去），不隨列數變多；各表既有觸發器讓資料包失效。
// - 免費方案每次呼叫最多 50 次 D1 查詢：兩隻狗一起讀（每張表 1 句），每張表都有資料時合併與取消合併都在 50 句以內（dog-merge.test.mjs 量）。
// - 讀寫都用 dog_id 篩；SCAN_OK 這幾張表沒有 dog_id 開頭的索引，會整張掃。合併是管理者偶爾按的操作、這幾張表都小，
//   不為它加索引（加索引每次寫入都多寫一列）；dog-merge.test.mjs 用查詢計畫確認其他表都走索引（CODING_STANDARDS.md D1）。
import { dogRevisionIs, editError } from './dog-edit.js';
import { batchIf, isConflict } from './conditional-batch.js';
import { editLogWrites } from './editlog.js';
import { joinStays, withoutStays } from './stays.js';

export const SCAN_OK = {
  v3_photos: '只有主照片的部分索引；一隻狗只有幾張新照片',
  v3_volunteer_favorites: '主鍵 (volunteer_id,dog_id)；志工數×常溜的狗，幾百列',
  v3_volunteer_cards: '主鍵 (volunteer_id,dog_id)；同上',
  v3_card_opened: '主鍵 (walker_code,dog_id)；舊代號開卡，只減不增',
  v3_walk_state: '主鍵 dog_key；一隻狗最多一列',
};
const conflict = () => editError(409, '兩隻狗的資料在預覽後有變動，請重新預覽再合併');
const sameDay = (row, mine) => mine.some(k => k.walk_date === row.walk_date && k.walker_code === row.walker_code);
// 每張表：label 顯示用；move(row, ctx) 回傳搬到留下那隻的樣子，回 null＝留下那隻已經有一份、不搬（只留在快照裡）。
// replaces：搬過去的列取代留下那隻原本的列（一隻狗只有一列的表）
const TABLES = [
  { table: 'v3_dog_numbers', label: '編號', move: row => row },
  // 沒編號時溜的紀錄記成留下那隻的目前編號，志工網站的溜狗紀錄才對得到牠；同一天兩邊都有就接在後面
  { table: 'v3_walks', label: '溜狗紀錄', move: (row, { mine, number, walks }) => {
    if (sameDay(row, mine) || sameDay(row, walks)) return null;
    const day = [...mine, ...walks].filter(w => w.walk_date === row.walk_date);
    const position = day.length ? Math.max(...day.map(w => w.position)) + 1 : row.position;
    return { ...row, position, dog_number: row.dog_number || number };
  } },
  { table: 'v3_intros', label: '介紹', move: (row, { mine }) => (mine.length ? null : row) },
  { table: 'v3_rest', label: '休養', move: (row, { mine }) => (mine.length ? null : row) },
  { table: 'v3_stays', label: '出入所紀錄', replaces: true, move: (row, { mine }) => (mine.length ? { ...row, stays_json: joinStays(mine[0].stays_json, row.stays_json) } : row) },
  // 只當一般照片搬過去：留下那隻的主照片可能在舊固定路徑（R2），不能被蓋掉
  { table: 'v3_photos', label: '照片', move: row => ({ ...row, is_primary: 0 }) },
  // 被併的狗離所過、留下的狗在所：跟再入所一樣，記用哪個編號回來
  { table: 'v3_dog_departures', label: '離所紀錄', move: (row, { mine, onMain, number }) =>
    mine.some(k => k.number === row.number) ? null : { ...row, returned_number: onMain && !row.returned_number ? number : row.returned_number } },
  { table: 'v3_activity_dogs', label: '活動出席', move: row => row },
  { table: 'v3_volunteer_favorites', label: '常溜', move: (row, { mine }) => (mine.some(k => k.volunteer_id === row.volunteer_id) ? null : row) },
  { table: 'v3_volunteer_cards', label: '開卡', move: (row, { mine }) => (mine.some(k => k.volunteer_id === row.volunteer_id) ? null : row) },
  { table: 'v3_card_opened', label: '開卡（舊代號）', move: (row, { mine }) => (mine.some(k => k.walker_code === row.walker_code) ? null : row) },
  // 暫住紀錄（#772）以表上的暫住列為主鍵，跟著搬到留下那隻
  { table: 'v3_sheet_stays', label: '暫住', move: row => row },
];
// 今日溜狗狀態以 dog_key（編號或名字）為主鍵、出站佇列掛在它上面，不能刪掉重建；只改 dog_id
const WALK_STATE = { table: 'v3_walk_state', label: '今日溜狗狀態' };
const HEX = /^[a-f0-9]{32}$/;

const json = JSON.stringify;
const marks = ids => ids.map(() => '?').join(',');
const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];
// 一句讀兩隻（或一隻）狗：名字、revision、目前編號、所有編號
async function dogsOf(db, ...ids) {
  const found = await all(db, `SELECT d.dog_id,d.name,d.sex,d.fixed_care,s.revision,
    (SELECT number FROM v3_sheet_main WHERE dog_id=d.dog_id ORDER BY row_index LIMIT 1) AS current_number,
    (SELECT json_group_array(number) FROM (SELECT number FROM v3_dog_numbers WHERE dog_id=d.dog_id ORDER BY number)) AS numbers
    FROM v3_dogs d JOIN v3_dog_edit_state s USING(dog_id) WHERE d.dog_id IN (${marks(ids)})`, ...ids);
  return ids.map(id => {
    const dog = found.find(d => d.dog_id === id);
    if (!dog) return null;
    const numbers = JSON.parse(dog.numbers);
    // 顯示用的編號：在所用目前編號，不在所用最新的舊編號
    return { ...dog, onMain: dog.current_number !== null, numbers, shown: dog.current_number || numbers.at(-1) || '' };
  });
}
// 每張表一句，兩隻狗的列一起讀再分開
async function rowsOf(db, ...ids) {
  const out = ids.map(() => ({}));
  for (const { table } of [...TABLES, WALK_STATE]) {
    const rows = await all(db, `SELECT * FROM ${table} WHERE dog_id IN (${marks(ids)})`, ...ids);
    ids.forEach((id, i) => { out[i][table] = rows.filter(r => r.dog_id === id); });
  }
  return out;
}
const counts = rows => Object.fromEntries(TABLES.concat(WALK_STATE)
  .map(({ table, label }) => [label, (rows[table] || []).length]).filter(([, n]) => n));
const publicDog = dog => ({ dogId: dog.dog_id, name: dog.name, number: dog.shown, numbers: dog.numbers, revision: dog.revision, onMain: dog.onMain });

// 整批列：刪掉「每一欄都跟這份一樣」的列、照這份插回去。先用 dog_id 篩（走索引），欄名來自 SELECT *、表名來自固定清單。
// 同一批的列都屬於同一隻狗。
function deleteRows(db, table, rows) {
  const cols = Object.keys(rows[0]);
  return db.prepare(`DELETE FROM ${table} WHERE ${table}.dog_id=? AND EXISTS(SELECT 1 FROM json_each(?) WHERE ${cols.map(c => `${table}.${c} IS json_extract(value,'$.${c}')`).join(' AND ')})`)
    .bind(rows[0].dog_id, json(rows));
}
function insertRows(db, table, rows, ignore = false) {
  const cols = Object.keys(rows[0]);
  return db.prepare(`INSERT${ignore ? ' OR IGNORE' : ''} INTO ${table}(${cols.join(',')}) SELECT ${cols.map(c => `json_extract(value,'$.${c}')`).join(',')} FROM json_each(?)`).bind(json(rows));
}

// 算出：哪些列搬過去（搬過去長什麼樣子）、哪些列因為留下那隻已經有一份而不搬
async function plan(db, targetId, sourceId) {
  if (!HEX.test(targetId) || !HEX.test(sourceId)) throw editError(400, '請選要合併的狗');
  if (targetId === sourceId) throw editError(400, '不能跟自己合併');
  const [target, source] = await dogsOf(db, targetId, sourceId);
  if (!target || !source) throw editError(404, '找不到這隻狗，請重新讀取');
  if (source.onMain) throw editError(409, '要併掉的狗還在試算表主清單上；請併到牠身上，或先在試算表處理');
  const [targetRows, rows] = await rowsOf(db, targetId, sourceId);
  const moved = {}, notMoved = {}, replaced = {};
  for (const { table, move, replaces } of TABLES) {
    moved[table] = []; notMoved[table] = [];
    if (replaces && rows[table].length && targetRows[table].length) replaced[table] = targetRows[table];
    for (const row of rows[table]) {
      const next = move(row, { mine: targetRows[table], walks: moved[table], number: target.current_number || '', onMain: target.onMain });
      if (next) moved[table].push({ ...next, dog_id: targetId });
      else notMoved[table].push(row);
    }
  }
  return { target, source, rows, moved, notMoved, replaced };
}

export async function previewMerge(db, targetId, sourceId) {
  const { target, source, rows, moved, notMoved } = await plan(db, targetId, sourceId);
  return {
    target: publicDog(target), source: publicDog(source),
    moved: counts({ ...moved, v3_walk_state: rows.v3_walk_state }),
    kept: counts(notMoved),
    // 只留一份、會丟掉的內容讓管理者先看（快照裡還有，取消合併拿得回來）
    lost: {
      ...(notMoved.v3_intros.length ? { 介紹: notMoved.v3_intros[0].intro } : {}),
      ...(notMoved.v3_rest.length ? { 休養: `${notMoved.v3_rest[0].until_date} ${notMoved.v3_rest[0].reason}`.trim() } : {}),
    },
  };
}

function logStatements(db, kind, targetId, number, before, after, actor, requestId) {
  return editLogWrites(db, { at: new Date().toISOString(), name: '管理者', kind, dogId: targetId, number, before, after, source: 'access',
    actor: { requestId, subject: actor.subject, email: actor.email } });
}
function checkInput(input, keys, actor) {
  if (!input || Object.keys(input).sort().join(',') !== keys || !Number.isSafeInteger(input.revision)) throw editError(400, '請重新預覽後再合併');
  if (!actor?.subject || !actor?.email) throw editError(403, '操作者未確認');
}
// 寫入被約束擋下（版本不對、外鍵、主鍵撞到）整批不寫，回 409 讓管理者重新讀取
async function runBatch(db, conditions, writes, message) {
  try { return await batchIf(db, conditions, writes); }
  catch (error) { if (isConflict(error, { unique: true })) throw editError(409, message); throw error; }
}

export async function mergeDogs(db, targetId, input, { actor } = {}) {
  checkInput(input, 'revision,sourceId,sourceRevision', actor);
  if (typeof input.sourceId !== 'string' || !Number.isSafeInteger(input.sourceRevision)) throw editError(400, '請重新預覽後再合併');
  const { target, source, rows, moved, notMoved, replaced } = await plan(db, targetId, input.sourceId);
  if (target.revision !== input.revision || source.revision !== input.sourceRevision) throw conflict();
  const sourceId = source.dog_id, requestId = crypto.randomUUID();
  const writes = [];
  for (const { table } of TABLES) {
    if (rows[table].length) writes.push(deleteRows(db, table, rows[table]));
    if (replaced[table]) writes.push(deleteRows(db, table, replaced[table]));
    if (moved[table].length) writes.push(insertRows(db, table, moved[table]));
  }
  if (rows.v3_walk_state.length) writes.push(db.prepare('UPDATE v3_walk_state SET dog_id=? WHERE dog_id=?').bind(targetId, sourceId));
  // 入所事件（#285）不再用（ADR 0022，#667），表等下一張 PR 才 DROP；被併那隻還留著的列不搬，只刪掉，不然外鍵擋住刪狗。DROP 時一起拿掉這句
  writes.push(db.prepare('DELETE FROM v3_intake_events WHERE dog_id=?').bind(sourceId));
  // 沒刪乾淨（讀完後又多了列）時，刪狗會被外鍵擋下，整批不寫
  writes.push(db.prepare('DELETE FROM v3_dog_edit_state WHERE dog_id=?').bind(sourceId),
    db.prepare('DELETE FROM v3_dogs WHERE dog_id=?').bind(sourceId),
    // 溜狗紀錄不帶版本觸發器：明確加一次，留下那隻開著的草稿才會被擋
    db.prepare('UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id=?').bind(targetId));
  const sourceDog = { dog_id: source.dog_id, name: source.name, sex: source.sex, fixed_care: source.fixed_care };
  const logAt = writes.length;
  writes.push(...logStatements(db, 'merge', targetId, target.shown,
    { name: source.name, numbers: source.numbers, counts: counts(rows), snapshot: { dog: sourceDog, rows } },
    { sourceId, name: target.name, number: target.shown, moved: counts({ ...moved, v3_walk_state: rows.v3_walk_state }), kept: counts(notMoved), rows: moved, replaced },
    actor, requestId));
  const result = await runBatch(db, [dogRevisionIs(targetId, input.revision), dogRevisionIs(sourceId, input.sourceRevision)], writes, '合併沒寫成：兩隻狗的資料在預覽後有變動，或有資料撞在一起；資料沒有改，請重新預覽再試');
  return { logId: result[logAt].meta.last_row_id, target: { ...publicDog(target), revision: null } };
}

// 取消合併：照快照重建被併的那隻、插回牠原本的每一列；當時搬過去的列只在「每一欄都沒變」時從留下那隻刪掉。
// 合併後留下那隻又改過的列（例如試算表重寫了那天的溜狗）算留下那隻自己的資料，不動。
// #667 以前的快照還有 v3_intake_events：不在 TABLES 裡，照樣跳過，不插回也不刪。
export async function unmergeDogs(db, targetId, input, { actor } = {}) {
  checkInput(input, 'logId,revision', actor);
  if (!Number.isSafeInteger(input.logId)) throw editError(400, '找不到這筆合併紀錄');
  const log = await db.prepare("SELECT * FROM v3_edit_log WHERE id=? AND kind='merge' AND dog_id=?").bind(input.logId, targetId).first();
  if (!log) throw editError(404, '找不到這筆合併紀錄');
  const before = JSON.parse(log.before_json), after = JSON.parse(log.after_json);
  const { dog, rows } = before.snapshot;
  if (await db.prepare('SELECT 1 FROM v3_dogs WHERE dog_id=?').bind(dog.dog_id).first()) throw editError(409, '這筆合併已經取消過了');
  if (await db.prepare("SELECT 1 FROM v3_edit_log WHERE id>? AND kind IN ('merge','unmerge') AND json_extract(after_json,'$.sourceId')=?").bind(log.id, dog.dog_id).first())
    throw editError(409, '這隻狗之後又合併或取消過，請從最新一筆處理');
  const [target] = await dogsOf(db, targetId);
  if (!target) throw editError(404, '找不到這隻狗，請重新讀取');
  if (target.revision !== input.revision) throw editError(409, '這隻狗的資料已變更，請重新讀取再取消合併');
  const requestId = crypto.randomUUID();
  // 出入所紀錄（ADR 0021）：合併後留下那隻又改過那一列時，拿掉被併那隻的部分，不讓兩隻重複
  const staysNow = rows.v3_stays?.length && after.rows.v3_stays?.length
    ? await db.prepare('SELECT stays_json FROM v3_stays WHERE dog_id=?').bind(targetId).first('stays_json') : null;
  const staysEdited = staysNow && staysNow !== after.rows.v3_stays[0].stays_json;
  const writes = [db.prepare('INSERT INTO v3_dogs(dog_id,name,sex,fixed_care) VALUES(?,?,?,?)').bind(dog.dog_id, dog.name, dog.sex, dog.fixed_care)];
  for (const { table } of TABLES) {
    if (after.rows[table]?.length) writes.push(deleteRows(db, table, after.rows[table]));
    if (rows[table]?.length) writes.push(insertRows(db, table, rows[table]));
    // 留下那隻原本的那列：合併後又改過（接起來那列沒刪到）就保留改過的
    if (after.replaced?.[table]?.length) writes.push(insertRows(db, table, after.replaced[table], true));
  }
  if (staysEdited) {
    const mine = withoutStays(staysNow, rows.v3_stays[0].stays_json, before.numbers || []);
    writes.push(mine
      ? db.prepare('UPDATE v3_stays SET stays_json=? WHERE dog_id=? AND stays_json=?').bind(mine, targetId, staysNow)
      : db.prepare('DELETE FROM v3_stays WHERE dog_id=? AND stays_json=?').bind(targetId, staysNow));
  }
  if (rows.v3_walk_state?.length) writes.push(db.prepare('UPDATE v3_walk_state SET dog_id=? WHERE dog_key IN (SELECT json_extract(value,\'$.dog_key\') FROM json_each(?)) AND dog_id=?').bind(dog.dog_id, json(rows.v3_walk_state), targetId));
  writes.push(db.prepare('UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id=?').bind(targetId));
  writes.push(...logStatements(db, 'unmerge', targetId, target.shown,
    { name: target.name, number: target.shown, mergeLogId: log.id },
    { sourceId: dog.dog_id, name: dog.name, numbers: before.numbers, counts: before.counts }, actor, requestId));
  // 原本的列插不回去（例如編號後來給了別隻）時整批不寫
  await runBatch(db, [dogRevisionIs(targetId, input.revision)], writes, '合併後這些資料又被改到別處，不能自動取消；資料沒有改，請重新讀取確認');
  return { target: { ...publicDog(target), revision: null }, source: { dogId: dog.dog_id, name: dog.name } };
}
