import { dispatchWalk } from './walk-accept.js';
import { scanWalks } from './walk-reconcile.js';
import { retryNotifiedComparison } from './walk-notify.js';

// 分開使用到期、未完成及中斷派送索引；不讀已完成的歷史工作。
export async function retryWalks(env, now) {
  if (env.WALK_RETRY_ENABLED !== 'true' || env.PREVIEW || !env.DB) return;
  const db = env.DB, at = new Date(now).toISOString();
  try { await retryNotifiedComparison(env,now); }
  catch (error) { console.warn('walk-notify-retry:',error.message); }
  try { await scanWalks(env,now); }
  catch (error) { console.warn('walk-scan:',error.message); }
  const interrupted = (await db.prepare(`SELECT d.dog_key,d.dispatch_id,s.number,s.name
    FROM v3_walk_delivery d JOIN v3_walk_state s ON s.dog_key=d.dog_key
    WHERE d.started_at<=? ORDER BY d.started_at,d.dog_key LIMIT 10`)
    .bind(new Date(now-60000).toISOString()).all()).results || [];
  // 相容舊程序在 target 後中斷、或早期版本未同時保存 delivery 的未決工作。
  const orphaned = (await db.prepare(`SELECT o.dog_key,s.number,s.name FROM v3_walk_outbox o
    JOIN v3_walk_state s ON s.dog_key=o.dog_key AND s.version=o.version
    WHERE o.status='dispatching' AND o.next_attempt_at<=?
    AND NOT EXISTS(SELECT 1 FROM v3_walk_delivery d WHERE d.dog_key=o.dog_key)
    ORDER BY o.next_attempt_at,o.dog_key LIMIT ?`).bind(at,10-interrupted.length).all()).results || [];
  const due = (await db.prepare(`SELECT o.dog_key,s.number,s.name FROM v3_walk_outbox o
    JOIN v3_walk_state s ON s.dog_key=o.dog_key AND s.version=o.version
    WHERE o.status IN ('pending','retry','unconfirmed') AND o.next_attempt_at<=?
    AND NOT EXISTS(SELECT 1 FROM v3_walk_delivery d WHERE d.dog_key=o.dog_key)
    ORDER BY o.next_attempt_at,o.dog_key LIMIT ?`).bind(at,10-interrupted.length-orphaned.length).all()).results || [];
  const recoveries=[...interrupted,...orphaned].map(dog=>({ ...dog,recovery:{ dispatchId:dog.dispatch_id || '' } }));
  for (const dog of [...recoveries,...due]) {
    try {
      // 逾時只允許同鎖重新讀回，不表示舊 Google 執行已停止。
      await dispatchWalk(db,{ id:dog.number,name:dog.name },env,now,dog.recovery);
    } catch (error) { console.warn('walk-retry:',dog.dog_key,error.message); }
  }
}
