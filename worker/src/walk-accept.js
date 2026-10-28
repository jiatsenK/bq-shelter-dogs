// #456：API 成功承諾止於 D1 原子接受；Google 寫回由持久工作追蹤。
import { walkerCode, editorOf, editLogWrites } from './editlog.js';
import { identityByCode } from './identity.js';
import { previousWalk } from './today.js';
import { callSheet, REFUSED_CODES } from './sheet-write.js';
import { splitNames } from './sheet-read.js';
import { walkDay } from './dog-list.js';

const names = text => [...new Set(splitNames(text))];
const keyOf = dog => dog.id || `名:${dog.name}`;
const one = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
const rows = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];
// 多個讀取併成一次 D1 往返（#460：Worker CPU 跟往返次數成正比）；回傳每個查詢的結果列。
const reads = async (db, ...queries) => (await db.batch(queries.map(([sql, ...args]) => db.prepare(sql).bind(...args)))).map(r => r.results || []);
const CURRENT_JOB = 'SELECT o.* FROM v3_walk_outbox o JOIN v3_walk_state s ON s.dog_key=o.dog_key AND s.version=o.version WHERE o.dog_key=?';
const RETRY = 'SELECT dispatch_id,reserved_day FROM v3_walk_retry WHERE dog_key=?';
const dayOf = now => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
// 交易 guard（#681）：條件不成立或是 NULL 才插一列 0，違反 CHECK(ok=1) 讓整個 batch 回復；成立時一列都不寫，batch 結尾也不用清。
// 要用 IS NOT 1，不能寫 WHERE NOT(條件)：條件是 NULL 時 NOT 也是 NULL，guard 會靜靜放行。
export const guard = (db, condition, ...args) => db.prepare(`INSERT INTO v3_walk_guard SELECT 0 WHERE (${condition}) IS NOT 1`).bind(...args);
export class WalkError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function changedWalk(old) {
  const error = new WalkError(409, '名單已改變，請先確認目前紀錄');
  error.current = { date: old.effective_date, walker: old.walker };
  error.version = old.version;
  return error;
}

export async function readAcceptedWalks(db, today) {
  // 版本與內容在同一列，冷讀也只讀一列；午夜只換 today 判定。
  const pack = await one(db, 'SELECT version,payload FROM v3_walk_pack WHERE id=1');
  if (!pack) throw new Error('沒有溜狗資料包');
  return { version: pack.version, date: today, source: 'd1', walks: Object.values(JSON.parse(pack.payload))
    .map(w => ({ ...w, walked: w.walkedDate === today })) };
}

// 狗清單的遛狗日期是試算表複本，要等狗清單保險掃描才更新；今日溜狗（ADR 0018）是正本，
// 有的狗用它的日期，並附上同一份今日紀錄，網站開頁就拿得到（K 2026-10-26）。
// 資料包快取裡的狗是共用的，換日期時複製一份，不改到快取
export function withTodayWalks(dogs, today) {
  const byKey = new Map(today.walks.map(w => [w.key, w])), onList = new Set();
  const merged = dogs.map(dog => {
    const w = byKey.get(dog.id || `名:${dog.name}`);
    if (!w) return dog;
    onList.add(w.key);
    return w.walkedDate === dog.walkedDate ? dog : { ...dog, walkedDate: w.walkedDate || null };
  });
  return { dogs: merged, today: { ...today, walks: today.walks.filter(w => onList.has(w.key)) } };
}

// SQL 的每次寫入都預留含觸發器與索引的保守上界：看單次門檻與持久每日保留量，不能靠重試繞過。
// #591：不查 Cloudflare 帳號當日用量（正式環境沒設 token，從沒查到過）。
// retry：其中屬於寫回重試的列數（#685），同時算進總預算與重試自己的每日上限。
export function writeBudget(db, env, cost, now = Date.now(), retry = 0) {
  const max = Number(env.SYNC_MAX_ROWS || 500), daily = Number(env.SYNC_DAILY_BUDGET || 20000), retryDaily = retryBudget(env);
  if (!Number.isFinite(max) || !Number.isFinite(daily) || !Number.isFinite(retryDaily) || cost > max) throw new WalkError(503, '溜狗寫入預算不足');
  const day = new Date(now).toISOString().slice(0, 10); // D1 帳號額度 UTC 午夜重置。
  return [
    guard(db, 'COALESCE((SELECT reserved FROM v3_walk_write_budget WHERE day=?),0)+?<=?', day, cost, daily),
    ...retry ? [guard(db, 'COALESCE((SELECT retry FROM v3_walk_write_budget WHERE day=?),0)+?<=?', day, retry, retryDaily)] : [],
    db.prepare('INSERT INTO v3_walk_write_budget(day,reserved,retry) VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET reserved=reserved+excluded.reserved,retry=retry+excluded.retry').bind(day, cost, retry),
  ];
}
const retryBudget = env => Number(env.SYNC_RETRY_DAILY_BUDGET || 10000);

// 派送前一次保留整條協定（含失敗／釋放）的索引及觸發器上界。
// 同派送重送的 target／receipt 是冪等的，不可重複消耗這份保留量。
// retry：同一次請求已讀到的 v3_walk_retry 列（沒有這列為 null）；沒傳就自己讀。
async function transitionBudget(db,env,dogKey,dispatchId,cost,retry) {
  const day=new Date().toISOString().slice(0,10);
  const prepaid=retry!==undefined ? retry?.dispatch_id===dispatchId && retry.reserved_day===day
    : await one(db,'SELECT dispatch_id FROM v3_walk_retry WHERE dog_key=? AND dispatch_id=? AND reserved_day=?',dogKey,dispatchId,day);
  return prepaid ? [] : writeBudget(db,env,cost);
}

