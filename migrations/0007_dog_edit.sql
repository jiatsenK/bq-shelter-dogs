-- #566 repurposes v3_photos as a transactional version pointer after 0004 removed the old unused inventory.
CREATE TABLE IF NOT EXISTS v3_photos (
 object_key TEXT PRIMARY KEY NOT NULL,
 dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
 thumb_key TEXT,
 is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
 uploaded_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS v3_primary_photo ON v3_photos(dog_id) WHERE is_primary=1;
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
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_dogs_UPDATE AFTER UPDATE ON v3_dogs WHEN OLD.dog_id IS NOT NEW.dog_id OR OLD.name IS NOT NEW.name OR OLD.sex IS NOT NEW.sex OR OLD.fixed_care IS NOT NEW.fixed_care BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id,NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_dogs_DELETE AFTER DELETE ON v3_dogs BEGIN DELETE FROM v3_dog_edit_state WHERE dog_id=OLD.dog_id; END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_sheet_main_INSERT AFTER INSERT ON v3_sheet_main BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_sheet_main_UPDATE AFTER UPDATE OF row_index,dog_id,number,name,cage,note ON v3_sheet_main WHEN OLD.row_index IS NOT NEW.row_index OR OLD.dog_id IS NOT NEW.dog_id OR OLD.number IS NOT NEW.number OR OLD.name IS NOT NEW.name OR OLD.cage IS NOT NEW.cage OR OLD.note IS NOT NEW.note BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id,NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_sheet_main_DELETE AFTER DELETE ON v3_sheet_main BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_dog_numbers_INSERT AFTER INSERT ON v3_dog_numbers BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_dog_numbers_UPDATE AFTER UPDATE ON v3_dog_numbers WHEN OLD.number IS NOT NEW.number OR OLD.dog_id IS NOT NEW.dog_id BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id,NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_dog_numbers_DELETE AFTER DELETE ON v3_dog_numbers BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_intros_INSERT AFTER INSERT ON v3_intros BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_intros_UPDATE AFTER UPDATE ON v3_intros WHEN OLD.dog_id IS NOT NEW.dog_id OR OLD.intro IS NOT NEW.intro BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id,NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_intros_DELETE AFTER DELETE ON v3_intros BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_rest_INSERT AFTER INSERT ON v3_rest BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_rest_UPDATE AFTER UPDATE ON v3_rest WHEN OLD.dog_id IS NOT NEW.dog_id OR OLD.until_date IS NOT NEW.until_date OR OLD.reason IS NOT NEW.reason BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id,NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_rest_DELETE AFTER DELETE ON v3_rest BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_stays_INSERT AFTER INSERT ON v3_stays BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_stays_UPDATE AFTER UPDATE ON v3_stays WHEN OLD.dog_id IS NOT NEW.dog_id OR OLD.stays_json IS NOT NEW.stays_json BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id,NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_stays_DELETE AFTER DELETE ON v3_stays BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_photos_INSERT AFTER INSERT ON v3_photos BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_photos_UPDATE AFTER UPDATE ON v3_photos WHEN OLD.object_key IS NOT NEW.object_key OR OLD.dog_id IS NOT NEW.dog_id OR OLD.thumb_key IS NOT NEW.thumb_key OR OLD.is_primary IS NOT NEW.is_primary OR OLD.uploaded_at IS NOT NEW.uploaded_at BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id,NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_photos_DELETE AFTER DELETE ON v3_photos BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_dog_departures_INSERT AFTER INSERT ON v3_dog_departures BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_dog_departures_UPDATE AFTER UPDATE ON v3_dog_departures WHEN OLD.dog_id IS NOT NEW.dog_id OR OLD.number IS NOT NEW.number OR OLD.name IS NOT NEW.name OR OLD.departed_date IS NOT NEW.departed_date OR OLD.date_source IS NOT NEW.date_source OR OLD.seen_date IS NOT NEW.seen_date OR OLD.reason IS NOT NEW.reason OR OLD.matched IS NOT NEW.matched OR OLD.flags_json IS NOT NEW.flags_json OR OLD.returned_number IS NOT NEW.returned_number OR OLD.last_number IS NOT NEW.last_number OR OLD.last_name IS NOT NEW.last_name OR OLD.last_cage IS NOT NEW.last_cage OR OLD.last_walked_date IS NOT NEW.last_walked_date OR OLD.last_note IS NOT NEW.last_note OR OLD.last_sex IS NOT NEW.last_sex OR OLD.last_intro IS NOT NEW.last_intro OR OLD.former_json IS NOT NEW.former_json OR OLD.groups_json IS NOT NEW.groups_json BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id,NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS dog_edit_v3_dog_departures_DELETE AFTER DELETE ON v3_dog_departures BEGIN UPDATE v3_dog_edit_state SET revision=revision+1 WHERE dog_id IN (OLD.dog_id); END;
DROP TRIGGER IF EXISTS packs_v3_dogs_UPDATE;
CREATE TRIGGER IF NOT EXISTS packs_v3_dogs_UPDATE AFTER UPDATE OF fixed_care,sex ON v3_dogs WHEN OLD.fixed_care<>NEW.fixed_care OR OLD.sex<>NEW.sex BEGIN
 UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=NEW.dog_id);
 UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key,j.value+(j.key IN (SELECT CASE WHEN COALESCE(departed_date,'')='' THEN 'none' ELSE substr(departed_date,1,4) END FROM v3_dog_departures WHERE dog_id=NEW.dog_id))) FROM json_each(years) j) WHERE id=1 AND OLD.sex<>NEW.sex AND EXISTS(SELECT 1 FROM v3_dog_departures WHERE dog_id=NEW.dog_id);
END;

CREATE TRIGGER IF NOT EXISTS packs_v3_dog_edit_state_INSERT AFTER INSERT ON v3_dog_edit_state BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_dog_edit_state_UPDATE AFTER UPDATE OF revision,token ON v3_dog_edit_state WHEN OLD.revision<>NEW.revision OR OLD.token<>NEW.token BEGIN
 UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=NEW.dog_id);
 UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key,j.value+(j.key IN (SELECT CASE WHEN COALESCE(departed_date,'')='' THEN 'none' ELSE substr(departed_date,1,4) END FROM v3_dog_departures WHERE dog_id=NEW.dog_id))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures WHERE dog_id=NEW.dog_id);
END;
CREATE TRIGGER IF NOT EXISTS packs_v3_dog_edit_state_DELETE AFTER DELETE ON v3_dog_edit_state BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=OLD.dog_id); END;

-- Existing cached payloads predate CAS and current-sex fields. Invalidate once.
UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND (EXISTS(SELECT 1 FROM v3_dogs) OR EXISTS(SELECT 1 FROM v3_packs));
UPDATE v3_departure_versions SET years=(SELECT json_group_object(key,value+1) FROM json_each(years)) WHERE id=1;

CREATE TABLE IF NOT EXISTS v3_dog_edit_guard (id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1));

CREATE TRIGGER IF NOT EXISTS packs_v3_photos_INSERT AFTER INSERT ON v3_photos BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=NEW.dog_id); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id=NEW.dog_id))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id=NEW.dog_id); END;

CREATE TRIGGER IF NOT EXISTS packs_v3_photos_UPDATE AFTER UPDATE ON v3_photos BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id IN (OLD.dog_id,NEW.dog_id)); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)); END;

CREATE TRIGGER IF NOT EXISTS packs_v3_photos_DELETE AFTER DELETE ON v3_photos BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=OLD.dog_id); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id=OLD.dog_id))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id=OLD.dog_id); END;

