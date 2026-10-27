-- #678：保險掃描（dog-list.js scanTick，每天 3 次）找「誰遛的」原文還沒補填（walker IS NULL，#519）的列，原本每次整張掃主清單。
-- 正式庫早就是 0 列：部分索引只收 walker IS NULL 的列，平常是空的，查詢改走索引就讀 0 列。index.js 管理用途的同條件查詢也一樣。
CREATE INDEX IF NOT EXISTS v3_sheet_main_walker_null ON v3_sheet_main(row_index) WHERE walker IS NULL;
