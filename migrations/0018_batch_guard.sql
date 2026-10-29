-- #747：有條件 batch（worker/src/conditional-batch.js）的 guard 表換成通用名稱。永遠是空表：條件不成立才插一列 0，違反 CHECK 讓整批回復。
-- 舊的 v3_walk_guard 等不再使用它的程式部署後，下一張 PR 再刪（docs/agents/data-changes.md 先加後刪）。
CREATE TABLE IF NOT EXISTS v3_batch_guard (ok INTEGER NOT NULL CHECK(ok=1));
