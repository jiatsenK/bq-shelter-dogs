# #460 Cron CPU 討論交接（2026-10-22）

給下一個視窗接著 `/grill-with-docs` 用。分支 `claude/460-d1-unified`、PR #487、worktree `C:\Users\User\repos\bq-460`。功能開關 `SITE.d1WalkAccept` 維持關閉；沒有新的線上測試授權。

## 四件工作（詞見 GLOSSARY.md）

| # | 名稱 | 方向 | 何時跑 | 狀態 |
|---|---|---|---|---|
| 1 | 試算表同步（`syncTick`） | 試算表 → 網站，狗清單等 | 每 10 分鐘 | 正式在跑 |
| 2 | 改表通知比對（#458） | 試算表 → D1 溜狗欄 | 有人手改時（GAS 變更時觸發器） | 寫好、開關關著 |
| 3 | 保險掃描（#459） | 試算表 → D1，補 2 漏掉的 | 原本每分鐘 | 寫好、開關關著 |
| 4 | 派送（#460） | D1 → 試算表 | 每分鐘 | 寫好、開關關著 |

注意：`worker/src/index.js` 的 `scheduled` 現在同一次呼叫裡跑 `syncTick`（1）和 `retryWalks`（3＋4），三件擠在同一個 10 ms。

## 已知事實

- 線上 Cron 一輪（掃描 200＋派送 10）P99 50 ms；回呼 P99 4.6 ms；正式 `syncTick` 7 天 P99 8.17 ms。
- 本機剖析：CPU 大多在 D1 綁定每次往返，商業邏輯 < 15%（`docs/research/2026-10-22-460-cron-cpu-cause.md`）。
- 業界做法與可用工具：`docs/research/2026-10-22-460-sync-patterns.md`。
- 「四件是否都需要」研究：`docs/research/2026-10-22-460-job-count.md`。重點：
  - 可收成兩件：①試算表同步，和「溜狗對帳」（②③④同一路徑；收到通知＝馬上跑一次保險掃描，可刪 `walkCompare`）。不用重開鎖定。
  - ③ 不能併進 ①：① 用 gviz，規格與 ADR 0017 規定 gviz 不算證據。
  - ④ 本來就在按下時用 `waitUntil` 背景派送（`index.js:947`），Cron 只補失敗。

## K 已決定

1. 派送改成一輪合併處理：最多 10 隻一次交給 Apps Script、D1 用 `batch()`；一輪 10 隻維持。
2. 保險掃描改每 10 分鐘（ADR 0017 第 5 點要改）。

## 後續決定（2026-10-22 第二次討論）

- 照研究收成兩件：②③④合成溜狗對帳，通知＝馬上跑一次保險掃描。
- Cron 拆兩個排程：同步一個、對帳一個。
- 不做自動降隻數，用 `cpu-bench` 量。
- Apps Script 全部改完再部署一次。
- 直接改 ADR 0017 第 5 點（`prototype/d1-walk-sync` 分支），不另寫 ADR。
- 掃描加 Apps Script 四欄指紋，沒改就不回傳整份（`sheet_sig` 是 gviz，不能沿用）。

實作內容見 `460-d1-walk-unified.md` 的「Cron 收成兩件」。

## 目前進度（2026-10-22 換電腦前）

- 已實作並推上 PR #487：Cron 拆兩個排程、通知改跑保險掃描、四欄指紋、合併派送（`dispatchWalks`／`walkWakeBatch`）。ADR 0017 第 5 點改在 `prototype/d1-walk-sync`（commit e34ffea）。
- 測試：網頁測試全過；node 只剩 `scripts/local-check.test.mjs` 4 項，HEAD 改動前就失敗，跟本次無關。
- `cpu-bench`（run 39784436803）未通過：Cron 一輪 P99 57.89 ms（最壞情況：每輪整份比對 200 列＋派送 10 隻），回呼 P99 3.68 ms。
- 開關 `SITE.d1WalkAccept` 關著；Apps Script 還沒部署，等 CPU 過了再部署。
- **下一步**（等 K 決定）：先在本機拆開量掃描和派送各占多少 CPU，不跑線上；知道哪段最吃再決定怎麼改。
