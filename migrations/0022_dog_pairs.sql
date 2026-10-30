-- #774（ADR 0025）：確認消失的一般狗跟同籠新出現、或同籠同名還在表上的狗列成「可能是同一隻」，管理者按合併或不是同一隻。
-- added_at：這一列由狗清單同步新建的時間（ISO）；NULL＝本欄加上之前就在表上。只用來判斷「新出現」，不在觸發器的欄裡。
ALTER TABLE v3_sheet_main ADD COLUMN added_at TEXT;
-- 確認消失時那隻狗的籠位：之後同籠新建狗時拿來配對（主清單複本那一列已經刪掉）
CREATE TABLE IF NOT EXISTS v3_sheet_gone (
 dog_id TEXT PRIMARY KEY NOT NULL,
 cage TEXT NOT NULL,
 gone_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS v3_sheet_gone_cage ON v3_sheet_gone(cage, gone_at);
-- 配對：gone_dog_id＝確認消失、待核對的那隻（合併時被併掉）；dog_id＝表上那隻（留下）。按過「不是同一隻」的列留著，同一組不再建立
CREATE TABLE IF NOT EXISTS v3_dog_pairs (
 gone_dog_id TEXT NOT NULL,
 dog_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','merged','not_same')),
 created_at TEXT NOT NULL,
 decided_at TEXT,
 PRIMARY KEY(gone_dog_id, dog_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS v3_dog_pairs_pending ON v3_dog_pairs(created_at) WHERE status='pending';
