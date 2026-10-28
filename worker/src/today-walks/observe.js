// 收試算表觀測值：改表通知（GAS 編輯觸發 /rows、寫前再讀 /observe、target）與保險掃描用同一套規則收下人工修改（ADR 0018 補充，#746）。
// 僅接受同鎖 GAS 直接讀值；通知內容與 gviz 都不能當成觀測值。
import { editLogWrites } from '../editlog.js';
import { names, keyOf, same, one, rows, reads, taiwanDay, CURRENT_JOB, RETRY, MAIN_DOG, WalkError } from './shared.js';
import { seedState } from './read.js';
import { sourceMembers } from './accept.js';
import { writeVersion, previousOf } from './version.js';
import { costOf, reserve } from './budget.js';
import { confirmWalk } from './receipt.js';

// 修改紀錄（#672，ADR 0004 修訂）：收下人工改表時，表上有日期、且收下後日期或溜狗人變了才記（清空日期不記；改回較早一天記成那天）。
// 操作者只能寫表上的溜狗人（sheet）；改後是收下後的值（after，同日跟網站名單合併時會多網站上的人）。
// 網站寫回又讀回的值在比對時就認出來、不會走到收下，所以不會重複記。when：[條件 SQL, ...參數]，寫入當下條件成立才記（#700）
function sheetWalkLog(old, sheet, after, number, at, when) {
  if (!sheet.date || (after.date === old.effective_date && after.walker === old.walker)) return [];
  return [{ entry: { at, kind: 'walk', source: 'sheet', name: sheet.walker, dogId: old.dog_id, number,
    before: { date: old.effective_date, walker: old.walker }, after: { date: after.date, walker: after.walker } }, when }];
}

// #700：網站上還沒有溜狗狀態的狗，網站沒寫回過（登記會先建狀態），表上溜狗欄變了一定是人工改表。
// 狗清單同步常比今日溜狗比對先把新值寫進主清單，比對拿主清單當基準值就看不出有改，所以由狗清單同步在同一批記（dog-list.js applyMain）。
// 比對先收下時狀態已建，這裡就不記；比對讀完基準值後才被狗清單同步搶先時，比對那邊看主清單已變就不記（compare），兩邊只會記一筆。
// old：主清單改前那列；sheet：表上新的 { date, walker }
export async function listWalkLog(db, env, dog, old, sheet, at) {
  const key = keyOf(dog);
  if (await one(db, 'SELECT 1 FROM v3_walk_state WHERE dog_key=?', key)) return [];
  const logs = sheetWalkLog({ dog_id: old.dog_id, effective_date: old.walked_date || '', walker: old.walker ?? '' }, sheet, sheet, dog.id, at,
    ['NOT EXISTS(SELECT 1 FROM v3_walk_state WHERE dog_key=?)', key]);
  return logs.length ? [...reserve(db, env, costOf([['v3_edit_log', 1]]), Date.parse(at)), ...logs.flatMap(l => editLogWrites(db, l.entry, l.when))] : [];
}

async function baselineVersion(db, key) {
  const accepted = (await one(db, 'SELECT version FROM v3_walk_baselines WHERE dog_key=?', key))?.version || 0;
  const synced = (await one(db, "SELECT version FROM v3_walk_outbox WHERE dog_key=? AND status='synced' ORDER BY version DESC LIMIT 1", key))?.version || 0;
  return Math.max(accepted, synced);
}
export async function knownIntermediate(db, key, observed, version) {
  return one(db, "SELECT version FROM v3_walk_outbox WHERE dog_key=? AND target_date=? AND target_walker=? AND readback_seen=1 AND status='superseded' AND version>? AND version<? LIMIT 1",
    key, observed.date, observed.walker, await baselineVersion(db, key), version);
}

// 人工改表的版本：建立當下就 synced、沒派送過（dispatch_id 空白）；next_attempt_at 是建立時間。
// 從 version 往回找 MANUAL_MERGE_MS 內連續的人工版本，回傳這串之前那一版的值；同一日期內改人名不影響「上一次」，所以只在改日期時用。
const MANUAL_MERGE_MS = 120000;
async function beforeManualEdits(db, key, version, now) {
  const since = new Date(now - MANUAL_MERGE_MS).toISOString();
  const chain = await rows(db, "SELECT version,target_date,target_walker,status,dispatch_id,next_attempt_at FROM v3_walk_outbox WHERE dog_key=? AND version<=? ORDER BY version DESC LIMIT 6", key, version);
  const manual = row => row.status === 'synced' && row.dispatch_id === '' && row.next_attempt_at >= since;
  if (!chain.length || chain[0].version !== version || !manual(chain[0])) return null;
  let i = 0;
  while (i + 1 < chain.length && chain[i + 1].version === chain[i].version - 1 && manual(chain[i + 1])) i++;
  const prior = chain[i + 1];
  return prior?.version === chain[i].version - 1 ? prior : null;
}

