-- #267：經 K 確認後，在部署新版 Worker 前對正式 D1 執行。
-- 只建立空表，不修改既有狗、開卡或試算表資料，可重跑。
CREATE TABLE IF NOT EXISTS v3_favorites (
  walker_code TEXT NOT NULL,
  dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  added_on TEXT NOT NULL,
  PRIMARY KEY(walker_code,dog_id)
);
