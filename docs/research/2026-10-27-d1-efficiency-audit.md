# D1 讀寫效率稽核（2026-10-27）

- 對象：main `14b476b`。唯讀稽核：沒有改程式、資料庫或設定，沒有部署，也沒有開 Issue。
- 資料來源：
  - Cloudflare GraphQL Analytics：`d1AnalyticsAdaptiveGroups`、`d1QueriesAdaptiveGroups`（Query Insights）、`workersInvocationsAdaptive`。
  - `wrangler tail` 即時日誌 4 分鐘。
  - K 在 PowerShell 跑的 5 句唯讀 SELECT。
  - 程式碼與本機 SQLite（照 `db/compact-schema.sql` 建庫）的量測：
    - 子任務一：讀取路徑。
    - 子任務二：寫入路徑。
    - 子任務三：SQL 查詢計畫。
- 標記：〔實測〕是 Cloudflare 或正式庫的數字；〔本機〕是本機 SQLite 量的；〔推估〕是照程式碼推出來的。
- 時間都是台灣時間。

## 結論

- 用量離免費額度很遠。10/27 到 13:40，D1 讀 45,904 列（每天上限 500 萬，約 0.9%），寫 1,594 列（上限 10 萬，約 1.6%）。
- 10/27 是第一天有真的志工在用。10/24–10/26 的流量都是測試人員（K 2026-10-27 說明），只能當參考，不能拿來當平常的用量。
- 最大的消耗是在所資料包重算，占 10/27 那段時間讀取的 56%。其次依序是：
  - 寫回流程本身多寫的列。
  - 身分查詢每次整張掃。
  - 管理網站狗表一次讀很多列。

## 實測數字（10/27 10:00–13:30）

| 日期 | D1 查詢 | 讀取列 | 寫入列 | 查詢 P90 最高 | Worker 請求 | 錯誤 | CPU 合計 | CPU P99 最高 |
|---|---|---|---|---|---|---|---|---|
| 10/24（測試） | 34 | 1,106 | 0 | 7.5 ms | 63 | 0 | 0.09 秒 | 13 ms |
| 10/25（測試） | 104 | 431 | 0 | 1.6 ms | 39 | 0 | 0.13 秒 | 18 ms |
| 10/26（測試） | 149 | 1,600 | 1 | 1.7 ms | 51 | 0 | 0.24 秒 | 21 ms |
| **10/27** | **2,808** | **33,865** | **1,498** | 1.6 ms | **489** | 0（另有 3 次使用者中途斷線） | 2.6 秒 | 33 ms |

- 高峰在 11:30–11:45：15 分鐘內讀 11,236 列、寫入查詢 191 次。
- 使用人數〔實測，正式庫 SELECT〕：10/27 有 6 位溜狗人、34 隻狗，`v3_walks` 共 37 筆，`v3_walk_outbox` 有 40 筆工作。
  - 10/24 有 12 筆工作（3 隻狗），10/26 有 6 筆（1 隻）。`v3_walks` 這三天沒有資料，所以溜狗人數不知道。
- 平均到每次操作〔實測總量 ÷ 實際筆數，含共用消耗〕：

  | 單位 | 查詢次數 | 讀取列數 | 寫入列數 |
  |---|---|---|---|
  | 每筆寫回工作 | 約 69 | 約 872 | 約 40 |
  | 每位溜狗人 | 約 463 | 約 5,810 | 約 268 |

- `INSERT INTO v3_walk_outbox` 執行了 85 次，表裡只有 40 列。差的那 45 次原因不明，現有資料判斷不了。

讀取量的來源〔照 SQL 文字對回程式歸類；歸類是推估〕：

| 來源 | 讀取占比 | 備註 |
|---|---|---|
| 在所資料包重算 | 56% | |
| 身分、常溜、名單 | 18% | |
| 管理網站狗表 | 9% | |
| GAS 狗清單 | 9% | |
| 溜狗登記＋寫回 | 5% | 占查詢次數 50%、寫入 89% |
| 輪詢 `/today` | 0.4% | 136 次 |
| 排程 | 約 0% | |

