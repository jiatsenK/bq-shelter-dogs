-- #559 第二步：刪 0005 換成 JSON 之後沒人讀寫的 3 張表。第一步（PR #578）的程式已部署，Worker、GAS、腳本、管理網站都只讀寫
-- v3_sheet_main.walker_codes、v3_sheet_group_columns。套用 workflow 會先整份複製正式庫到 bq-shelter-dogs-backup。
-- 觸發器跟著表一起刪；先明寫 DROP TRIGGER，看得出少了哪幾個。v3_sheet_main_walkers 是子表（外鍵指向主清單），刪它不影響主清單
DROP TRIGGER IF EXISTS packs_v3_sheet_main_walkers_INSERT;
DROP TRIGGER IF EXISTS packs_v3_sheet_main_walkers_UPDATE;
DROP TRIGGER IF EXISTS packs_v3_sheet_main_walkers_DELETE;
DROP TRIGGER IF EXISTS packs_v3_sheet_groups_INSERT;
DROP TRIGGER IF EXISTS packs_v3_sheet_groups_UPDATE;
DROP TRIGGER IF EXISTS packs_v3_sheet_groups_DELETE;
DROP TRIGGER IF EXISTS packs_v3_sheet_group_labels_INSERT;
DROP TRIGGER IF EXISTS packs_v3_sheet_group_labels_UPDATE;
DROP TRIGGER IF EXISTS packs_v3_sheet_group_labels_DELETE;
DROP TABLE IF EXISTS v3_sheet_main_walkers;
DROP TABLE IF EXISTS v3_sheet_groups;
DROP TABLE IF EXISTS v3_sheet_group_labels;
