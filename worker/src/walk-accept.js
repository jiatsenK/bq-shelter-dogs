// #456：API 成功承諾止於 D1 原子接受；Google 寫回由持久工作追蹤。
import { walkerCode } from './editlog.js';
import { identityByCode } from './identity.js';
import { todayRowsWritten } from '../../scripts/sync-diff.mjs';

const SEP = /[、,，\/／&＆+＋。｡．.;；:：|｜·・\s]+/;
const names = text => [...new Set(String(text || '').split(SEP).filter(Boolean))];
const keyOf = dog => dog.id || `名:${dog.name}`;
const one = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
const rows = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];
const dayOf = now => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
export class WalkError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function readAcceptedWalks(db, today) {
  // 版本與內容在同一列，冷讀也只讀一列；午夜只換 today 判定。
  const pack = await one(db, 'SELECT version,payload FROM v3_walk_pack WHERE id=1');
  if (!pack) throw new Error('沒有溜狗資料包');
  return { version: pack.version, date: today, source: 'd1', walks: Object.values(JSON.parse(pack.payload))
    .map(w => ({ ...w, walked: w.walkedDate === today })) };
}

// SQL 的每次寫入都預留含觸發器與索引的保守上界。帳號當日量不可取得時，
// 與既有同步相同：警告＋單次門檻；本路徑另有持久每日保留量，不能靠重試繞過。
export async function writeBudget(db, env, cost, now = Date.now()) {
  const max = Number(env.SYNC_MAX_ROWS || 500), daily = Number(env.SYNC_DAILY_BUDGET || 20000);
  const observed = env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID ? await todayRowsWritten({ token: env.CLOUDFLARE_API_TOKEN,
    accountId: env.CLOUDFLARE_ACCOUNT_ID, now: new Date(now), fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(3000) }) }) : null;
  if (!Number.isFinite(max) || !Number.isFinite(daily) || cost > max || (observed !== null && (!Number.isFinite(observed) || observed + cost > daily))) {
    throw new WalkError(503, '溜狗寫入預算不足');
  }
  if (observed === null) console.warn('walk-budget: account analytics unavailable; checking single-operation and reserved daily budget');
  const day = new Date(now).toISOString().slice(0, 10); // D1 帳號額度 UTC 午夜重置。
  return [
    db.prepare('INSERT INTO v3_walk_guard SELECT CASE WHEN COALESCE((SELECT reserved FROM v3_walk_write_budget WHERE day=?),0)+?<=? THEN 1 ELSE 0 END').bind(day, cost, daily),
    db.prepare('INSERT INTO v3_walk_write_budget(day,reserved) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET reserved=reserved+excluded.reserved').bind(day, cost),
  ];
}

async function seedState(db, dog) {
  const matches = await rows(db, `SELECT dog_id,walked_date,row_index FROM v3_sheet_main WHERE ${dog.id ? 'number=?' : "number='' AND name=?"}`, dog.id || dog.name);
  if (matches.length !== 1) throw new WalkError(409, '找不到唯一的主清單狗');
  const seed = matches[0];
  const people = await rows(db, 'SELECT COALESCE(n.name,v.name) AS name FROM v3_sheet_main_walkers w LEFT JOIN v3_identity_names n ON n.code=w.walker_code LEFT JOIN v3_volunteer_codes c ON c.code=w.walker_code LEFT JOIN v3_volunteers v ON v.volunteer_id=c.volunteer_id WHERE w.row_index=? ORDER BY w.position', seed.row_index);
  return { dog_id: seed.dog_id, effective_date: seed.walked_date || '', walker: people.map(p => p.name).filter(Boolean).join('、'), version: 0 };
}

async function membersOf(db, text, secret) {
  const members = [];
  for (const name of names(text)) {
    // 沿用既有固定身分。登記不建立、猜測或合併任何人。
    const person = await identityByCode(db, await walkerCode(name, secret));
    if (!members.some(m => m.volunteerId === person.volunteerId)) members.push({ volunteerId: person.volunteerId, name });
  }
  return members;
}

