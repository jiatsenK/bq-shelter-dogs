// 寫一個新版本：志工接受（溜了／修改／復原）、改表通知（含狗清單同步交來的溜狗欄，#747）、保險掃描三條路徑都走這裡（#746）。
// 一個有條件 batch（交易）：version guard、寫入預算、取代未完成工作、插入 outbox、上一次、溜狗紀錄、修改紀錄，一起成功或一起回復。
// 溜狗紀錄（v3_walks）與溜狗類修改紀錄只由今日溜狗紀錄 module 寫（ADR 0018 補充，#747）。
import { editLogWrites } from '../editlog.js';
import { one, reads, codesOf, when } from './shared.js';
import { costOf, reserve, budgetedBatch } from './budget.js';

// 「上一次」：同一天只換人，沿用原本的上一次；換了日期，上一次就是改前的值。
// before：人工一格一格改時（observe.js 的 beforeManualEdits）這串連改之前那一版，記它不記改一半的狀態。
export function previousOf(old, sameDay, before = null) {
  if (sameDay) return { date: old.previous_date ?? '', walker: old.previous_walker ?? '' };
  return before ? { date: before.target_date, walker: before.target_walker } : { date: old.effective_date, walker: old.walker };
}

// 溜狗紀錄一隻狗一天一組（同一天以最後一次為準，跟當初從 GitHub JSON 匯入時合併的規則一樣）。
// 只寫不一樣的位置（#682，ADR 0008）：同一份名單再寫一次寫入 0 列、溜狗紀錄資料包不失效。
// - 名單照位置比，順序不同算有變；沒有溜狗人存一列 null，用 IS NOT 比，null 對 null 算一樣；人數變少刪掉多出的位置。
// - 那天的編號和狗名照第一次記的（#248），之後改名、換編號不改那天，加人也沿用。
export function walkDay(db, dogId, date, dog, codes) {
  const list = codes.length ? codes : [null];
  return [
    db.prepare('DELETE FROM v3_walks WHERE dog_id=? AND walk_date=? AND position>=?').bind(dogId, date, list.length),
    ...list.map((code, i) => db.prepare(`INSERT INTO v3_walks(dog_id,walk_date,position,walker_code,dog_number,dog_name)
      SELECT ?1,?2,?3,?4,COALESCE((SELECT dog_number FROM v3_walks WHERE dog_id=?1 AND walk_date=?2 AND position=0),?5),COALESCE((SELECT dog_name FROM v3_walks WHERE dog_id=?1 AND walk_date=?2 AND position=0),?6) WHERE true
      ON CONFLICT(dog_id,walk_date,position) DO UPDATE SET walker_code=excluded.walker_code,walker_name=NULL WHERE walker_code IS NOT excluded.walker_code`)
      .bind(dogId, date, i, code, dog.id, dog.name)),
  ];
}

// 溜狗紀錄（v3_walks，圖鑑／我溜過讀）跟著今日溜狗紀錄同一批寫（稽核第 4 項，K 2026-10-26）。
// walks：{ rewrite, drop, codes }。rewrite＝照名單代號 codes 重寫那天；drop＝刪掉那天（復原、人工改回較早的日子）；都沒有就不動（清空日期不刪）。
// 那天原本有幾列不能從溜狗狀態推（例如改回的較早那天本來就有紀錄），寫前照 v3_walks 實際列數算預算，
// 同一批再用條件確認列數沒有變多，保留量才是真的上界。
async function walkWrites(db, dogId, dog, { rewrite = null, drop = null, codes = [] } = {}) {
  const days = [drop, rewrite].filter(Boolean);
  if (!dogId || !days.length) return { conditions: [], statements: [], rows: 0 };
  const counts = (await reads(db, ...days.map(day => ['SELECT COUNT(*) AS n FROM v3_walks WHERE dog_id=? AND walk_date=?', dogId, day]))).map(([r]) => r?.n || 0);
  const conditions = days.map((day, i) => when('(SELECT COUNT(*) FROM v3_walks WHERE dog_id=? AND walk_date=?)<=?', dogId, day, counts[i]));
  const statements = [], at = day => counts[days.indexOf(day)];
  let rows = 0;
  if (drop) { statements.push(db.prepare('DELETE FROM v3_walks WHERE dog_id=? AND walk_date=?').bind(dogId, drop)); rows += at(drop); }
  // 重寫：刪掉多出來的位置、照名單一位一位寫，最多動到「原本的列＋新名單」那麼多列
  if (rewrite) { statements.push(...walkDay(db, dogId, rewrite, dog, codes)); rows += at(rewrite) + Math.max(1, codes.length); }
  return { conditions, statements, rows };
}

// next：{ dog, key, date, walker, members, operationDate, at, status }
//   status：'pending'＝要寫回試算表；'synced'＝人工改表收下的值就是表上的值。
// base：收下試算表觀測值時傳表上的值（同時記 v3_walk_baselines）；志工接受不傳，不動 base（回執確認可能剛更新它）。
// walks：見 walkWrites。logs：給 editlog.js 的 editLogWrites 的修改紀錄。
// request：志工接受的請求識別與回應（重送時原樣回）。
export async function writeVersion(db, env, now, { old, next, previous, base = null, walks = {}, logs = [], request = null }) {
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
  const walked = await walkWrites(db, old.dog_id, next.dog, walks);
  statements.push(...walked.statements);
  writes.push(['v3_walks', walked.rows]);
  for (const entry of logs) statements.push(...editLogWrites(db, entry));
  writes.push(['v3_edit_log', logs.length]);
  await budgetedBatch(db, env, now, { cost: costOf(writes), statements,
    conditions: [when('COALESCE((SELECT version FROM v3_walk_state WHERE dog_key=?),0)=?', next.key, old.version), ...walked.conditions] });
  return version;
}

// 狗清單同步新建進主清單的狗（新狗、回所）：表上那天溜狗紀錄還沒有才照表上名單寫，不記修改紀錄、不建溜狗狀態（照 #747 前狗清單同步的規則）。
// 主清單複本還沒有這隻狗，沒有基準值可以比，所以不走觀測值；回 { conditions, statements } 放進狗清單同步建狗那一批（溜狗紀錄的外鍵要先有狗）。
export async function listedWalk(db, env, now, dogId, dog, { date, walker }) {
  if (!date || await one(db, 'SELECT 1 FROM v3_walks WHERE dog_id=? AND walk_date=? LIMIT 1', dogId, date)) return { conditions: [], statements: [] };
  const codes = await codesOf(walker, env.WALKER_KEY);
  const budget = reserve(db, env, costOf([['v3_walks', Math.max(1, codes.length)]]), now);
  return { conditions: [...budget.conditions, when('NOT EXISTS(SELECT 1 FROM v3_walks WHERE dog_id=? AND walk_date=?)', dogId, date)],
    statements: [...budget.statements, ...walkDay(db, dogId, date, dog, codes)] };
}

// 沒編號的狗補上編號（狗清單同步）：那隻狗還沒記編號的溜狗紀錄補上（那天的編號照第一次記的，#248；之後換編號不改）。
// 只改編號一欄、一隻狗只會發生一次，跟狗清單同步那一批一起寫，不另保留寫入預算（同 #747 前）
export const numberWalks = (db, dogId, number) => [db.prepare("UPDATE v3_walks SET dog_number=? WHERE dog_id=? AND dog_number=''").bind(number, dogId)];
