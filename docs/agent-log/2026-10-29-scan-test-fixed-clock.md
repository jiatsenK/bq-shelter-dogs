# 保險掃描測試固定時鐘

- 日期：2026-10-29。Agent：Claude Code。
- 問題：`worker/test/walk-edit-rows.test.mjs`「#500 保險掃描沒有不同的狗只問一次就結束」用真實時間跑排程。UTC 1 點（台灣 9 點）那一小時，`23 1,5,15 * * *` 是當天第一次掃描，`index.js` 的 `firstScanOfDay` 成立，會順便清修改紀錄、多記一列 `cron_editlog`，D1 寫入數就比斷言多 1（expected 42、actual 43）。10/29 台灣 09:01、09:03 跑 #751、#752 的 CI 都卡在這裡，main 同時段也一樣。
- 重現：`origin/main`（88ae1898）把時鐘固定在 UTC 01:30 會失敗、05:30 通過；10/29 台灣 09:18 用真實時鐘跑也失敗。
- 判斷：正式程式照設計運作（ADR 0004 修訂、`edit-log-prune.test.mjs` 已驗每天第一次掃描清一次並記錄）。多的那列是排程狀態 `v3_sync_state`，不經過溜狗寫入預算 `v3_walk_write_budget`（只有 `walk-accept.js` 預留），預算不會算錯。是測試沒固定時間。
- 做了什麼：該測試用 `t.mock.timers` 把 `Date` 固定在 2026-10-22T05:23Z（台灣 13:23 那次掃描），註明原因。只改測試，不動正式程式。
- 順帶發現（未處理）：同一個測試裡跑 `5-59/10` 重試排程時會印 `cron retry: Provided value cannot be bound to SQLite parameter 2.`，main 原本就有，測試沒驗這段所以不會失敗，待另外查是測試假資料還是程式問題。
- 與 #752 的關係：#752 沒改這支測試檔，只改 `index.js`，不衝突，合併順序不限。
- 相關 PR：見本分支 PR。
