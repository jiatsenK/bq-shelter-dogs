// 有條件 batch（#745）：條件都成立才整批寫，否則整批回復。樂觀鎖（資料沒被別人改過才寫）、今日溜狗紀錄的寫入預算（#747）共用這一份。
// 條件要算出 1 才放行：0、NULL、資料列不見（純量子查詢是 NULL）都擋（#681）：
// 不成立才插一列 0 讓 CHECK(ok=1) 失敗；成立時一列都不寫，batch 結尾不用清。要用 IS NOT 1，寫成 WHERE NOT(條件) 時 NULL 會放行。
// 條件都在句子之前算，看到的是這批寫入前的資料。
const conditionGuard = (db, { sql, args = [] }) => db.prepare(`INSERT INTO v3_batch_guard SELECT 0 WHERE (${sql}) IS NOT 1`).bind(...args);

// conditions：[{ sql, args }]；回傳只有 statements 的結果（跟 statements 一一對應）
export async function batchIf(db, conditions, statements) {
  const results = await db.batch([...conditions.map(c => conditionGuard(db, c)), ...statements]);
  return results.slice(conditions.length);
}

// 被約束擋下：條件不成立（CHECK）、外鍵，也就是讀完後資料被改過（樂觀鎖的呼叫端回 409 讓使用者重新讀取）或寫入預算不足；
// unique: true 時主鍵或唯一值撞到也算（狗合併）。NOT NULL 等其他錯誤是程式寫錯，不算衝突。
export const isConflict = (error, { unique = false } = {}) =>
  new RegExp(`(CHECK|FOREIGN KEY${unique ? '|UNIQUE' : ''}) constraint failed`, 'i').test(error?.message || '');
