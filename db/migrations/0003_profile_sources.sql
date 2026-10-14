-- #218：附屬資料的來源核對，舊備註只記封存指紋，不恢復內容。
CREATE TABLE IF NOT EXISTS v2_profile_sources (
  source_id TEXT PRIMARY KEY NOT NULL,
  source_kind TEXT NOT NULL,
  source_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('imported','pending','archived')),
  reason TEXT NOT NULL,
  raw_json TEXT NOT NULL CHECK (json_valid(raw_json)),
  dog_id TEXT REFERENCES v2_dogs(dog_id) ON DELETE RESTRICT,
  admission_id TEXT REFERENCES v2_admissions(admission_id) ON DELETE RESTRICT,
  walker_id TEXT REFERENCES v2_walkers(walker_id) ON DELETE RESTRICT,
  UNIQUE(source_kind,source_key)
);
