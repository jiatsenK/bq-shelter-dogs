-- #771（ADR 0025）：試算表上消失的主清單列先當候選，記第一次不見的時間；又出現就清掉，確認後整列移出主清單。
-- 資料包觸發器只看 row_index、dog_id、number、name、cage、note 等欄（UPDATE OF），改這欄不會讓資料包重算。
ALTER TABLE v3_sheet_main ADD COLUMN missing_at TEXT;
