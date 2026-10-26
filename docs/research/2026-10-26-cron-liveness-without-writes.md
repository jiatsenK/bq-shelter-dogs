# 排程存活不靠 D1 心跳的做法（2026-10-26）

問題：PR #601（branch `claude/cron-limit-status`）讓三件排程工作每次跑完都 upsert `v3_sync_state` 的 `cron_<工作>` 一列（`worker/src/cron-status.js:20-22`）。寫回重試每 10 分鐘跑一次，一天約 144 列寫入（同檔第 4 行註解）。這違反過去設計稿「沒有差異不寫心跳」（`docs/design/history/459-walk-retry.md:19`、`docs/design/history/458-sheet-reconcile.md:61`）。有沒有辦法讓管理網站看到每個排程最後跑完的時間和失敗，又不用每 10 分鐘寫一次 D1？

本次只讀文件與程式，沒有部署，也沒有查正式環境。

## 1. Cloudflare 自己的執行紀錄

### 1a. GraphQL `workersInvocationsScheduled`（每次 Cron 一列）

- **有這個資料集，這個 repo 也用過。** `scripts/cpu-history.mjs:24-29` 查 `workersInvocationsScheduled(filter:{scriptName,datetime_geq,datetime_leq}){cron status cpuTimeUs datetime}`。2026-10-22 查到正式 Worker 7 天 601 次 Cron（`docs/design/history/460-d1-walk-unified.md:116`）。
- **欄位**（取自 introspection 產生的 schema 鏡像 <https://pages.johnspurlock.com/graphql-schema-docs/cloudflare.html>，`AccountWorkersInvocationsScheduled`）：`cron`（排程字串）、`scheduledDatetime`（排定時間）、`datetime`、`status`、`cpuTimeUs`、`scriptName`、`environmentName`。每個欄位都能篩選，可以照 `datetime_DESC`／`scheduledDatetime_DESC` 排序。所以能分開查 `cron:"5-59/10 * * * *"` 和 `cron:"53 1,5,15 * * *"`，看到每次觸發的時間和狀態。
- **官方文件幾乎沒寫。** Cron Triggers 頁只說程式要讀 Cron Events 的話「use Cloudflare's GraphQL Analytics API」，沒寫資料集名稱（<https://developers.cloudflare.com/workers/configuration/cron-triggers/>）。資料集清單頁和 Workers 指標教學只提 `workersInvocationsAdaptive`（<https://developers.cloudflare.com/analytics/graphql-api/features/data-sets/>、<https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/>）。等於是**沒有官方文件的資料集**。
- **`status` 看得到什麼：** 只看得到 Cloudflare 那一層的結果，例如 `success`、超過資源上限（第三方 PR 看過 `exceededResources`：<https://github.com/juncaj93/Fantasy-Analyst/pull/304>）。`recordRun` 會把工作丟出的錯誤接住（`cron-status.js:11-17`），所以**工作本身失敗時，這裡照樣顯示 `success`**。CPU 超過 10 ms、Worker 當掉、根本沒觸發，這三種它都看得到，D1 心跳反而看不到「CPU 超限」，因為工作被中斷時 `recordRun` 來不及寫。
- **權限：** 跟 `todayRowsWritten` 一樣，用 API token 的 Account Analytics 讀取（`worker/src/d1-usage.js:3`）。分析類 token 的權限見 <https://developers.cloudflare.com/analytics/analytics-engine/sql-api/>（Account | Account Analytics | Read）。
- **免費方案能不能用、資料保留多久：** 官方沒列。可以用 `viewer{accounts(filter:{accountTag:$a}){settings{workersInvocationsScheduled{enabled notOlderThan maxDuration maxPageSize}}}}` 查（schema 的 `AccountSettings` 有這個資料集，`Settings` 型別有這幾個欄位）。adaptive 資料集官方保證「every plan 至少 31 天」（<https://developers.cloudflare.com/analytics/graphql-api/limits/>），但這個資料集名稱不是 adaptive，不一定適用。
- **查詢次數上限：** 每 5 分鐘 300 次（同上 limits 頁），管理網站打開才查，用不到這麼多。
- **延遲：** 官方沒寫。Cron Events 頁只說新建或改名的 Worker「up to 30 minutes」才會出現紀錄。
- **可靠度：** 有第三方回報，2026-10-20 19:40Z 起整個帳號的這個資料集都查不到資料，但 Cron 其實照常在跑（<https://github.com/rezachidotnet/ahanassa-website/pull/89>）。社群也有人看過重複計數。Cloudflare 自己的 CLI 有人開 issue 要求支援讀取，目前只被標上 `upstream`（<https://github.com/cloudflare/cf/issues/168>）。所以**查不到資料不能直接當成「排程沒跑」**。

### 1b. 後台 Cron Events

只存最近 100 次觸發（<https://developers.cloudflare.com/workers/configuration/cron-triggers/>）。寫回重試每 10 分鐘一次，100 次大約只涵蓋 16 小時。這是給人看的後台畫面，程式要讀還是得走 1a。

