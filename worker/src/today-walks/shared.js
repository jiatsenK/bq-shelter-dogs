// 今日溜狗紀錄 module 內共用的小工具（ADR 0018）。module 外面只 import ./index.js（worker/test/standards.test.mjs 會擋）。
import { splitNames } from '../sheet-read.js';
import { walkerCode } from '../editlog.js';

export const names = text => [...new Set(splitNames(text))];
// 名單 → 溜狗紀錄用的代號（重複的只留一個；沒有 WALKER_KEY 算不出代號就是空的，溜狗紀錄記一列沒有溜狗人）
export const codesOf = async (text, secret) => [...new Set((await Promise.all(names(text).map(name => walkerCode(name, secret)))).filter(Boolean))];
// 名單照拆開的名字比（#707）：沒有溜狗狀態的狗改前是表上原文，可能用逗號或空白分隔
export const sameNames = (a, b) => names(a).join('、') === names(b).join('、');
export const keyOf = dog => dog.id || `名:${dog.name}`;
export const same = (a, b) => a.date === b.date && a.walker === b.walker;
export const one = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
export const rows = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];
// 多個讀取併成一次 D1 往返（#460：Worker CPU 跟往返次數成正比）；回傳每個查詢的結果列。
export const reads = async (db, ...queries) => (await db.batch(queries.map(([sql, ...args]) => db.prepare(sql).bind(...args)))).map(r => r.results || []);
export const taiwanDay = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
// 寫入預算的日子：D1 帳號額度 UTC 午夜重置，跟今日溜狗的台灣日期不同
export const budgetDay = ms => new Date(ms).toISOString().slice(0, 10);
// 保險掃描只收「沒有交給 Apps Script」的這一版：人工收下的（synced）或還沒派送的（pending）；
// 派送中、結果不明、等重試的由派送自己在同鎖 target／回執收尾
export const scanCanTake = status => status === 'synced' || status === 'pending';
export const CURRENT_JOB = 'SELECT o.* FROM v3_walk_outbox o JOIN v3_walk_state s ON s.dog_key=o.dog_key AND s.version=o.version WHERE o.dog_key=?';
export const RETRY = 'SELECT dispatch_id,reserved_day FROM v3_walk_retry WHERE dog_key=?';
export const MAIN_DOG = dog => `SELECT dog_id,walked_date,walker,walker_codes,row_index FROM v3_sheet_main WHERE ${dog.id ? 'number=?' : "number='' AND name=?"}`;

// 交易條件（#681、#747）：給 conditional-batch.js 的 batchIf，條件成立（算出 1）才整批寫；不成立、NULL 都整批回復
export const when = (sql, ...args) => ({ sql, args });

export class WalkError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function changedWalk(old) {
  const error = new WalkError(409, '名單已改變，請先確認目前紀錄');
  error.current = { date: old.effective_date, walker: old.walker };
  error.version = old.version;
  return error;
}