// 溜狗紀錄（v3_walks，圖鑑／我溜過讀）跟著今日溜狗紀錄同一批寫（稽核第 4 項，K 2026-10-26）。
// 網站寫回試算表是程式寫入、不觸發狗清單同步，以前要等保險掃描才進溜狗紀錄。
// 改回較早的日子（復原、人工改回）刪掉原本較新那天；清空日期不刪（同 dog-list.js）。人工改的新那天仍由狗清單同步照表寫。
const HISTORY_ROW_COST = 4; // 表＋主鍵＋日期索引＋walkpack 觸發器
const countOf = state => state.members_json ? JSON.parse(state.members_json).length : names(state.walker).length;
const dropDay = (db, dogId, date) => db.prepare('DELETE FROM v3_walks WHERE dog_id=? AND walk_date=?').bind(dogId, date);
export function droppedDay(db, old, nextDate) {
  if (!old.dog_id || !nextDate || !old.effective_date || nextDate >= old.effective_date) return { statements: [], cost: 0 };
  return { statements: [dropDay(db, old.dog_id, old.effective_date)], cost: HISTORY_ROW_COST * Math.max(1, countOf(old)) };
}

// 修改紀錄（#672，ADR 0004 修訂）：溜了（網站按、試算表改）、撤銷、改溜狗人跟今日溜狗紀錄同一批記一筆。
// source：volunteer＝志工網站、sheet＝試算表（editlog.js EDIT_SOURCES）；改前、改後都是 { date, walker }
const EDIT_LOG_COST = 8; // 表＋主鍵＋AUTOINCREMENT 序號，保守上界
// when：[條件 SQL, ...參數]，寫入當下條件成立才記（#700 防狗清單同步與比對兩邊都記）
// 收下人工改表時：表上有日期、且收下後日期或溜狗人變了才記（清空日期不記；改回較早一天記成那天）。
// 操作者只能寫表上的溜狗人（sheet）；改後是收下後的值（after，同日跟網站名單合併時會多網站上的人）。
// 網站寫回又讀回的值在比對時就認出來、不會走到收下，所以不會重複記
export function sheetWalkLog(db, old, sheet, after, number, at, when) {
  if (!sheet.date || (after.date === old.effective_date && after.walker === old.walker)) return { statements: [], cost: 0 };
  return { statements: editLogWrites(db, { at, kind: 'walk', source: 'sheet', name: sheet.walker, dogId: old.dog_id, number,
    before: { date: old.effective_date, walker: old.walker }, after: { date: after.date, walker: after.walker } }, when), cost: EDIT_LOG_COST };
}

// #700：網站上還沒有溜狗狀態的狗，網站沒寫回過（登記會先建狀態），表上溜狗欄變了一定是人工改表。
// 狗清單同步常比今日溜狗比對先把新值寫進主清單，比對拿主清單當基準值就看不出有改，所以由狗清單同步在同一批記（dog-list.js applyMain）。
// 比對先收下時狀態已建，這裡就不記；比對讀完基準值後才被狗清單同步搶先時，比對那邊看主清單已變就不記（compareTrustedWalk），兩邊只會記一筆。
// old：主清單改前那列；sheet：表上新的 { date, walker }
export async function listWalkLog(db, env, dog, old, sheet, at) {
  const key = keyOf(dog);
  if (await one(db, 'SELECT 1 FROM v3_walk_state WHERE dog_key=?', key)) return [];
  const { statements, cost } = sheetWalkLog(db, { dog_id: old.dog_id, effective_date: old.walked_date || '', walker: old.walker ?? '' }, sheet, sheet, dog.id, at,
    ['NOT EXISTS(SELECT 1 FROM v3_walk_state WHERE dog_key=?)', key]);
  return statements.length ? [...writeBudget(db, env, cost), ...statements] : [];
}

const MAIN_DOG = dog => `SELECT dog_id,walked_date,walker,walker_codes,row_index FROM v3_sheet_main WHERE ${dog.id ? 'number=?' : "number='' AND name=?"}`;
async function uniqueMainDog(db,dog) {
  const matches = await rows(db, MAIN_DOG(dog), dog.id || dog.name);
  if (matches.length !== 1) throw new WalkError(409, '找不到唯一的主清單狗');
  return matches[0];
}
// 基準值的溜狗人用主清單存的試算表原文（#707）：代號換名字再以「、」接起來，表上用逗號、空白分隔或名字換不回代號時，
// 比對會把沒改的表當成人工改表，跟狗清單同步各記一筆。原文還沒補填（NULL，#519）才退回用代號換名字
async function seedState(db, dog, today) {
  const seed = await uniqueMainDog(db,dog);
  const walker = seed.walker ?? (await rows(db, 'SELECT n.name FROM v3_sheet_main m, json_each(m.walker_codes) w LEFT JOIN v3_identity_names n ON n.code=w.value WHERE m.row_index=? ORDER BY w.key', seed.row_index))
    .map(p => p.name).filter(Boolean).join('、');
  const previous = seed.walked_date === today ? await previousWalk(db, dog, today) : null;
  return { dog_id: seed.dog_id, effective_date: seed.walked_date || '', walker, version: 0, main: seed,
    ...(previous ? { previous_date: previous.date.date || '', previous_walker: previous.walker } : {}) };
}

export async function membersOf(db, text, secret) {
  const members = [];
  for (const name of names(text)) {
    // 沿用既有固定身分。登記不建立、猜測或合併任何人。
    const person = await identityByCode(db, await walkerCode(name, secret));
    if (!members.some(m => m.volunteerId === person.volunteerId)) members.push({ volunteerId: person.volunteerId, name });
  }
  return members;
}

// 已可信讀回的來源名單可含未使用網站的人；只保留精確文字，不建立或推測身分。
async function sourceMembers(db,text,secret) {
  const members=[];
  for (const name of names(text)) {
    let volunteerId=null;
    try { volunteerId=(await identityByCode(db,await walkerCode(name,secret))).volunteerId; }
    catch (error) { if (error.status!==409) throw error; }
    members.push({ volunteerId,name });
  }
  return members;
}

