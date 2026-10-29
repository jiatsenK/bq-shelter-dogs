// 寫一個新版本：志工接受（溜了／修改／復原）、改表通知、保險掃描三條路徑都走這裡（#746）。
// 一個 D1 batch（交易）：version guard、寫入預算、取代未完成工作、插入 outbox、上一次、溜狗紀錄、修改紀錄，一起成功或一起回復。
import { editLogWrites } from '../editlog.js';
import { walkDay } from '../dog-list.js';
import { guard } from './shared.js';
import { costOf, reserve } from './budget.js';

// 「上一次」：同一天只換人，沿用原本的上一次；換了日期，上一次就是改前的值。
// before：人工一格一格改時（observe.js 的 beforeManualEdits）這串連改之前那一版，記它不記改一半的狀態。
export function previousOf(old, sameDay, before = null) {
  if (sameDay) return { date: old.previous_date ?? '', walker: old.previous_walker ?? '' };
  return before ? { date: before.target_date, walker: before.target_walker } : { date: old.effective_date, walker: old.walker };
}

// 溜狗紀錄（v3_walks，圖鑑／我溜過讀）跟著今日溜狗紀錄同一批寫（稽核第 4 項，K 2026-10-26）。
// history：'rewrite'＝照新名單重寫新的那天（codes 是名單代號）；'drop'＝刪掉改前那天（復原、人工改回較早的日子）；null＝不動。
// 清空日期不刪（同 dog-list.js）。人工改的新那天仍由狗清單同步照表寫。
// 那天原本有幾列不能從溜狗狀態推（狗清單同步可能已經照表寫了別的名單），寫前照 v3_walks 實際列數算預算，
// 同一批再用 guard 確認列數沒有變多，保留量才是真的上界。
async function historyWrites(db, old, next, history, codes) {
  if (!old.dog_id || !history) return { statements: [], rows: 0 };
  const date = history === 'drop' ? old.effective_date : next.date;
  const existing = (await db.prepare('SELECT COUNT(*) AS n FROM v3_walks WHERE dog_id=? AND walk_date=?').bind(old.dog_id, date).first())?.n || 0;
  const unchanged = guard(db, '(SELECT COUNT(*) FROM v3_walks WHERE dog_id=? AND walk_date=?)<=?', old.dog_id, date, existing);
  if (history === 'drop') return { statements: [unchanged, db.prepare('DELETE FROM v3_walks WHERE dog_id=? AND walk_date=?').bind(old.dog_id, date)], rows: existing };
  // 重寫：刪掉多出來的位置、照名單一位一位寫，最多動到「原本的列＋新名單」那麼多列
  return { statements: [unchanged, ...walkDay(db, old.dog_id, date, next.dog, codes)], rows: existing + Math.max(1, codes.length) };
}

// next：{ dog, key, date, walker, members, operationDate, at, status }
//   status：'pending'＝要寫回試算表；'synced'＝人工改表收下的值就是表上的值。
// base：收下試算表觀測值時傳表上的值（同時記 v3_walk_baselines）；志工接受不傳，不動 base（回執確認可能剛更新它）。
// history／codes：見 historyWrites。logs：[{ entry, when }]，entry 給 editlog.js 的 editLogWrites。
// request：志工接受的請求識別與回應（重送時原樣回）。
export async function writeVersion(db, env, now, { old, next, previous, base = null, history = null, codes = [], logs = [], request = null }) {
  const version = old.version + 1;
  const statements = [], writes = [['v3_walk_state', 1], ['v3_walk_outbox', 2]];
  const keepBase = !base;
  const firstBase = { date: old.base_date ?? old.effective_date, walker: old.base_walker ?? old.walker };
  const setBase = base || firstBase;
  statements.push(db.prepare(`INSERT INTO v3_walk_state(dog_key,dog_id,number,name,version,effective_date,walker,members_json,base_date,base_walker,previous_date,previous_walker,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(dog_key) DO UPDATE SET version=excluded.version,effective_date=excluded.effective_date,walker=excluded.walker,members_json=excluded.members_json,${keepBase ? '' : 'base_date=excluded.base_date,base_walker=excluded.base_walker,'}previous_date=excluded.previous_date,previous_walker=excluded.previous_walker,updated_at=excluded.updated_at`)
    .bind(next.key, old.dog_id, next.dog.id, next.dog.name, version, next.date, next.walker, JSON.stringify(next.members), setBase.date, setBase.walker, previous.date, previous.walker, next.at));
  if (request) {
    statements.push(db.prepare('INSERT INTO v3_walk_requests VALUES(?,?,?,?,?)').bind(request.id, next.key, next.operationDate, request.fingerprint, JSON.stringify(request.result)));
    writes.push(['v3_walk_requests', 1]);
  }
  statements.push(db.prepare("UPDATE v3_walk_outbox SET status='superseded' WHERE dog_key=? AND status NOT IN ('synced','superseded')").bind(next.key),
    db.prepare("INSERT INTO v3_walk_outbox(dog_key,version,operation_date,target_date,target_walker,status,next_attempt_at) VALUES(?,?,?,?,?,'pending',?)").bind(next.key, version, next.operationDate, next.date, next.walker, next.at));
  // walk_pack_INSERT 觸發器先記 pending；收下的值另外改狀態，walk_pack_outbox_UPDATE 才會把資料包也改成 synced。
  if (next.status !== 'pending') {
    statements.push(db.prepare('UPDATE v3_walk_outbox SET status=? WHERE dog_key=? AND version=?').bind(next.status, next.key, version));
    writes.push(['v3_walk_outbox', 1]);
  }
  if (base) {
    statements.push(db.prepare('INSERT INTO v3_walk_baselines VALUES(?,?) ON CONFLICT(dog_key) DO UPDATE SET version=excluded.version').bind(next.key, version));
    writes.push(['v3_walk_baselines', 1]);
  }
  const walked = await historyWrites(db, old, next, history, codes);
  statements.push(...walked.statements);
  writes.push(['v3_walks', walked.rows]);
  for (const { entry, when } of logs) statements.push(...editLogWrites(db, entry, when));
  writes.push(['v3_edit_log', logs.length]);
  await db.batch([
    guard(db, 'COALESCE((SELECT version FROM v3_walk_state WHERE dog_key=?),0)=?', next.key, old.version),
    ...reserve(db, env, costOf(writes), now),
    ...statements,
  ]);
  return version;
}
