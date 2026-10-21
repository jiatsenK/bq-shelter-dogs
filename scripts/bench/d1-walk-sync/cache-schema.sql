-- THROWAWAY #441: isolated copies of the exact today's-table layout and triggers.
CREATE TABLE IF NOT EXISTS bench441_cache_today (
  walk_date TEXT NOT NULL, dog_key TEXT NOT NULL,
  walked INTEGER NOT NULL CHECK(walked IN (0,1)),
  walked_date TEXT NOT NULL DEFAULT '', walker TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL, PRIMARY KEY(walk_date,dog_key)
);
CREATE TABLE IF NOT EXISTS bench441_cache_versions (
  id INTEGER PRIMARY KEY CHECK(id=1), today INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO bench441_cache_versions(id) VALUES(1);
CREATE TRIGGER IF NOT EXISTS bench441_cache_insert AFTER INSERT ON bench441_cache_today
BEGIN UPDATE bench441_cache_versions SET today=today+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS bench441_cache_update AFTER UPDATE ON bench441_cache_today
BEGIN UPDATE bench441_cache_versions SET today=today+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS bench441_cache_delete AFTER DELETE ON bench441_cache_today
BEGIN UPDATE bench441_cache_versions SET today=today+1 WHERE id=1; END;