export async function acceptWalk(db, input, env, now = Date.now()) {
  if (!db || !env.WALKER_KEY) throw new WalkError(503, '身分服務尚未準備好');
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId || '') || input.operationDate !== dayOf(now)) throw new WalkError(400, '請求識別或操作日期不對');
  if (input.action !== 'walk' || !Array.isArray(input.dogs) || input.dogs.length !== 1) throw new WalkError(400, '此入口只接受單狗登記');
  const dog = input.dogs[0], key = keyOf(dog);
  const fingerprint = JSON.stringify({ action: input.action, operationDate: input.operationDate, walker: input.walker, dog });
  const previous = () => one(db, 'SELECT fingerprint,result_json FROM v3_walk_requests WHERE request_id=?', input.requestId);
  const replay = old => {
    if (old.fingerprint !== fingerprint) throw new WalkError(409, '相同請求識別不能更改內容');
    return JSON.parse(old.result_json);
  };
  const existing = await previous();
  if (existing) return replay(existing);
  const added = await membersOf(db, input.walker, env.WALKER_KEY);
  if (!added.length) throw new WalkError(400, '要先選好身分');
  for (let attempt = 0; attempt < 8; attempt++) {
    const old = await one(db, 'SELECT * FROM v3_walk_state WHERE dog_key=?', key) || await seedState(db, dog);
    const members = old.effective_date === input.operationDate
      ? old.members_json ? JSON.parse(old.members_json) : await membersOf(db, old.walker, env.WALKER_KEY) : [];
    for (const person of added) if (!members.some(m => m.volunteerId === person.volunteerId)) members.push(person);
    const walker = members.map(m => m.name).join('、'), version = old.version + 1;
    const baseDate = old.base_date ?? old.effective_date, baseWalker = old.base_walker ?? old.walker;
    const previousDate = old.effective_date === input.operationDate ? old.previous_date ?? '' : old.effective_date;
    const previousWalker = old.effective_date === input.operationDate ? old.previous_walker ?? '' : old.walker;
    const at = new Date(now).toISOString();
    const result = { ...dog, status: 'written', accepted: true, requestId: input.requestId, operationDate: input.operationDate,
      version, current: { date: input.operationDate, walker }, wrote: { walker },
      prev: { date: { date: previousDate }, walker: previousWalker }, syncStatus: 'pending', at };
    try {
      await db.batch([
        db.prepare('INSERT INTO v3_walk_guard SELECT CASE WHEN COALESCE((SELECT version FROM v3_walk_state WHERE dog_key=?),0)=? THEN 1 ELSE 0 END').bind(key, old.version),
        ...await writeBudget(db, env, 32, now),
        db.prepare('INSERT INTO v3_walk_state(dog_key,dog_id,number,name,version,effective_date,walker,members_json,base_date,base_walker,previous_date,previous_walker,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(dog_key) DO UPDATE SET version=excluded.version,effective_date=excluded.effective_date,walker=excluded.walker,members_json=excluded.members_json,previous_date=excluded.previous_date,previous_walker=excluded.previous_walker,updated_at=excluded.updated_at')
          .bind(key, old.dog_id, dog.id, dog.name, version, input.operationDate, walker, JSON.stringify(members), baseDate, baseWalker, previousDate, previousWalker, at),
        db.prepare('INSERT INTO v3_walk_requests VALUES(?,?,?,?,?)').bind(input.requestId, key, input.operationDate, fingerprint, JSON.stringify(result)),
        db.prepare("UPDATE v3_walk_outbox SET status='superseded' WHERE dog_key=? AND status NOT IN ('synced','superseded')").bind(key),
        db.prepare("INSERT INTO v3_walk_outbox(dog_key,version,operation_date,target_date,target_walker,status,next_attempt_at) VALUES(?,?,?,?,?,'pending',?)").bind(key, version, input.operationDate, input.operationDate, walker, at),
        db.prepare('DELETE FROM v3_walk_guard'),
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

export async function dispatchWalk(db, dog, env) {
  const key = keyOf(dog), dispatchId = crypto.randomUUID(), now = new Date().toISOString();
  if (await one(db, 'SELECT dispatch_id FROM v3_walk_delivery WHERE dog_key=?', key)) return;
  const job = await one(db, "SELECT o.* FROM v3_walk_outbox o JOIN v3_walk_state s ON s.dog_key=o.dog_key AND s.version=o.version WHERE o.dog_key=? AND o.status IN ('pending','retry','unconfirmed')", key);
  if (!job) return;
  let claimed;
  try { claimed = await db.batch([
    db.prepare('INSERT INTO v3_walk_guard SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM v3_walk_delivery WHERE dog_key=?) THEN 1 ELSE 0 END').bind(key),
    ...await writeBudget(db, env, 16),
    db.prepare('INSERT INTO v3_walk_delivery VALUES(?,?,?)').bind(key, dispatchId, now),
    db.prepare("UPDATE v3_walk_outbox SET status='dispatching',dispatch_id=?,error='' WHERE dog_key=? AND version=? AND status IN ('pending','retry','unconfirmed') RETURNING version").bind(dispatchId, key, job.version),
    db.prepare('DELETE FROM v3_walk_guard'),
  ]); } catch (error) {
    if (await one(db, 'SELECT dispatch_id FROM v3_walk_delivery WHERE dog_key=?', key)) return;
    throw error;
  }
  if (!claimed[claimed.length - 2].results?.length) {
    await db.prepare('DELETE FROM v3_walk_delivery WHERE dog_key=? AND dispatch_id=?').bind(key, dispatchId).run();
    return;
  }
  try {
    if (!env.SHEET_WRITE_URL || !env.SHEET_WRITE_KEY) throw new Error('writeback-not-configured');
    const res = await fetch(env.SHEET_WRITE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'walkWake', dog, dispatchId, key: env.SHEET_WRITE_KEY }), signal: AbortSignal.timeout(20000) });
    const receipt = await res.json();
    if (!res.ok || !receipt.ok) throw new Error('writeback-unconfirmed');
    const confirmed = await confirmWalk(db, { ...receipt, dogKey: key }, env);
    if (!confirmed.confirmed) throw new Error('writeback-unconfirmed');
  } catch (error) {
    await db.batch([
      ...await writeBudget(db, env, 16),
      db.prepare("UPDATE v3_walk_outbox SET status='retry',error=?,next_attempt_at=? WHERE dog_key=? AND dispatch_id=? AND status='dispatching'")
        .bind(String(error.message).slice(0, 100), now, key, dispatchId),
      db.prepare('DELETE FROM v3_walk_guard'),
    ]);
  } finally {
    await db.prepare('DELETE FROM v3_walk_delivery WHERE dog_key=? AND dispatch_id=?').bind(key, dispatchId).run();
  }
}

export async function confirmWalk(db, receipt, env) {
  const { dogKey, dispatchId, version, current } = receipt;
  if (!current || !dispatchId || !Number.isInteger(version)) throw new WalkError(400, '回執不完整');
  const job = await one(db, 'SELECT * FROM v3_walk_outbox WHERE dog_key=? AND version=? AND dispatch_id=?', dogKey, version, dispatchId);
  const state = await one(db, 'SELECT * FROM v3_walk_state WHERE dog_key=?', dogKey);
  if (!job) return { confirmed:false };
  if (current.date !== job.target_date || current.walker !== job.target_walker) throw new WalkError(409, '試算表讀回不符');
  if (state?.version !== version) {
    // 可信舊回執只記中間讀值，不把目前工作標成完成。未知結果不能走此捷徑。
    if (!job.readback_seen) await db.batch([
      ...await writeBudget(db,env,16),
      db.prepare('UPDATE v3_walk_outbox SET readback_seen=1 WHERE dog_key=? AND version=? AND dispatch_id=? AND readback_seen=0').bind(dogKey,version,dispatchId),
      db.prepare('DELETE FROM v3_walk_guard'),
    ]);
    return { confirmed:false };
  }
  if (job.status === 'synced') return { confirmed:true };
  await db.batch([
    db.prepare('INSERT INTO v3_walk_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM v3_walk_state s JOIN v3_walk_outbox o ON o.dog_key=s.dog_key AND o.version=s.version WHERE s.dog_key=? AND s.version=? AND o.dispatch_id=?) THEN 1 ELSE 0 END').bind(dogKey,version,dispatchId),
    ...await writeBudget(db, env, 16),
    db.prepare('UPDATE v3_walk_state SET base_date=?,base_walker=? WHERE dog_key=? AND version=?').bind(current.date, current.walker, dogKey, version),
    db.prepare("UPDATE v3_walk_outbox SET status='synced',readback_seen=1,error='' WHERE dog_key=? AND version=? AND dispatch_id=?").bind(dogKey, version, dispatchId),
    db.prepare('DELETE FROM v3_walk_guard'),
  ]);
  return { confirmed: true };
}

// 同鎖直接讀表後才呼叫。觀測到不同值時停寫，不將 gviz 舊快照當成人工修改。
export async function writebackTarget(db, input, env) {
  const key = keyOf(input.dog);
  const state = await one(db, 'SELECT * FROM v3_walk_state WHERE dog_key=?', key);
  if (!state) throw new WalkError(404, '尚未接管這隻狗');
  const job = await one(db, 'SELECT * FROM v3_walk_outbox WHERE dog_key=? AND version=?', key, state.version);
  if (!input.current || (input.current.date !== state.base_date || input.current.walker !== state.base_walker)) {
    // 目前目標相符可處理回應遺失；其他已觀測修改留待重新比對，絕不盲寫。
    const matchesCurrent = input.current?.date === state.effective_date && input.current?.walker === state.walker && !!job?.dispatch_id;
    const intermediate = input.current && await one(db, 'SELECT version FROM v3_walk_outbox WHERE dog_key=? AND target_date=? AND target_walker=? AND readback_seen=1 AND version<? LIMIT 1',key,input.current.date,input.current.walker,state.version);
    if (!matchesCurrent && !intermediate) throw new WalkError(409, '觀測到試算表衝突，停止覆寫');
  }
  if (!job || !['dispatching','retry','unconfirmed','pending'].includes(job.status)) throw new WalkError(409, '沒有待寫回目標');
  // 舊喚醒也只取目前版本；在 script lock 中授予目前版本派送識別。
  await db.batch([
    db.prepare('INSERT INTO v3_walk_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM v3_walk_state WHERE dog_key=? AND version=?) THEN 1 ELSE 0 END').bind(key,state.version),
    ...await writeBudget(db, env, 16),
    db.prepare("UPDATE v3_walk_outbox SET dispatch_id=?,status='dispatching' WHERE dog_key=? AND version=? AND EXISTS(SELECT 1 FROM v3_walk_state WHERE dog_key=? AND version=?)").bind(input.dispatchId, key, state.version, key, state.version),
    db.prepare('DELETE FROM v3_walk_guard'),
  ]);
  return { version: state.version, dispatchId: input.dispatchId, current: { date: state.effective_date, walker: state.walker } };
}
