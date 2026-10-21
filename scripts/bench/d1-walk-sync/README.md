# #441 丟棄式量測工具

分支 `prototype/d1-walk-sync`。第 1 步已完成 Google 20 筆與 Cloudflare 部分原型量測，見[實測報告](../../../docs/research/2026-10-21-d1-walk-sync-measurements.md)。仍不能視為完整驗收或直接決定 ADR 0017、寬限期與 Cron 頻率。不變更正式 Worker、D1 schema、試算表寫入程式。

## K 先準備的 Google 複本

1. 複製試算表，命名為 `BENCH441 今日溜狗測試`。保留「主清單」欄位順序、表頭位置和大致列數；可改成假名字。請勿把複本接到正式網站。
2. 在複本的「擴充功能 → Apps Script」打開它自己的專案。若有複製過來的程式或觸發器，先確認它們不會呼叫正式服務；測試專案只保留下一步產生的程式。勿修改正式專案。
3. 在本分支根目錄執行下列指令。將產生的 `generated-test-only.gs` 整份貼進測試專案。這份檔案已忽略，不提交；是原 `apps-script/sheet-write.gs` 加測試防護與只記錄事件的 `notifyWorker`。

```powershell
Set-Location C:\Users\User\repos\bq-shelter-dogs\.scratch\issue-441
Test-Path scripts/bench/d1-walk-sync/build-gas.mjs
node scripts/bench/d1-walk-sync/build-gas.mjs
```

4. 測試專案「專案設定 → 指令碼屬性」設定：`SHEET_ID` 與 `PROTOTYPE_SHEET_ID` 都填**複本 ID**，`WRITE_KEY` 填一組測試專用金鑰。金鑰留在本機，不貼到 Issue 或聊天。時區設台北。不要設定正式的 `NOTIFY_URL`／`NOTIFY_KEY`。
5. 另建「網頁應用程式」部署，執行身分選自己，存取選所有人。提供複本網址與這個測試部署的 `/exec` 網址。程式會要求試算表名稱以 `BENCH441` 開頭；這是防誤用，不能取代人工核對複本 ID。
6. gviz 必須可在未登入狀態讀取，和現有 Worker 一樣。若需要開放讀取，先將複本資料匿名化，再設定測試複本的讀取權限。不要為了量測改正式表權限。
7. 在**測試專案**新增安裝型「試算表／變更時」觸發器，函式選 `notifyWorker`。它目前只在執行紀錄記時間與 `changeType`，不通知任何 Worker。Cloudflare 通知 CPU 已由獨立 HTTP 呼叫探測，尚未連接 Apps Script 的端到端通知。