export async function acceptWalk(db, input, env, now = Date.now()) {
  if (!db || !env.WALKER_KEY) throw new WalkError(503, '身分服務尚未準備好');
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId || '') || input.operationDate !== dayOf(now)) throw new WalkError(400, '請求識別或操作日期不對');
  if (!['walk', 'edit', 'undo'].includes(input.action) || !Array.isArray(input.dogs) || input.dogs.length !== 1) throw new WalkError(400, '此入口只接受單狗操作');
  const dog = input.dogs[0], key = keyOf(dog);
  const fingerprint = JSON.stringify({ action: input.action, operationDate: input.operationDate, walker: input.walker, editor: input.editor, dog });
  const previous = () => one(db, 'SELECT fingerprint,result_json FROM v3_walk_requests WHERE request_id=?', input.requestId);
  const replay = old => {
    if (old.fingerprint !== fingerprint) throw new WalkError(409, '相同請求識別不能更改內容');
    return JSON.parse(old.result_json);
  };
  const existing = await previous();
  if (existing) return replay(existing);
  const added = await membersOf(db, input.walker, env.WALKER_KEY);
  if (!added.length) throw new WalkError(400, '要先選好身分');
  const modifying = input.action !== 'walk';
  const editor = modifying ? await editorOf(input.action === 'edit' ? input.editor : input.walker, env.WALKER_KEY) : null;
  if (modifying && !editor) throw new WalkError(400, '要先選好身分');
  if (editor) await membersOf(db, editor.name, env.WALKER_KEY);
  for (let attempt = 0; attempt < 8; attempt++) {
    const old = await one(db, 'SELECT * FROM v3_walk_state WHERE dog_key=?', key) || await seedState(db, dog, input.operationDate);
    if (modifying && (dog.expectedVersion !== old.version || old.effective_date !== input.operationDate)) throw changedWalk(old);
    let members = old.effective_date === input.operationDate
      ? old.members_json ? JSON.parse(old.members_json) : await sourceMembers(db, old.walker, env.WALKER_KEY) : [];
    let effectiveDate = input.operationDate;
    if (input.action === 'undo') {
      if (members.length !== 1) throw changedWalk(old);
      const previous = old.previous_date !== undefined && old.previous_date < input.operationDate ? { date: { date: old.previous_date }, walker: old.previous_walker }
        : await previousWalk(db, dog, input.operationDate);
      if (!previous) throw new WalkError(409, '找不到唯一的主清單狗');
      effectiveDate = previous.date.date || '';
      members = await sourceMembers(db, previous.walker, env.WALKER_KEY);
    } else if (input.action === 'edit') {
      members = added;
    } else {
      for (const person of added) {
        const existingMember = members.find(m => m.volunteerId === person.volunteerId || (!m.volunteerId && m.name === person.name));
        if (existingMember && !existingMember.volunteerId) existingMember.volunteerId=person.volunteerId;
        else if (!existingMember) members.push(person);
      }
    }
    const walker = members.map(m => m.name).join('、'), version = old.version + 1;
    const baseDate = old.base_date ?? old.effective_date, baseWalker = old.base_walker ?? old.walker;
    const previousDate = old.effective_date === input.operationDate ? old.previous_date ?? '' : old.effective_date;
    const previousWalker = old.effective_date === input.operationDate ? old.previous_walker ?? '' : old.walker;
    const at = new Date(now).toISOString();
    const result = { ...dog, status: input.action === 'undo' ? 'restored' : 'written', accepted: true, requestId: input.requestId, operationDate: input.operationDate,
      version, current: { date: effectiveDate, walker }, wrote: { walker },
      prev: { date: { date: previousDate }, walker: previousWalker }, syncStatus: 'pending', at };
    // 今天照名單重寫那天；復原就刪掉今天（上一次那天本來就在溜狗紀錄裡，不動）。
    const codes = effectiveDate === input.operationDate ? [...new Set(await Promise.all(members.map(m => walkerCode(m.name, env.WALKER_KEY))))] : [];
    const history = effectiveDate === input.operationDate ? walkDay(db, old.dog_id, effectiveDate, dog, codes) : [dropDay(db, old.dog_id, input.operationDate)];
    const historyCost = HISTORY_ROW_COST * ((old.effective_date === input.operationDate ? countOf(old) : 0) + codes.length);
    const before = { date: old.effective_date, walker: old.walker };
    // 按溜了：操作者是這次按的人（一起溜就全部）；已經在今天名單裡、名單沒變就不記。
    // 名單照拆開的名字比（#707）：沒有溜狗狀態的狗改前是表上原文，可能用逗號或空白分隔
    const logs = editor ? editLogWrites(db, { at, kind: input.action === 'undo' ? 'walkundo' : 'walkedit', source: 'volunteer', code: editor.code, name: editor.name, dogId: old.dog_id, number: dog.id, before, after: result.current })
      : before.date !== effectiveDate || names(before.walker).join('、') !== walker ? editLogWrites(db, { at, kind: 'walk', source: 'volunteer', code: added.length === 1 ? await walkerCode(added[0].name, env.WALKER_KEY) : '',
        name: added.map(m => m.name).join('、'), dogId: old.dog_id, number: dog.id, before, after: result.current }) : [];
    try {
      await db.batch([
        guard(db, 'COALESCE((SELECT version FROM v3_walk_state WHERE dog_key=?),0)=?', key, old.version),
        ...await writeBudget(db, env, 32 + EDIT_LOG_COST * logs.length + historyCost, now),
        db.prepare('INSERT INTO v3_walk_state(dog_key,dog_id,number,name,version,effective_date,walker,members_json,base_date,base_walker,previous_date,previous_walker,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(dog_key) DO UPDATE SET version=excluded.version,effective_date=excluded.effective_date,walker=excluded.walker,members_json=excluded.members_json,previous_date=excluded.previous_date,previous_walker=excluded.previous_walker,updated_at=excluded.updated_at')
          .bind(key, old.dog_id, dog.id, dog.name, version, effectiveDate, walker, JSON.stringify(members), baseDate, baseWalker, previousDate, previousWalker, at),
        db.prepare('INSERT INTO v3_walk_requests VALUES(?,?,?,?,?)').bind(input.requestId, key, input.operationDate, fingerprint, JSON.stringify(result)),
        db.prepare("UPDATE v3_walk_outbox SET status='superseded' WHERE dog_key=? AND status NOT IN ('synced','superseded')").bind(key),
        db.prepare("INSERT INTO v3_walk_outbox(dog_key,version,operation_date,target_date,target_walker,status,next_attempt_at) VALUES(?,?,?,?,?,'pending',?)").bind(key, version, input.operationDate, effectiveDate, walker, at),
        ...history,
        ...logs,
      ]);
      return result;
    } catch (error) {
      const duplicate = await previous();
      if (duplicate) return replay(duplicate);
      const latest = await one(db, 'SELECT version FROM v3_walk_state WHERE dog_key=?', key);
      if ((latest?.version || 0) === old.version) throw error;
    }
  }
  throw new WalkError(409, '登記競爭中，請用原請求再試');
}

