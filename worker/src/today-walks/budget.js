// 寫入預算（ADR 0008）：每批寫入前照「這批要寫哪些表、各幾列」算保守上界，看單次門檻與持久每日保留量，不能靠重試繞過。
// 每日保留量是有條件 batch（conditional-batch.js）的一個條件（#747）：超過就整批回復，錯誤跟其他條件一樣（isConflict）。
// #591：不查 Cloudflare 帳號當日用量（正式環境沒設 token，從沒查到過）。
import { batchIf } from '../conditional-batch.js';
import { budgetDay, WalkError } from './shared.js';

// 每寫一列的保守上界＝表本身 1 列＋每個索引（含主鍵、UNIQUE）1 列＋觸發器連帶寫的列（同一種操作觸發的全部加起來）；AUTOINCREMENT 另加序號 1 列。
// worker/test/today-walks-budget.test.mjs 照 db/compact-schema.sql 算每列成本、用觸發器數每種轉換實際寫的列，確認保留量夠（不讀這張表，少算就失敗）。
export const ROW_COST = {
  v3_walk_state: 3, // 主鍵＋walk_pack 觸發器
  v3_walk_requests: 2,
  v3_walk_outbox: 10, // 主鍵＋7 個部分索引＋walk_pack 觸發器
  v3_walk_baselines: 2,
  v3_walk_delivery: 3, // 主鍵＋started 索引
  v3_walk_retry: 2,
  v3_walk_write_budget: 2,
  v3_walk_conflicts: 2,
  v3_walks: 6, // 主鍵＋日期、無編號兩個索引＋walkpack 觸發器（UPDATE 兩句）
  v3_edit_log: 3, // AUTOINCREMENT 序號＋系統自動判斷的部分索引（#775；溜了不在索引裡，照保守上界算）
};

// writes：[[表, 列數], …]；保留量本身也寫一列 v3_walk_write_budget，一起算進去。
export function costOf(writes) {
  let cost = ROW_COST.v3_walk_write_budget;
  for (const [table, count] of writes) {
    if (!ROW_COST[table]) throw new Error(`寫入預算沒有這張表的成本：${table}`);
    cost += ROW_COST[table] * count;
  }
  return cost;
}

// 一隻狗一次派送整條協定（#498）要寫的列：認領、GAS target 授予、回執確認或可信舊回執、失敗轉重試、放掉派送識別。
// 派送時一次保留，同派送的 target／receipt 已預付，不重複扣（prepaid）。
export const CLAIM = [['v3_walk_retry', 1], ['v3_walk_delivery', 1], ['v3_walk_outbox', 1]];
export const GRANT = [['v3_walk_delivery', 1], ['v3_walk_outbox', 1]];
export const CONFIRM = [['v3_walk_state', 1], ['v3_walk_baselines', 1], ['v3_walk_outbox', 1], ['v3_walk_delivery', 1]];
export const READBACK = [['v3_walk_outbox', 1]];
export const FAILURE = [['v3_walk_retry', 1], ['v3_walk_outbox', 1]];
export const RELEASE = [['v3_walk_delivery', 1]];
export const DISPATCH_ROWS = [...CLAIM, ...GRANT, ...CONFIRM, ...READBACK, ...FAILURE, ...RELEASE];
// 一隻狗的整條協定（不含保留量那一列，那列每批只寫一次）
export const DISPATCH_COST = costOf(DISPATCH_ROWS) - ROW_COST.v3_walk_write_budget;

export const retryBudget = env => Number(env.SYNC_RETRY_DAILY_BUDGET || 10000);

// 保留 cost 列：回 { conditions, statements }，條件是「今天的保留量加這批不超過每日上限」，句子記下這次保留量。
// retry：其中屬於寫回重試的列數（#685），同時算進總預算與重試自己的每日上限。超過單次門檻直接丟 503，不送 D1。
export function reserve(db, env, cost, now, retry = 0) {
  const max = Number(env.SYNC_MAX_ROWS || 500), daily = Number(env.SYNC_DAILY_BUDGET || 20000), retryDaily = retryBudget(env);
  if (!Number.isFinite(max) || !Number.isFinite(daily) || !Number.isFinite(retryDaily) || cost > max) throw new WalkError(503, '溜狗寫入預算不足');
  const day = budgetDay(now);
  return {
    conditions: [
      { sql: 'COALESCE((SELECT reserved FROM v3_walk_write_budget WHERE day=?),0)+?<=?', args: [day, cost, daily] },
      ...retry ? [{ sql: 'COALESCE((SELECT retry FROM v3_walk_write_budget WHERE day=?),0)+?<=?', args: [day, retry, retryDaily] }] : [],
    ],
    statements: [db.prepare('INSERT INTO v3_walk_write_budget(day,reserved,retry) VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET reserved=reserved+excluded.reserved,retry=retry+excluded.retry').bind(day, cost, retry)],
  };
}

// 保留 cost 列後，conditions 都成立才寫 statements（一個 D1 batch）；cost 是 0（同派送已預付）就不保留。
// 回 statements 的結果（跟 statements 一一對應，不含記保留量那句）
export async function budgetedBatch(db, env, now, { cost, retry = 0, conditions = [], statements }) {
  const budget = cost ? reserve(db, env, cost, now, retry) : { conditions: [], statements: [] };
  const results = await batchIf(db, [...budget.conditions, ...conditions], [...budget.statements, ...statements]);
  return results.slice(budget.statements.length);
}

// 派送後的狀態轉換要保留的列數：同派送當天已在 v3_walk_retry 保留過整條協定就是 0。
// retry：同一次請求已讀到的 v3_walk_retry 列（沒有這列為 null）；沒傳就自己讀。
export async function transitionCost(db, now, dogKey, dispatchId, writes, retry) {
  const day = budgetDay(now);
  const prepaid = retry !== undefined ? retry?.dispatch_id === dispatchId && retry.reserved_day === day
    : await db.prepare('SELECT dispatch_id FROM v3_walk_retry WHERE dog_key=? AND dispatch_id=? AND reserved_day=?').bind(dogKey, dispatchId, day).first();
  return prepaid ? 0 : costOf(writes);
}
