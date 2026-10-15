PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE IF NOT EXISTS "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'0001_business_model.sql','2026-10-14 07:54:31');
CREATE TABLE v2_dogs (
  dog_id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16))))
    CHECK (length(dog_id) = 32 AND dog_id NOT GLOB '*[^0-9a-f]*'),
  name TEXT NOT NULL,
  sex TEXT NOT NULL DEFAULT 'unknown' CHECK (sex IN ('male','female','unknown')),
  intro TEXT NOT NULL DEFAULT '',
  intro_original TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
CREATE TABLE v2_admissions (
  admission_id TEXT PRIMARY KEY NOT NULL,
  dog_id TEXT NOT NULL REFERENCES v2_dogs(dog_id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('in','departed','unknown')),
  intake_date TEXT CHECK (intake_date IS NULL OR (intake_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(intake_date,'+0 days') IS intake_date)),
  intake_date_source TEXT CHECK (intake_date_source IN ('number','manual')),
  intake_source TEXT,
  intake_reason TEXT,
  cage TEXT NOT NULL DEFAULT '',
  covered INTEGER NOT NULL DEFAULT 0 CHECK (covered IN (0,1)),
  sheet_note TEXT NOT NULL DEFAULT '',
  departed_date TEXT CHECK (departed_date IS NULL OR (departed_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(departed_date,'+0 days') IS departed_date)),
  departed_date_source TEXT CHECK (departed_date_source IN ('note','seen')),
  departed_reason TEXT CHECK (departed_reason IN ('adopt','death','other','pending')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  UNIQUE(admission_id,dog_id)
);
CREATE TABLE v2_admission_numbers (
  number TEXT PRIMARY KEY NOT NULL,
  admission_id TEXT NOT NULL REFERENCES v2_admissions(admission_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('current','corrected','legacy'))
);
CREATE TABLE v2_daily_walks (
  walk_id TEXT PRIMARY KEY NOT NULL,
  admission_id TEXT NOT NULL REFERENCES v2_admissions(admission_id) ON DELETE RESTRICT,
  walk_date TEXT NOT NULL CHECK (walk_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(walk_date,'+0 days') IS walk_date),
  state TEXT NOT NULL CHECK (state IN ('provisional','final','superseded','cancelled')),
  participant_quality TEXT NOT NULL CHECK (participant_quality IN ('known','unknown')),
  evidence TEXT NOT NULL CHECK (evidence IN ('sync','snapshot','legacy')),
  finalized_on TEXT CHECK (finalized_on IS NULL OR (finalized_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(finalized_on,'+0 days') IS finalized_on)),
  UNIQUE(admission_id,walk_date)
);
CREATE TABLE v2_dog_photos (
  photo_id TEXT PRIMARY KEY NOT NULL,
  dog_id TEXT NOT NULL REFERENCES v2_dogs(dog_id) ON DELETE RESTRICT,
  object_key TEXT NOT NULL,
  thumb_key TEXT,
  state TEXT NOT NULL CHECK (state IN ('active','replaced')),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1))
);
CREATE TABLE v2_walkers (
  walker_id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE v2_walker_codes (
  code TEXT PRIMARY KEY NOT NULL CHECK (length(code) = 12),
  walker_id TEXT NOT NULL REFERENCES v2_walkers(walker_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('primary','alias')),
  confirmed_at TEXT,
  CHECK ((kind = 'primary' AND confirmed_at IS NULL) OR (kind = 'alias' AND confirmed_at IS NOT NULL))
);
CREATE TABLE v2_walk_participants (
  walk_id TEXT NOT NULL REFERENCES v2_daily_walks(walk_id) ON DELETE RESTRICT,
  walker_id TEXT NOT NULL REFERENCES v2_walkers(walker_id) ON DELETE RESTRICT,
  PRIMARY KEY(walk_id,walker_id)
);
CREATE TABLE v2_card_opened (
  walker_id TEXT NOT NULL REFERENCES v2_walkers(walker_id) ON DELETE RESTRICT,
  dog_id TEXT NOT NULL REFERENCES v2_dogs(dog_id) ON DELETE RESTRICT,
  opened_on TEXT NOT NULL CHECK (opened_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(opened_on,'+0 days') IS opened_on),
  PRIMARY KEY(walker_id,dog_id)
);
CREATE TABLE v2_rest_settings (
  admission_id TEXT PRIMARY KEY NOT NULL REFERENCES v2_admissions(admission_id) ON DELETE RESTRICT,
  until_date TEXT NOT NULL CHECK (until_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(until_date,'+0 days') IS until_date),
  reason TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
CREATE TABLE v2_sync_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  observed_day TEXT NOT NULL CHECK (observed_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(observed_day,'+0 days') IS observed_day),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('ok','partial','failed')),
  counts_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(counts_json))
);
CREATE TABLE v2_source_bindings (
  binding_id TEXT PRIMARY KEY NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('numbered_row','named_row','temp_row','departed_row')),
  source_key TEXT NOT NULL,
  admission_id TEXT REFERENCES v2_admissions(admission_id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('confirmed','candidate','rejected')),
  evidence TEXT NOT NULL DEFAULT '',
  last_seen_run_id TEXT REFERENCES v2_sync_runs(run_id) ON DELETE RESTRICT,
  CHECK (state <> 'confirmed' OR admission_id IS NOT NULL)
);
CREATE TABLE v2_sheet_observations (
  run_id TEXT NOT NULL REFERENCES v2_sync_runs(run_id) ON DELETE RESTRICT,
  binding_id TEXT NOT NULL REFERENCES v2_source_bindings(binding_id) ON DELETE RESTRICT,
  raw_date_text TEXT NOT NULL,
  parsed_date TEXT CHECK (parsed_date IS NULL OR (parsed_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(parsed_date,'+0 days') IS parsed_date)),
  date_result TEXT NOT NULL CHECK (date_result IN ('ok','future','invalid')),
  walker_codes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(walker_codes_json) AND json_type(walker_codes_json) = 'array'),
  raw_name TEXT NOT NULL DEFAULT '',
  raw_cage TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(run_id,binding_id)
);
CREATE TABLE v2_walk_groups (
  group_id TEXT PRIMARY KEY NOT NULL,
  source_group_key TEXT NOT NULL,
  state TEXT NOT NULL
);
CREATE TABLE v2_walk_group_members (
  group_id TEXT NOT NULL REFERENCES v2_walk_groups(group_id) ON DELETE RESTRICT,
  admission_id TEXT NOT NULL REFERENCES v2_admissions(admission_id) ON DELETE RESTRICT,
  PRIMARY KEY(group_id,admission_id)
);
CREATE TABLE v2_operations (
  operation_id TEXT PRIMARY KEY NOT NULL,
  request_hash TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('walk','edit','undo','intro','rest','photo')),
  actor_walker_id TEXT REFERENCES v2_walkers(walker_id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('prepared','dispatched','verified','failed','uncertain')),
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  desired_json TEXT NOT NULL CHECK (json_valid(desired_json)),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  created_at TEXT NOT NULL,
  verified_at TEXT
);
CREATE TABLE v2_changes (
  change_id INTEGER PRIMARY KEY,
  operation_id TEXT REFERENCES v2_operations(operation_id) ON DELETE RESTRICT,
  sync_run_id TEXT REFERENCES v2_sync_runs(run_id) ON DELETE RESTRICT,
  dog_id TEXT NOT NULL REFERENCES v2_dogs(dog_id) ON DELETE RESTRICT,
  admission_id TEXT,
  field TEXT NOT NULL,
  old_json TEXT CHECK (old_json IS NULL OR json_valid(old_json)),
  new_json TEXT CHECK (new_json IS NULL OR json_valid(new_json)),
  observed_at TEXT NOT NULL,
  FOREIGN KEY(admission_id,dog_id) REFERENCES v2_admissions(admission_id,dog_id) ON DELETE RESTRICT,
  CHECK ((operation_id IS NULL) <> (sync_run_id IS NULL))
);
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('d1_migrations',1);
CREATE UNIQUE INDEX v2_one_in_admission ON v2_admissions(dog_id) WHERE status = 'in';
CREATE UNIQUE INDEX v2_one_current_number ON v2_admission_numbers(admission_id) WHERE kind = 'current';
CREATE UNIQUE INDEX v2_one_active_primary_photo ON v2_dog_photos(dog_id) WHERE is_primary = 1 AND state = 'active';
CREATE UNIQUE INDEX v2_one_primary_code ON v2_walker_codes(walker_id) WHERE kind = 'primary';