// 單狗背景派送（網站接受後）也走同一個派送核心（#498）。
export function dispatchWalk(db, dog, env, clock = Date.now(), recovery = null) {
  return dispatchWalks(db, [{ dog, recovery }], env, clock);
}

// 派送核心（#460、#498）：單狗、多狗、背景派送與重試共用；認領、交給 Apps Script、收尾各一次往返。
// 依單次寫入上限拆批，批量只是內部執行方式。預算拒絕或 D1 故障就停下留待下一輪（往外丟 DispatchError），
// 只有版本競爭才逐隻重來各自判斷。items：[{ dog, recovery }]。
const DISPATCH_COST = 96;
export class DispatchError extends Error {
  constructor(kind, cause) { super(`${kind}: ${cause.message}`); this.kind = kind; }
}
export async function dispatchWalks(db, items, env, clock = Date.now()) {
  const size = Math.max(1, Math.min(10, Math.floor(Number(env.SYNC_MAX_ROWS || 500) / DISPATCH_COST) || 1));
  for (let i = 0; i < items.length; i += size) await dispatchBatch(db, items.slice(i, i + size), env, clock);
}

// 重試上限（#684）：沒設定、試算表明確拒絕（金鑰、試算表 ID、權限錯）再試也不會好，失敗一次就停；其他錯誤第 10 次失敗後停。
// 停住的工作狀態照舊是 retry，下次時間設成永遠不到期，排程就不再撿；管理網站「資料檢查」列出來。這隻狗有新登記會換版本、次數歸零。
export const RETRY_LIMIT = 10;
export const STOPPED_AT = '9999-12-31T00:00:00.000Z';

// 寫回失敗的種類寫進 outbox.error 前綴：沒設定、結果不明（逾時、連不上、沒回這隻）、試算表明確拒絕。
const remoteError = error => error.code === 'unreachable' ? `writeback-unconfirmed: ${error.message}` : `writeback-rejected: ${error.message}`;

// 重試每日上限（#685）：失敗過的工作再派送算重試，另外扣自己的每日上限（SYNC_RETRY_DAILY_BUDGET）；第一次派送只扣總預算。
// 用完時重試延到隔天（UTC 午夜，跟預算同時重置），不擋同一輪的第一次派送，也不佔排程每輪十隻的名額。
// 中斷後的恢復派送不算重試：它沒有下次時間可延，失敗後轉成重試才受上限管。
const retrying = j => !j.recovery && j.job.status !== 'pending';
const DEFER_COST = 4; // outbox 一列＋到期索引，保守上界