10/24–10/27 都沒有寫回失敗的重試。

## 問題清單（依影響排序）

### 1. 在所資料包太常失效，同時進來的請求還會各自重算

- 位置：
  - `worker/src/packs.js:88`（`smallPack`）→ `worker/src/compact.js:19`（`readDogsPayload`）。
  - 呼叫路徑：`GET /api/dogs`、`GET /api/rest` → `readSmall`。
- 證據：
  - 〔實測〕10/27 11 時，`compact.js:22` 那句主清單 JOIN 跑了 36 次、讀 16,524 列，占那段時間讀取量的 47%。同一小時 GAS 狗清單送了 12 批。
  - 〔實測，正式庫〕`v3_pack_versions.small` 是 1439，`v3_packs` 的 main 存的是 1417（31,213 字元），落後 22 版。版本對不上時，每台還沒快取的 Worker 機器讀一次就要整份重算。
- 根本原因〔程式碼確認〕：
  - 觸發器 `db/compact-schema.sql:400`（`packs_v3_sheet_main_UPDATE`）監看 `walked_date`、`walker_codes`。GAS 狗清單只要送「溜過了」，資料包就失效。ADR 0018 之後，今天溜狗的正本已經是 `v3_walk_pack`，這兩欄不需要讓 small 失效。
  - `smallPack` 要等重算完才寫進記憶體快取。同一台機器上 `/dogs` 和 `/rest` 同時進來時，兩個都會重算。
- 還沒確定：落後 22 版，是「存檔失敗」還是「存了之後又失效」。
  - 支持存檔失敗：10/27 Query Insights 裡 `INSERT INTO v3_packs` 是 0 次（10/26 有 12 次），08 時有 16 次 DELETE、0 次 INSERT。
  - 支持又失效：〔本機〕116 隻狗的資料包存檔正常；而且 Query Insights 對 batch 裡的語句只記一部分。
  - 要開 Workers Logs 才能確定：`savePack` 存檔失敗時會寫 `console.error('pack', …)`。
- 改善方式：
  - 把溜狗日期和代號從 small 拆出去，另外給一個版本號。
  - 正在重算時，讓其他請求共用同一份結果，不要各自重算。
- 預期效益：每次失效從約 900–1,600 列降到約 120 列〔推估〕。
- 風險：要改觸發器並新增 migration；ADR 0009／0014 和 `worker/test/packs.test.mjs` 要一起改。

### 2. 網站登記過的狗，保險掃描用一樣的內容刪掉再寫一次

- 位置：
  - `worker/src/dog-list.js:55-61`（`walkDay`）。
  - 呼叫路徑：GAS `dogListScan` → `/api/walk-writeback/dog-list` → `applyMain`（`dog-list.js:96`）。
- 證據〔本機〕：網站登記 10 隻狗之後，掃描約寫 152 列，`v3_walks` 內容前後完全一樣。
- 根本原因：網站登記沒有更新 `v3_sheet_main.walked_date`，試算表指紋（`apps-script/sheet-write.gs:520`）就變了；`walkDay` 又不比對內容，一律先 DELETE 再 INSERT。
- 改善方式：寫入前先讀那天現有的代號，一樣就跳過。
- 預期效益：每次登記約省 15 列，資料包也少失效一次。
- 風險：很低。

### 3. 每次按溜了，流程本身的寫入約占 6–7 成

- 位置：
  - `worker/src/walk-accept.js:173-185`（登記）、`:227-236`（派送）、`:320-328`（確認）、`:52-60`（預算）。
  - `v3_walk_outbox` 的 11 個索引：`db/compact-schema.sql:39-53`。
