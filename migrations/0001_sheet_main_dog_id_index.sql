-- #555：主清單用狗 ID 找列不整張掃。開卡讀回、readRest 等的 NUMBER_OF，和觸發器的 EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=…) 都用到。
-- row_index 是 INTEGER PRIMARY KEY（rowid），索引本身就照 row_index 排，ORDER BY m.row_index LIMIT 1 不用另外排序。
CREATE INDEX IF NOT EXISTS v3_sheet_main_dog ON v3_sheet_main(dog_id);
