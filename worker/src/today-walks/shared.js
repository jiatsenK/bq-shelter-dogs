// 今日溜狗紀錄 module 內共用的小工具（ADR 0018）。module 外面只 import ./index.js（worker/test/standards.test.mjs 會擋）。
import { splitNames } from '../sheet-read.js';

export const names = text => [...new Set(splitNames(text))];
export const keyOf = dog => dog.id || `名:${dog.name}`;
export const same = (a, b) => a.date === b.date && a.walker === b.walker;
export const one = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
export const rows = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];
// 多個讀取併成一次 D1 往返（#460：Worker CPU 跟往返次數成正比）；回傳每個查詢的結果列。
export const reads = async (db, ...queries) => (await db.batch(queries.map(([sql, ...args]) => db.prepare(sql).bind(...args)))).map(r => r.results || []);
export const taiwanDay = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
export const CURRENT_JOB = 'SELECT o.* FROM v3_walk_outbox o JOIN v3_walk_state s ON s.dog_key=o.dog_key AND s.version=o.version WHERE o.dog_key=?';
export const RETRY = 'SELECT dispatch_id,reserved_day FROM v3_walk_retry WHERE dog_key=?';
export const MAIN_DOG = dog => `SELECT dog_id,walked_date,walker,walker_codes,row_index FROM v3_sheet_main WHERE ${dog.id ? 'number=?' : "number='' AND name=?"}`;

// 交易 guard（#681）：條件不成立或是 NULL 才插一列 0，違反 CHECK(ok=1) 讓整個 batch 回復；成立時一列都不寫，batch 結尾也不用清。
// 要用 IS NOT 1，不能寫 WHERE NOT(條件)：條件是 NULL 時 NOT 也是 NULL，guard 會靜靜放行。
export const guard = (db, condition, ...args) => db.prepare(`INSERT INTO v3_walk_guard SELECT 0 WHERE (${condition}) IS NOT 1`).bind(...args);

export class WalkError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function changedWalk(old) {
  const error = new WalkError(409, '名單已改變，請先確認目前紀錄');
  error.current = { date: old.effective_date, walker: old.walker };
  error.version = old.version;
  return error;
}
