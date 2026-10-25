# 活動紀錄、資料檢查與更新紀錄（#567）

2026-10-26。基準 main `8d62135`（含 #564–#566）。依 #562、#567、ADR 0020（草稿 PR #584）。沒有新增 migration、資料表或排程。

## 活動紀錄 `activities.html`

- 資料：沿用 `v3_activities`／`v3_activity_dogs`、`worker/src/activities.js` 的 `cleanActivity`（日期、兩種類型、最多 60 隻、名字長度）、`resolveDogs`（編號／永久 ID 對狗，名字照存不猜）與 revision 條件寫入。不匯入第二份、不建新表。
- API：GET／POST `/api/manage/activities`、PUT／DELETE `/api/manage/activities/{id}`。寫入要同來源、JSON、最多 16000 bytes；改／刪必帶 revision，過期回 409，讀完到寫入之間被刪回 404。
- 紀錄：每次增修刪在同一個 D1 batch 寫 `v3_edit_log`（editor_name「管理者」、kind `activity`，內容同志工端 `activityLog`）與 `v3_dog_edit_actors`（Access subject／email、source `access`）。紀錄寫不進去整批回復，活動不會改了卻沒紀錄。紀錄條件綁 revision，別人先改了不留假紀錄。志工端活動 API 行為不變（仍事後記）。
- 未對應名字（`dog_id` NULL）原樣保留、標示「未對應」；管理端加狗只接受明確對上的狗（完整選單標籤、編號，或唯一同名），不做名字合併。
- 開關：管理者不受 `showActivities`／`editActivity` 限制；頁面上方顯示志工網站目前狀態。志工端隱藏與編輯關閉沿用 #565，未改。
- 成本：載入 = 活動清單（版本號 1 列，沒變用 Worker 記憶體）＋狗清單（同狗資料頁，1 SELECT＋R2 清單）＋設定 1 列。新增 = 1 batch（活動 1＋出席 N＋紀錄 2 列）；修改 = 先讀 1 次＋1 batch；搜尋、篩選 0 次 API。

### 四場活動（待 K 核對）

本票沒有連正式 D1。K 說的「目前四場」無法從 repo、Issue 或 fixture 證實，測試資料不是證據。合併前請 K 在 PowerShell 唯讀查詢：

```powershell
npx.cmd wrangler d1 execute bq-shelter-dogs --remote --command "SELECT a.activity_id, a.activity_date, a.kind, a.revision, COUNT(d.position) AS dogs, SUM(d.dog_id IS NULL) AS unmatched FROM v3_activities a LEFT JOIN v3_activity_dogs d USING(activity_id) GROUP BY a.activity_id ORDER BY a.activity_date"
```

核對日期、類型、出席隻數與未對應數。不足四場、重複或內容不同時先列差異，不用管理頁自動補登或合併。

## 資料檢查 `checks.html`

- 主清單資料完整度：沿用志工 `dataCompleteness` 規則（沒有編號、編號看不出入所日期、沒有溜狗日期、沒有性別、沒有入所介紹、沒有照片），只算主清單上的狗；資料用 `/api/manage/dogs`（多回 `walkedDate`，同一個 SELECT）。照片看 D1 照片引用／R2 清單，命名為「沒有照片紀錄」，不逐張 HEAD 下載；沒有實物巡檢。
- 網站有、試算表沒有（#518）：GET `/api/manage/data-checks` 只讀 `v3_sync_state` 的 `dog_list_extra`，主清單／已出所的鍵各用最多 ceil(N/90) 個 SELECT 對回狗名、籠位、永久 ID（最多顯示 200 筆）。不刪狗、不記離所、不合併。
- 狀態分開：讀取失敗（API 錯）、讀不懂（紀錄壞掉）、從未掃描、過期（最後掃描超過 24 小時）、正常。前兩者明說「不代表沒有差異／缺漏」。
- 掃描時間：`scanDogList` 每次掃描都把 `checkedAt` 寫進 `dog_list_extra`（`at` 仍只在清單變動時換）。一天三次、每次 1 列，取代原本「指紋一樣就不寫 D1」。志工 Worker 部署前的舊格式沒有 `checkedAt`，頁面顯示「掃描時間還沒記錄」並視為無法確認是否過期。

## 更新紀錄 `updates.html`

- 網站更新：建置時把 `public/website-updates.json` 複製到 `admin/public/shared/`，管理頁唯讀顯示；不存 D1。
- 資料編輯：GET `/api/manage/edits`，參數白名單 `q`（操作者、編號、狗名、改前改後文字，`%`／`_` 視為文字）、`kind`（`KIND_LABELS`）、`dog`（編號、舊編號、永久 ID 或狗名）、`actor`（名字或管理者 email）、`source`（access／volunteer／legacy）、`from`／`to`（台灣日期）、`order`（newest／oldest）、`page`、`size`（25／50／100）；未知參數或超過 100 字回 400。
- 查詢在 D1 涵蓋整張 `v3_edit_log`，每次固定 2 個查詢（COUNT＋一頁，超出頁數時多 1 次取最後一頁）。沒有索引可用時讀取量上限約為紀錄列數 × 2；文字輸入 300 ms 節流。
- 管理者 email 只出現在管理 API；志工 `/api/edits` 仍只回 editorName「管理者」與來源，不含 Access 身分（測試覆蓋）。
- 改前／改後文字沿用志工編輯紀錄頁的 `editsValue`（抽到 `public/js/edit-values.js`，兩站共用）。

## 正式步驟（待 K）

1. 審查草稿 PR，確認兩站共用模組的變動（`worker/src/activities.js`、`worker/src/dog-list.js`、`public/js/edits.js`／`edit-values.js`）。
2. 無 migration。合併後志工 Worker 照既有流程部署（掃描時間才開始記）；管理 Worker 沒有自動部署，K 用管理站設定手動 `npx.cmd wrangler deploy -c <管理站設定>`。
3. 登入管理站驗收：三頁可開、活動用一場測試活動新增→修改→刪除後到更新紀錄查得到（或只看不改）、資料檢查顯示 #518 清單與掃描時間、更新紀錄搜尋早於最近 100 筆的內容。
4. 本次未執行合併、部署、正式查詢或正式寫入。

## 回復

回復到前一版程式即可；沒有新表。`dog_list_extra` 多出的 `checkedAt` 欄位舊程式會忽略。
