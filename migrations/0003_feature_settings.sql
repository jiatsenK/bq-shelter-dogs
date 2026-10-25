-- #565：單列設定；同一 UPDATE 觸發可靠前後紀錄，失敗一併回復。
CREATE TABLE IF NOT EXISTS v3_feature_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 revision INTEGER NOT NULL CHECK(revision>=1),
 values_json TEXT NOT NULL CHECK(json_valid(values_json)),
 actor_subject TEXT NOT NULL DEFAULT '',
 actor_email TEXT NOT NULL DEFAULT '',
 changed_at TEXT NOT NULL DEFAULT '',
 request_id TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO v3_feature_settings(id,revision,values_json) VALUES(1,1,'{"showActivities":true,"showQuality":true,"showUpdates":true,"editIntro":true,"editPhoto":true,"editRest":true,"editActivity":true,"editFixedCare":true,"editStays":true,"editFormer":true}');
CREATE TABLE IF NOT EXISTS v3_feature_settings_log (
 revision INTEGER PRIMARY KEY,
 before_json TEXT NOT NULL,
 after_json TEXT NOT NULL,
 actor_subject TEXT NOT NULL,
 actor_email TEXT NOT NULL,
 changed_at TEXT NOT NULL,
 request_id TEXT NOT NULL UNIQUE
);
CREATE TRIGGER IF NOT EXISTS feature_settings_audit AFTER UPDATE ON v3_feature_settings BEGIN
 INSERT INTO v3_feature_settings_log(revision,before_json,after_json,actor_subject,actor_email,changed_at,request_id)
 VALUES(NEW.revision,OLD.values_json,NEW.values_json,NEW.actor_subject,NEW.actor_email,NEW.changed_at,NEW.request_id);
END;