const validObserved = observed => observed && typeof observed.walker === 'string' && observed.walker.length <= 2000 &&
  typeof observed.date === 'string' && (!observed.date || (/^\d{4}-\d{2}-\d{2}$/.test(observed.date) &&
    Number.isFinite(Date.parse(observed.date)) && new Date(observed.date).toISOString().slice(0, 10) === observed.date));

// seen：回填同一次讀到的衝突紀錄；狀態沒變時也回填快照，給 target 沿用，不再重讀。
// expected：保險掃描讀表前看到的版本；讀表期間有新登記（版本變了）就先不收，留給下一輪，避免新登記被撤銷。
async function compare(db, env, now, dog, observed, seen, expected) {
  if (!validObserved(observed)) throw new WalkError(409, '試算表日期或名單無法確認');
  const key = keyOf(dog);
  const [[stateRow], mains, [conflict], [currentJob], [delivery], [retry]] = await reads(db,
    ['SELECT * FROM v3_walk_state WHERE dog_key=?', key], [MAIN_DOG(dog), dog.id || dog.name],
    ['SELECT dog_key FROM v3_walk_conflicts WHERE dog_key=?', key], [CURRENT_JOB, key],
    ['SELECT dispatch_id FROM v3_walk_delivery WHERE dog_key=?', key], [RETRY, key]);
  seen.conflict = !!conflict;
  if (expected !== undefined && (stateRow?.version || 0) !== expected) return { changed: false, deferred: true };
  const old = stateRow || await seedState(db, dog, taiwanDay(now));
  if (mains.length !== 1 || mains[0].dog_id !== old.dog_id) throw new WalkError(409, '找不到唯一的主清單狗');
  const base = { date: old.base_date ?? old.effective_date, walker: old.base_walker ?? old.walker };
  const current = { date: old.effective_date, walker: old.walker };
  if (same(observed, base)) {
    if (stateRow) seen.snapshot = { state: stateRow, job: currentJob, delivery, retry: retry ?? null };
    return { changed: false, version: old.version, current };
  }
  const job = old.version && currentJob;
  if (same(observed, current) && job?.dispatch_id) {
    await confirmWalk(db, env, now, { dogKey: key, dispatchId: job.dispatch_id, version: old.version, current: observed });
    return { changed: false, version: old.version, current };
  }
  // 未取得可信回執的已派送值，可能是舊程式寫入，不能猜成人工修正。
  const frontier = await baselineVersion(db, key);
  let unknown = await one(db, "SELECT version FROM v3_walk_outbox WHERE dog_key=? AND target_date=? AND target_walker=? AND readback_seen=0 AND dispatch_id<>'' AND version>? LIMIT 1", key, observed.date, observed.walker, frontier);
  if (!unknown && observed.walker === base.walker) unknown = await one(db, "SELECT version FROM v3_walk_outbox WHERE dog_key=? AND target_date=? AND readback_seen=0 AND dispatch_id<>'' AND version>? LIMIT 1", key, observed.date, frontier);
  if (!unknown && observed.date === base.date) unknown = await one(db, "SELECT version FROM v3_walk_outbox WHERE dog_key=? AND target_walker=? AND readback_seen=0 AND dispatch_id<>'' AND version>? LIMIT 1", key, observed.walker, frontier);
  if (unknown) throw new WalkError(409, '試算表可能是未確認派送結果，保留待處理');
  const intermediate = await knownIntermediate(db, key, observed, old.version);
  if (intermediate) return { changed: false, version: old.version, current };
  // 同一天網站名單與表上名單合併：表上拿掉的人拿掉，網站加的人留著。
  let target = observed;
  if (observed.date === base.date && current.date === base.date && observed.walker && !same(current, base)) {
    const removed = names(base.walker).filter(name => !names(observed.walker).includes(name));
    target = { date: observed.date, walker: [...new Set([...names(current.walker).filter(name => !removed.includes(name)), ...names(observed.walker)])].join('、') };
  }
  // 自由改表可能有尚未使用網站的名字；保留來源文字，不猜測或建立志工身分。
  const members = await sourceMembers(db, target.walker, env.WALKER_KEY);
  const at = new Date(now).toISOString();
  const sameDay = target.date === old.effective_date;
  // 人工一格一格改（先改人名再改日期）時，上一次記這串連改之前的值，不記改一半的狀態。
  let before = sameDay ? null : await beforeManualEdits(db, key, old.version, now);
  // 改回連改前的日期：那一版就是現在的值，當「上一次」沒有意義，照一般規則。
  if (before?.target_date === target.date) before = null;
  // 沒有溜狗狀態（基準值從主清單推）：主清單的日期或代號在讀完後被狗清單同步改了，就是它記過了（listWalkLog），這裡不再記
  const unchanged = old.main ? ['EXISTS(SELECT 1 FROM v3_sheet_main WHERE row_index=? AND walked_date IS ? AND walker_codes=?)', old.main.row_index, old.main.walked_date, old.main.walker_codes] : undefined;
  // 改回較早的日子：溜狗紀錄刪掉原本較新那天；清空日期不刪
  const drop = old.dog_id && target.date && old.effective_date && target.date < old.effective_date;
  const version = await writeVersion(db, env, now, { old, previous: previousOf(old, sameDay, before), base: observed,
    history: drop ? 'drop' : null, logs: sheetWalkLog(old, observed, target, dog.id, at, unchanged),
    next: { dog, key, date: target.date, walker: target.walker, members, operationDate: taiwanDay(now), at, status: same(target, observed) ? 'synced' : 'pending' } });
  return { changed: true, version, current: target };
}

