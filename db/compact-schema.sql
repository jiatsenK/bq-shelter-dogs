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
  intro TEXT NOT NULL DEFAULT '',
  fields INTEGER NOT NULL DEFAULT 0
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

-- 每個名字直接存在溜狗紀錄；無人名的舊紀錄仍能保留。
CREATE TABLE IF NOT EXISTS v3_walks (
  dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  walk_date TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '',
  walker_name TEXT,
  walker_code TEXT,
  PRIMARY KEY(dog_id,walk_date,position)
);
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
