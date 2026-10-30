# 活動紀錄、待補清單、修改紀錄與網站更新（#567）

> 2026-10-30 #774：待補清單的「網站有、試算表沒有」改成「可能是同一隻」（見下方〈可能是同一隻〉）。`/api/manage/data-checks` 拿掉，保險掃描不再寫 `dog_list_extra`（D1 有、試算表沒有的單位只回給 Apps Script 記在執行紀錄）。正式庫裡舊的那一列留著不影響，之後要清另開 migration。

> 2026-10-26 #624：管理網站頁名改了，API 與契約不變。「資料檢查」→「待補清單」（完整度各項連到已篩選的狗資料表，狗名直接開編輯抽屜）；「更新紀錄」拆成「修改紀錄」（`updates.html`，資料編輯）與「網站更新」（`releases.html`）。志工網站的頁名不變。

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

## 待補清單 `checks.html`（原資料檢查）

- 主清單資料完整度：沿用志工 `dataCompleteness` 規則（沒有編號、編號看不出入所日期、沒有溜狗日期、沒有性別、沒有入所介紹、沒有照片），只算主清單上的狗；資料用 `/api/manage/dogs`（多回 `walkedDate`，同一個 SELECT）。照片看 D1 照片引用／R2 清單，命名為「沒有照片紀錄」，不逐張 HEAD 下載；沒有實物巡檢。
- 可能是同一隻（#774，取代 #518「網站有、試算表沒有」）：讀 GET `/api/manage/dog-pairs` 的 `count`，顯示「有 N 組可能是同一隻」並連到狗資料 `./?status=unknown`；讀不到明說「不代表沒有」。
- 讀取失敗明說「不代表沒有差異／缺漏」。保險掃描有沒有在跑看「排程」區塊（`cron_scan`）。

## 可能是同一隻（#774，ADR 0025）

- 配對怎麼來：試算表上消失的列確認移出主清單時，同籠有新出現的狗、或同籠同名的狗還在表上，就建一組；確認後 7 天內同籠新建狗也建一組（`worker/src/dog-pairs.js`，跟狗清單同步同一個 batch，不多花 D1 往返）。表：`v3_sheet_gone`（確認時的籠位）、`v3_dog_pairs`（狀態 pending／merged／not_same）。migration `0022`。
- API（只有 Access 管理者）：GET `/api/manage/dog-pairs` 回 `{ count, pairs }`，只列等確認、待核對那隻還在而且不在主清單也沒有離所紀錄、表上那隻還在主清單的組，最新在上，1 個查詢。POST `/api/manage/dog-pairs/{待核對那隻}/{表上那隻}/not-same`（同來源）記成不是同一隻，同一批寫修改紀錄 `not_same`（Access 身分記在 `v3_dog_edit_actors`）；已經不是等確認回 404／409。
- 合併：沿用 `/api/manage/dogs/{表上那隻}/merge`（預覽、帶兩隻版本、按兩次才寫），合併的同一批把這組記成 merged；取消合併照舊在修改紀錄按，那組不會再列出。
- 資料頁：待核對的狗名下顯示「可能跟 ○○（籠位）是同一隻」，旁邊「合併」（開抽屜、選好那一隻直接預覽）和「不是同一隻」（按兩次才送，成功後那組從畫面拿掉）。配對讀不到時表格照常，表格上方另外說明。
- 修改紀錄：`not_same` 顯示「不是同一隻」，內容「跟 ○○（籠位）不是同一隻」；保留 14 天（只有合併、取消合併永久保留）。
- 網頁測試：`tests/admin-dog-pairs.cjs`；Worker 測試：`worker/test/dog-pairs.test.mjs`（Apps Script fixture，刪列後新增、先新增後刪、暖暖殘留合併與取消、不是同一隻不再出現）。

## 修改紀錄 `updates.html`、網站更新 `releases.html`（原更新紀錄）

- 網站更新（K 2026-10-28 改）：頁面在瀏覽器直接讀公開 repo 的 GitHub Releases（`api.github.com/repos/…/releases`，不帶登入，每個 IP 每小時 60 次），release-please 發版就有，不用重新部署管理網站；CSP 的 `connect-src` 因此多放 `https://api.github.com`。純規則在 `admin/public/js/release-notes.js`：草稿與預先發布不列、日期換台灣日期、拿掉每條結尾的 PR／commit 連結，版本號連到 GitHub 的 Release 頁。不存 D1。同一天 K 決定不再人工寫：`public/website-updates.json`、`docs/website-updates.md` 刪掉，志工網站資訊 → 更新紀錄只剩資料編輯。
- Release PR 合併就會改 `.release-please-manifest.json`，`release-please.yml` 照這個路徑馬上跑一次打 tag、建 Release；平常仍每週一 9:00 跑一次整理 Release PR。
- 資料編輯：GET `/api/manage/edits`，參數白名單 `q`（操作者、編號、狗名、改前改後文字，`%`／`_` 視為文字）、`kind`（`KIND_LABELS`）、`dog`（編號、舊編號、永久 ID 或狗名）、`actor`（名字或管理者 email）、`source`（access／volunteer／legacy）、`from`／`to`（台灣日期）、`order`（newest／oldest）、`cursor`（上一頁最後一筆的 id）、`size`（25／50／100）；未知參數或超過 100 字回 400。
- 查詢在 D1 涵蓋整張 `v3_edit_log`，每次 1 個查詢：照主鍵順序、游標接續、`LIMIT` 一頁＋1 判斷下一頁，不算總筆數（CODING_STANDARDS「量不能隨資料變大」）。不帶條件的載入與換頁只讀一頁的列，測試證明紀錄多 10 倍讀取列數不變、查詢計畫不排序整張表。
- 例外（待 K 確認）：帶搜尋文字或篩選時，SQLite 沿主鍵往下找到湊滿一頁；符合的很少時最多走完整張表。這是 #567「搜尋涵蓋分頁完整範圍」的必要代價，只在管理者手動搜尋時發生，文字輸入 300 ms 節流；若要再壓低需另開票加索引或全文檢索。
- 管理者 email 只出現在管理 API；志工 `/api/edits` 仍只回 editorName「管理者」與來源，不含 Access 身分（測試覆蓋）。
- 改前／改後文字沿用志工編輯紀錄頁的 `editsValue`（抽到 `public/js/edit-values.js`，兩站共用）。

## 正式步驟（待 K）

1. 審查草稿 PR，確認兩站共用模組的變動（`worker/src/activities.js`、`worker/src/dog-list.js`、`public/js/edits.js`／`edit-values.js`）。
2. 無 migration。合併後志工 Worker 照既有流程部署（掃描時間才開始記）；管理 Worker 沒有自動部署，K 用管理站設定手動 `npx.cmd wrangler deploy -c <管理站設定>`。
3. 登入管理站驗收：三頁可開、活動用一場測試活動新增→修改→刪除後到更新紀錄查得到（或只看不改）、資料檢查顯示 #518 清單與掃描時間、更新紀錄搜尋早於最近 100 筆的內容。
4. 本次未執行合併、部署、正式查詢或正式寫入。

## 回復

回復到前一版程式即可；沒有新表。`dog_list_extra` 多出的 `checkedAt` 欄位舊程式會忽略。