Google 授權與部署由 K 操作；不需把正式金鑰交給工具。官方說明：[Web Apps](https://developers.google.com/apps-script/guides/web)、[Installable Triggers](https://developers.google.com/apps-script/guides/triggers/installable)。程式呼叫不會觸發安裝型觸發器，排序、貼上、復原是否產生事件仍須實際操作，不能由這份工具的 doPost 模擬。

## 寫入與 gviz 可見時間

選複本中一隻有編號的狗，確認「編號、犬名、遛狗日期、誰遛的」分別在哪些欄。先設定這些環境變數；下面僅示範欄位格式，**不是正式表的欄位位置**。

```powershell
$env:BENCH_SHEET_ID = '填測試複本ID'
$env:BENCH_WRITE_URL = '填測試部署exec網址'
$env:BENCH_DOG_ID = '填測試狗編號'
$env:BENCH_DOG_NAME = '填測試狗犬名'
$env:BENCH_COLUMNS = 'B,C,D,E'
$testKeyInput = Read-Host '測試 WRITE_KEY' -AsSecureString
$env:BENCH_WRITE_KEY = [System.Net.NetworkCredential]::new('', $testKeyInput).Password
try {
  node scripts/bench/d1-walk-sync/sheet-latency.mjs
} finally {
  Remove-Item Env:BENCH_WRITE_KEY -ErrorAction SilentlyContinue
}
```

每次會在複本的兩個允許欄位登記一個唯一 `BENCH441_…` 名字；不自動清除，避免清掉同時測試者的資料。多次執行會累積名字，請在下一組測試前由 K 在複本清理測試列。每次結果一行 JSON，可另存忽略的 `.jsonl`，確認無個資後再整理進實測表。

- `postMs`：客戶端送出 POST 到收到成功結果，含網路／Google 等待；不是 Apps Script 純執行時間，更不是 Worker CPU。
- 測試防護會多讀試算表名稱，報告須標示這個額外成本；這是受防護測試路徑的延遲，不能宣稱和正式 doPost 完全相同。
- `firstVisibleResponseMs`：從 POST 開始到第一次收到含標記的 gviz 回應。
- `lastAbsentResponseMs`：最後一次收到未含標記的回應時間；可能是更早產生的快照，不能當成伺服器資料可見時間的下界。第一次輪詢就成功時為 null，不能聲稱 gviz 延遲為零。
- 網路／解碼／身分檢查失敗會輸出一筆 `failed` JSON 與階段。POST 失敗時寫入結果可能未知，先以 marker 查複本，不能直接重送。
- 固定 URL、每次選同四欄，不加 cache-busting 參數。每 2 秒讀一次，單次請求最多等 30 秒；整組輪詢名義期限 180 秒，最後一個請求可能跨過期限。超時或請求失敗不能視為已量到延遲上限。

## 尚待完成的實測

| 項目 | 所需證據 | 狀態 |
|---|---|---|
| doPost 與 gviz 延遲 | 至少 20 組原始樣本、日期、複本結構、觀測最大值及失敗數；上限為樣本觀測範圍，不是服務保證 | 20 筆序列樣本完成；人工修改後的可見延遲未測 |
| 排序、多格貼上、Ctrl+Z | 人工動作時間與執行紀錄 `receivedAt`／`changeType` 配對，每項多次；沒事件也記錄 | K 回報三項都有，原始紀錄待補 |
| Cloudflare Cron／通知 CPU | 隔離 Worker 版本、Cron 事件及通知請求的 Cloudflare CPU 原始資料；冷啟動須有 isolate 證據，不能拿新 URL 當冷啟動 | 已取得通知與 Cron CPU；首次 handler 有識別，未保證所有平台啟動成本 |
| 10 支手機每分鐘讀、同狗並行寫 | 10 個獨立客戶端＋隔離 D1＋候選同步邏輯，讀回名字聯集、pending、三方合併與重試狀態 | 十個邏輯客戶端的 D1 先寫、背景加名寫回及真實 Cron 恢復通過；三方合併／整格替換未做 |
| 免費額度 | 實際 D1 rows_read／rows_written（含索引、觸發器、重試）與 Workers 請求／CPU；估算要另標假設與帳號其他用量 | 單次成本已測；全帳號與正式全今日清單仍未驗證 |

repo 的測試 D1 設定 `wrangler.preview-db.jsonc`，ID 為 `9e23a65c-c9dd-4f83-ad9c-2e01626910f0`；只在此庫使用 `schema.sql` 的兩張 `bench441_` 表及 run ID，不清庫。不要直接部署現有 `wrangler.preview.json`，它含非本票服務設定。

## Cloudflare 原型工具與重跑界線

- `worker.mjs`：加密驗證 header、到期防護、四欄雜湊快照比對、D1 原子加名／pending、既有測試 GAS 背景加名與 Cron 重試。這不是正式整格替換／三方合併。
- `schema.sql`：只建立兩張原型表，不帶刪除或正式表操作。原型分支不合併 main，不把這些表加進正式 compact-schema。
- `wrangler.jsonc`：固定測試帳號、測試 D1、獨立 Worker 名稱。預設 `EXPIRES_AT=0` 且無 Cron，直接部署會處於停用狀態。實測時使用忽略的 `deploy.generated.json` 設定有限期限與暫時 Cron；不能把正式資源綁進來。
- `probe.mjs`：20 次序列通知探測；`load.mjs`：十人同狗並行＋三輪每分鐘十讀＋Sheet 聯集；`deferred.mjs`：未派送的 pending＋同名重送＋等待真實 Cron 恢復。它們使用 `BENCH_WORKER_URL` 與本機環境變數 `BENCH_WRITE_KEY`，不在命令列帶金鑰。
- `read-tail.mjs`：從本機即時事件移除 request 資訊，只保留白名單診斷；`summarize.mjs`：核對本次探測／聯集／Cron 恢復證據，再產生研究證據 JSON。它是本次 run 的整理器，版本 ID 與檔名固定；重跑須更新來源，不能直接覆蓋歷史證據。
- 使用 `wrangler tail --format json` 收原始事件時先遮蔽 `X-Bench-Key`，只放忽略檔；不提交 request headers、IP 或 request.cf。正式證據使用白名單轉出的 JSON。
- 本次已關閉 Cron 並以到期設定停用 HTTP 作業，正確金鑰也只會得到 410。重跑前須再次核對授權目標、schema、金鑰與期限；先 `wrangler deploy --dry-run`，再用 `--secrets-file` 的忽略暫存檔部署。部署後刪明文暫存，測完移除排程並到期停用，API 讀回確認。

第 1 步所有實測完成前，#441 仍維持未完成。接著才由 K 確認 ADR，依票內第 2、3 步決定規格與子票。

## 版本快取／預算追加驗證

[快取／預算報告](../../../docs/research/2026-10-21-d1-walk-cache-budget.md)及[原始選取證據](../../../docs/research/2026-10-21-d1-walk-cache-evidence.json)。

- `cache-schema.sql`／`cache-seed.sql` 只在測試 D1 建兩張專屬表與版本觸發器，200 筆假資料分兩批，每批 100 個 INSERT。每批實測寫 300 列，不能把整份 600 列寫入當作低於 500 的單批。
- `cache-meter.mjs` 匯入原 `readTodayWalks`，只以 SQL allowlist 導向測試表，使用 ALS 分別記每請求 metadata；正式檔案不改。此測試原型的今天日期固定 2026-10-21，不能跨日期直接重跑冒充今天。
- `cache-load.mjs load` 在第 0、1、2 分鐘各 30 個邏輯客戶端讀取，中間另加 30 次登記後立即驗證。登記啟用 `cacheExercise`，會把 pending 與測試 today 更新放進同一 batch。
- `cache-load.mjs clear`／`restore` 需要先由連接器精確讀回測試格、確認編號與備份，再完成明確的測試複本改值。工具只發通知及驗證，不能拿它代替 Apps Script 觸發器的端到端驗收。
- `cache-load.mjs cold` 在正常測試後獨立強制 30 次資料快取 miss，不等同新 isolate。`read-tail.mjs cache` 寫另一份白名單紀錄，避免覆蓋前輪原始日誌。
- `cache-summarize.mjs` 根據本次固定檔名、版本及帳號聚合日誌產生證據；只適用本次 run，重跑須保留歷史證據並更換來源／輸出。
- 三組資料正確性驗證已通過，成本是命中 1 列、miss 201 列。200 列全 miss 的全天情境會超出免費額度，CPU 最大分組 P99 10.591 ms 也高於 10 ms；報告沒有將短時段命中率或 HTTP 成功當免費方案過關。測完再次到期停用，API 已核對回 410。
