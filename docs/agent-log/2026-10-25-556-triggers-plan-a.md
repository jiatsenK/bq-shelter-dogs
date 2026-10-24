# D1 觸發器方案甲（#556）

- 日期：2026-10-25。Agent：Claude。分支 `claude/556-triggers-plan-a-b82f19`。
- 依據：#556、觸發器稽核 #548 的方案甲（K 已同意；方案乙「修訂 ADR 0009」先不做）。報告在 PR #551：`docs/research/2026-10-24-521-d1-triggers-audit.md`。
- 改動：
  - `migrations/0002_trigger_plan_a.sql`：`DROP TRIGGER IF EXISTS` 18 個 `identity_*`（正式庫本來就沒有）；9 個收窄（先 DROP 再建）：`walk_pack_UPDATE`（`UPDATE OF version,effective_date,walker,updated_at`）、`packs_v3_sheet_main_UPDATE`（`UPDATE OF` 在所資料包讀的欄；離所那段只在列號、狗、編號變時才加）、`packs_v3_{intros,intake_events,dog_numbers,rest,stays}_UPDATE`（OLD、NEW 合成一句，同一隻狗只加 1）、`packs_v3_departures_UPDATE`（同一年只加 1）、`walkpack_v3_walks_UPDATE`（同一個月或都是今天只加 1）。`db/compact-schema.sql` 同步改。
  - `worker/src/identity.js`：`linkIdentityName`、更名、合併的 batch 自己 `UPDATE v3_identity_revision SET revision=revision+1`。
  - 測試：`packs.test.mjs` 加 5 個收窄測試（換回舊觸發器 5 個都會失敗）；`identity.test.mjs` 加「送出前有人改名字對照仍被擋」（拿掉程式加 1 會失敗）；`d1-read.test.mjs` 拿掉 `total_changes()/2`。
- 觸發器數：schema 75 → 57；正式庫 57 → 57（identity 本來就沒有，數量不變，但 9 個內容換了）。票上寫的 54 要等 #558 刪 `version_v3_today_walks_*` 3 個。
- 例外：
  - migration 編號用 0002，0001 是 #555（PR #571）。#571 沒合併前，`d1-migrations.test.mjs` 的連號測試會紅；本機暫時疊上 #571 跑過，連號與一致性都過。**要先合 #571 再合這張。**
  - 「先加後刪」：DROP 的是觸發器、不是資料；identity 那 18 個正式庫本來就沒有，所以 migration 和程式放同一張 PR。先套 migration、再部署之間，正式庫行為跟現在一樣。
  - `changesData` 判定 0002 不用備份（只有 DROP／CREATE TRIGGER）。
- 沒做：`packs_v3_departure_items_UPDATE` 也是 OLD、NEW 各加一次（同一個編號加 2），報告沒列進 9 個，沒動。
- PR：（開好後補）
