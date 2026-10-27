-- #681：寫回紀錄（v3_walk_outbox）少寫索引。K 2026-10-27 重新開放寫回協定，研究見 docs/research/2026-10-27-walk-writeback-write-cost.md。
-- readback：沒有查詢用到。唯一帶 readback_seen=1 的查詢（knownIntermediate）本機與正式庫 EXPLAIN 都選 causal。
-- unknown_date、unknown_walker：三句「未知結果」查詢只留 unknown。另外兩句改走主鍵（dog_key=? AND version>基準版本），
-- 只讀這隻狗基準之後的幾個版本再過濾，讀取量幾乎一樣，每次派送少寫 2 列（EXPLAIN 仍是 SEARCH）。
-- 只刪索引不刪資料，套用 workflow 不用先備份；查詢不寫索引名字，套用前後的程式都能跑。
DROP INDEX IF EXISTS v3_walk_outbox_readback;
DROP INDEX IF EXISTS v3_walk_outbox_unknown_date;
DROP INDEX IF EXISTS v3_walk_outbox_unknown_walker;
