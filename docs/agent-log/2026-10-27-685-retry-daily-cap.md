# 2026-10-27 寫回重試另設每天上限（#685）

- Agent：Claude Code（Opus 5.5），由 #687 分派工作階段交辦
- 分支：`claude/685-retry-daily-cap-703621`

## 依據

#685；D1 效率稽核第 6 項選項 C，K 2026-10-27 定案（`docs/research/2026-10-27-writeback-retry-budget.md`、`docs/research/2026-10-27-d1-efficiency-audit.md` 的「定案」表）。接在 #684（明確拒絕就停、最多 10 次）之後。

## 做了什麼

- `migrations/0016_walk_retry_budget.sql`：`v3_walk_write_budget` 加 `retry` 欄（預設 0），`db/compact-schema.sql` 同步。
- `worker/src/walk-accept.js`：
  - `writeBudget` 多一個 `retry` 參數：重試的列數照舊算進 `reserved`，另外累加到 `retry`，用 guard 跟 `SYNC_RETRY_DAILY_BUDGET`（沒設時 5,000）比。
  - `dispatchBatch` 認領前，在同一次讀取往返多讀當天 `retry` 用量；失敗過的工作（狀態不是 `pending`、不是中斷恢復）算重試，放得下才派送，放不下的把 `next_attempt_at` 改成隔天 UTC 午夜（扣總預算 4 列／隻），同一輪的第一次派送照送。
- `wrangler.jsonc`、`wrangler.test-site.jsonc`：`SYNC_RETRY_DAILY_BUDGET=5000`；`docs/adr/README.md` 重新產生。
- 文件：ADR 0018 補一段決策；`docs/ARCHITECTURE_NOW.md` 補說明。
- 測試：`worker/test/walk-retry.test.mjs` 兩個（上限只夠一次重試時第二次延到隔天、隔天照常重試、第一次派送不算；上限 0 時卡住的重試延到隔天，同一輪新登記的第一次派送照送、再登記照常接受）。

## 取捨

- 上限 5,000 列是研究舉的例子（約 52 次重試／天，總預算 40,000 的 1/8），K 還沒定數字；要改只動 `wrangler.jsonc`。
- 重試同時算進總預算，總預算仍是 D1 寫入的硬上限；重試最多吃掉 5,000，新的登記至少剩 35,000。
- 延到隔天要寫 outbox 一列，因為不寫的話卡住的工作 `next_attempt_at` 最早，會一直佔排程每輪十隻的名額，擋住沒送成的第一次派送。
- 中斷後的恢復派送不算重試：它靠 `v3_walk_delivery` 撿，沒有下次時間可延；失敗後轉成 `retry` 才受上限管。
- migration 用 0016：#683（PR #698）用 0015，排在前面合併。

## 未完成／另案

- 停住後怎麼重送：#675。
- 96 列預留要等累積實際資料再量（稽核 D 項）。
