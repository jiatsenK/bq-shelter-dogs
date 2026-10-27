-- #679：溜狗日期、溜狗人從在所資料包（small）拆成溜狗日期包（part=walked），有自己的版本號 walked。
-- GAS 狗清單送「溜過了」只改 walked_date／walker_codes，之後只讓 walked 加 1，small 不再整份重算（ADR 0009、0014）。
-- 溜狗日期包照主清單順序存編號、狗名、溜狗日期、溜狗人，所以主清單加、刪狗或改列號、編號、狗名也讓 walked 加 1。
ALTER TABLE v3_pack_versions ADD COLUMN walked INTEGER NOT NULL DEFAULT 0;
DROP TRIGGER IF EXISTS packs_v3_sheet_main_UPDATE;
CREATE TRIGGER IF NOT EXISTS packs_v3_sheet_main_UPDATE AFTER UPDATE OF row_index,dog_id,number,name,cage,note ON v3_sheet_main BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1; UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)))) FROM json_each(years) j) WHERE id=1 AND (OLD.row_index<>NEW.row_index OR OLD.dog_id<>NEW.dog_id OR OLD.number<>NEW.number) AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)); END;
CREATE TRIGGER IF NOT EXISTS walked_v3_sheet_main_INSERT AFTER INSERT ON v3_sheet_main BEGIN UPDATE v3_pack_versions SET walked=walked+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS walked_v3_sheet_main_UPDATE AFTER UPDATE OF row_index,number,name,walked_date,walker_codes ON v3_sheet_main BEGIN UPDATE v3_pack_versions SET walked=walked+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS walked_v3_sheet_main_DELETE AFTER DELETE ON v3_sheet_main BEGIN UPDATE v3_pack_versions SET walked=walked+1 WHERE id=1; END;
