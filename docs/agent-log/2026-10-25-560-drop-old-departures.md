# 刪舊離所三表（#560 第二步）

- 日期：2026-10-25。Agent：Claude。分支 `claude/560-drop-old-departures`，疊在 `claude/559-drop-old-tables`（#559 的 0007）上（合併順序 0007 → 0008）。
- 依據：#560；`docs/agents/data-changes.md`「先加後刪」：#579（0006）已合併，0004–0006 在 2026-10-25 套上正式庫並部署。
- 先查讀寫點：整個 repo（worker、admin、apps-script、scripts、.github）除了 `db/compact-schema.sql`、文件、`scripts/migration-0006-dog-departures.test.mjs`（0006 搬資料測試，只跑到 0006）之外，沒有地方讀寫 `v3_departures`、`v3_departure_items`、`v3_departed_cards`。
- 改動：
  - `migrations/0008_drop_old_departures.sql`：明寫 DROP 9 個觸發器（`packs_v3_departures_*`、`packs_v3_departure_items_*`、`version_v3_departed_cards_*`），再 DROP 三張表（items 先刪）；索引 `v3_departures_date／_dog` 隨表刪。會刪資料，套用 workflow 會先複製到備用庫。
  - `db/compact-schema.sql` 拿掉三張表、2 個索引、9 個觸發器；離所說明併到 `v3_dog_departures` 那段。
  - `scripts/compact-schema.test.mjs` 表清單；新增 `scripts/migration-0008-drop-old-departures.test.mjs`；`docs/COMPACT_D1.md`。
- 測試庫（`bq-shelter-dogs-test`）：#559 已先套 0007（`d1_migrations` 到 0007，觸發器 55）。匯出當基準 → `npx wrangler d1 migrations apply bq-shelter-dogs-test --remote --config wrangler.preview-db.jsonc` 套 0008（記在 `d1_migrations`）→ 再匯出比對：`/departures`、`/departures/index`、`/departures?year=2026`、`/departed-cards`、`/rest`、`/dogs` 完全相同（版本號也不變），`/walkers` 只有讀取時間不同。三張舊表與它們的觸發器、索引都不在了，新表 8 列。觸發器 55→46，名稱與內容跟 `compact-schema.sql` 逐一相同；匯出檔本機複本上改 `walker_codes` small 加 1、離所只讓那一年加 1、換年兩年各加 1。
- 本機 `check-local.ps1 -Full`：Node 448 個中 444 過，失敗 4 個是已知的 `scripts/local-check.test.mjs`；連號測試通過。網頁套件另用 `-Suite` 跑 22 個：全部通過。
- PR：#582（草稿）。
- 合併後 K 按「套用 D1 migration」前可先只讀確認舊表沒有部署後才寫進的新列（應為 0）：`SELECT COUNT(*) FROM v3_departures d WHERE NOT EXISTS(SELECT 1 FROM v3_dog_departures n WHERE n.dog_id=d.dog_id AND n.number=d.number);`
