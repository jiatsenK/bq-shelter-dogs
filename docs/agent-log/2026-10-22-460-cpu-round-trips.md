# 2026-10-22 #460 Cron 一輪 CPU：減少 D1 往返

- Agent：Claude。分支 `claude/460-d1-unified`（PR #487），用 `/diagnosing-bugs`、`/improve-codebase-architecture`、`/codebase-design`。
- 診斷：本機量一輪，保險掃描 116 隻 < 1 ms，派送 10 隻約 8 ms，重現不了線上 73 ms；逐筆記錄後，派送一隻約 16 次 D1 往返，同一份資料重讀 4 次。判斷 Worker CPU 跟往返次數成正比，尚未在線上證實。
- 改法：`walk-accept.js` 同一次請求內多個讀取併成一次 batch、快照往下傳；跨請求核對與 guard 不變（ADR 0017）。Cron 收到回應後只讀一次確認（K 選 A）。往返：Cron 6→3、拿目標 6→1、回報 4→2。
- 測試：新增 `worker/test/walk-round-trips.test.mjs`（改前紅、改後綠）。三個既有測試配合調整：派送晚一點才呼叫 fetch 時的放行方式、查詢別名 `o` 的索引斷言、競爭插入點改在授予目標的寫入之前。
- `worker/cpu-bench/fake-gas.js` 的狗數可用 `BENCH_DOGS` 設定，沒設時仍是 200。
- 測速：回呼改經服務綁定打到第二個測速 Worker `bq-shelter-dogs-cpu-cb`，跟正式一樣分開呼叫；工作流程分開讀兩邊 CPU、最後兩個都刪。新增 `cpu-bench.test.mjs` 一項。
- 驗證：Node 430／430。前端沒改，網頁測試沒重跑。未部署、未線上量測。