async function dispatchBatch(db, items, env, clock) {
  const now = new Date(clock).toISOString(), day = now.slice(0, 10);
  const found = await reads(db, ...items.flatMap(({ dog, recovery }) => [
    ['SELECT dispatch_id FROM v3_walk_delivery WHERE dog_key=?', keyOf(dog)],
    [`${CURRENT_JOB} AND (o.status IN ('pending','retry','unconfirmed') OR (?=1 AND o.status='dispatching'))`, keyOf(dog), Number(!!recovery)]]),
    ['SELECT retry FROM v3_walk_write_budget WHERE day=?', day]);
  const ready = items.map((item, i) => ({ ...item, key: keyOf(item.dog), delivery: found[2 * i][0], job: found[2 * i + 1][0],
    recoverId: item.recovery?.dispatchId || '', dispatchId: crypto.randomUUID() }))
    .filter(j => !(j.delivery && j.delivery.dispatch_id !== j.recoverId) && j.job && (j.recovery || j.job.next_attempt_at <= now));
  let retryLeft = retryBudget(env) - (found.at(-1)[0]?.retry || 0);
  const jobs = [], deferred = [];
  for (const j of ready) {
    if (!retrying(j)) jobs.push(j);
    else if (retryLeft >= DISPATCH_COST) { jobs.push(j); retryLeft -= DISPATCH_COST; }
    else deferred.push(j);
  }
  if (deferred.length) {
    const tomorrow = new Date(Date.parse(day) + 86400000).toISOString();
    try { await db.batch([...writeBudget(db, env, DEFER_COST * deferred.length, clock),
      ...deferred.map(j => db.prepare("UPDATE v3_walk_outbox SET next_attempt_at=? WHERE dog_key=? AND version=? AND status IN ('retry','unconfirmed')").bind(tomorrow, j.key, j.job.version))]); }
    catch (error) { throw new DispatchError(error instanceof WalkError || /CHECK constraint/i.test(error.message) ? 'budget' : 'd1', error); }
  }
  if (!jobs.length) return;
  let claimed;
  try { claimed = await db.batch([
    ...await writeBudget(db, env, DISPATCH_COST * jobs.length, clock, DISPATCH_COST * jobs.filter(retrying).length),
    ...jobs.flatMap(j => [
      guard(db, "COALESCE((SELECT dispatch_id FROM v3_walk_delivery WHERE dog_key=?),'')=? AND EXISTS(SELECT 1 FROM v3_walk_state WHERE dog_key=? AND version=?)", j.key, j.recoverId, j.key, j.job.version),
      db.prepare('INSERT INTO v3_walk_retry(dog_key,version,failures,dispatch_id,reserved_day) VALUES(?,?,0,?,?) ON CONFLICT(dog_key) DO UPDATE SET failures=CASE WHEN version=excluded.version THEN failures ELSE 0 END,version=excluded.version,dispatch_id=excluded.dispatch_id,reserved_day=excluded.reserved_day').bind(j.key, j.job.version, j.dispatchId, day),
      db.prepare('INSERT INTO v3_walk_delivery VALUES(?,?,?) ON CONFLICT(dog_key) DO UPDATE SET dispatch_id=excluded.dispatch_id,started_at=excluded.started_at').bind(j.key, j.dispatchId, now),
      db.prepare("UPDATE v3_walk_outbox SET status='dispatching',dispatch_id=?,error='' WHERE dog_key=? AND version=? AND (status IN ('pending','retry','unconfirmed') OR (?=1 AND status='dispatching')) RETURNING version").bind(j.dispatchId, j.key, j.job.version, Number(!!j.recovery)),
    ]),
  ]); } catch (error) {
    if (error instanceof WalkError) throw new DispatchError('budget', error); // 單次上限，寫入前就擋下
    // 整批沒寫進去。重讀：狀態都沒變＝guard 只剩每日預算會擋，否則是 D1 故障；逐隻重跑只會繞過預算。
    let latest;
    try { latest = await reads(db, ...jobs.flatMap(j => [['SELECT dispatch_id FROM v3_walk_delivery WHERE dog_key=?', j.key],
      ['SELECT version FROM v3_walk_state WHERE dog_key=?', j.key]])); }
    catch { throw new DispatchError('d1', error); }
    const unchanged = jobs.every((j, i) => {
      const [[delivery], [state]] = [latest[2 * i], latest[2 * i + 1]];
      return (delivery?.dispatch_id || '') === (j.delivery?.dispatch_id || '') && state?.version === j.job.version;
    });
    if (unchanged) throw new DispatchError(/CHECK constraint/i.test(error.message) ? 'budget' : 'd1', error);
    // 有一隻的狀態在讀和認領之間變了（版本競爭）：多隻就逐隻重來各自判斷；單隻已被別人處理，不用再派。
    if (jobs.length > 1) for (const { dog, recovery } of jobs) await dispatchBatch(db, [{ dog, recovery }], env, clock);
    return;
  }
  const offset = claimed.length - jobs.length * 4; // 每隻 4 句，第 4 句是認領的 UPDATE … RETURNING
  const mine = jobs.filter((j, i) => claimed[offset + i * 4 + 3].results?.length);
  const lost = jobs.filter(j => !mine.includes(j));
  if (lost.length) await db.batch(lost.map(j => db.prepare('DELETE FROM v3_walk_delivery WHERE dog_key=? AND dispatch_id=?').bind(j.key, j.dispatchId)));
  if (!mine.length) return;
  const receipts = new Map();
  let batchError = '', refused = false;
  try {
    if (!env.SHEET_WRITE_URL || !env.SHEET_WRITE_KEY) throw Object.assign(new Error('writeback-not-configured'), { configured: false });
    // 單隻沿用 walkWake（回應就是那隻的回執），多隻用 walkWakeBatch；收尾相同。
    if (mine.length === 1) receipts.set(mine[0].dispatchId, { ...await callSheet(env, { action: 'walkWake', dog: mine[0].dog, dispatchId: mine[0].dispatchId }), ok: true });
    else {
      const out = await callSheet(env, { action: 'walkWakeBatch', items: mine.map(j => ({ dog: j.dog, dispatchId: j.dispatchId })) });
      for (const r of Array.isArray(out.results) ? out.results : []) if (r?.dispatchId) receipts.set(r.dispatchId, r);
    }
  } catch (error) { // callSheet 的訊息不含試算表 ID、金鑰
    batchError = error.configured === false ? error.message : remoteError(error);
    refused = error.configured === false || REFUSED_CODES.has(error.code);
  }
  // 每隻剛認領時已在 v3_walk_retry 保留今天的預算，收尾的狀態轉換不用再扣。
  const prepaid = j => ({ dispatch_id: j.dispatchId, reserved_day: day });
  const after = await reads(db, ...mine.flatMap(j => {
    const r = receipts.get(j.dispatchId);
    return [["SELECT o.version FROM v3_walk_outbox o JOIN v3_walk_state s ON s.dog_key=o.dog_key AND s.version=o.version WHERE o.dog_key=? AND o.version=? AND o.dispatch_id=? AND o.status='synced'", j.key, r?.ok ? r.version : -1, j.dispatchId],
      ["SELECT o.version,COALESCE(r.failures,0) AS failures,r.version AS retry_version FROM v3_walk_outbox o LEFT JOIN v3_walk_retry r ON r.dog_key=o.dog_key WHERE o.dog_key=? AND o.dispatch_id=? AND o.status='dispatching'", j.key, j.dispatchId],
      ['SELECT dispatch_id FROM v3_walk_delivery WHERE dog_key=? AND dispatch_id=?', j.key, j.dispatchId]];
  }));
  const failed = [], held = [];
  for (const [i, j] of mine.entries()) {
    const r = receipts.get(j.dispatchId), [done] = after[3 * i], [stuck] = after[3 * i + 1], [still] = after[3 * i + 2];
    if (still) held.push(j);
    if (done || !stuck) continue;
    let error = batchError || (r ? (r.ok ? '' : `writeback-rejected: ${r.error || ''}`) : 'writeback-unconfirmed: 沒有這隻的回應');
    if (!error) {
      try { if ((await confirmWalk(db, { ...r, dogKey: j.key }, env)).confirmed) continue; error = 'writeback-unconfirmed'; }
      catch (e) { error = e.message; }
    }
    const failures = stuck.retry_version === stuck.version ? stuck.failures + 1 : 1;
    failed.push({ j, version: stuck.version, failures, error });
  }
  const statements = [];
  for (const { j, version, failures, error } of failed) {
    const next = refused || failures >= RETRY_LIMIT ? STOPPED_AT
      : new Date(Math.max(clock, Date.now()) + [1,2,4,8,15][Math.min(failures - 1,4)] * 60000).toISOString();
    statements.push(...await transitionBudget(db, env, j.key, j.dispatchId, 24, prepaid(j)),
      db.prepare('UPDATE v3_walk_retry SET version=?,failures=? WHERE dog_key=? AND dispatch_id=?').bind(version, failures, j.key, j.dispatchId),
      db.prepare("UPDATE v3_walk_outbox SET status='retry',error=?,next_attempt_at=? WHERE dog_key=? AND dispatch_id=? AND status='dispatching'")
        .bind(String(error).slice(0, 100), next, j.key, j.dispatchId));
  }
  // 成功、失敗都放掉這次的派送識別；回執已確認的早就刪了，只刪還握著的，都刪了就省掉這次往返。
  statements.push(...held.map(j => db.prepare('DELETE FROM v3_walk_delivery WHERE dog_key=? AND dispatch_id=?').bind(j.key, j.dispatchId)));
  if (statements.length) await db.batch(statements);
}

