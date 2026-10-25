# 刪舊離所三表（#560 第二步）

- 日期：2026-10-25。Agent：Claude。分支 `claude/560-drop-old-departures`，疊在 `claude/559-drop-old-tables`（#559 的 0007）上（合併順序 0007 → 0008）。
- 依據：#560；`docs/agents/data-changes.md`「先加後刪」：#579（0006）已合併，0004–0006 在 2026-10-25 套上正式庫並部署。
- 先查讀寫點：整個 repo（worker、admin、apps-script、scripts、.github）除了 `db/compact-schema.sql`、文件、`scripts/migration-0006-dog-departures.test.mjs`（0006 搬資料測試，只跑到 0006）之外，沒有地方讀寫 `v3_departures`、`v3_departure_items`、`v3_departed_cards`。
- 改動：
  - `migrations/0008_drop_old_departures.sql`：明寫 DROP 9 個觸發器（`packs_v3_departures_*`、`packs_v3_departure_items_*`、`version_v3_departed_cards_*`），再 DROP 三張表（items 先刪）；索引 `v3_departures_date／_dog` 隨表刪。會刪資料，套用 workflow 會先複製到備用庫。
  - `db/compact-schema.sql` 拿掉三張表、2 個索引、9 個觸發器；離所說明併到 `v3_dog_departures` 那段。
  - `scripts/compact-schema.test.mjs` 表清單；新增 `scripts/migration-0008-drop-old-departures.test.mjs`；`docs/COMPACT_D1.md`。
