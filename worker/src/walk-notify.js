import { writeBudget } from './walk-accept.js';

// 預算包含控制列、guard 與每日保留量；控制列不是同步成功證明。
async function transition(db, env, statement) {
  const result = await db.batch([...await writeBudget(db,env,8),statement,db.prepare('DELETE FROM v3_walk_guard')]);
  return result[result.length-2].results || [];
}

export async function compareNotifiedWalks(db, env, recoverBefore = '') {
  const owner = crypto.randomUUID(), started = new Date().toISOString();
  const claimed = await transition(db,env,db.prepare("UPDATE v3_walk_compare SET status='running',owner=?,again=0,started_at=?,error='' WHERE id=1 AND (status<>'running' OR (started_at<=? AND ?<>'')) RETURNING id").bind(owner,started,recoverBefore,recoverBefore));
  if (!claimed.length) {
    await transition(db,env,db.prepare("UPDATE v3_walk_compare SET again=1 WHERE id=1 AND status='running' AND again=0"));
    return { merged:true };
  }
  try {
    for (let pass=0; pass<2; pass++) {
      if (!env.SHEET_WRITE_URL || !env.SHEET_WRITE_KEY) throw new Error('trusted-sheet-reader-not-configured');
      // 只傳已知一致基準供 GAS 篩掉無差異列；可信值仍由同鎖直接讀表取得。
      const known = (await db.prepare(`SELECT m.number AS id,m.name,
        COALESCE(s.base_date,m.walked_date,'') AS date,
        COALESCE(s.base_walker,(SELECT group_concat(name,'、') FROM
          (SELECT COALESCE(n.name,v.name) AS name FROM v3_sheet_main_walkers w
           LEFT JOIN v3_identity_names n ON n.code=w.walker_code
           LEFT JOIN v3_volunteer_codes c ON c.code=w.walker_code
           LEFT JOIN v3_volunteers v ON v.volunteer_id=c.volunteer_id
           WHERE w.row_index=m.row_index ORDER BY w.position)),'') AS walker
        FROM v3_sheet_main m LEFT JOIN v3_walk_state s ON s.dog_key=CASE WHEN m.number<>'' THEN m.number ELSE '名:'||m.name END LIMIT 501`).all()).results || [];
      if (known.length>500) throw new Error('comparison-source-row-limit');
      const response = await fetch(env.SHEET_WRITE_URL,{ method:'POST',headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({ action:'walkCompare',key:env.SHEET_WRITE_KEY,known,limit:5 }),signal:AbortSignal.timeout(25000) });
      const result = await response.json();
      if (!response.ok || !result.ok || result.protocol!=='walkCompare-v1' ||
        !Number.isInteger(result.compared) || result.compared<0 || result.compared>5 || result.remaining!==0) throw new Error('trusted-sheet-comparison-incomplete');
      const state = await db.prepare('SELECT again FROM v3_walk_compare WHERE id=1 AND owner=?').bind(owner).first();
      if (!state) return { merged:true };
      if (state?.again && pass===0) {
        await transition(db,env,db.prepare('UPDATE v3_walk_compare SET again=0 WHERE id=1 AND owner=?').bind(owner));
        continue;
      }
      await transition(db,env,db.prepare("UPDATE v3_walk_compare SET status=CASE WHEN again=1 THEN 'pending' ELSE 'idle' END,owner='' WHERE id=1 AND owner=?").bind(owner));
      return { compared:true };
    }
  } catch (error) {
    await transition(db,env,db.prepare("UPDATE v3_walk_compare SET status='pending',owner='',error=? WHERE id=1 AND owner=?").bind(String(error.message).slice(0,200),owner));
    console.warn('walk-compare: retained pending comparison');
    return { pending:true };
  }
}

// 排程只重啟讀表工作，不將逾時當作 Google 已完成；仍走相同 GAS 鎖及版本 guard。
export async function retryNotifiedComparison(env,now) {
  if (env.D1_WALK_NOTIFY!=='1') return;
  const cutoff=new Date(now-60000).toISOString();
  const pending=await env.DB.prepare("SELECT id FROM v3_walk_compare WHERE id=1 AND (status='pending' OR (status='running' AND started_at<=?))").bind(cutoff).first();
  if (pending) return compareNotifiedWalks(env.DB,env,cutoff);
}
