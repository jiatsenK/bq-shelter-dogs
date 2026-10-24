# v3_sheet_main 補 dog_id 索引（#555）

- 日期：2026-10-25。Agent：Claude。分支 `claude/555-sheet-main-dog-id-index-b7cb88`。
- 依據：#555（#521 第 3 項）；#549 資料表稽核第 4.2、6 節。
- 改動：新增 `migrations/0001_sheet_main_dog_id_index.sql`（`CREATE INDEX IF NOT EXISTS v3_sheet_main_dog ON v3_sheet_main(dog_id)`）；`db/compact-schema.sql` 在 `v3_sheet_main` 定義旁同步加同一行。觸發器段落沒動（#556 同時在改，用 0002）。
- EXPLAIN QUERY PLAN：開卡讀回的子查詢從 `SCAN m` 變成 `SEARCH m USING INDEX v3_sheet_main_dog (dog_id=?)`，沒有另外排序（row_index 是 rowid，索引本來就照它排）；觸發器的 `EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=…)` 變成 `SEARCH … USING COVERING INDEX v3_sheet_main_dog`。本機 SQLite 與測試庫 D1 都一樣。
- 測試庫 `bq-shelter-dogs-test` 實測 rows_read（套用前 → 後）：單查 `SELECT 1 FROM v3_sheet_main WHERE dog_id=?` 116 → 2；開卡讀回（49 張卡的志工）3,011 → 98。
- 測試庫已用 `wrangler.preview-db.jsonc` 套了 0001（已記在測試庫的 `d1_migrations`；之後改這個檔不會重套，要重來就跑「準備預覽資料庫」）。
- 正式庫沒有動：K 合併後按「套用 D1 migration」。
- 本機檢查：`scripts/d1-migrations.test.mjs`、`worker/test/packs.test.mjs` 40/40 通過。`-Full` 431/435，失敗的 4 個都在 `scripts/local-check.test.mjs`：這台沒有 `pwsh`；改 `BQ_CHECK_PWSH=powershell` 後剩 1 個，是 Windows PowerShell 5.1 主控台用 Big5 輸出中文造成亂碼。都是本機環境，跟本票無關，CI 照常跑。
