# 2026-10-22 refactor/backend-deepen：後端架構整理 8 項

- Agent：Claude Code（Opus 5.5）
- 依據：K 2026-10-22 看完後端盤點（`/improve-codebase-architecture`，只限 worker／db／scripts）後說「全部都要改」。

## 做了什麼（一項一個 commit）

1. 刪掉 `scripts/sync-sheet.mjs` 寫 data/、讀狗卡（dogs/*.md 已不存在）的程式；溜狗紀錄、離所規則的測試改成直接測還在用的函式。
2. 正式同步用的記憶體 D1 從 `worker/test/fakes.mjs` 搬到 `scripts/memory-d1.mjs`（fakes.mjs 轉出同一個函式）。
3. 寫試算表的呼叫都經過 `worker/src/sheet-write.js` 的 `callSheet`，能做的動作列在 `SHEET_ACTIONS`（ADR 0006），測試核對小程式真的有這些動作；狗群寫 D1 的 SQL 搬到 `compact.js`。
4. 休養、固定照顧、介紹、舊編號、出入所的共同步驟收成 `editDog`／`DOG_EDITS`（ADR 0004）。
5. gviz 解析、欄位對應、名字分隔符號共用 `worker/src/sheet-read.js`（Worker、同步、walk-accept）。
6. 網站 API 改成路由表 `SITE_ROUTES`。
7. 我溜過的計算規則拆到 `worker/src/walk-summary.js`。

## 刻意的行為差異（審查時列出，K 可以決定要不要還原）

- 舊編號現在有本文大小上限（2048 位元組），記編輯紀錄也帶時間。
- 舊編號、出入所改成先檢查有沒有選名字，再檢查欄位（沒選名字又填錯時，回「請先選好你的名字」）。
- 編號格式不對的訊息統一成「狗狗編號格式不對」；固定照顧沒接資料庫、找不到狗的訊息跟其他編輯一致。
- 狗群金鑰錯誤的訊息從「通關碼」改成「金鑰」（ADR 0004 已沒有通關碼）。
- `/rest/a/b` 這種多一段的網址不再被休養接住（原本回 400，現在落到後面的處理）。

## retro 後補的檢查（K：「壞的東西只是搬家」）

- `worker/test/standards.test.mjs`：沒帶條件的 SELECT／DELETE 要列在 `FULL_SCAN_OK`（既有的待 #474 確認）；拆名字只能用 `splitNames`（三處改掉，trim 差異已補進 #473）。
- CODING_STANDARDS.md 加「搬動的程式碼視同新寫」；`docs/agents/issue-tracker.md` 加重構規格要列既有違規與票號。

## 驗證

node 測試 403 項、網頁測試 262 項全過；Standards／Spec 兩軸審查已做，上面的差異就是審查列出、決定保留的。