- 證據：
  - 〔實測〕10/27 `DELETE FROM v3_walk_guard` 跑了 109 次、寫 182 列。
  - 〔本機〕1 人溜 1 隻，從登記到寫回約寫 55 列，真正的業務資料約 15–20 列。
  - 〔本機〕`v3_walk_outbox_readback` 沒有任何查詢用到；三個 `unknown*` 索引可以合成一個（`walk-accept.js:406-408`）。
- 改善方式：
  - guard 改成條件不成立時讓整個 batch 失敗，不寫入任何列。
  - 刪掉沒用到的索引，合併重複的索引。
- 預期效益：每次登記從約 55 列降到約 35–40 列〔推估〕。
- 風險：這是鎖定的寫回協定（#456／#498），要 K 同意。

### 4. 身分查詢一次 4 句，還整張掃名字表

- 位置：
  - `worker/src/identity.js:9-21`（`identityByCode`、`identityOf`）。
  - 前端切回網頁時會同步常溜，沒有節流：`public/js/app.js:1314` → `public/js/favorites.js:108`。
- 證據：
  - 〔實測〕`identity.js:19` 在 10/27 跑了 72 次、讀 1,517 列，每次都是整張表；`v3_identity_redirects` 被查了 184 次。
  - 〔查詢計畫〕`SCAN v3_identity_names`。
- 改善方式：
  - 新增索引 `v3_identity_names(volunteer_id, code)`，查詢計畫會變成 `SEARCH … (volunteer_id=?)`。
  - 把 4 句合成 1 句。
  - 切回網頁時，距離上次同步不到 10 分鐘就不重抓。
- 預期效益：切回網頁時的查詢約少 80–90%〔推估〕。
- 風險：跨裝置同步常溜最多慢 10 分鐘。

### 5. 管理網站狗表一次讀約 890 列

- 位置：`worker/src/admin/dogs.js:6`（`readManageDogs`）。
- 證據〔實測〕：10/26 跑了 61 次、讀約 5.7 萬列，占那天 61%（測試期間）；10/27 跑了 3 次、3,090 列。
- 改善方式：跟著 small 的版本號做快取。

### 6. 寫回失敗時重試沒有上限，會吃掉每天的溜狗預算〔推估；10/24–10/27 實測沒有發生〕

- 位置：`worker/src/walk-accept.js:286-295`（退避時間）、`:205`、`:228`（每次預留 96 列）；`worker/src/walk-retry.js:15-36`。
- 根本原因：試算表明確拒絕也照樣重試，沒有次數上限。每次預留 96 列，實際只寫約 24 列〔本機〕。
- 影響：卡住 6 隻以上，就會用完 `SYNC_DAILY_BUDGET`（40,000），之後所有人登記都會失敗。
- 改善方式：試算表明確拒絕就停止重試；設定最多重試次數；重試另設預算上限。

### 7. 保險掃描以 `v3_walk_outbox` 為主整張掃，這張表只增不刪

- 位置：`worker/src/walk-reconcile.js:54`（`scanWalks`）。
- 證據：
  - 〔實測〕10/27 一次讀 110 列，10/24 只有 24 列。
  - 〔查詢計畫〕`SCAN o`。
- 改善方式：改用 `CROSS JOIN`，查詢計畫會變成 `SCAN s; SEARCH o …(dog_key=? AND version=?)`，結果完全相同。

### 8. 排程沒工作也每 10 分鐘寫一列

- 位置：`worker/src/cron-status.js:20`；`worker/src/walk-retry.js` 沒有工作時回傳 `undefined`。
- 證據〔實測〕：10/26 晚上的部署之後開始出現。正式庫每天 144 列，測試庫 10/27 到下午已有 84 列，兩邊共用帳號的額度。
- 跟 ADR 0018「沒有就直接結束」不一致。

### 9. 其他（影響小）

- 編輯一次狗資料，版本號會被觸發器加 2–3 次：`dog_edit_*` 和 `packs_*` 連鎖觸發，見 `compact-schema.sql:472-507`。
- `/departed-cards` 重複讀版本號（`departed.js:29`、`:31`）。
- 重試排程的 3 句 SELECT 可以合成 1 句（`walk-retry.js:18-32`）。
- 新增沒有編號的狗時整張掃 `v3_walks`（`dog-list.js:100`）。
- 保險掃描每次都整張掃一次 `walker IS NULL`（`dog-list.js:251`），但正式庫早就是 0 列。

