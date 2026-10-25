-- #557 第二步：刪 #549 確認沒人讀寫的 6 張表、v3_sheet_main 7 欄、v3_pack_versions 舊欄（只在正式庫）、v3_sync_state 舊鍵。
-- 先加後刪：#557 第一步（PR #575，main 226a4b4）已部署，Worker、GAS、腳本都不再讀寫這些。套用 workflow 會先整份複製正式庫到 bq-shelter-dogs-backup。
-- 2026-10-25 在 bq-shelter-dogs-test 用複本實測過同樣順序：整檔一次成功；欄只在觸發器 UPDATE OF 清單不會擋 DROP COLUMN，但文字會留著舊欄名，所以先換觸發器。

-- 1. 6 張表（v3_photos 的 v3_primary_photo 索引跟著刪；沒有外鍵、觸發器指向它們）
DROP TABLE IF EXISTS v3_walk_compare;
DROP TABLE IF EXISTS v3_sheet_departed;
DROP TABLE IF EXISTS v3_photos;
DROP TABLE IF EXISTS v3_volunteer_codes;
DROP TABLE IF EXISTS v3_favorites;
DROP TABLE IF EXISTS v3_sheet_former_numbers;

-- 2. v3_sheet_main 7 欄。觸發器 UPDATE OF 列著 my_walked／my_walked_date／sex／version，SQLite 會擋 DROP COLUMN，先換掉觸發器
DROP TRIGGER IF EXISTS packs_v3_sheet_main_UPDATE;
CREATE TRIGGER IF NOT EXISTS packs_v3_sheet_main_UPDATE AFTER UPDATE OF row_index,dog_id,number,name,cage,note,walked_date ON v3_sheet_main BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1; UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)))) FROM json_each(years) j) WHERE id=1 AND (OLD.row_index<>NEW.row_index OR OLD.dog_id<>NEW.dog_id OR OLD.number<>NEW.number) AND EXISTS(SELECT 1 FROM v3_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)); END;
ALTER TABLE v3_sheet_main DROP COLUMN covered;
ALTER TABLE v3_sheet_main DROP COLUMN my_walked;
ALTER TABLE v3_sheet_main DROP COLUMN my_walked_date;
ALTER TABLE v3_sheet_main DROP COLUMN synced_at;
ALTER TABLE v3_sheet_main DROP COLUMN version;
ALTER TABLE v3_sheet_main DROP COLUMN sex;
ALTER TABLE v3_sheet_main DROP COLUMN intro;

-- 在所資料包的性別改讀 v3_dogs（#557 第一步），改性別也要讓 small 加 1
DROP TRIGGER IF EXISTS packs_v3_dogs_UPDATE;
CREATE TRIGGER IF NOT EXISTS packs_v3_dogs_UPDATE AFTER UPDATE OF fixed_care,sex ON v3_dogs WHEN OLD.fixed_care<>NEW.fixed_care OR OLD.sex<>NEW.sex BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=NEW.dog_id); END;

-- 3. v3_pack_versions 舊欄 walks／live／cutoff 只在正式庫（和從它複製的測試庫）有，空庫沒有，不能直接 DROP COLUMN：整張重建，只留 id、small
CREATE TABLE v3_pack_versions_557 AS SELECT id, small FROM v3_pack_versions;
DROP TABLE v3_pack_versions;
CREATE TABLE IF NOT EXISTS v3_pack_versions (id INTEGER PRIMARY KEY CHECK(id=1), small INTEGER NOT NULL DEFAULT 0);
INSERT INTO v3_pack_versions(id, small) SELECT id, small FROM v3_pack_versions_557;
DROP TABLE v3_pack_versions_557;

-- 4. v3_sync_state 舊同步的鍵，沒有程式讀寫
DELETE FROM v3_sync_state WHERE key IN ('sheet_sig', 'walks_synced');