export async function confirmWalk(db, receipt, env) {
  const { dogKey, dispatchId, version, current } = receipt;
  if (!current || !dispatchId || !Number.isInteger(version)) throw new WalkError(400, '回執不完整');
  const [[job], [state], [retryRow]] = await reads(db, ['SELECT * FROM v3_walk_outbox WHERE dog_key=? AND version=? AND dispatch_id=?', dogKey, version, dispatchId],
    ['SELECT * FROM v3_walk_state WHERE dog_key=?', dogKey], [RETRY, dogKey]);
  const retry = retryRow ?? null;
  if (!job) return { confirmed:false };
  if (current.date !== job.target_date || current.walker !== job.target_walker) throw new WalkError(409, '試算表讀回不符');
  if (state?.version !== version) {
    // 可信舊回執只記中間讀值，不把目前工作標成完成。未知結果不能走此捷徑。
    if (!job.readback_seen) await db.batch([
      ...await transitionBudget(db,env,dogKey,dispatchId,16,retry),
      db.prepare('UPDATE v3_walk_outbox SET readback_seen=1 WHERE dog_key=? AND version=? AND dispatch_id=? AND readback_seen=0').bind(dogKey,version,dispatchId),
    ]);
    return { confirmed:false };
  }
  if (job.status === 'synced') return { confirmed:true };
  await db.batch([
    guard(db, 'EXISTS(SELECT 1 FROM v3_walk_state s JOIN v3_walk_outbox o ON o.dog_key=s.dog_key AND o.version=s.version WHERE s.dog_key=? AND s.version=? AND o.dispatch_id=?)', dogKey,version,dispatchId),
    ...await transitionBudget(db,env,dogKey,dispatchId,16,retry),
    db.prepare('UPDATE v3_walk_state SET base_date=?,base_walker=? WHERE dog_key=? AND version=?').bind(current.date, current.walker, dogKey, version),
    db.prepare('INSERT INTO v3_walk_baselines VALUES(?,?) ON CONFLICT(dog_key) DO UPDATE SET version=excluded.version').bind(dogKey,version),
    db.prepare("UPDATE v3_walk_outbox SET status='synced',readback_seen=1,error='' WHERE dog_key=? AND version=? AND dispatch_id=?").bind(dogKey, version, dispatchId),
    db.prepare('DELETE FROM v3_walk_delivery WHERE dog_key=? AND dispatch_id=?').bind(dogKey,dispatchId),
  ]);
  return { confirmed: true };
}

async function baselineVersion(db,key) {
  const accepted=(await one(db,'SELECT version FROM v3_walk_baselines WHERE dog_key=?',key))?.version || 0;
  const synced=(await one(db,"SELECT version FROM v3_walk_outbox WHERE dog_key=? AND status='synced' ORDER BY version DESC LIMIT 1",key))?.version || 0;
  return Math.max(accepted,synced);
}
async function knownIntermediate(db,key,observed,version) {
  return one(db,"SELECT version FROM v3_walk_outbox WHERE dog_key=? AND target_date=? AND target_walker=? AND readback_seen=1 AND status='superseded' AND version>? AND version<? LIMIT 1",
    key,observed.date,observed.walker,await baselineVersion(db,key),version);
}

// 人工改表的版本：建立當下就 synced、沒派送過（dispatch_id 空白）；next_attempt_at 是建立時間。
// 從 version 往回找 MANUAL_MERGE_MS 內連續的人工版本，回傳這串之前那一版的值；同一日期內改人名不影響「上一次」，所以只在改日期時用。
const MANUAL_MERGE_MS = 120000;
async function beforeManualEdits(db,key,version,now) {
  const since=new Date(now-MANUAL_MERGE_MS).toISOString();
  const chain=await rows(db,"SELECT version,target_date,target_walker,status,dispatch_id,next_attempt_at FROM v3_walk_outbox WHERE dog_key=? AND version<=? ORDER BY version DESC LIMIT 6",key,version);
  const manual=row=>row.status==='synced' && row.dispatch_id==='' && row.next_attempt_at>=since;
  if (!chain.length || chain[0].version!==version || !manual(chain[0])) return null;
  let i=0;
  while (i+1<chain.length && chain[i+1].version===chain[i].version-1 && manual(chain[i+1])) i++;
  const prior=chain[i+1];
  return prior?.version===chain[i].version-1 ? prior : null;
}

