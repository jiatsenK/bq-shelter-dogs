# #501 整份重新載入 D1：不用 GitHub Actions 的選項比較

- 日期：2026-10-23（研究代理：Claude Code 研究代理）
- 問題：GitHub Actions 退出試算表同步後，需要一條「整份重新載入」路徑，把 Google 試算表的狗清單（約 200–300 列；分頁：主清單、已出所、常遛狗群）灌進 D1，用於災難復原或首次灌資料。Workers 免費方案每次呼叫 CPU 10 ms。
- 範圍：只讀官方文件（Cloudflare、Google）＋ repo 既有研究；未部署、未實測。官方沒說清楚處標「需實測」。
- 前置研究：`2026-10-22-460-sync-patterns.md`（各平台免費額度）、`2026-10-22-460-cron-cpu-cause.md`（CPU 主因是 D1 往返次數與 JSON 解析，不是單次往返）。本檔不重抄，只補「整份重載」相關的數字。

## 結論

- **最簡單可靠：Apps Script 手動「全部重送」，分批 POST 給 Worker，每批 Worker 只寫差異（選項 7）**。資料主人本來就是試算表、Apps Script 本來就讀得到所有分頁、不需新增 Cloudflare 產品；每批 50 列以內用一次 `db.batch()` 寫入，CPU 預估在 10 ms 內（需實測）。失敗就整個再按一次，冪等。
- **備援（災難時最穩）：K 本機產生 SQL 檔 → `wrangler d1 execute --remote --file`（選項 5）**。完全不吃 Worker CPU 上限，官方檔案上限 5 GiB；缺點是要人在電腦前、要先把試算表轉成 SQL。
- Workflows、Queues、DO alarms、分批 Cron 都「能用」，但對 300 列一次性工作是過度設計：多一個產品要部署與監看，而且每步／每次呼叫仍是 10 ms CPU，問題沒有變小，只是被切開。
- Worker 自己抓 Google（選項 6）可行但不建議當主路：要在 Worker 存 Google 憑證（或把表設成公開才能用 gviz），而且單次解析 300 列＋寫入是否 < 10 ms 需實測。
- 信心：中高。CPU 數字皆為推估，建議先用選項 7 跑一次 300 列實測。

## 1. 官方上限速查（Workers 免費方案，2026-10 讀取）

| 項目 | 數字 | 來源 |
|---|---|---|
| CPU 時間定義 | 處理器執行 Worker 程式碼的時間；**等待 `fetch()`、KV、資料庫查詢不算** | https://developers.cloudflare.com/workers/platform/limits/ |
| 每次呼叫 CPU | HTTP 10 ms、每次 Cron 10 ms | 同上 |
| 子請求 | 每次呼叫 50 | 同上 |
| 記憶體 | 128 MB／isolate | 同上 |
| 時長 | HTTP 無硬上限（客戶端連著）；Cron、DO alarm、Queue consumer 15 分鐘；`waitUntil` 延 30 秒 | 同上 |
| D1 每次呼叫查詢數 | 50（付費 1,000），算入子請求 | https://developers.cloudflare.com/d1/platform/limits/ |
| D1 單句 SQL | 100 KB；綁定參數每句 100 個 | 同上 |
| D1 每日 | 讀 500 萬列、寫 10 萬列；超過即當天報錯到 UTC 0 點；Wrangler／匯入的 INSERT 也算 | https://developers.cloudflare.com/d1/platform/pricing/ |

300 列 × 3 分頁全寫一次 < 1,000 列寫入（另加索引寫入，仍遠低於 10 萬），額度不是問題。

## 2. 逐項比較

### 1) Cloudflare Workflows

- 免費方案：可用。每步 CPU **10 ms**、每步牆鐘時間無限、每步可重試（上限 10,000）、每個 workflow 1,024 步、每實例每請求 50 子請求、步驟結果與事件 payload 上限 1 MiB、同時 100 個實例。來源：https://developers.cloudflare.com/workflows/reference/limits/
- 可靠性：高。步驟結果持久化，失敗只重跑該步，適合「抓表 → 分段寫入」。
- 複雜度：中高。要新增 Workflow 類別與綁定、設計步驟切分（抓 Google 一步、每 50 列寫一步），還要處理 Google 憑證（同選項 6）。注意抓下的整張表若當步驟結果回傳，受 1 MiB 限制（300 列預估遠小於，需實測）。
- 判斷：可行但為一次性工作多養一個產品。

