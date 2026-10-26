import { writeBudget, membersOf, reconcileWalk, droppedDay } from './walk-accept.js';
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
      const dropped=droppedDay(db,state,sheet.date); // 改回較早的日子：溜狗紀錄刪掉原本較新那天（walk-accept.js）
      await db.batch([
        db.prepare('INSERT INTO v3_walk_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM v3_walk_state s JOIN v3_walk_outbox o ON o.dog_key=s.dog_key AND o.version=s.version WHERE s.dog_key=? AND s.version=? AND o.status=\'synced\') THEN 1 ELSE 0 END').bind(state.dog_key,state.version),
        ...await writeBudget(db,env,40+dropped.cost,now),
        ...dropped.statements,
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

// 一隻狗的指紋：D1 記的「表上值」（base_date／base_walker）；要跟 apps-script/sheet-write.gs 的 walkScanRows 算法完全一樣。
export async function walkFingerprint(date,walker) {
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([date,walker]))));
  return [...bytes.slice(0,8)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

// 保險掃描（ADR 0018 第 5 點）：按狗送指紋，Apps Script 只回指紋不同的狗，Worker 只比那幾隻。
// 指紋直接由 base 算出、不另外記：寫回確認或人工值收下時 base 就跟著更新；沒收完（未決派送、一輪上限）的狗 base 不變，下次自然再回來。
export async function scanWalks(env,now) {
  const observed=(await env.DB.prepare(`SELECT s.*,o.status FROM v3_walk_state s
    JOIN v3_walk_outbox o ON o.dog_key=s.dog_key AND o.version=s.version`).all()).results || [];
  if (!observed.length) return;
  const fingerprints={};
  for (const s of observed) fingerprints[s.dog_key]=await walkFingerprint(s.base_date,s.base_walker);
  const body=await callSheet(env,{ action:'walkScan',fingerprints }).catch(e=>{ throw new Error(`主清單直接讀回失敗：${e.message}`); });
  if (Array.isArray(body.rows) && !body.rows.length) return;
  await reconcileWalkSnapshot(env.DB,body.rows,observed,env,now);
}

// 有人編輯（#500，ADR 0018）：GAS 在同一 script lock 內直接讀出受影響的列送來，Worker 只比這幾隻，不回頭讀整張表。
// 換籠、出現在「已出所」等非溜狗欄位由狗清單編輯觸發另外送（#501，worker/src/dog-list.js），這裡只回 ack。
// ack：Worker 已持久接手（更新、無差異，或已記進 v3_walk_conflicts）；D1 失敗或功能開關關閉回 false，讓 GAS 保留待通知版本，開啟後補送。
export async function reconcileEditedRows(db, rows, env) {
  const walks = env.D1_WALK_NOTIFY === '1';
  const results = [];
  for (const row of rows) {
    if (row.sheet !== 'main' || !row.current) { results.push({ ok:true, ack:true }); continue; }
    if (!walks) { results.push({ ok:false, ack:false, error:'今日溜狗編輯同步尚未啟用' }); continue; }
    try { results.push({ ok:true, ack:true, ...await reconcileWalk(db,row.dog,row.current,env) }); }
    catch (error) { results.push({ ok:false, ack:!!error.status, error:error.status ? error.message : '比較失敗，保留待處理' }); }
  }
  return results;
}
