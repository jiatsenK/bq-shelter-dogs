# 排程心跳寫入：沒工作也每 10 分鐘寫一列（稽核第 8 項）

2026-10-27。問題：D1 效率稽核第 8 項指出，寫回重試沒工作時也寫一列 `cron_retry`，跟 ADR 0018「沒有就直接結束」不一致（`claude/d1-efficiency-audit` 分支 `docs/research/2026-10-27-d1-efficiency-audit.md:144-148`、`:183`）。這是 bug、該改，還是文件沒跟上？

本次只讀程式、文件與官方文件，沒有部署、沒有查正式環境。

## 結論先講

- **不是意外，是 K 在 2026-10-26 明確選的。** PR #601（`c80b88c`）的紀錄寫：比較過「每次都寫／每小時一次／問 Cloudflare GraphQL」後，K 選每次都寫，理由是永遠只更新同 3 列、約免費額度 0.15%（`docs/agent-log/2026-10-26-cron-limit-status.md` 「例外與注意」第 1 點；比較見 `docs/research/2026-10-26-cron-liveness-without-writes.md` 第 5、6 節）。
- **真正的缺口是 ADR 0018 沒記這個決策。** 第 2 點仍寫「沒有就直接結束」（`docs/adr/0018-today-walks-d1-event-sync.md:10`），第 7 點的修訂註記只講排程數與垃圾桶（同檔 `:18`），沒提心跳。`ARCHITECTURE_NOW.md:42` 已寫「寫回重試每 10 分鐘寫這一列」。
- **建議：維持現狀，在 ADR 0018 第 2 點補一句修訂註記**，並順手修兩處過時註解。量很小，不值得為它改程式或加權限。

## 現況（程式）

- `worker/src/cron-status.js:8-24`：`recordRun` 呼叫工作，回傳 `false`（功能沒開）才不記；其他情況成功記 `okAt`、失敗記 `failAt`，用一句 `INSERT … ON CONFLICT DO UPDATE … json_patch` upsert `v3_sync_state` 的 `cron_<工作>`。第 4 行註解已寫「一天約 144 列寫入」。
- `worker/src/walk-retry.js:15-36`：`retryWalks` 沒工作時照樣跑 3 句 SELECT 後回傳 `undefined`，所以 `recordRun` 會寫。
- `worker/src/index.js:788-800`：`scheduled` 把三件工作都包在 `recordRun` 裡。
- 排程：正式 `wrangler.jsonc:40` 為 `5-59/10 * * * *`（重試）與 `23 1,5,15 * * *`（保險掃描）；測試網站 `wrangler.test-site.jsonc:38` 只有重試。
- 過時註解：`worker/src/index.js:25` 寫「沒工作就只查一次 D1」，實際是 3 讀 1 寫（稽核文件 `:184` 也指出）；`docs/ARCHITECTURE_NOW.md:42` 的保險掃描時間還寫 `53 1,5,15`，跟 `wrangler.jsonc:40` 的 `23` 不一致。

## 誰在讀心跳

- 只有管理網站。`worker/src/admin/checks.js:58-78` 的 `readCronStatus` 一次 SELECT 3 列；過期門檻寫回重試 40 分鐘、保險掃描 13 小時、垃圾桶 32 天（`:60`）。
- API：`worker/src/admin/index.js:114` `GET /api/manage/cron-status`；前端 `admin/public/js/api.js:14`、`admin/public/js/checks.js:96-125`、`admin/public/js/data-checks.js:56-66` 在「資料檢查」頁的「排程」卡片顯示最後跑完時間、最近失敗、是否過期。
- 沒有自動告警，也沒有志工網站讀它；只在管理者打開頁面時讀。

## 官方文件