### 2) Queues

- 免費方案：可用。每天 **10,000 次操作**（每 64 KB 讀／寫／刪算一次，重試也算讀），保留 **24 小時不可改**，每批最多 100 則；consumer 時長 15 分鐘。來源：https://developers.cloudflare.com/queues/platform/pricing/ 、https://developers.cloudflare.com/queues/platform/limits/
- CPU：limits 頁寫 consumer 預設 30 秒、可調到 5 分鐘，但未區分免費方案；Workers limits 頁的免費方案 10 ms 是否套用到 consumer **需實測**（保守視為 10 ms）。
- 可靠性：中高（自動重試、死信佇列）。但還是需要一個「生產者」去讀試算表，問題回到選項 6 或 7。
- 複雜度：中。對 6 批訊息的工作來說價值低。

### 3) Durable Objects alarms

- 免費方案：可用，且**免費方案只支援 SQLite 後端 DO**。每天 10 萬次請求（alarm 觸發算請求）、寫 10 萬列、讀 500 萬列；每次 `setAlarm()` 計一列寫入。來源：https://developers.cloudflare.com/durable-objects/platform/pricing/
- CPU：pricing 頁未寫 alarm handler 的 CPU 上限；Workers limits 頁只寫 alarm 時長 15 分鐘。免費方案 alarm 每次是否 10 ms **需實測**。
- 做法：DO 存游標，每次 alarm 處理一段再 `setAlarm()` 下一次。可靠（alarm 失敗會重試）但要自己寫游標狀態機。
- 複雜度：中高。等於手刻一個小型 Workflows。

### 4) 分批 Cron（游標接續）

- 免費方案：可用，帳號 5 個 Cron Trigger，每次 10 ms CPU、50 子請求。來源：https://developers.cloudflare.com/workers/platform/limits/
- 做法：D1 或 KV 存游標與「重載進行中」旗標，每分鐘 Cron 抓一段寫一段。300 列每次 50 列需約 6 分鐘以上。
- 可靠性：中。每次都要重新抓 Google（或先暫存整份到 D1／KV），中途試算表被改會讀到不一致的快照；Cron 數量已被佔用（見 #460）。
- 複雜度：中。旗標、游標、快照一致性都要處理，而且災難復原時要等它跑完。

### 5) R2／D1 import·export／`wrangler d1 execute --file`

- `wrangler d1 execute <db> --remote --file=x.sql`：檔案上限 5 GiB；單句太長會報「Statement too long」需拆 INSERT；要移除 `BEGIN TRANSACTION`／`COMMIT`；表依相依順序匯入。不加 `--remote` 只寫本機資料庫。來源：https://developers.cloudflare.com/d1/best-practices/import-export-data/
- `wrangler d1 export` 可把 D1 匯出成 SQL，適合在改動前做還原點（同頁）。
- 不經 Worker，**不受 10 ms CPU 限制**；匯入的 INSERT 仍算 D1 寫入額度（D1 pricing）。
- R2：import 流程官方說明是經 Wrangler／API 上傳檔案，本專案不需另存 R2。
- 可靠性：高（官方工具、一次交易語意需實測）。複雜度：低到中——需要一支本機腳本把試算表（CSV 下載或 Sheets API）轉成符合現行 schema 的 SQL，且要人在電腦前。
- 判斷：最好的「災難備援」，不適合當日常按鈕。

### 6) Worker 自己讀 Google（Sheets API 或 gviz）

