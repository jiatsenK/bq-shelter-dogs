import { dispatchWalks } from './walk-accept.js';
import { scanWalks, retryNotifiedScan } from './walk-reconcile.js';

const enabled = env => env.WALK_RETRY_ENABLED === 'true' && !env.PREVIEW && !!env.DB;

// 保險掃描（#498）：與寫回重試分開，只補漏；有沒跑完的改表通知就補跑它（它本身就是一次掃描）。
export async function scanTick(env, now) {
  if (!enabled(env)) return;
  try { if (!await retryNotifiedScan(env,now)) await scanWalks(env,now); }
  catch (error) { console.warn('walk-scan:',error.message); }
}

// 寫回重試（#498）：只把到期、未完成及中斷的派送交給共用派送核心，不先掃表；不讀已完成的歷史工作。
export async function retryWalks(env, now) {
  if (!enabled(env)) return;
  const db = env.DB, at = new Date(now).toISOString();
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
  // 逾時只允許同鎖重新讀回，不表示舊 Google 執行已停止。
  try { await dispatchWalks(db,[...recoveries,...due].map(dog=>({ dog:{ id:dog.number,name:dog.name },recovery:dog.recovery })),env,now); }
  catch (error) { console.warn('walk-retry:',error.message); }
}