### 10. 不是程式本身造成的消耗〔實測〕

- 10/24 手動查詢讀了約 2.5 萬列，占當天 21%。
- 10/25 套用 migration 讀了約 2 萬列。
- 調查時建議改用測試庫或備用庫。

## SQL 查詢計畫證據（本機 SQLite，照正式 schema 建庫）

| 位置 | 查詢計畫 | 改寫後 |
|---|---|---|
| `compact.js:22` | `SCAN m`，再逐列查 4 張表 | 見第 1 項 |
| `identity.js:19` | `SCAN v3_identity_names` | 加索引後是 `SEARCH … (volunteer_id=?)` |
| `walk-reconcile.js:54` | `SCAN o` | 改 `CROSS JOIN` 後是 `SCAN s; SEARCH o` |
| `dog-list.js:219`、`:251` | `SCAN m`、`SCAN v3_sheet_main` | 改成只查這一批的 `IN (…)` |
| `dog-list.js:100` | `SCAN w`（`v3_walks`） | 加部分索引 `v3_walks(dog_name) WHERE dog_number=''` |
| `admin/dogs.js:6` | 整份重新計算＋相關子查詢＋暫存排序 | 見第 5 項 |

- 觸發器和 `json_each` 都只碰少數幾列，沒有整張掃描。
- 唯一沒有任何查詢用到的索引：`v3_walk_outbox_readback`。

## 實作跟 ADR 不一致的地方

- ADR 0009 說 small 是「很少變的資料」，但它監看溜狗日期和代號（第 1 項）。
- ADR 0009／0014 的讀取量是用「回傳列數」算的（`scripts/memory-d1.mjs`）。D1 是照「掃描列數」計費，所以 ADR 寫的數字偏低。
- ADR 0018 補充說「掃描取代網站寫入」，實際上兩邊都會寫，是加總（第 2 項）。
- ADR 0018 說「沒有就直接結束」，排程實際上每次都寫心跳（第 8 項）。
- `worker/src/index.js:25` 的註解寫「沒工作就只查一次 D1」，實際上是 3 讀 1 寫。
- `index.js:457` 的註解寫「手機每分鐘抓 `/walkers`」，已經過時：前端現在只有 `/today` 在輪詢。

## 缺口

- Workers Logs 沒開（script settings 的 `observability` 是 null），所以：
  - 沒辦法照路徑或使用者分攤用量。
  - 確定不了第 1 項的原因。
  - Worker 統計資料沒有 HTTP 狀態碼欄位，只看得到 0 次未處理的例外和 3 次使用者中途斷線。
- 排程的執行紀錄（`workersInvocationsScheduled`）是空的，排程次數是推算的。
- 開 Workers Logs 要改正式環境設定，這次沒有動，要 K 決定。

## 重跑方式

- GraphQL 查詢：用 wrangler OAuth 的 token 打 `https://api.cloudflare.com/client/v4/graphql`。
  - 帳號 `a0f88d34c34ad0d34f923b9f43799622`，正式庫 `6cd6c304-0fed-4ddb-b9ec-799e60a4adb4`，Worker 名稱 `bq-shelter-dogs`。
  - 用到的資料集：`d1AnalyticsAdaptiveGroups`（`datetimeHour`、`datetimeFifteenMinutes`）、`d1QueriesAdaptiveGroups`（`query`、`datetimeHour`）、`workersInvocationsAdaptive`。
  - 免費方案查太密集會被限速，等 5 分鐘再查。
- Query Insights 每小時的查詢次數和 D1 Analytics 差不到 1%，但同一個 batch 裡的語句不會每句都記到，用它判斷「有沒有執行某句」要小心。
