-- #556（#548 觸發器方案甲）：刪 18 個 identity_*、收窄 9 個觸發條件。只換觸發器，不動資料。
-- identity_* 正式庫本來就沒有（只在測試庫）；版本號改由 worker/src/identity.js 的更名、合併、linkIdentityName 自己加 1。
DROP TRIGGER IF EXISTS identity_v3_identity_names_INSERT;
DROP TRIGGER IF EXISTS identity_v3_identity_names_UPDATE;
DROP TRIGGER IF EXISTS identity_v3_identity_names_DELETE;
DROP TRIGGER IF EXISTS identity_v3_identity_redirects_INSERT;
DROP TRIGGER IF EXISTS identity_v3_identity_redirects_UPDATE;
DROP TRIGGER IF EXISTS identity_v3_identity_redirects_DELETE;
DROP TRIGGER IF EXISTS identity_v3_volunteers_INSERT;
DROP TRIGGER IF EXISTS identity_v3_volunteers_UPDATE;
DROP TRIGGER IF EXISTS identity_v3_volunteers_DELETE;
DROP TRIGGER IF EXISTS identity_v3_volunteer_favorites_INSERT;
DROP TRIGGER IF EXISTS identity_v3_volunteer_favorites_UPDATE;
DROP TRIGGER IF EXISTS identity_v3_volunteer_favorites_DELETE;
DROP TRIGGER IF EXISTS identity_v3_volunteer_cards_INSERT;
DROP TRIGGER IF EXISTS identity_v3_volunteer_cards_UPDATE;
DROP TRIGGER IF EXISTS identity_v3_volunteer_cards_DELETE;
DROP TRIGGER IF EXISTS identity_v3_walks_INSERT;
DROP TRIGGER IF EXISTS identity_v3_walks_UPDATE;
DROP TRIGGER IF EXISTS identity_v3_walks_DELETE;
-- 收窄：只在網站讀到的欄位真的可能變時才加 1；OLD、NEW 落在同一隻狗／同一年／同一個月只加一次。改內容要先 DROP 再建
DROP TRIGGER IF EXISTS walk_pack_UPDATE;
DROP TRIGGER IF EXISTS walkpack_v3_walks_UPDATE;
DROP TRIGGER IF EXISTS packs_v3_sheet_main_UPDATE;
DROP TRIGGER IF EXISTS packs_v3_intros_UPDATE;
DROP TRIGGER IF EXISTS packs_v3_intake_events_UPDATE;
DROP TRIGGER IF EXISTS packs_v3_dog_numbers_UPDATE;
DROP TRIGGER IF EXISTS packs_v3_rest_UPDATE;
DROP TRIGGER IF EXISTS packs_v3_stays_UPDATE;
DROP TRIGGER IF EXISTS packs_v3_departures_UPDATE;
CREATE TRIGGER IF NOT EXISTS walk_pack_UPDATE AFTER UPDATE OF version,effective_date,walker,updated_at ON v3_walk_state BEGIN
  UPDATE v3_walk_pack SET version=version+1,payload=json_set(payload,'$.'||json_quote(NEW.dog_key),json_object('key',NEW.dog_key,'version',NEW.version,'walkedDate',NEW.effective_date,'walker',NEW.walker,'at',NEW.updated_at,'syncStatus',COALESCE((SELECT status FROM v3_walk_outbox WHERE dog_key=NEW.dog_key AND version=NEW.version),'pending'))) WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS walkpack_v3_walks_UPDATE AFTER UPDATE ON v3_walks BEGIN UPDATE v3_walk_versions SET total=total+(OLD.walk_date<cutoff), live=live+(OLD.walk_date>=cutoff), months=CASE WHEN OLD.walk_date<cutoff THEN json_set(months,'$."'||substr(OLD.walk_date,1,7)||'"',COALESCE(json_extract(months,'$."'||substr(OLD.walk_date,1,7)||'"'),0)+1) ELSE months END WHERE id=1; UPDATE v3_walk_versions SET total=total+(NEW.walk_date<cutoff), live=live+(NEW.walk_date>=cutoff), months=CASE WHEN NEW.walk_date<cutoff THEN json_set(months,'$."'||substr(NEW.walk_date,1,7)||'"',COALESCE(json_extract(months,'$."'||substr(NEW.walk_date,1,7)||'"'),0)+1) ELSE months END WHERE id=1 AND NOT ((OLD.walk_date<cutoff)=(NEW.walk_date<cutoff) AND (OLD.walk_date>=cutoff OR substr(OLD.walk_date,1,7)=substr(NEW.walk_date,1,7))); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_sheet_main_UPDATE AFTER UPDATE OF row_index,dog_id,number,name,cage,note,walked_date,my_walked,my_walked_date,sex,version ON v3_sheet_main BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1; UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)))) FROM json_each(years) j) WHERE id=1 AND (OLD.row_index<>NEW.row_index OR OLD.dog_id<>NEW.dog_id OR OLD.number<>NEW.number) AND EXISTS(SELECT 1 FROM v3_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_intros_UPDATE AFTER UPDATE ON v3_intros BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id IN (OLD.dog_id,NEW.dog_id)); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_intake_events_UPDATE AFTER UPDATE ON v3_intake_events BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id IN (OLD.dog_id,NEW.dog_id)); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_dog_numbers_UPDATE AFTER UPDATE ON v3_dog_numbers BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id IN (OLD.dog_id,NEW.dog_id)); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_rest_UPDATE AFTER UPDATE ON v3_rest BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id IN (OLD.dog_id,NEW.dog_id)); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_stays_UPDATE AFTER UPDATE ON v3_stays BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id IN (OLD.dog_id,NEW.dog_id)); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_departures_UPDATE AFTER UPDATE ON v3_departures BEGIN UPDATE v3_departure_versions SET years=json_set(years,'$."'||CASE WHEN COALESCE(OLD.departed_date,'')='' THEN 'none' ELSE substr(OLD.departed_date,1,4) END||'"',COALESCE(json_extract(years,'$."'||CASE WHEN COALESCE(OLD.departed_date,'')='' THEN 'none' ELSE substr(OLD.departed_date,1,4) END||'"'),0)+1) WHERE id=1; UPDATE v3_departure_versions SET years=json_set(years,'$."'||CASE WHEN COALESCE(NEW.departed_date,'')='' THEN 'none' ELSE substr(NEW.departed_date,1,4) END||'"',COALESCE(json_extract(years,'$."'||CASE WHEN COALESCE(NEW.departed_date,'')='' THEN 'none' ELSE substr(NEW.departed_date,1,4) END||'"'),0)+1) WHERE id=1 AND (CASE WHEN COALESCE(NEW.departed_date,'')='' THEN 'none' ELSE substr(NEW.departed_date,1,4) END)<>(CASE WHEN COALESCE(OLD.departed_date,'')='' THEN 'none' ELSE substr(OLD.departed_date,1,4) END); END;
