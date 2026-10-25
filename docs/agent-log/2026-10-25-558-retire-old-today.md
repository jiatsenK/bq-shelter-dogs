# 舊今日溜狗退場第一步（#558）

- 日期：2026-10-25。Agent：Claude。分支 `claude/558-retire-old-today-387503`。
- 依據：#558（#521-6）；觸發器稽核〈版本號與讀取端〉、資料表稽核 2.9 節（PR #551）；ADR 0018；「先加後刪」（`docs/agents/data-changes.md`）。
- 追查：
  - 現在的網頁：`site-config.js` `d1WalkAccept: true` → `walk-flow.js` 讀 `/today?source=d1`；`walk-registration.js` 在 d1 模式一律走 `executeAccepted`，每筆都帶 `requestId`。不會再呼叫舊 `/today`、也不會送沒有 requestId 的溜了／修改／復原。
  - 正式庫（只 SELECT）：`v3_today_walks` 只剩 1 列（walk_date 2026-10-24，updated_at `2026-10-24T06:14:58Z`＝台灣 14:14，#533 合併後幾分鐘的舊網頁）；`v3_data_versions.today=600`。`saveTodayWalks` 每次寫入會刪掉今天以前的列，所以 10/25 到查詢當下沒有寫入。
- 改動（只改程式，沒有 migration、沒動 `compact-schema.sql`）：
  - `worker/src/index.js`：`POST /walk` 的 walk／edit／undo 沒帶 `requestId` 時回 410「網頁版本太舊，這次沒有登記。請重新整理更新網頁後再按一次」，不寫試算表、不寫 `v3_today_walks`；`GET /today` 不帶 `source=d1` 回 410，不讀 `v3_today_walks`／`v3_data_versions`。舊流程的程式一併拿掉（伺服器找上一次的舊復原、`walkundo` 編輯紀錄、`saveTodayWalks` 呼叫、`cleanWalkDog` 的 `prev`／`wrote`／`expected` 檢查、原本只擋已接管狗的 409）。備註、異動紀錄（note／log）照舊。
  - `worker/src/today.js`：只留 `previousWalk`（D1 接受流程還在用）。
  - 測試：`today.test.mjs` 改寫成退場測試（先紅 6 個再轉綠，含「刪表後照常」）；`undo-revert.test.mjs` 改成直接測 `previousWalk`；`worker.test.mjs` 的 #138 共用擋法改用 note；`walk-accept.test.mjs` 舊入口 409 → 410。
- 選擇：回錯誤，不改走 D1 接受流程。理由寫在 PR 說明。
- 本機：相關 Node 測試全過。`check-local.ps1 -Full`：Node 434 個中 430 過，失敗 4 個都是 `scripts/local-check.test.mjs`（#556 紀錄寫過乾淨 main 也一樣）；Node 失敗會停下全套，網頁套件另用 `-Suite` 全部跑。
- 第二步（另一張 PR）：DROP `v3_today_walks`、`v3_data_versions`、`version_v3_today_walks_*` 3 個觸發器，同時改 `compact-schema.sql`、`scripts/compact-schema.test.mjs` 表清單、`today.test.mjs` 的 `oldTable`。
- PR：見下方。
