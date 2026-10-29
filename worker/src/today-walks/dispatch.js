// 派送（#460、#498）：網站接受後的單狗背景派送、排程撿到期與中斷的工作都走同一個核心；認領、交給 Apps Script、收尾各一次往返。
// 依單次寫入上限拆批，批量只是內部執行方式。預算拒絕或 D1 故障就停下留待下一輪（往外丟 DispatchError），
// 只有版本競爭才逐隻重來各自判斷。
import { REFUSED_CODES } from '../sheet-write.js';
import { guard, keyOf, same, one, reads, budgetDay, CURRENT_JOB, WalkError } from './shared.js';
import { costOf, reserve, retryBudget, transitionBudget, DISPATCH_COST, FAILURE, GRANT } from './budget.js';
import { confirmWalk } from './receipt.js';
import { observeOne, knownIntermediate } from './observe.js';

export class DispatchError extends Error {
  constructor(kind, cause) { super(`${kind}: ${cause.message}`); this.kind = kind; }
}

// 重試上限（#684）：沒設定、試算表明確拒絕（金鑰、試算表 ID、權限錯）再試也不會好，失敗一次就停；其他錯誤第 10 次失敗後停。
// 停住的工作狀態照舊是 retry，下次時間設成永遠不到期，排程就不再撿；管理網站「資料檢查」列出來。這隻狗有新登記會換版本、次數歸零。
export const RETRY_LIMIT = 10;
export const STOPPED_AT = '9999-12-31T00:00:00.000Z';
const BACKOFF_MINUTES = [1, 2, 4, 8, 15];

// 寫回失敗的種類寫進 outbox.error 前綴：沒設定、結果不明（逾時、連不上、沒回這隻）、試算表明確拒絕。
const remoteError = error => error.code === 'unreachable' ? `writeback-unconfirmed: ${error.message}` : `writeback-rejected: ${error.message}`;

// 重試每日上限（#685）：失敗過的工作再派送算重試，另外扣自己的每日上限（SYNC_RETRY_DAILY_BUDGET）；第一次派送只扣總預算。
// 用完時重試延到隔天（UTC 午夜，跟預算同時重置），不擋同一輪的第一次派送，也不佔排程每輪十隻的名額。
// 中斷後的恢復派送不算重試：它沒有下次時間可延，失敗後轉成重試才受上限管。
const retrying = j => !j.recovery && j.job.status !== 'pending';

// items：[{ dog, recovery }]；recovery 是中斷的派送（{ dispatchId }），沒有為 null。
export async function dispatchWalks(db, env, sheet, now, items) {
  const size = Math.max(1, Math.min(10, Math.floor(Number(env.SYNC_MAX_ROWS || 500) / DISPATCH_COST) || 1));
  for (let i = 0; i < items.length; i += size) await dispatchBatch(db, env, sheet, now, items.slice(i, i + size));
}

// 寫回重試（#498）：只把到期、未完成及中斷的派送交給派送核心，不先掃表；不讀已完成的歷史工作。每輪最多 10 隻。
export async function dueWalks(db, now) {
  const at = new Date(now).toISOString();
  const interrupted = (await db.prepare(`SELECT d.dog_key,d.dispatch_id,s.number,s.name
    FROM v3_walk_delivery d JOIN v3_walk_state s ON s.dog_key=d.dog_key
    WHERE d.started_at<=? ORDER BY d.started_at,d.dog_key LIMIT 10`)
    .bind(new Date(now - 60000).toISOString()).all()).results || [];
  // 相容舊程序在 target 後中斷、或早期版本未同時保存 delivery 的未決工作。
  const orphaned = (await db.prepare(`SELECT o.dog_key,s.number,s.name FROM v3_walk_outbox o
    JOIN v3_walk_state s ON s.dog_key=o.dog_key AND s.version=o.version
    WHERE o.status='dispatching' AND o.next_attempt_at<=?
    AND NOT EXISTS(SELECT 1 FROM v3_walk_delivery d WHERE d.dog_key=o.dog_key)
    ORDER BY o.next_attempt_at,o.dog_key LIMIT ?`).bind(at, 10 - interrupted.length).all()).results || [];
  const due = (await db.prepare(`SELECT o.dog_key,s.number,s.name FROM v3_walk_outbox o
    JOIN v3_walk_state s ON s.dog_key=o.dog_key AND s.version=o.version
    WHERE o.status IN ('pending','retry','unconfirmed') AND o.next_attempt_at<=?
    AND NOT EXISTS(SELECT 1 FROM v3_walk_delivery d WHERE d.dog_key=o.dog_key)
    ORDER BY o.next_attempt_at,o.dog_key LIMIT ?`).bind(at, 10 - interrupted.length - orphaned.length).all()).results || [];
  // 逾時只允許同鎖重新讀回，不表示舊 Google 執行已停止。
  return [...interrupted.map(d => ({ ...d, recovery: { dispatchId: d.dispatch_id || '' } })), ...orphaned.map(d => ({ ...d, recovery: { dispatchId: '' } })), ...due.map(d => ({ ...d, recovery: null }))]
    .map(d => ({ dog: { id: d.number, name: d.name }, recovery: d.recovery }));
}

