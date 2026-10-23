import { writeBudget, membersOf, reconcileWalk } from './walk-accept.js';
import { callSheet } from './sheet-write.js';

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
  let changed=0,deferred=0;
  for (const state of observedStates) {
    const sheet=byKey.get(state.dog_key);
    if (!sheet || same(sheet,{ date:state.base_date,walker:state.base_walker })) continue;
    // 未決派送可能正好寫到中間值；沒有可信分類就留給同鎖 target 查明，不能當人工值。
    if (state.status!=='synced' || !same({ date:state.effective_date,walker:state.walker },{ date:state.base_date,walker:state.base_walker })) { deferred++; continue; }
    if (changed===10) { deferred++; continue; }
    try {
      const members=await membersOf(db,sheet.walker,env.WALKER_KEY);
      const version=state.version+1,at=new Date(now).toISOString();
      await db.batch([
        db.prepare('INSERT INTO v3_walk_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM v3_walk_state s JOIN v3_walk_outbox o ON o.dog_key=s.dog_key AND o.version=s.version WHERE s.dog_key=? AND s.version=? AND o.status=\'synced\') THEN 1 ELSE 0 END').bind(state.dog_key,state.version),
        ...await writeBudget(db,env,40,now),
        // 同日人工改名單保留原復原基準，不將今天被移除的人當成上一次。
        db.prepare('UPDATE v3_walk_state SET version=?,effective_date=?,walker=?,members_json=?,base_date=?,base_walker=?,previous_date=CASE WHEN effective_date=? THEN previous_date ELSE effective_date END,previous_walker=CASE WHEN effective_date=? THEN previous_walker ELSE walker END,updated_at=? WHERE dog_key=? AND version=?')
          .bind(version,sheet.date,sheet.walker,JSON.stringify(members),sheet.date,sheet.walker,sheet.date,sheet.date,at,state.dog_key,state.version),
        db.prepare("INSERT INTO v3_walk_outbox(dog_key,version,operation_date,target_date,target_walker,status,next_attempt_at) VALUES(?,?,?,?,?,'pending',?)")
          .bind(state.dog_key,version,at.slice(0,10),sheet.date,sheet.walker,at),
        db.prepare("UPDATE v3_walk_outbox SET status='synced',readback_seen=1 WHERE dog_key=? AND version=?").bind(state.dog_key,version),
        db.prepare('DELETE FROM v3_walk_guard'),
      ]);
      changed++;
    } catch (error) { deferred++; console.warn('walk-reconcile:',state.dog_key,error.message); }
  }
  return { changed,deferred };
}

// 四欄指紋（#460）：上次掃描全部收完時記下；Apps Script 讀到一樣的指紋就只回「沒改」，不傳整份。
// 還有差異沒收完（未決派送、一輪上限、失敗）就不記，下次照常拿整份比對。
const SCAN_SIG='walk_scan_sig';

export async function scanWalks(env,now) {
  const [observedResult,sigResult]=await env.DB.batch([
    env.DB.prepare(`SELECT s.*,o.status FROM v3_walk_state s
    JOIN v3_walk_outbox o ON o.dog_key=s.dog_key AND o.version=s.version`),
    env.DB.prepare('SELECT value FROM v3_sync_state WHERE key=?').bind(SCAN_SIG)]);
  const observed=observedResult.results || [], known=sigResult.results?.[0]?.value || '';
  if (!observed.length) return;
  const body=await callSheet(env,{ action:'walkScan',sig:known }).catch(e=>{ throw new Error(`主清單直接讀回失敗：${e.message}`); });
  if (known && body.same===true && body.sig===known) return;
  const { deferred }=await reconcileWalkSnapshot(env.DB,body.rows,observed,env,now);
  const next=!deferred && typeof body.sig==='string' ? body.sig : '';
  if (next!==known) await env.DB.prepare('INSERT INTO v3_sync_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(SCAN_SIG,next).run();
}

// 有人編輯（#500，ADR 0018）：GAS 在同一 script lock 內直接讀出受影響的列送來，Worker 只比這幾隻，不回頭讀整張表。
// 換籠、出現在「已出所」等非溜狗欄位交給狗清單同步（markChanged）；同狗兩處都有，GAS 已合併成最後出現的那筆。
// ack：Worker 已持久接手（更新、無差異，或已記進 v3_walk_conflicts）；D1 失敗或功能開關關閉回 false，讓 GAS 保留待通知版本，開啟後補送。
export async function reconcileEditedRows(db, rows, env, markChanged) {
  const walks = env.D1_WALK_NOTIFY === '1';
  if (!walks || rows.some(row => row.sheet !== 'main' || row.other)) await markChanged(db);
  const results = [];
  for (const row of rows) {
    if (row.sheet !== 'main' || !row.current) { results.push({ ok:true, ack:true }); continue; }
    if (!walks) { results.push({ ok:false, ack:false, error:'今日溜狗編輯同步尚未啟用' }); continue; }
    try { results.push({ ok:true, ack:true, ...await reconcileWalk(db,row.dog,row.current,env) }); }
    catch (error) { results.push({ ok:false, ack:!!error.status, error:error.status ? error.message : '比較失敗，保留待處理' }); }
  }
  return results;
}
