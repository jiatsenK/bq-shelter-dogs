# 0003：舊資料與舊 D1 表清除（#252）

狀態：已完成（2026-10-15）

## 決策

網站資料搬到 D1 的 `v3_*` 表（見 `docs/design/history/COMPACT_D1.md`）後，舊資料全部退役：

- repo 刪除 `data/`、`dogs/`；刪除前的 main 打上 `data-final` 標籤封存，Git 歷史不改寫。
- 正式 D1 `bq-shelter-dogs` 刪除 6 張舊表（`card_opened`、`walker_names`、`changes`、`walks`、`dogs`、`kv`）；預覽 D1 `bq-shelter-dogs-test` 刪除第一版與 `v2_*` 共 25 張候選表。`v3_*` 不動。
- K 2026-10-15 取消原本 72 小時觀察期，改為當天完成驗證後驗收。
- 「我的備註」退役，`/notes` API 回 410；`NOTES_PASSCODE` 保留給休養、介紹、管理使用。

## 結果

- 刪前備份只存在本機已忽略的 `.migration-private/252/`，不提交。
- 刪後兩個資料庫外鍵檢查 0 筆，正式與預覽的 dogs／walks／rest／departures API 皆 200。
- 完整執行紀錄與驗證：[#252 留言](https://github.com/jiatsenK/bq-shelter-dogs/issues/252#issuecomment-6188598668)。

## 之後

- 舊表的建表檔（`db/schema.sql`、`db/migrations/`）和一次性搬遷工具已在 #275 移除，`wrangler*.jsonc` 也不再設定 `migrations_dir`，避免誤跑把舊表建回來。需要時從 Git 歷史或 `data-final` 標籤找。
- 預覽 D1 留有 wrangler 的 `d1_migrations` 紀錄表，不影響網站，保留。
- 清除前的準備文件（原 `docs/CLEANUP_252.md`、`docs/CLEANUP_252_AUDIT.md`）併入本檔後刪除，原文在 Git 歷史。