async function dispatchBatch(db, env, sheet, now, items) {
  const at = new Date(now).toISOString(), day = budgetDay(now);
  const found = await reads(db, ...items.flatMap(({ dog, recovery }) => [
    ['SELECT dispatch_id FROM v3_walk_delivery WHERE dog_key=?', keyOf(dog)],
    [`${CURRENT_JOB} AND (o.status IN ('pending','retry','unconfirmed') OR (?=1 AND o.status='dispatching'))`, keyOf(dog), Number(!!recovery)]]),
    ['SELECT retry FROM v3_walk_write_budget WHERE day=?', day]);
  const ready = items.map((item, i) => ({ ...item, key: keyOf(item.dog), delivery: found[2 * i][0], job: found[2 * i + 1][0],
    recoverId: item.recovery?.dispatchId || '', dispatchId: crypto.randomUUID() }))
    .filter(j => !(j.delivery && j.delivery.dispatch_id !== j.recoverId) && j.job && (j.recovery || j.job.next_attempt_at <= at));
  let retryLeft = retryBudget(env) - (found.at(-1)[0]?.retry || 0);
  const jobs = [], deferred = [];
  for (const j of ready) {
    if (!retrying(j)) jobs.push(j);
    else if (retryLeft >= DISPATCH_COST) { jobs.push(j); retryLeft -= DISPATCH_COST; }
    else deferred.push(j);
  }
  if (deferred.length) {
    const tomorrow = new Date(Date.parse(day) + 86400000).toISOString();
    try { await db.batch([...reserve(db, env, costOf([['v3_walk_outbox', deferred.length]]), now),
      ...deferred.map(j => db.prepare("UPDATE v3_walk_outbox SET next_attempt_at=? WHERE dog_key=? AND version=? AND status IN ('retry','unconfirmed')").bind(tomorrow, j.key, j.job.version))]); }
    catch (error) { throw new DispatchError(error instanceof WalkError || /CHECK constraint/i.test(error.message) ? 'budget' : 'd1', error); }
  }
  if (!jobs.length) return;
  let claimed;
  const CLAIM_STATEMENTS = 4; // 每隻：guard、v3_walk_retry、v3_walk_delivery、認領 outbox
  try { claimed = await db.batch([
    ...reserve(db, env, DISPATCH_COST * jobs.length + costOf([]), now, DISPATCH_COST * jobs.filter(retrying).length),
    ...jobs.flatMap(j => [
      guard(db, "COALESCE((SELECT dispatch_id FROM v3_walk_delivery WHERE dog_key=?),'')=? AND EXISTS(SELECT 1 FROM v3_walk_state WHERE dog_key=? AND version=?)", j.key, j.recoverId, j.key, j.job.version),
      db.prepare('INSERT INTO v3_walk_retry(dog_key,version,failures,dispatch_id,reserved_day) VALUES(?,?,0,?,?) ON CONFLICT(dog_key) DO UPDATE SET failures=CASE WHEN version=excluded.version THEN failures ELSE 0 END,version=excluded.version,dispatch_id=excluded.dispatch_id,reserved_day=excluded.reserved_day').bind(j.key, j.job.version, j.dispatchId, day),
      db.prepare('INSERT INTO v3_walk_delivery VALUES(?,?,?) ON CONFLICT(dog_key) DO UPDATE SET dispatch_id=excluded.dispatch_id,started_at=excluded.started_at').bind(j.key, j.dispatchId, at),
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
    if (jobs.length > 1) for (const { dog, recovery } of jobs) await dispatchBatch(db, env, sheet, now, [{ dog, recovery }]);
    return;
  }
  const offset = claimed.length - jobs.length * CLAIM_STATEMENTS; // 預算的敘述在前面，最後一句是認領的 UPDATE … RETURNING
  const mine = jobs.filter((j, i) => claimed[offset + (i + 1) * CLAIM_STATEMENTS - 1].results?.length);
  const lost = jobs.filter(j => !mine.includes(j));
  if (lost.length) await db.batch(lost.map(j => db.prepare('DELETE FROM v3_walk_delivery WHERE dog_key=? AND dispatch_id=?').bind(j.key, j.dispatchId)));
  if (!mine.length) return;
  const receipts = new Map();
  let batchError = '', refused = false;
  try {
    if (!env.SHEET_WRITE_URL || !env.SHEET_WRITE_KEY) throw Object.assign(new Error('writeback-not-configured'), { configured: false });
    // 單隻沿用 walkWake（回應就是那隻的回執），多隻用 walkWakeBatch；收尾相同。
    if (mine.length === 1) receipts.set(mine[0].dispatchId, { ...await sheet(env, { action: 'walkWake', dog: mine[0].dog, dispatchId: mine[0].dispatchId }), ok: true });
    else {
      const out = await sheet(env, { action: 'walkWakeBatch', items: mine.map(j => ({ dog: j.dog, dispatchId: j.dispatchId })) });
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
      try { if ((await confirmWalk(db, env, now, { ...r, dogKey: j.key })).confirmed) continue; error = 'writeback-unconfirmed'; }
      catch (e) { error = e.message; }
    }
    const failures = stuck.retry_version === stuck.version ? stuck.failures + 1 : 1;
    failed.push({ j, version: stuck.version, failures, error });
  }
  const statements = [];
  for (const { j, version, failures, error } of failed) {
    // 退避從「現在」起算：排程的 now 固定在排程時間，叫 Apps Script 可能已經花了幾十秒，不能讓重試提早到期
    const next = refused || failures >= RETRY_LIMIT ? STOPPED_AT
      : new Date(Math.max(now, Date.now()) + BACKOFF_MINUTES[Math.min(failures - 1, BACKOFF_MINUTES.length - 1)] * 60000).toISOString();
    statements.push(...await transitionBudget(db, env, now, j.key, j.dispatchId, FAILURE, prepaid(j)),
      db.prepare('UPDATE v3_walk_retry SET version=?,failures=? WHERE dog_key=? AND dispatch_id=?').bind(version, failures, j.key, j.dispatchId),
      db.prepare("UPDATE v3_walk_outbox SET status='retry',error=?,next_attempt_at=? WHERE dog_key=? AND dispatch_id=? AND status='dispatching'")
        .bind(String(error).slice(0, 100), next, j.key, j.dispatchId));
  }
  // 成功、失敗都放掉這次的派送識別；回執已確認的早就刪了，只刪還握著的，都刪了就省掉這次往返。
  statements.push(...held.map(j => db.prepare('DELETE FROM v3_walk_delivery WHERE dog_key=? AND dispatch_id=?').bind(j.key, j.dispatchId)));
  if (statements.length) await db.batch(statements);
}

// 發 target：GAS 在 script lock 內直接讀表後才呼叫。觀測到不同值時先照改表通知的規則比對，絕不盲寫。
export async function writebackTarget(db, env, now, input) {
  const key = keyOf(input.dog);
  const seen = {};
  await observeOne(db, env, now, input.dog, input.current, seen);
  // 比對沒改狀態時沿用同一次讀到的快照；改了才重讀。
  const snap = seen.snapshot;
  const state = snap ? snap.state : await one(db, 'SELECT * FROM v3_walk_state WHERE dog_key=?', key);
  if (!state) throw new WalkError(404, '尚未接管這隻狗');
  const job = snap ? snap.job : await one(db, 'SELECT * FROM v3_walk_outbox WHERE dog_key=? AND version=?', key, state.version);
  const target = { date: state.effective_date, walker: state.walker };
  if (job?.status === 'synced' && input.current && same(input.current, target)) {
    return { skip: true, version: state.version, dispatchId: input.dispatchId, current: input.current };
  }
  if (!input.current || !same(input.current, { date: state.base_date, walker: state.base_walker })) {
    // 目前目標相符可處理回應遺失；其他已觀測修改留待重新比對，絕不盲寫。
    const matchesCurrent = !!input.current && same(input.current, target) && !!job?.dispatch_id;
    const intermediate = input.current && await knownIntermediate(db, key, input.current, state.version);
    if (!matchesCurrent && !intermediate) throw new WalkError(409, '觀測到試算表衝突，停止覆寫');
  }
  if (!job || !['dispatching', 'retry', 'unconfirmed', 'pending'].includes(job.status)) throw new WalkError(409, '沒有待寫回目標');
  if (job.dispatch_id === input.dispatchId && job.status === 'dispatching') {
    const granted = snap ? snap.delivery?.dispatch_id === input.dispatchId : await one(db, 'SELECT version FROM v3_walk_state WHERE dog_key=? AND version=? AND EXISTS(SELECT 1 FROM v3_walk_outbox WHERE dog_key=? AND version=? AND dispatch_id=? AND status=\'dispatching\') AND EXISTS(SELECT 1 FROM v3_walk_delivery WHERE dog_key=? AND dispatch_id=?)', key, state.version, key, state.version, input.dispatchId, key, input.dispatchId);
    if (granted) return { version: state.version, dispatchId: input.dispatchId, current: target };
  }
  // 舊喚醒也只取目前版本；在 script lock 中授予目前版本派送識別。
  await db.batch([
    guard(db, 'EXISTS(SELECT 1 FROM v3_walk_state WHERE dog_key=? AND version=?)', key, state.version),
    ...await transitionBudget(db, env, now, key, input.dispatchId, GRANT, snap ? snap.retry : undefined),
    db.prepare('INSERT INTO v3_walk_delivery VALUES(?,?,?) ON CONFLICT(dog_key) DO UPDATE SET dispatch_id=excluded.dispatch_id,started_at=excluded.started_at').bind(key, input.dispatchId, new Date(now).toISOString()),
    db.prepare("UPDATE v3_walk_outbox SET dispatch_id=?,status='dispatching' WHERE dog_key=? AND version=? AND EXISTS(SELECT 1 FROM v3_walk_state WHERE dog_key=? AND version=?)").bind(input.dispatchId, key, state.version, key, state.version),
  ]);
  return { version: state.version, dispatchId: input.dispatchId, current: target };
}