// 僅接受同鎖 GAS 直接讀值；通知內容與 gviz 都不能呼叫這個比較入口。
export async function reconcileWalk(db, dog, observed, env, seen = {}) {
  if (!dog || typeof dog.id !== 'string' || typeof dog.name !== 'string' || !dog.name ||
    (dog.id && !/^[A-Za-z0-9]{1,32}$/.test(dog.id))) throw new WalkError(400,'狗的識別不完整');
  const key = keyOf(dog);
  try {
    const result = await compareTrustedWalk(db,dog,observed,env,seen);
    if (seen.conflict) {
      await db.batch([...await writeBudget(db,env,8),db.prepare('DELETE FROM v3_walk_conflicts WHERE dog_key=?').bind(key)]);
    }
    return result;
  } catch (error) {
    const observation = JSON.stringify(observed ?? null), reason = error.status ? error.message : '比較失敗，保留待處理';
    const previous = await one(db,'SELECT observation,error FROM v3_walk_conflicts WHERE dog_key=?',key);
    if (previous?.observation !== observation || previous?.error !== reason) {
      await db.batch([...await writeBudget(db,env,8),db.prepare('INSERT INTO v3_walk_conflicts VALUES(?,?,?) ON CONFLICT(dog_key) DO UPDATE SET observation=excluded.observation,error=excluded.error').bind(key,observation,reason)]);
    }
    throw error;
  }
}

// seen：回填同一次讀到的衝突紀錄；狀態沒變時也回填快照，給拿目標沿用，不再重讀。
async function compareTrustedWalk(db, dog, observed, env, seen = {}) {
  if (!observed || typeof observed.walker !== 'string' || observed.walker.length > 2000 ||
    typeof observed.date !== 'string' || (observed.date && (!/^\d{4}-\d{2}-\d{2}$/.test(observed.date) ||
      !Number.isFinite(Date.parse(observed.date)) || new Date(observed.date).toISOString().slice(0,10) !== observed.date))) {
    throw new WalkError(409, '試算表日期或名單無法確認');
  }
  const key = keyOf(dog);
  const [[stateRow], mains, [conflict], [currentJob], [delivery], [retry]] = await reads(db,
    ['SELECT * FROM v3_walk_state WHERE dog_key=?', key], [MAIN_DOG(dog), dog.id || dog.name],
    ['SELECT dog_key FROM v3_walk_conflicts WHERE dog_key=?', key], [CURRENT_JOB, key],
    ['SELECT dispatch_id FROM v3_walk_delivery WHERE dog_key=?', key], [RETRY, key]);
  seen.conflict = !!conflict;
  const old = stateRow || await seedState(db, dog,dayOf(Date.now()));
  if (mains.length !== 1 || mains[0].dog_id!==old.dog_id) throw new WalkError(409,'找不到唯一的主清單狗');
  const base = { date: old.base_date ?? old.effective_date, walker: old.base_walker ?? old.walker };
  const same = (a,b) => a.date === b.date && a.walker === b.walker;
  const current = { date: old.effective_date, walker: old.walker };
  if (same(observed,base)) {
    if (stateRow) seen.snapshot = { state: stateRow, job: currentJob, delivery, retry: retry ?? null };
    return { changed:false, version:old.version, current };
  }
  const job = old.version && currentJob;
  if (same(observed,current) && job?.dispatch_id) {
    await confirmWalk(db, { dogKey:key, dispatchId:job.dispatch_id, version:old.version, current:observed },env);
    return { changed:false, version:old.version, current };
  }
  // 未取得可信回執的已派送值，可能是舊程式寫入，不能猜成人工修正。
  const frontier = await baselineVersion(db,key);
  let unknown = await one(db,"SELECT version FROM v3_walk_outbox WHERE dog_key=? AND target_date=? AND target_walker=? AND readback_seen=0 AND dispatch_id<>'' AND version>? LIMIT 1",key,observed.date,observed.walker,frontier);
  if (!unknown && observed.walker===base.walker) unknown=await one(db,"SELECT version FROM v3_walk_outbox WHERE dog_key=? AND target_date=? AND readback_seen=0 AND dispatch_id<>'' AND version>? LIMIT 1",key,observed.date,frontier);
  if (!unknown && observed.date===base.date) unknown=await one(db,"SELECT version FROM v3_walk_outbox WHERE dog_key=? AND target_walker=? AND readback_seen=0 AND dispatch_id<>'' AND version>? LIMIT 1",key,observed.walker,frontier);
  if (unknown) throw new WalkError(409, '試算表可能是未確認派送結果，保留待處理');
  const intermediate = await knownIntermediate(db,key,observed,old.version);
  if (intermediate) return { changed:false, version:old.version, current };
  let target = observed;
  if (observed.date === base.date && current.date === base.date && observed.walker && !same(current,base)) {
    const removed = names(base.walker).filter(name => !names(observed.walker).includes(name));
    target = { date:observed.date, walker:[...new Set([...names(current.walker).filter(name => !removed.includes(name)), ...names(observed.walker)])].join('、') };
  }
  // 自由改表可能有尚未使用網站的名字；保留來源文字，不猜測或建立志工身分。
  const members = await sourceMembers(db,target.walker,env.WALKER_KEY);
  const version = old.version + 1, at = new Date().toISOString();
  const status = same(target,observed) ? 'synced' : 'pending';
  // 人工一格一格改（先改人名再改日期）時，上一次記這串連改之前的值，不記改一半的狀態。
  let before=target.date===old.effective_date ? null : await beforeManualEdits(db,key,old.version,Date.now());
  // 改回連改前的日期：那一版就是現在的值，當「上一次」沒有意義，照一般規則。
  if (before?.target_date===target.date) before=null;
  const previousDate=target.date===old.effective_date ? old.previous_date ?? '' : (before?.target_date ?? old.effective_date);
  const previousWalker=target.date===old.effective_date ? old.previous_walker ?? '' : (before?.target_walker ?? old.walker);
  // 沒有溜狗狀態（基準值從主清單推）：主清單的日期或代號在讀完後被狗清單同步改了，就是它記過了（listWalkLog），這裡不再記
  const unchanged=old.main ? ['EXISTS(SELECT 1 FROM v3_sheet_main WHERE row_index=? AND walked_date IS ? AND walker_codes=?)',old.main.row_index,old.main.walked_date,old.main.walker_codes] : undefined;
  const dropped=droppedDay(db,old,target.date),logged=sheetWalkLog(db,old,observed,target,dog.id,at,unchanged);
  await db.batch([
    guard(db, 'COALESCE((SELECT version FROM v3_walk_state WHERE dog_key=?),0)=?', key,old.version),
    ...await writeBudget(db,env,32+dropped.cost+logged.cost),
    ...dropped.statements,
    ...logged.statements,
    db.prepare('INSERT INTO v3_walk_state(dog_key,dog_id,number,name,version,effective_date,walker,members_json,base_date,base_walker,previous_date,previous_walker,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(dog_key) DO UPDATE SET version=excluded.version,effective_date=excluded.effective_date,walker=excluded.walker,members_json=excluded.members_json,base_date=excluded.base_date,base_walker=excluded.base_walker,previous_date=excluded.previous_date,previous_walker=excluded.previous_walker,updated_at=excluded.updated_at')
      .bind(key,old.dog_id,dog.id,dog.name,version,target.date,target.walker,JSON.stringify(members),observed.date,observed.walker,previousDate,previousWalker,at),
    db.prepare('INSERT INTO v3_walk_baselines VALUES(?,?) ON CONFLICT(dog_key) DO UPDATE SET version=excluded.version').bind(key,version),
    db.prepare("UPDATE v3_walk_outbox SET status='superseded' WHERE dog_key=? AND status NOT IN ('synced','superseded')").bind(key),
    db.prepare("INSERT INTO v3_walk_outbox(dog_key,version,operation_date,target_date,target_walker,status,next_attempt_at) VALUES(?,?,?,?,?,'pending',?)").bind(key,version,dayOf(Date.now()),target.date,target.walker,at),
    db.prepare('UPDATE v3_walk_outbox SET status=? WHERE dog_key=? AND version=?').bind(status,key,version),
  ]);
  return { changed:true, version, current:target };
}