- D1 免費方案：每天寫入 10 萬列，UTC 00:00 重置；用完當天不能查詢 D1。INSERT／UPDATE／DELETE 每影響一列算一列，寫到有索引的欄位多算一列。<https://developers.cloudflare.com/d1/platform/pricing/>（2026-10-27 讀）
- Cron Triggers 後台「Trigger Events → View events」只留最近 100 次；要更久、可篩選要用 Workers Logs；程式要讀走 GraphQL Analytics API。新建或改名的 Worker 最多 30 分鐘才出現。<https://developers.cloudflare.com/workers/configuration/cron-triggers/>（2026-10-27 讀）
- 其他替代做法（`workersInvocationsScheduled`、Workers Logs 計費與權限、Analytics Engine 額度）昨天已整理過並附官方網址，這裡不重抄：`docs/research/2026-10-26-cron-liveness-without-writes.md` 第 1 節。重點：
  - Workers Logs 要開 `observability` 並部署，查詢 API 要 Workers Observability **Write** 權限（<https://developers.cloudflare.com/workers/observability/logs/workers-logs/>、<https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/>）。稽核也發現目前沒開（稽核文件 `:189`）。
  - Analytics Engine 免費每天 10 萬個資料點、目前不收費、保留 3 個月（<https://developers.cloudflare.com/analytics/analytics-engine/pricing/>、<https://developers.cloudflare.com/analytics/analytics-engine/limits/>）。
  - GraphQL 的 `workersInvocationsScheduled` 沒有官方文件；稽核時查到是空的（稽核文件 `:193`），不能當唯一來源。

## 量級（粗估）

- 寫回重試：一天 144 次。保險掃描 3 次，垃圾桶每月 1 次。
- 正式：約 147 列／天、約 4,400 列／月。測試網站也有重試排程（稽核實測 10/27 下午已 84 列），約 144 列／天。兩邊共用帳號額度，合計約 290 列／天、約 8,700 列／月，占每天 10 萬列的約 0.3%。
- 10/24–10/26 是測試人員流量，心跳又是 10/26 晚上才開始，所以「心跳占當天總寫入幾成」要用 10/27 之後的資料算；心跳本身是固定量，跟使用量無關。

## 選項

| 做法 | D1 寫入／月（正式＋測試） | 優點 | 缺點 | 對管理網站 |
|---|---|---|---|---|
| A. 維持現狀，補 ADR 修訂註記 | ~8,700 | 不改程式；看得到每 10 分鐘有沒有跑；K 已選過 | 跟原設計「沒事不寫」不同，要寫清楚例外 | 不變 |
| B. 只在有工作或失敗時寫 | 閒時 0 | 符合 ADR 原文 | 分不出「沒跑」和「沒工作」，排程卡片會常顯示過期；`retryWalks` 要改回傳值 | 過期判斷失效，要另找存活來源 |
| C. 每小時寫一次（依 `scheduledTime` 分鐘數，失敗一律寫） | ~1,500 | 降約 83%；不用新權限 | 粒度 1 小時；要改程式與測試、門檻放寬到約 2 小時 10 分 | 門檻改值，顯示時間最多晚 1 小時 |
| D. 改寫 Analytics Engine | 0 | 不佔 D1；保留 3 個月 | 新綁定；管理 Worker 要加讀分析的 token，打破「沒有機器憑證」（`wrangler.admin.jsonc:1`） | 改讀 SQL API |
| E. 改用 Cloudflare 內建紀錄（Workers Logs／GraphQL） | 0 | 零寫入；看得到 CPU 超限、平台沒觸發 | Logs 要開 observability、Write 權限；GraphQL 資料集沒文件、會空 | 改讀外部 API，讀不到時要另外顯示 |

## 建議

**選 A。** 每月約 8,700 列、0.3% 額度，跟稽核其他項目比是最小的一項；而且是 K 知情選過的取捨，改掉等於推翻 10/26 的決定。要做的事：

1. ADR 0018 第 2 點後加一句修訂註記：寫回重試沒工作時仍記一列跑完時間給管理網站判斷排程有沒有在跑（K 2026-10-26，#601）。**只記決策，不寫列數或百分比。**
2. 修 `worker/src/index.js:25` 註解（3 讀 1 寫）與 `docs/ARCHITECTURE_NOW.md:42` 的排程時間。

如果之後寫入額度變緊，再改 C（最便宜、不用權限）；B 單獨用不夠，D／E 要 K 同意給管理 Worker token。

## 未確認

- 測試網站的心跳是否真的有人看；如果測試站排程卡片沒人用，可以只讓正式站寫，測試站省一半。
- D1 upsert 更新同一列時是否算 1 列（官方只說「每影響一列算一列」，`key` 是主鍵、只改 `value`，推論是 1 列）。
