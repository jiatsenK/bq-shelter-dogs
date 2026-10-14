-- #217：歷史來源逐筆保存，未決來源不以有效紀錄冒充。
CREATE TABLE IF NOT EXISTS v2_history_sources (
  source_id TEXT PRIMARY KEY NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('walk','snapshot','departed_sheet','departure_json')),
  source_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('imported','pending','ignored')),
  reason TEXT NOT NULL,
  raw_json TEXT NOT NULL CHECK (json_valid(raw_json)),
  walk_id TEXT REFERENCES v2_daily_walks(walk_id) ON DELETE RESTRICT,
  admission_id TEXT REFERENCES v2_admissions(admission_id) ON DELETE RESTRICT,
  UNIQUE(source_kind,source_key)
);
