-- #685：寫回重試另設每天上限。重試保留的列數除了照舊算進 reserved，也累加在這欄，跟 SYNC_RETRY_DAILY_BUDGET 比；第一次派送不算。
-- 舊列補 0：今天在這之前的重試沒分開記，當作還沒用。
ALTER TABLE v3_walk_write_budget ADD COLUMN retry INTEGER NOT NULL DEFAULT 0;