- CPU 定義：等待 `fetch()` 與 D1 查詢**不算** CPU（Workers limits）。算的是：JSON 解析、欄位對應、比對差異、組 SQL、序列化 D1 請求。
- 成本推估（非官方，需實測）：既有 #460 量測顯示本機 116 列純 JS 處理 0.4–0.9 ms，而正式環境 CPU 主因是「D1 往返次數」與每次往返的序列化／解析。300 列 × 3 分頁一次解析大約數 ms；若逐列寫 D1（數百次往返）必爆，若用少數幾次 `db.batch()`（每批 ≤ 50 句以守住每呼叫 50 查詢上限）則**可能**落在 10 ms 邊緣。也就是單次呼叫做完整份，不保證；切成多次呼叫才穩。
- Sheets API：`spreadsheets.values.batchGet` 一次讀多個範圍；讀取配額每專案每分鐘 300 次、每使用者每分鐘 60 次。需要 OAuth 或服務帳號，Worker 要存金鑰並簽 JWT（簽章本身也吃 CPU，需實測）。來源：https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchGet 、https://developers.google.com/workspace/sheets/api/limits
- gviz（Visualization Query）：官方文件是 Google Charts 的資料來源協定，試算表須公開或「知道連結者可看」才能匿名讀，對有志工個資的表不建議；回傳格式非 Sheets API 正式契約。來源：https://developers.google.com/chart/interactive/docs/querylanguage
- 複雜度：中高（憑證管理＋分段）。

### 7) 對照組：Apps Script「全部重送」，分批 POST

- 做法：試算表選單一個手動函式，`getValues()` 一次讀整個分頁（官方建議批次讀寫，見 https://developers.google.com/apps-script/guides/support/best-practices ），每 50 列 `UrlFetchApp.fetch` POST 到 Worker；Worker 驗證共用密鑰後，讀 D1 該批現況、只對有變的列 `db.batch()` upsert。
- Apps Script 配額（免費 Gmail）：單次執行 6 分鐘、UrlFetch 每日 2 萬次。300 列 ÷ 50 = 6 次 POST，遠低於上限。來源：https://developers.google.com/apps-script/guides/services/quotas
- Worker 端每批：解析一個小 JSON（50 列）、1 次 SELECT、1 次 `batch()` 寫入 → 預估數 ms，**需實測**，可再降到 25 列一批換取餘裕。每批 HTTP 呼叫獨立計 10 ms，總量不受限。
- 可靠性：高。冪等（只寫差異、upsert），失敗就重按；Apps Script 可依回應碼重試該批。已出所／常遛狗群分頁同樣分批送；「試算表已刪、D1 仍有」的列需最後一批帶完整 ID 清單讓 Worker 標記（ID 清單 300 個字串，比對成本低，需實測）。
- 複雜度：低。沿用既有 Apps Script 與 Worker 寫入路徑，不需新產品、不需在 Cloudflare 存 Google 憑證。

## 3. 總表

| 選項 | 免費可用 | CPU／時間 | 可靠性 | 複雜度 |
|---|---|---|---|---|
| 1 Workflows | 可 | 每步 10 ms，步數 1,024 | 高 | 中高 |
| 2 Queues | 可（1 萬操作／天） | consumer CPU 免費方案需實測 | 中高 | 中 |
| 3 DO alarms | 可（僅 SQLite DO） | alarm CPU 免費方案需實測 | 中高 | 中高 |
| 4 分批 Cron | 可（5 個 Cron） | 每次 10 ms，需數分鐘 | 中 | 中 |
| 5 wrangler `--file` | 可 | 不經 Worker | 高 | 低中（需人在本機） |
| 6 Worker 讀 Google | 可 | 單次整份可能超 10 ms，需實測 | 中 | 中高 |
| 7 Apps Script 分批 POST | 可 | 每批獨立 10 ms，預估足夠 | 高 | 低 |

## 4. 建議

主路用 **選項 7**：最少新東西、資料主人直接推、每批 CPU 小且可重按，符合「不管控只要可還原」。備援保留 **選項 5**：先 `wrangler d1 export` 留還原點，必要時本機產 SQL 匯入，完全繞開 CPU 上限。

建議下一步：
1. 用 `wrangler dev` 或正式環境跑一次 50 列批次，看 CPU（觀測頁 CPU time）是否 < 5 ms；超過就降到 25 列。
2. 決定刪除語意（試算表沒有的狗在 D1 要標記還是刪除），寫進 ADR。
