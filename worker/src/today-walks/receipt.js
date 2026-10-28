// 收回執（#456）：GAS 寫完讀回的值跟派送目標一樣才標成完成，並把表上值（base）更新成它。
import { guard, reads, RETRY, WalkError } from './shared.js';
import { transitionBudget, CONFIRM, READBACK } from './budget.js';

export async function confirmWalk(db, env, now, receipt) {
  const { dogKey, dispatchId, version, current } = receipt;
  if (!current || !dispatchId || !Number.isInteger(version)) throw new WalkError(400, '回執不完整');
  const [[job], [state], [retryRow]] = await reads(db, ['SELECT * FROM v3_walk_outbox WHERE dog_key=? AND version=? AND dispatch_id=?', dogKey, version, dispatchId],
    ['SELECT * FROM v3_walk_state WHERE dog_key=?', dogKey], [RETRY, dogKey]);
  const retry = retryRow ?? null;
  if (!job) return { confirmed: false };
  if (current.date !== job.target_date || current.walker !== job.target_walker) throw new WalkError(409, '試算表讀回不符');
  if (state?.version !== version) {
    // 可信舊回執只記中間讀值，不把目前工作標成完成。未知結果不能走此捷徑。
    if (!job.readback_seen) await db.batch([
      ...await transitionBudget(db, env, now, dogKey, dispatchId, READBACK, retry),
      db.prepare('UPDATE v3_walk_outbox SET readback_seen=1 WHERE dog_key=? AND version=? AND dispatch_id=? AND readback_seen=0').bind(dogKey, version, dispatchId),
    ]);
    return { confirmed: false };
  }
  if (job.status === 'synced') return { confirmed: true };
  await db.batch([
    guard(db, 'EXISTS(SELECT 1 FROM v3_walk_state s JOIN v3_walk_outbox o ON o.dog_key=s.dog_key AND o.version=s.version WHERE s.dog_key=? AND s.version=? AND o.dispatch_id=?)', dogKey, version, dispatchId),
    ...await transitionBudget(db, env, now, dogKey, dispatchId, CONFIRM, retry),
    db.prepare('UPDATE v3_walk_state SET base_date=?,base_walker=? WHERE dog_key=? AND version=?').bind(current.date, current.walker, dogKey, version),
    db.prepare('INSERT INTO v3_walk_baselines VALUES(?,?) ON CONFLICT(dog_key) DO UPDATE SET version=excluded.version').bind(dogKey, version),
    db.prepare("UPDATE v3_walk_outbox SET status='synced',readback_seen=1,error='' WHERE dog_key=? AND version=? AND dispatch_id=?").bind(dogKey, version, dispatchId),
    db.prepare('DELETE FROM v3_walk_delivery WHERE dog_key=? AND dispatch_id=?').bind(dogKey, dispatchId),
  ]);
  return { confirmed: true };
}
