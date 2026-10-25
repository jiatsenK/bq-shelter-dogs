-- #560（#521-8）離所改用狗 ID 記，第一步只「加」：新表 v3_dog_departures 併入 v3_departures、v3_departure_items、v3_departed_cards，
-- 搬現有資料；程式改讀寫新表。舊三張表（和它們的觸發器）先留著不讀不寫，下一張 PR 才 DROP。
-- 這份有 INSERT … SELECT（搬資料），套用 workflow 會先把正式庫複製到備用庫 bq-shelter-dogs-backup。
CREATE TABLE IF NOT EXISTS v3_dog_departures (
  dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  number TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  departed_date TEXT,
  date_source TEXT,
  seen_date TEXT,
  reason TEXT NOT NULL DEFAULT 'unknown',
  matched TEXT NOT NULL DEFAULT '',
  flags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(flags_json)),
  returned_number TEXT,
  last_number TEXT,
  last_name TEXT,
  last_cage TEXT,
  last_walked_date TEXT,
  last_note TEXT,
  last_sex TEXT,
  last_intro TEXT,
  former_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(former_json)),
  groups_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(groups_json)),
  PRIMARY KEY(dog_id,number)
);
CREATE INDEX IF NOT EXISTS v3_dog_departures_date ON v3_dog_departures(departed_date);
CREATE INDEX IF NOT EXISTS v3_dog_departures_number ON v3_dog_departures(number);
-- 離所的版本號（ADR 0014）：新表有新增、修改、刪除，只讓那一年加 1（跟 packs_v3_departures_* 一樣，換年兩年各加 1）
CREATE TRIGGER IF NOT EXISTS packs_v3_dog_departures_INSERT AFTER INSERT ON v3_dog_departures BEGIN UPDATE v3_departure_versions SET years=json_set(years,'$."'||CASE WHEN COALESCE(NEW.departed_date,'')='' THEN 'none' ELSE substr(NEW.departed_date,1,4) END||'"',COALESCE(json_extract(years,'$."'||CASE WHEN COALESCE(NEW.departed_date,'')='' THEN 'none' ELSE substr(NEW.departed_date,1,4) END||'"'),0)+1) WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS packs_v3_dog_departures_UPDATE AFTER UPDATE ON v3_dog_departures BEGIN UPDATE v3_departure_versions SET years=json_set(years,'$."'||CASE WHEN COALESCE(OLD.departed_date,'')='' THEN 'none' ELSE substr(OLD.departed_date,1,4) END||'"',COALESCE(json_extract(years,'$."'||CASE WHEN COALESCE(OLD.departed_date,'')='' THEN 'none' ELSE substr(OLD.departed_date,1,4) END||'"'),0)+1) WHERE id=1; UPDATE v3_departure_versions SET years=json_set(years,'$."'||CASE WHEN COALESCE(NEW.departed_date,'')='' THEN 'none' ELSE substr(NEW.departed_date,1,4) END||'"',COALESCE(json_extract(years,'$."'||CASE WHEN COALESCE(NEW.departed_date,'')='' THEN 'none' ELSE substr(NEW.departed_date,1,4) END||'"'),0)+1) WHERE id=1 AND (CASE WHEN COALESCE(NEW.departed_date,'')='' THEN 'none' ELSE substr(NEW.departed_date,1,4) END)<>(CASE WHEN COALESCE(OLD.departed_date,'')='' THEN 'none' ELSE substr(OLD.departed_date,1,4) END); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_dog_departures_DELETE AFTER DELETE ON v3_dog_departures BEGIN UPDATE v3_departure_versions SET years=json_set(years,'$."'||CASE WHEN COALESCE(OLD.departed_date,'')='' THEN 'none' ELSE substr(OLD.departed_date,1,4) END||'"',COALESCE(json_extract(years,'$."'||CASE WHEN COALESCE(OLD.departed_date,'')='' THEN 'none' ELSE substr(OLD.departed_date,1,4) END||'"'),0)+1) WHERE id=1; END;
-- 狗的主清單、編號、休養、出入所紀錄改了，讓這隻狗出所那幾年加 1：改看新表。改內容要先 DROP 再建
DROP TRIGGER IF EXISTS packs_v3_sheet_main_INSERT;
DROP TRIGGER IF EXISTS packs_v3_sheet_main_UPDATE;
DROP TRIGGER IF EXISTS packs_v3_sheet_main_DELETE;
DROP TRIGGER IF EXISTS packs_v3_dog_numbers_INSERT;
DROP TRIGGER IF EXISTS packs_v3_dog_numbers_UPDATE;
DROP TRIGGER IF EXISTS packs_v3_dog_numbers_DELETE;
DROP TRIGGER IF EXISTS packs_v3_rest_INSERT;
DROP TRIGGER IF EXISTS packs_v3_rest_UPDATE;
DROP TRIGGER IF EXISTS packs_v3_rest_DELETE;
DROP TRIGGER IF EXISTS packs_v3_stays_INSERT;
DROP TRIGGER IF EXISTS packs_v3_stays_UPDATE;
DROP TRIGGER IF EXISTS packs_v3_stays_DELETE;
CREATE TRIGGER IF NOT EXISTS packs_v3_sheet_main_INSERT AFTER INSERT ON v3_sheet_main BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1; UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id=NEW.dog_id))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id=NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_sheet_main_UPDATE AFTER UPDATE OF row_index,dog_id,number,name,cage,note,walked_date,walker_codes ON v3_sheet_main BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1; UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)))) FROM json_each(years) j) WHERE id=1 AND (OLD.row_index<>NEW.row_index OR OLD.dog_id<>NEW.dog_id OR OLD.number<>NEW.number) AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_sheet_main_DELETE AFTER DELETE ON v3_sheet_main BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1; UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id=OLD.dog_id))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id=OLD.dog_id); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_dog_numbers_INSERT AFTER INSERT ON v3_dog_numbers BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=NEW.dog_id); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id=NEW.dog_id))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id=NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_dog_numbers_UPDATE AFTER UPDATE ON v3_dog_numbers BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id IN (OLD.dog_id,NEW.dog_id)); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_dog_numbers_DELETE AFTER DELETE ON v3_dog_numbers BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=OLD.dog_id); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id=OLD.dog_id))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id=OLD.dog_id); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_rest_INSERT AFTER INSERT ON v3_rest BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=NEW.dog_id); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id=NEW.dog_id))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id=NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_rest_UPDATE AFTER UPDATE ON v3_rest BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id IN (OLD.dog_id,NEW.dog_id)); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_rest_DELETE AFTER DELETE ON v3_rest BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=OLD.dog_id); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id=OLD.dog_id))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id=OLD.dog_id); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_stays_INSERT AFTER INSERT ON v3_stays BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=NEW.dog_id); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id=NEW.dog_id))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id=NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_stays_UPDATE AFTER UPDATE ON v3_stays BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id IN (OLD.dog_id,NEW.dog_id)); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_stays_DELETE AFTER DELETE ON v3_stays BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=OLD.dog_id); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id=OLD.dog_id))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id=OLD.dog_id); END;
-- 搬資料：有編號的離所（附屬清單組成 JSON 陣列，照原本的 position 排）。新表已有同一筆就跳過（重跑不重複）
INSERT INTO v3_dog_departures(dog_id,number,name,departed_date,date_source,seen_date,reason,matched,flags_json,returned_number,last_number,last_name,last_cage,last_walked_date,last_note,last_sex,last_intro,former_json,groups_json)
SELECT d.dog_id,d.number,d.name,d.departed_date,d.date_source,d.seen_date,d.reason,d.matched,(SELECT json_group_array(value) FROM (SELECT value FROM v3_departure_items i WHERE i.number=d.number AND i.kind='flag' ORDER BY i.position)),d.returned_number,d.last_number,d.last_name,d.last_cage,d.last_walked_date,d.last_note,d.last_sex,d.last_intro,(SELECT json_group_array(value) FROM (SELECT value FROM v3_departure_items i WHERE i.number=d.number AND i.kind='former' ORDER BY i.position)),(SELECT json_group_array(value) FROM (SELECT value FROM v3_departure_items i WHERE i.number=d.number AND i.kind='group' ORDER BY i.position))
FROM v3_departures d WHERE NOT EXISTS(SELECT 1 FROM v3_dog_departures n WHERE n.dog_id=d.dog_id AND n.number=d.number);
-- 只有名字的已出所狗卡：編號留空，狗名照 v3_dogs，seen_date 記建卡那天
INSERT INTO v3_dog_departures(dog_id,number,name,departed_date,seen_date,reason)
SELECT c.dog_id,'',g.name,c.departed_date,substr(c.created_at,1,10),c.reason
FROM v3_departed_cards c JOIN v3_dogs g USING(dog_id) WHERE NOT EXISTS(SELECT 1 FROM v3_dog_departures n WHERE n.dog_id=c.dog_id AND n.number='');
