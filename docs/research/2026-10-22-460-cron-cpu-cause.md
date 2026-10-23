# #460 Cron 一輪 CPU 到底花在哪

- 日期：2026-10-22（台灣時間）。Agent：Claude Code 背景研究代理。
- 問題（K）：Cron 一輪（保險掃描 200 隻＋派送 10 隻）線上 P50 33 ms／P99 50 ms；本機掃描 116 隻純 JS 只要 0.4–0.9 ms；正式 Cron P99 8 ms。懷疑是架構問題、不是資料量。
- 範圍：只讀 repo（分支 `claude/460-d1-unified`）與 Cloudflare 官方文件。沒有部署、沒有線上測試、沒有改程式。

## 結論

- **最可能：CPU 花在「一輪裡的往返次數」，主要是派送，不是掃描。** 而且測速 Worker 自己扮演假 Apps Script，每派一隻多付兩次服務綁定呼叫的打包／解讀，正式環境不會付這筆。
- 「每輪固定約 22 ms」不可靠：只有兩次線上結果（110.86 ms → 50.30 ms）可以擬合，分不出固定成本與每次往返成本；本機掃描只要 0.4–0.9 ms，派送 10 隻卻要 9–25 ms（`docs/design/460-d1-walk-unified.md:85`），兩者矛盾的是「固定 22 ms＝掃描」這個推論（同檔 :115）。
- 信心：中。程式結構能解釋大部分，但線上無法逐段計時（Workers 計時器只在 I/O 時前進），要靠本機 workerd 剖析確認。

## 一輪做了什麼（測速版）

`POST /cpu-round` → `retryWalks`（`worker/cpu-bench/index.js:14-17`、`worker/src/walk-retry.js:6-35`）：

| 階段 | D1 呼叫 | 其他子請求 | 出處 |
|---|---|---|---|
| 比對通知重試 | 1（`first`） | — | `worker/src/walk-notify.js:52-57` |
| 保險掃描 | 1（`SELECT s.*` 200 列寬列） | 1 次假 Apps Script `walkScan`（同一 isolate 內產生 200 列並 `Response.json`，再 `res.json()` 解回） | `worker/src/walk-reconcile.js:43-49`、`worker/cpu-bench/fake-gas.js:44-46`、`worker/src/sheet-write.js:28-34` |
| 掃描比對 | 0（測速資料無差異，`changed=0`） | — | `walk-reconcile.js:17-21`、`fake-gas.js:23` |
| 找待派送 | 3 | — | `walk-retry.js:13-27` |
| 每隻派送 ×10 | 約 3（讀一批、搶鎖一批、確認一批） | 1 次假 Apps Script `walkWake` → 內部再 2 次服務綁定 `CALLBACK.fetch`（target、receipt），每次 `new Request` + `JSON.stringify` + `res.json()` | `worker/src/walk-accept.js:172-205`、`fake-gas.js:31-39,47-51` |
| 寫入預算 | 不另打 D1；沒設權杖所以不打帳號分析 HTTP，只 `console.warn` | — | `walk-accept.js:38-50`、`wrangler.cpu-bench.jsonc` 註解 |

合計約 35 次 D1＋10 次 `walkWake`＋20 次服務綁定＋1 次 `walkScan`，約 65 次往返，幾乎都在派送。

## 假設逐一檢查

