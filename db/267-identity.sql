-- #267：舊代號資料保留作為待對照來源，新個人資料只由固定志工持有。
CREATE TABLE IF NOT EXISTS v3_identity_names (
 code TEXT PRIMARY KEY NOT NULL,
 name_key TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 volunteer_id TEXT NOT NULL REFERENCES v3_volunteers(volunteer_id)
);
CREATE TABLE IF NOT EXISTS v3_identity_redirects (
 volunteer_id TEXT PRIMARY KEY NOT NULL REFERENCES v3_volunteers(volunteer_id),
 target_id TEXT NOT NULL REFERENCES v3_volunteers(volunteer_id),
 CHECK(volunteer_id <> target_id)
);
CREATE TABLE IF NOT EXISTS v3_volunteer_favorites (
 volunteer_id TEXT NOT NULL REFERENCES v3_volunteers(volunteer_id),
 dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id),
 added_on TEXT NOT NULL,
 PRIMARY KEY(volunteer_id,dog_id)
);
CREATE TABLE IF NOT EXISTS v3_volunteer_cards (
 volunteer_id TEXT NOT NULL REFERENCES v3_volunteers(volunteer_id),
 dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id),
 opened_on TEXT NOT NULL,
 PRIMARY KEY(volunteer_id,dog_id)
);
CREATE TABLE IF NOT EXISTS v3_identity_operations (
 operation_id TEXT PRIMARY KEY NOT NULL,
 request_json TEXT NOT NULL,
 identity_id TEXT NOT NULL REFERENCES v3_volunteers(volunteer_id)
);
-- 在 batch 內檢查前置條件；失敗時連同編輯紀錄回復。
CREATE TABLE IF NOT EXISTS v3_identity_guard (valid INTEGER NOT NULL CHECK(valid=1));
CREATE TABLE IF NOT EXISTS v3_identity_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
INSERT OR IGNORE INTO v3_identity_revision VALUES(1,0);
CREATE TRIGGER IF NOT EXISTS identity_v3_identity_names_INSERT AFTER INSERT ON v3_identity_names BEGIN UPDATE v3_identity_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS identity_v3_identity_names_UPDATE AFTER UPDATE ON v3_identity_names BEGIN UPDATE v3_identity_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS identity_v3_identity_names_DELETE AFTER DELETE ON v3_identity_names BEGIN UPDATE v3_identity_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS identity_v3_identity_redirects_INSERT AFTER INSERT ON v3_identity_redirects BEGIN UPDATE v3_identity_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS identity_v3_identity_redirects_UPDATE AFTER UPDATE ON v3_identity_redirects BEGIN UPDATE v3_identity_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS identity_v3_identity_redirects_DELETE AFTER DELETE ON v3_identity_redirects BEGIN UPDATE v3_identity_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS identity_v3_volunteers_INSERT AFTER INSERT ON v3_volunteers BEGIN UPDATE v3_identity_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS identity_v3_volunteers_UPDATE AFTER UPDATE ON v3_volunteers BEGIN UPDATE v3_identity_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS identity_v3_volunteers_DELETE AFTER DELETE ON v3_volunteers BEGIN UPDATE v3_identity_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS identity_v3_volunteer_favorites_INSERT AFTER INSERT ON v3_volunteer_favorites BEGIN UPDATE v3_identity_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS identity_v3_volunteer_favorites_UPDATE AFTER UPDATE ON v3_volunteer_favorites BEGIN UPDATE v3_identity_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS identity_v3_volunteer_favorites_DELETE AFTER DELETE ON v3_volunteer_favorites BEGIN UPDATE v3_identity_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS identity_v3_volunteer_cards_INSERT AFTER INSERT ON v3_volunteer_cards BEGIN UPDATE v3_identity_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS identity_v3_volunteer_cards_UPDATE AFTER UPDATE ON v3_volunteer_cards BEGIN UPDATE v3_identity_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS identity_v3_volunteer_cards_DELETE AFTER DELETE ON v3_volunteer_cards BEGIN UPDATE v3_identity_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS identity_v3_walks_INSERT AFTER INSERT ON v3_walks BEGIN UPDATE v3_identity_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS identity_v3_walks_UPDATE AFTER UPDATE ON v3_walks BEGIN UPDATE v3_identity_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS identity_v3_walks_DELETE AFTER DELETE ON v3_walks BEGIN UPDATE v3_identity_revision SET revision=revision+1 WHERE id=1; END;
