-- #775（ADR 0025）：資料頁「系統自動判斷」與編輯抽屜查修改紀錄裡系統判斷的那幾種（worker/src/editlog.js JUDGE_KINDS）。
-- 部分索引只收這幾種：溜了等大量紀錄寫入不多寫索引列，查詢只走判斷紀錄、照 id 由新到舊，不沿整張修改紀錄掃。
-- 種類清單要跟 JUDGE_KINDS 一字不差（查詢照抄同一份字面值，SQLite 才認得這個索引；admin-stage4.test.mjs 看查詢計畫）
CREATE INDEX IF NOT EXISTS v3_edit_log_judge ON v3_edit_log(id) WHERE kind IN ('automerge','stay-start','stay-end','pair','not_same');
