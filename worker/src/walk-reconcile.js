import { writeBudget, membersOf } from './walk-accept.js';

const same = (a,b) => a.date===b.date && a.walker===b.walker;

// 只吃接收端在同一 script lock 內直接讀出的四欄，不使用 gviz 快照。
// observedStates 在遠端讀表前取得，提交時再核對版本，避免讀表期間的新登記被撤銷。
export async function reconcileWalkSnapshot(db, snapshot, observedStates, env, now) {
  if (!Array.isArray(snapshot)) throw new Error('主清單讀回不完整');
  const byKey = new Map();
  for (const row of snapshot) {
    if (!row.dog || !row.current || typeof row.current.walker!=='string' || !/^(\d{4}-\d{2}-\d{2})?$/.test(row.current.date)) throw new Error('主清單讀回格式不明');
    const key=row.dog.id || `名:${row.dog.name}`;
    byKey.set(key,byKey.has(key) ? null : row.current);
  }
  let changed=0;
  for (const state of observedStates) {
    const sheet=byKey.get(state.dog_key);
    if (!sheet || same(sheet,{ date:state.base_date,walker:state.base_walker })) continue;
    // 未決派送可能正好寫到中間值；沒有可信分類就留給同鎖 target 查明，不能當人工值。
    if (state.status!=='synced' || !same({ date:state.effective_date,walker:state.walker },{ date:state.base_date,walker:state.base_walker })) continue;
    if (changed===10) break;
    try {
      const members=await membersOf(db,sheet.walker,env.WALKER_KEY);
      const version=state.version+1,at=new Date(now).toISOString();
      await db.batch([
        db.prepare('INSERT INTO v3_walk_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM v3_walk_state s JOIN v3_walk_outbox o ON o.dog_key=s.dog_key AND o.version=s.version WHERE s.dog_key=? AND s.version=? AND o.status=\'synced\') THEN 1 ELSE 0 END').bind(state.dog_key,state.version),
        ...await writeBudget(db,env,40,now),
        db.prepare('UPDATE v3_walk_state SET version=?,effective_date=?,walker=?,members_json=?,base_date=?,base_walker=?,previous_date=effective_date,previous_walker=walker,updated_at=? WHERE dog_key=? AND version=?')
          .bind(version,sheet.date,sheet.walker,JSON.stringify(members),sheet.date,sheet.walker,at,state.dog_key,state.version),
        db.prepare("INSERT INTO v3_walk_outbox(dog_key,version,operation_date,target_date,target_walker,status,next_attempt_at) VALUES(?,?,?,?,?,'pending',?)")
          .bind(state.dog_key,version,at.slice(0,10),sheet.date,sheet.walker,at),
        db.prepare("UPDATE v3_walk_outbox SET status='synced',readback_seen=1 WHERE dog_key=? AND version=?").bind(state.dog_key,version),
        db.prepare('DELETE FROM v3_walk_guard'),
      ]);
      changed++;
    } catch (error) { console.warn('walk-reconcile:',state.dog_key,error.message); }
  }
  return changed;
}

export async function scanWalks(env,now) {
  const observed=(await env.DB.prepare(`SELECT s.*,o.status FROM v3_walk_state s
    JOIN v3_walk_outbox o ON o.dog_key=s.dog_key AND o.version=s.version`).all()).results || [];
  if (!observed.length) return;
  const response=await fetch(env.SHEET_WRITE_URL,{ method:'POST',headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({ action:'walkScan',key:env.SHEET_WRITE_KEY }),signal:AbortSignal.timeout(20000) });
  const body=await response.json();
  if (!response.ok || !body.ok) throw new Error('主清單直接讀回失敗');
  await reconcileWalkSnapshot(env.DB,body.rows,observed,env,now);
}