### 1c. Workers Logs／Observability 查詢 API

- 會記錄 Cron 的執行紀錄，但要在 wrangler 設 `observability.enabled = true` 並重新部署（<https://developers.cloudflare.com/workers/observability/logs/workers-logs/>）。目前 `wrangler.jsonc` 沒設。
- 免費額度：現在是每天 20 萬筆、保留 3 天。**2026-12-01 起**改成 Cloudflare Observability 計費：免費方案每天 0.5 GB、保留 7 天，用完當天就停止收（<https://developers.cloudflare.com/observability/pricing/>）。開了以後所有 HTTP 請求也會一起記，要靠 `head_sampling_rate` 降量，但抽樣對 Cron 一樣有效。
- 查詢 API 是 `POST /accounts/{id}/workers/observability/telemetry/query`。API 文件寫要 **Workers Observability Write** 權限（<https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/>），比只讀分析資料的權限大。上面那個第三方 PR 也因為缺這個權限才沒採用。
- 好處是能看到 `console.warn` 的錯誤訊息。缺點是要改設定、權限比較大、保留期短。

### 1d. Workers Analytics Engine（Worker 自己寫，但不寫進 D1）

- Cron 跑完呼叫 `writeDataPoint`，不算 D1 寫入，也不用等它寫完。免費方案每天可寫 10 萬個資料點、讀 1 萬次查詢，目前不收費（<https://developers.cloudflare.com/analytics/analytics-engine/pricing/>）。資料保留 3 個月，每次呼叫最多寫 250 點（<https://developers.cloudflare.com/analytics/analytics-engine/limits/>）。
- 讀的時候走 SQL API `…/accounts/<id>/analytics_engine/sql`，權限是 Account Analytics Read（<https://developers.cloudflare.com/analytics/analytics-engine/sql-api/>）。
- 能記工作本身成功或失敗、有沒有實際做事。代價是要多一個綁定，管理 Worker 也要有 token。延遲官方沒寫。

## 2. repo 現有的帳號分析程式能不能拿來用

- `worker/src/d1-usage.js:4-17`：`todayRowsWritten` 用 `fetch` 打 `https://api.cloudflare.com/client/v4/graphql`，帶 `Authorization: Bearer <token>`。查不到時回 `null`，由呼叫的人決定怎麼處理。查詢字串換成 1a 那段，就能寫一個 `recentCronRuns`，寫法幾乎一樣。
- 呼叫的地方是 `worker/src/walk-accept.js:40-45`：Worker 有 `env.CLOUDFLARE_API_TOKEN` 和 `env.CLOUDFLARE_ACCOUNT_ID` 才查，逾時 3 秒，查不到就 `console.warn('walk-budget: …')` 再走保守的路。
- 這兩個值都是 Cloudflare 後台手動加的密鑰，repo 裡沒有。正式站目前有沒有設不確定（`docs/adr/README.md:41-42`）。
- **管理 Worker 目前沒有這兩個值。** `wrangler.admin.jsonc:1` 寫明「read-only admin entry point. No cron or machine credentials」。要用 1a 就得替管理 Worker 加一把只能讀 Account Analytics 的 token 當 secret，這會改掉「沒有機器憑證」這個前提，要 K 決定。管理網站前面有 Cloudflare Access，token 只在伺服器端用，不會送到瀏覽器。
- 本機唯讀查詢可以直接用 `scripts/cpu-history.mjs`。

## 3. 只動 D1 的降量做法

已經有低頻心跳的先例：#567 的 `dog_list_extra` 每次掃描都寫 `checkedAt`，一天 3 次（`worker/src/dog-list.js:271-273`）。照片垃圾桶也已經有 `trash_purged` 這一列（`worker/src/index.js:327`）。

- **B1 條件式 upsert，每小時最多一次：** `ON CONFLICT DO UPDATE … WHERE` 上次的 `okAt` 早於一小時前才更新。本機 `node:sqlite` 實測，條件不成立時 `changes: 0`，第一次寫和超過一小時後的那次都是 `changes: 1`。**但 D1 怎麼算 rows written 沒寫清楚。** pricing 頁只說「measure how many rows were written」，INSERT、UPDATE、DELETE 都算，有改到索引欄位會多算一列（<https://developers.cloudflare.com/d1/platform/pricing/>）。回傳物件的 `rows_written` 寫的是「the number of rows written by this query」（<https://developers.cloudflare.com/d1/worker-api/return-object/>）。條件不成立時到底算 0 列還是 1 列，沒有文件，要實測。
- **B2 用時間決定要不要寫（不靠 D1 怎麼計數）：** 只有「每小時第一個寫回重試時段」（`scheduledTime` 的 UTC 分鐘數小於 10）才記 `okAt`，失敗則一律記。不必先讀 D1，一天固定 24 列。缺點是剛好那個時段沒觸發的話，會晚一小時才更新，所以「過期」的門檻要從 40 分鐘（`worker/src/admin/checks.js:60`）放寬到大約 2 小時 10 分。
- **B3 只在有工作或失敗時記：** 閒著的時候不寫。但「沒在跑」和「閒著沒事」分不出來，`retryWalks` 也要改成回傳做了幾件（`worker/src/walk-retry.js:15-36` 目前沒有回傳值）。單獨用不夠，要搭 1a 或 B2。
- **B4 把存活時間塞進本來就會寫的列：** 寫回重試閒著的時候一列都不寫，沒有可以搭的列。保險掃描有差異才寫 `walk_scan_sig`（`459-walk-retry.md:19`），一樣沒有固定會寫的列。這條路走不通。