| 假設 | 程式／文件證據 | 判斷 | 便宜的確認方式 |
|---|---|---|---|
| (a) 假 Apps Script 跑在測速 Worker 裡 | `fakeSheet` 換掉 `globalThis.fetch`（`index.js:15`）；`walkWake` 在呼叫端 isolate 內做 2 次服務綁定往返與 JSON 解讀（`fake-gas.js:47-51`）。正式環境 `fetch` 打 Google 只是等待，等待不算 CPU（[Limits](https://developers.cloudflare.com/workers/platform/limits/)）。`walkScan` 200 列 JSON 約十幾 KB，成本很小。 | **成立，佔比中**：20 次額外服務綁定往返是正式沒有的；約 1/3 的往返數。 | 本機把 `walkWake` 改成直接回傳固定回執（不呼叫 `machine`），比較前後剖析。 |
| (b) 每次 D1 呼叫的綁定打包成本 | D1 等待不算 CPU，但打包請求、解讀回傳在 Worker 內執行（同上文件「subrequest」含 D1）。設計文件已觀察到 CPU 隨往返數下降（`460-d1-walk-unified.md:87,108`）。 | **成立，主因**：35 次 D1＋其他往返，每次約 0.3–1 ms。 | `wrangler dev` 按 D 開 DevTools Profiler（[CPU profiling](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/)），看時間落在 D1 綁定／`Request`／JSON。 |
| (c) `writeBudget` 帳號分析 HTTP | 只有 `CLOUDFLARE_API_TOKEN` 與 `CLOUDFLARE_ACCOUNT_ID` 都設時才打（`walk-accept.js:40-41`）；測速 Worker 沒設（`wrangler.cpu-bench.jsonc` 註解）。 | **測速不成立**；但**正式會成立**：每派一隻、每次掃描寫入都打一次 GraphQL 並解讀，正式成本可能比測速更高。 | 讀程式即可確認；正式前應改成每輪只查一次。 |
| (d) 量測假象 | 20 輪取 P99≈最大值，樣本極少（`.github/workflows/cpu-bench.yml` 每批 20 次）；`/cpu-round` 結尾多一次 `SUM` 查詢（`index.js:18`）。冷啟動：測速與正式用同一份程式，正式 Cron P99 才 8 ms，冷啟動不像 22 ms。 | **部分成立**：P99 不穩，但 P50 33 ms 也超標，不是假象能解釋。 | 改看 P50；不需要線上測試。 |
| (e) 真的是掃描工作 | 本機 116 隻 0.4–0.9 ms 且與狗數幾乎無關（`460-d1-walk-unified.md:85`）；200 列寬列 `SELECT s.*` 的回傳解讀是唯一隨狗數成長的部分。 | **不太成立**：掃描頂多幾 ms。 | 本機剖析「0 隻待派送、只掃描」一輪。 |

## 架構面的意思

- 這是架構問題：每派一隻要多次 D1 往返＋一次（正式）或三次（測速）HTTP 往返，CPU 跟「往返數」成正比，不是跟資料量成正比。十隻就是幾十次往返。
- 正式環境去掉 (a) 後，估計仍有約 45 次往返；照每次 0.3–1 ms，仍可能超過 10 ms，而且正式還要加上 (c) 的帳號分析 HTTP。
- 方向：派送改成一輪只派 1–2 隻、或把多隻派送合併成少數幾個 `db.batch`；預算檢查一輪只做一次；`walkScan` 只取需要的欄位而非 `s.*`。

## 建議下一步

1. 本機 `wrangler dev`（本機 D1）＋ DevTools Profiler 跑 `/cpu-round` 三種情境：完整、`walkWake` 直接回傳、0 隻派送。三次剖析就能把 (a)(b)(e) 分開，不用線上授權。
2. 依剖析結果決定縮減哪一段，再申請下一次線上驗收。

## 本機剖析結果（2026-10-22 實測）

做法：`wrangler dev --local`（本機 D1，200 隻測速狗），用 Chrome DevTools Protocol 直接連 workerd 的偵錯埠，`Profiler` 每 50 µs 取樣一次，跑一次 `/cpu-round` 就存一份剖析檔。沒有部署，也沒有連到任何線上服務。本機有剖析工具和本機追蹤的額外負擔，絕對數字比線上大很多（完整一輪本機約 160–240 ms，線上 P50 33 ms），**只拿來看比例**。

| 情境 | 次數 | 執行 JS 的時間 | 時間花在哪 |
|---|---|---|---|
| 只做保險掃描（沒有狗要派送） | 11 次 | 多數 10–33 ms（有一次 114 ms 是離群值） | D1 綁定 31–54%、本機追蹤約 35%、我們自己的比對（`reconcileWalkSnapshot`）約 2% |
| 完整一輪（掃描＋派送 10 隻，含假回呼） | 4 次 | 163–238 ms | D1 綁定 44–62%、`callSheet` 底下的請求打包（含假 Apps Script）9–20%、本機追蹤 8–12%、`compareTrustedWalk`／`writeBudget`／`dispatchWalk` 各 3–5% |

`walkWake` 直接回固定回執這個情境沒有另外跑：完整一輪的剖析已經能看出假回呼歸在 `callSheet` 底下，約佔 9–20%。

結論：
- **我們自己的商業邏輯很少**：比對、預算檢查、派送判斷加起來不到 15%。保險掃描本身的比對約 2%。
- **CPU 大多花在 D1 綁定**：每次 D1 呼叫的打包、解讀，以及把結果轉成 JS 物件（`toJson`、`toArrayOfObjects`、`_send`）。往返越多、回傳的列和欄位越多，花得越多。
- 所以改善要從**減少往返次數**和**減少回傳的資料**下手：例如一輪只派 1–2 隻、多隻合併成少數幾次 `db.batch`、預算一輪只查一次、保險掃描只取需要的欄位。光把程式邏輯寫得更快，幫助有限。
- 保險掃描在本機一輪就佔 10–33 ms，大多也是 D1 綁定的花費。線上只做掃描的情況沒有量過，還不能確定能不能低於 10 ms。