// 同鎖直接讀表後才呼叫。觀測到不同值時停寫，不將 gviz 舊快照當成人工修改。
export async function writebackTarget(db, input, env) {
  const key = keyOf(input.dog);
  const seen = {};
  await reconcileWalk(db,input.dog,input.current,env,seen);
  // 比對沒改狀態時沿用同一次讀到的快照；改了才重讀。
  const snap = seen.snapshot;
  const state = snap ? snap.state : await one(db, 'SELECT * FROM v3_walk_state WHERE dog_key=?', key);
  if (!state) throw new WalkError(404, '尚未接管這隻狗');
  const job = snap ? snap.job : await one(db, 'SELECT * FROM v3_walk_outbox WHERE dog_key=? AND version=?', key, state.version);
  if (job?.status === 'synced' && input.current?.date === state.effective_date && input.current?.walker === state.walker) {
    return { skip:true,version:state.version,dispatchId:input.dispatchId,current:input.current };
  }
  if (!input.current || (input.current.date !== state.base_date || input.current.walker !== state.base_walker)) {
    // 目前目標相符可處理回應遺失；其他已觀測修改留待重新比對，絕不盲寫。
    const matchesCurrent = input.current?.date === state.effective_date && input.current?.walker === state.walker && !!job?.dispatch_id;
    const intermediate = input.current && await knownIntermediate(db,key,input.current,state.version);
    if (!matchesCurrent && !intermediate) throw new WalkError(409, '觀測到試算表衝突，停止覆寫');
  }
  if (!job || !['dispatching','retry','unconfirmed','pending'].includes(job.status)) throw new WalkError(409, '沒有待寫回目標');
  if (job.dispatch_id===input.dispatchId && job.status==='dispatching') {
    const granted=snap ? snap.delivery?.dispatch_id===input.dispatchId : await one(db,'SELECT version FROM v3_walk_state WHERE dog_key=? AND version=? AND EXISTS(SELECT 1 FROM v3_walk_outbox WHERE dog_key=? AND version=? AND dispatch_id=? AND status=\'dispatching\') AND EXISTS(SELECT 1 FROM v3_walk_delivery WHERE dog_key=? AND dispatch_id=?)',key,state.version,key,state.version,input.dispatchId,key,input.dispatchId);
    if (granted) return { version:state.version,dispatchId:input.dispatchId,current:{ date:state.effective_date,walker:state.walker } };
  }
  // 舊喚醒也只取目前版本；在 script lock 中授予目前版本派送識別。
  await db.batch([
    guard(db, 'EXISTS(SELECT 1 FROM v3_walk_state WHERE dog_key=? AND version=?)', key,state.version),
    ...await transitionBudget(db,env,key,input.dispatchId,16,snap ? snap.retry : undefined),
    db.prepare('INSERT INTO v3_walk_delivery VALUES(?,?,?) ON CONFLICT(dog_key) DO UPDATE SET dispatch_id=excluded.dispatch_id,started_at=excluded.started_at').bind(key,input.dispatchId,new Date().toISOString()),
    db.prepare("UPDATE v3_walk_outbox SET dispatch_id=?,status='dispatching' WHERE dog_key=? AND version=? AND EXISTS(SELECT 1 FROM v3_walk_state WHERE dog_key=? AND version=?)").bind(input.dispatchId, key, state.version, key, state.version),
  ]);
  return { version: state.version, dispatchId: input.dispatchId, current: { date: state.effective_date, walker: state.walker } };
}