## 4. D1 免費方案寫入上限

每天 100,000 列，UTC 00:00（台灣早上 8:00）重置。用完後當天就不能查詢 D1（<https://developers.cloudflare.com/d1/platform/pricing/>）。PR 現在的做法一天約 147 列（重試 144、掃描 3、垃圾桶每月 1 次），約占 0.15%。`v3_sync_state` 的 key 是主鍵，更新只改 `value`，不會多算索引列，只有第一次 insert 可能多算。另外 Workers 免費方案的 Cron 上限是整個帳號 5 個，每次 Cron 有 10 ms CPU（<https://developers.cloudflare.com/workers/platform/limits/>）。

## 5. 比較

| 做法 | D1 寫入／天 | 準確度 | 免費方案可用 | 權限／設定 | 複雜度 | 分得出「沒跑」和「沒工作」 |
|---|---|---|---|---|---|---|
| 現狀：每次都 upsert | ~147 | 到每次；CPU 超限時寫不進去 | 可 | 不用 | 已完成 | 可 |
| 1a GraphQL scheduled | 0 | 到每次（觸發、平台狀態、CPU）；工作本身的錯誤看不到；資料集偶爾會空 | 未確認，要查 `settings` | 管理 Worker 加 Account Analytics Read token | 中：抄 `d1-usage.js` | 可（資料集有資料時） |
| 1c Workers Logs API | 0 | 到每次，含錯誤訊息；有抽樣 | 可：12/1 前 3 天，之後 7 天、每天 0.5 GB | 開 observability、Workers Observability **Write** token | 中高 | 可 |
| 1d Analytics Engine | 0（每天約 147 個資料點） | 到每次，含工作成功或失敗 | 可：每天 10 萬點、不收費 | 新綁定，管理 Worker 加 Account Analytics Read token | 中 | 可 |
| B1 條件式 upsert 每小時 | ~27（如果 no-op 不算） | 1 小時 | 可 | 不用 | 低：改一句 SQL | 可（1 小時粒度） |
| B2 用時段決定要不要寫 | ~27 | 1 小時；失敗即時記 | 可 | 不用 | 低：加一個時段判斷、放寬過期門檻 | 可（1 小時粒度） |
| B3 只在有工作或失敗時記 | 視工作量，閒時 0 | 只看得到有事的時候 | 可 | 不用 | 低 | **不可** |
| B4 塞進既有的列 | — | — | — | — | 沒有可以搭的列 | — |

## 6. 建議

**先用 B2，失敗一律記；1a 留著當之後的加強。**

- 理由：B2 不用 token、不用綁定，也不依賴 D1 對 no-op 怎麼計數。寫入從 144 次降到一天 24 次，跟 #567 一天寫 3 次 `checkedAt` 是同一類低頻心跳。管理者要的是「最近有沒有在跑、有沒有失敗」，1 小時的粒度夠用。失敗照樣即時記。
- 1a 是唯一一種零寫入、又看得到「CPU 超限」和「平台根本沒觸發」的做法。但資料集沒有官方文件、有過整個帳號查不到資料的紀錄、免費方案還沒確認，管理 Worker 也得加 token，所以不適合當唯一來源。K 如果願意給管理 Worker 一把只讀分析資料的 token，可以在畫面上加「Cloudflare 紀錄的最近觸發」，查不到就顯示「讀不到」，不要判成沒跑。
- 如果要的是工作層級的完整紀錄又不想寫 D1，1d 比 1c 合適，因為權限比較小、保留 3 個月。但比 B2 多一層設定，目前沒有必要。

## 7. 未確認事項

- 帳號降回免費方案後，`settings.workersInvocationsScheduled.enabled` 和 `notOlderThan` 的實際值（要用 Account Analytics Read token 唯讀查一次）。
- `workersInvocationsScheduled` 的資料延遲，以及 `status` 有哪些值；`ctx.waitUntil` 裡的 promise 被拒絕時會不會反映在 `status`。
- D1 的 `ON CONFLICT DO UPDATE … WHERE` 條件不成立時，`meta.rows_written` 是 0 還是 1。要在測試用 D1 或本機 `wrangler dev` 看 `meta` 才知道。本機和正式算法是否一樣也沒有文件。
- 正式 Worker 現在有沒有設 `CLOUDFLARE_API_TOKEN`／`CLOUDFLARE_ACCOUNT_ID`（`docs/adr/README.md:41-42`）。
- Analytics Engine 的寫入到能查到之間延遲多久（官方沒寫）。
