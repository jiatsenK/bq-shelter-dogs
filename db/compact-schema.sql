-- #245/#246：獨立精簡模型。只由明確的遷移入口執行，不由部署自動套用。
-- 試算表複本以來源列／欄排序保存；集合拆成列，不存 JSON。
CREATE TABLE IF NOT EXISTS v3_dogs (
  dog_id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  sex TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS v3_dog_numbers (
  number TEXT PRIMARY KEY NOT NULL CHECK(length(number)>0),
  dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS v3_numbers_dog ON v3_dog_numbers(dog_id);

CREATE TABLE IF NOT EXISTS v3_sheet_main (
  row_index INTEGER PRIMARY KEY,
  dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  number TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  cage TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  covered INTEGER NOT NULL DEFAULT 0 CHECK(covered IN (0,1)),
  walked_date TEXT,
  my_walked INTEGER NOT NULL DEFAULT 0 CHECK(my_walked IN (0,1)),
  my_walked_date TEXT,
  synced_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  sex TEXT NOT NULL DEFAULT '',
  intro TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS v3_sheet_main_walkers (
  row_index INTEGER NOT NULL REFERENCES v3_sheet_main(row_index) ON DELETE RESTRICT,
  position INTEGER NOT NULL,
  walker_code TEXT NOT NULL,
  PRIMARY KEY(row_index,position)
);
CREATE TABLE IF NOT EXISTS v3_sheet_former_numbers (
  row_index INTEGER NOT NULL REFERENCES v3_sheet_main(row_index) ON DELETE RESTRICT,
  position INTEGER NOT NULL,
  number TEXT NOT NULL REFERENCES v3_dog_numbers(number) ON DELETE RESTRICT,
  PRIMARY KEY(row_index,position)
);
CREATE TABLE IF NOT EXISTS v3_sheet_changes (
  row_index INTEGER PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS v3_sheet_departed (
  row_index INTEGER PRIMARY KEY,
  number TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  walked_date TEXT,
  departed_date TEXT,
  note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS v3_sheet_groups (
  column_index INTEGER NOT NULL,
  row_index INTEGER NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY(column_index,row_index)
);
-- 常遛狗群每一欄的群名（分頁最下面一列，K 2026-10-16）
CREATE TABLE IF NOT EXISTS v3_sheet_group_labels (
  column_index INTEGER PRIMARY KEY,
  label TEXT NOT NULL
);

-- 每個名字直接存在溜狗紀錄；無人名的舊紀錄仍能保留。
-- dog_number／dog_name 是那天的編號和狗名（#248），狗後來改名或換編號，「我溜過」仍顯示當時的。
CREATE TABLE IF NOT EXISTS v3_walks (
  dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  walk_date TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  walker_name TEXT,
  walker_code TEXT,
  dog_number TEXT NOT NULL DEFAULT '',
  dog_name TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(dog_id,walk_date,position)
);
-- last_seen 給名字推薦排序（沿用舊 walker_names）。
CREATE TABLE IF NOT EXISTS v3_volunteers (
  volunteer_id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL UNIQUE,
  last_seen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v3_volunteer_codes (
  code TEXT PRIMARY KEY NOT NULL,
  volunteer_id TEXT NOT NULL REFERENCES v3_volunteers(volunteer_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS v3_card_opened (
  walker_code TEXT NOT NULL,
  dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  opened_on TEXT NOT NULL,
  PRIMARY KEY(walker_code,dog_id)
);
CREATE TABLE IF NOT EXISTS v3_favorites (
  walker_code TEXT NOT NULL,
  dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  added_on TEXT NOT NULL,
  PRIMARY KEY(walker_code,dog_id)
);
CREATE TABLE IF NOT EXISTS v3_rest (
  dog_id TEXT PRIMARY KEY NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  until_date TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS v3_photos (
  object_key TEXT PRIMARY KEY NOT NULL,
  dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  thumb_key TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
  uploaded_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS v3_primary_photo ON v3_photos(dog_id) WHERE is_primary=1;
CREATE TABLE IF NOT EXISTS v3_intros (
  dog_id TEXT PRIMARY KEY NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  intro TEXT NOT NULL
);

-- #285：一次入所／退回／轉所一列，保留未確認的日期與事件空白。
-- 原介紹仍留在 v3_intros，不自動解析或以編號日期覆寫。
CREATE TABLE IF NOT EXISTS v3_intake_events (
  dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  position INTEGER NOT NULL,
  number TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL DEFAULT '',
  event TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(dog_id,position)
);


-- 離所紀錄（#259，原本的 data/departures.json）：同步發現狗從主清單消失就記一筆，原因只讀「已出所」分頁判讀。
-- last_* 是離開主清單前最後一次的樣子（離所名冊的詳細資訊用）；last_number 是 NULL 表示沒有這份資料。
-- 判讀旗標、最後的舊編號、最後的常遛狗群拆成 v3_departure_items 的列。
CREATE TABLE IF NOT EXISTS v3_departures (
  number TEXT PRIMARY KEY NOT NULL CHECK(length(number)>0),
  dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  departed_date TEXT,
  date_source TEXT,
  seen_date TEXT,
  reason TEXT NOT NULL DEFAULT 'unknown',
  matched TEXT NOT NULL DEFAULT '',
  returned_number TEXT,
  last_number TEXT,
  last_name TEXT,
  last_cage TEXT,
  last_walked_date TEXT,
  last_note TEXT,
  last_sex TEXT,
  last_intro TEXT
);
CREATE TABLE IF NOT EXISTS v3_departure_items (
  number TEXT NOT NULL REFERENCES v3_departures(number) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('flag','former','group')),
  position INTEGER NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY(number,kind,position)
);

-- 編輯紀錄（docs/adr/0004-open-editing-and-edit-log.md）：網站上的編輯誰改了什麼；只增不刪。
-- before_json／after_json 是 JSON 文字（null 表示沒有）
CREATE TABLE IF NOT EXISTS v3_edit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  editor_code TEXT NOT NULL DEFAULT '',
  editor_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  dog_id TEXT,
  dog_number TEXT NOT NULL DEFAULT '',
  before_json TEXT,
  after_json TEXT
);
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

-- 今日溜狗紀錄（ADR 0007）：網站按溜了／復原寫試算表成功後，Worker 記下那隻狗在試算表的「遛狗日期」「誰遛的」現在是什麼，
-- 其他手機不用等同步就看得到。walked=0 是按了復原（狗不能再算今天溜過）。只認台灣時間今天；以前的下次寫入時清掉。
-- dog_key 跟網站 walkKey 一樣（有編號用編號，沒有用「名:犬名」）。試算表是正本，網站只採用比上次同步新的紀錄。
CREATE TABLE IF NOT EXISTS v3_today_walks (
  walk_date TEXT NOT NULL,
  dog_key TEXT NOT NULL,
  walked INTEGER NOT NULL CHECK(walked IN (0,1)),
  walked_date TEXT NOT NULL DEFAULT '',
  walker TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY(walk_date,dog_key)
);
