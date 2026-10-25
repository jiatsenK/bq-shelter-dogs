-- #566: per-dog CAS shared by GAS, volunteer and management writes.
CREATE TABLE IF NOT EXISTS v3_dog_edit_state (
 dog_id TEXT PRIMARY KEY REFERENCES v3_dogs(dog_id),
 revision INTEGER NOT NULL DEFAULT 1,
 token TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO v3_dog_edit_state(dog_id) SELECT dog_id FROM v3_dogs;
CREATE TABLE IF NOT EXISTS v3_dog_edit_actors (
 request_id TEXT PRIMARY KEY,
 log_id INTEGER NOT NULL UNIQUE REFERENCES v3_edit_log(id),
 actor_subject TEXT NOT NULL,
 actor_email TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('access','volunteer'))
);
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_dogs_INSERT AFTER INSERT ON v3_dogs BEGIN INSERT OR IGNORE INTO v3_dog_edit_state(dog_id) VALUES(NEW.dog_id); UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_dogs_UPDATE AFTER UPDATE ON v3_dogs BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id,NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_dogs_DELETE AFTER DELETE ON v3_dogs BEGIN DELETE FROM v3_dog_edit_state WHERE dog_id=OLD.dog_id; END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_sheet_main_INSERT AFTER INSERT ON v3_sheet_main BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_sheet_main_UPDATE AFTER UPDATE OF dog_id,number,name,cage,note,sex ON v3_sheet_main BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id,NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_sheet_main_DELETE AFTER DELETE ON v3_sheet_main BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_dog_numbers_INSERT AFTER INSERT ON v3_dog_numbers BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_dog_numbers_UPDATE AFTER UPDATE ON v3_dog_numbers BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id,NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_dog_numbers_DELETE AFTER DELETE ON v3_dog_numbers BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_intros_INSERT AFTER INSERT ON v3_intros BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_intros_UPDATE AFTER UPDATE ON v3_intros BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id,NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_intros_DELETE AFTER DELETE ON v3_intros BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_rest_INSERT AFTER INSERT ON v3_rest BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_rest_UPDATE AFTER UPDATE ON v3_rest BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id,NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_rest_DELETE AFTER DELETE ON v3_rest BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_stays_INSERT AFTER INSERT ON v3_stays BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_stays_UPDATE AFTER UPDATE ON v3_stays BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id,NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_stays_DELETE AFTER DELETE ON v3_stays BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_photos_INSERT AFTER INSERT ON v3_photos BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_photos_UPDATE AFTER UPDATE ON v3_photos BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id,NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_photos_DELETE AFTER DELETE ON v3_photos BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_departures_INSERT AFTER INSERT ON v3_departures BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_departures_UPDATE AFTER UPDATE ON v3_departures BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id,NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_departures_DELETE AFTER DELETE ON v3_departures BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id); END;
DROP TRIGGER IF EXISTS packs_v3_dogs_UPDATE;
CREATE TRIGGER IF NOT EXISTS packs_v3_dogs_UPDATE AFTER UPDATE OF fixed_care,sex ON v3_dogs WHEN OLD.fixed_care<>NEW.fixed_care OR OLD.sex<>NEW.sex BEGIN
 UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=NEW.dog_id);
 UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key,j.value+(j.key IN (SELECT CASE WHEN COALESCE(departed_date,'')='' THEN 'none' ELSE substr(departed_date,1,4) END FROM v3_departures WHERE dog_id=NEW.dog_id))) FROM json_each(years) j) WHERE id=1 AND OLD.sex<>NEW.sex AND EXISTS(SELECT 1 FROM v3_departures WHERE dog_id=NEW.dog_id);
END;

CREATE TRIGGER IF NOT EXISTS packs_v3_dog_edit_state_INSERT AFTER INSERT ON v3_dog_edit_state BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_dog_edit_state_UPDATE AFTER UPDATE OF token ON v3_dog_edit_state WHEN OLD.token<>NEW.token BEGIN
 UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=NEW.dog_id);
 UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key,j.value+(j.key IN (SELECT CASE WHEN COALESCE(departed_date,'')='' THEN 'none' ELSE substr(departed_date,1,4) END FROM v3_departures WHERE dog_id=NEW.dog_id))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_departures WHERE dog_id=NEW.dog_id);
END;
CREATE TRIGGER IF NOT EXISTS packs_v3_dog_edit_state_DELETE AFTER DELETE ON v3_dog_edit_state BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=OLD.dog_id); END;

-- Existing cached payloads predate CAS and current-sex fields. Invalidate once.
UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND (EXISTS(SELECT 1 FROM v3_dogs) OR EXISTS(SELECT 1 FROM v3_packs));
UPDATE v3_departure_versions SET years=(SELECT json_group_object(key,value+1) FROM json_each(years)) WHERE id=1;

CREATE TABLE IF NOT EXISTS v3_dog_edit_guard (id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1));

CREATE TRIGGER IF NOT EXISTS packs_v3_photos_INSERT AFTER INSERT ON v3_photos BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=NEW.dog_id); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_departures d WHERE d.dog_id=NEW.dog_id))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_departures d WHERE d.dog_id=NEW.dog_id); END;

CREATE TRIGGER IF NOT EXISTS packs_v3_photos_UPDATE AFTER UPDATE ON v3_photos BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id IN (OLD.dog_id,NEW.dog_id)); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)); END;

CREATE TRIGGER IF NOT EXISTS packs_v3_photos_DELETE AFTER DELETE ON v3_photos BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=OLD.dog_id); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_departures d WHERE d.dog_id=OLD.dog_id))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_departures d WHERE d.dog_id=OLD.dog_id); END;
