-- #560（#521-8）第二步：刪舊離所三表。0006 已把資料搬進 v3_dog_departures，程式從 #579 起不讀不寫這三張表。
-- 會刪資料：套用 workflow 會先把正式庫複製到備用庫 bq-shelter-dogs-backup。
-- 觸發器、索引隨表一起刪；這裡先明寫 DROP TRIGGER，看得出少了哪 9 個。v3_departure_items 參照 v3_departures，先刪。
DROP TRIGGER IF EXISTS packs_v3_departures_INSERT;
DROP TRIGGER IF EXISTS packs_v3_departures_UPDATE;
DROP TRIGGER IF EXISTS packs_v3_departures_DELETE;
DROP TRIGGER IF EXISTS packs_v3_departure_items_INSERT;
DROP TRIGGER IF EXISTS packs_v3_departure_items_UPDATE;
DROP TRIGGER IF EXISTS packs_v3_departure_items_DELETE;
DROP TRIGGER IF EXISTS version_v3_departed_cards_INSERT;
DROP TRIGGER IF EXISTS version_v3_departed_cards_UPDATE;
DROP TRIGGER IF EXISTS version_v3_departed_cards_DELETE;
DROP TABLE IF EXISTS v3_departure_items;
DROP TABLE IF EXISTS v3_departures;
DROP TABLE IF EXISTS v3_departed_cards;
