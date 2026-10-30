-- #772（ADR 0025）：暫住列不再建成狗，存成暫住紀錄 v3_sheet_stays；資料包觸發器只看送進在所資料包的欄（UPDATE OF）。
CREATE TABLE IF NOT EXISTS v3_sheet_stays (
  name TEXT PRIMARY KEY NOT NULL,
  dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  cage TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  missing_at TEXT
);
CREATE INDEX IF NOT EXISTS v3_sheet_stays_dog ON v3_sheet_stays(dog_id);
CREATE TRIGGER IF NOT EXISTS packs_v3_sheet_stays_INSERT AFTER INSERT ON v3_sheet_stays BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS packs_v3_sheet_stays_UPDATE AFTER UPDATE OF name,cage,note ON v3_sheet_stays BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS packs_v3_sheet_stays_DELETE AFTER DELETE ON v3_sheet_stays BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1; END;

-- 上線轉換：符合暫住判斷的沒編號狗（10/30 有新A08 的「(皮蛋）」，半形左括號配全形右括號）。
-- 暫住判斷同 worker/src/dog-list.js 的 stayTarget：沒編號、犬名整個用括號包起來（半形全形混用），括號裡去掉空白後跟主清單上一隻有編號的狗同名。
-- 1. 還在主清單複本上的暫住列轉成暫住紀錄（消失的候選時間照搬，表上已刪的照候選規則確認後暫住結束），再移出主清單複本
INSERT INTO v3_sheet_stays(name,dog_id,cage,note,missing_at)
SELECT name,stay_dog,cage,note,missing_at FROM (
  SELECT m.name,m.cage,m.note,m.missing_at,(SELECT r.dog_id FROM v3_sheet_main r WHERE r.number<>''
    AND replace(replace(r.name,' ',''),'　','')=replace(replace(substr(m.name,2,length(m.name)-2),' ',''),'　','') ORDER BY r.row_index LIMIT 1) AS stay_dog
  FROM v3_sheet_main m
  WHERE m.number='' AND length(m.name)>2 AND substr(m.name,1,1) IN ('(','（') AND substr(m.name,-1) IN (')','）')
) WHERE stay_dog IS NOT NULL;
DELETE FROM v3_sheet_main WHERE number='' AND name IN (SELECT name FROM v3_sheet_stays);
-- 2. 那隻假狗：沒有其他資料掛在牠身上（不在主清單、沒編號、沒有溜狗紀錄、照片、介紹等）才刪掉；修改紀錄沒有外鍵，留著。
--    有資料的留著，管理網站顯示待核對，照現有規則合併
DELETE FROM v3_dogs WHERE dog_id IN (
  SELECT d.dog_id FROM v3_dogs d
  WHERE length(d.name)>2 AND substr(d.name,1,1) IN ('(','（') AND substr(d.name,-1) IN (')','）')
    AND EXISTS(SELECT 1 FROM v3_sheet_main r WHERE r.number<>''
      AND replace(replace(r.name,' ',''),'　','')=replace(replace(substr(d.name,2,length(d.name)-2),' ',''),'　',''))
    AND NOT EXISTS(SELECT 1 FROM v3_sheet_main x WHERE x.dog_id=d.dog_id)
    AND NOT EXISTS(SELECT 1 FROM v3_sheet_stays x WHERE x.dog_id=d.dog_id)
    AND NOT EXISTS(SELECT 1 FROM v3_dog_numbers x WHERE x.dog_id=d.dog_id)
    AND NOT EXISTS(SELECT 1 FROM v3_walks x WHERE x.dog_id=d.dog_id)
    AND NOT EXISTS(SELECT 1 FROM v3_walk_state x WHERE x.dog_id=d.dog_id)
    AND NOT EXISTS(SELECT 1 FROM v3_intros x WHERE x.dog_id=d.dog_id)
    AND NOT EXISTS(SELECT 1 FROM v3_rest x WHERE x.dog_id=d.dog_id)
    AND NOT EXISTS(SELECT 1 FROM v3_intake_events x WHERE x.dog_id=d.dog_id)
    AND NOT EXISTS(SELECT 1 FROM v3_stays x WHERE x.dog_id=d.dog_id)
    AND NOT EXISTS(SELECT 1 FROM v3_dog_departures x WHERE x.dog_id=d.dog_id)
    AND NOT EXISTS(SELECT 1 FROM v3_photos x WHERE x.dog_id=d.dog_id)
    AND NOT EXISTS(SELECT 1 FROM v3_activity_dogs x WHERE x.dog_id=d.dog_id)
    AND NOT EXISTS(SELECT 1 FROM v3_volunteer_favorites x WHERE x.dog_id=d.dog_id)
    AND NOT EXISTS(SELECT 1 FROM v3_volunteer_cards x WHERE x.dog_id=d.dog_id)
    AND NOT EXISTS(SELECT 1 FROM v3_card_opened x WHERE x.dog_id=d.dog_id)
);
