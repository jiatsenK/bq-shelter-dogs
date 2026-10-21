-- THROWAWAY #441: only run against bq-shelter-dogs-test, never the production DB.
-- Prototype-only tables stay off compact-schema.sql and off main.
CREATE TABLE IF NOT EXISTS bench441_walkers (
  run TEXT NOT NULL,
  dog TEXT NOT NULL,
  walker TEXT NOT NULL,
  pending INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (run, dog, walker)
);
CREATE TABLE IF NOT EXISTS bench441_sheet_hashes (
  dog TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL
);