const validDog = dog => dog && typeof dog.id === 'string' && typeof dog.name === 'string' && dog.name &&
  (!dog.id || /^[A-Za-z0-9]{1,32}$/.test(dog.id));

// 一隻狗的觀測值：比對失敗記進 v3_walk_conflicts（管理者查得到、GAS 不用再送），之後比對成功就清掉。
export async function observeOne(db, env, now, dog, observed, seen = {}, expected) {
  if (!validDog(dog)) throw new WalkError(400, '狗的識別不完整');
  const key = keyOf(dog), conflictCost = costOf([['v3_walk_conflicts', 1]]);
  try {
    const result = await compare(db, env, now, dog, observed, seen, expected);
    if (seen.conflict && !result.deferred) {
      await db.batch([...reserve(db, env, conflictCost, now), db.prepare('DELETE FROM v3_walk_conflicts WHERE dog_key=?').bind(key)]);
    }
    return result;
  } catch (error) {
    const observation = JSON.stringify(observed ?? null), reason = error.status ? error.message : '比較失敗，保留待處理';
    const previous = await one(db, 'SELECT observation,error FROM v3_walk_conflicts WHERE dog_key=?', key);
    if (previous?.observation !== observation || previous?.error !== reason) {
      await db.batch([...reserve(db, env, conflictCost, now), db.prepare('INSERT INTO v3_walk_conflicts VALUES(?,?,?) ON CONFLICT(dog_key) DO UPDATE SET observation=excluded.observation,error=excluded.error').bind(key, observation, reason)]);
    }
    throw error;
  }
}

// 一批觀測值，逐隻比對，一隻失敗不影響其他隻。items：[{ dog, current, version? }]
// source：'edit'＝改表通知；'scan'＝保險掃描（帶讀表前的 version，每輪最多收 SCAN_LIMIT 隻，其餘留給下一輪）。
// 回每隻 { ok:true, changed, version, current } 或 { ok:false, ack, error }；ack＝已記進 v3_walk_conflicts，GAS 不用再送。
export const SCAN_LIMIT = 10;
export async function observeAll(db, env, now, items, { source = 'edit' } = {}) {
  const scan = source === 'scan', results = [];
  let changed = 0;
  for (const item of items) {
    if (scan && changed === SCAN_LIMIT) { results.push({ ok: true, changed: false, deferred: true }); continue; }
    try {
      const result = await observeOne(db, env, now, item.dog, item.current, {}, scan ? item.version : undefined);
      if (result.changed) changed++;
      results.push({ ok: true, ...result });
    } catch (error) {
      results.push({ ok: false, ack: !!error.status, error: error.status ? error.message : '比較失敗，保留待處理' });
    }
  }
  return results;
}
