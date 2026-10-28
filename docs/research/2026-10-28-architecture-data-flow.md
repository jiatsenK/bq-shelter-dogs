# 架構圖核對、資料流向與部署環境（2026-10-28）

2026-10-28（台灣時間）。問題（K）：`docs/diagrams/architecture.html` 畫得對不對；每一類資料從誰發起、經過哪個端點、存到哪、怎麼寫回試算表；測試網站、PR 預覽、各個 GitHub Actions 與排程各自綁什麼。

只讀研究，沒有改任何既有檔案、沒有 commit、沒有開瀏覽器。程式以 `main`（`c2da5f0`，與 `origin/main` 相同）為準，行號都是這一版的行號。以程式碼與設定檔為第一手來源；`docs/ARCHITECTURE_NOW.md`、`docs/adr/` 只當線索，不一致的地方列在第 5 節。網址的帳號子網域一律寫 `<子網域>`，密鑰、帳號 ID、資料庫 ID 都不寫。

---

## 架構圖核對結果（摘要）

**整體：8 個節點都存在、10 條箭頭的方向都對，沒有畫錯方向的箭頭。問題是「少畫」和「標籤太籠統」，會讓人誤會排程只在 Cloudflare、保險掃描只有一種、所有寫入都先存 D1。**

| 項目 | 判定 | 一句話 |
|---|---|---|
| 8 個節點 | 正確 | 名稱、Worker 名、D1／R2 名稱都對得上設定檔 |
| 志工→志工網站（HTTPS） | 正確 | |
| 管理者→管理網站（Access） | 正確 | |
| 志工網站→D1（先寫 D1） | 大致正確，有例外 | 溜了／修改／復原與所有狗資料編輯都先存 D1；**但「加備註」「新增異動紀錄」是直接同步寫試算表，不先存 D1** |
| 管理網站→D1 | 正確 | |
| 志工網站→R2（照片） | 正確 | 另含每月清照片垃圾桶 |
| 管理網站→R2 | 正確 | |
| 志工網站→Apps Script（寫回試算表） | 正確但標籤不完整 | 這條同時承載寫回（`walkWake`）、**今日溜狗保險掃描讀回（`walkScan`）**、備註／異動紀錄（`note`／`log`） |
| Apps Script→志工網站（推送改動） | 正確但標籤不完整 | 這條同時承載人工改表推送、**寫回過程的回呼（`target`／`receipt`／`observe`）**、**狗清單保險掃描（`dog-list-scan`）** |
| 試算表→Apps Script（編輯觸發） | 正確 | |
| 管理者→試算表（人工改表） | 正確 | |
| **漏畫：Apps Script→試算表** | **缺** | 真正改格子的是 GAS（寫「遛狗日期」「誰遛的」兩欄、追加備註與異動紀錄）；圖上只有試算表→GAS，看不出 GAS 會寫表 |
| 註記「排程：每 10 分鐘重試寫回，每天三次保險掃描比對試算表」 | **部分錯** | 放在 Cloudflare 區、寫成一件事，但實際上有**兩套排程、兩種保險掃描、方向相反**（見下） |

四個特別確認的問題：

1. **保險掃描是誰呼叫誰？兩種都有，方向相反。**
   - 今日溜狗保險掃描：**Worker 呼叫 GAS**。Worker 排程 `23 1,5,15 * * *`（台灣 09:23／13:23／23:23）跑 `scanTick` → `scanWalks` → `callSheet({action:'walkScan'})`（`worker/src/index.js:28`、`:799-800`；`worker/src/walk-retry.js:9-12`；`worker/src/walk-reconcile.js:55-64`，呼叫在 `:61`）。GAS 收到後在 `handleRequest` 走 `scanWalkSnapshot`（`apps-script/sheet-write.gs:46`、`:116-120`）。
   - 狗清單保險掃描：**GAS 呼叫 Worker**。GAS 時間觸發 `dogListScan`（台灣約 09:43／13:53／23:53，`apps-script/sheet-write.gs:314`）→ `POST /api/walk-writeback/dog-list-scan` → 再分批 `POST /api/walk-writeback/dog-list`（`apps-script/sheet-write.gs:498-523`，打 Worker 在 `:506`、`:517`；Worker 端 `worker/src/index.js:870-878`）。
2. **GAS `dogListScan` 也打 Worker 嗎？** 是，而且只打 Worker：先送指紋到 `/dog-list-scan`（`worker/src/dog-list.js:257-286` 回 `want`），再把不一樣的單位分批送 `/dog-list`（`worker/src/dog-list.js:224-254`）。
3. **管理網站會寫回試算表嗎？** 不會。管理 Worker 沒有 `SHEET_WRITE_URL`／`SHEET_WRITE_KEY`、程式裡沒有 `callSheet`，只碰 D1、R2（`worker/src/admin/index.js:58-122`；`wrangler.admin.jsonc:1`、`:21-31`）。唯一的對外 `fetch` 是驗 Access 簽章時抓金鑰（`worker/src/admin/access.js:19`）。管理網站只會放試算表／GAS 的「連結」給人點（`worker/src/admin/links.js:6-12`），不呼叫。
4. **志工網站讀資料完全不碰試算表嗎？** 是。所有 GET 路由都讀 D1（`/dogs`、`/walks`、`/today`、`/walkers`……，`worker/src/index.js:706-772`）或 R2（`/photos/*`，`worker/src/index.js:829`）。`worker/src/sheet-read.js` 只剩拆名字的純函式（`:1-9`），前端也沒有任何 Google 網址（`public/js/` 只有 `public/cards.html:11-13` 的 Google Fonts）。志工網站碰試算表只有「寫」：寫回兩欄（背景）與備註／異動紀錄（同步）。

### 建議怎麼改圖

1. **加一條 Apps Script → Google 試算表**（或把現有那條改成雙向）：標「寫兩欄、追加備註／讀表」。
2. **志工網站→Apps Script 的標籤**改成「寫回兩欄（walkWake）／保險掃描讀回（walkScan）／備註（note、log）」。
3. **Apps Script→志工網站的標籤**改成「推送改動（rows、dog-list）／寫回回呼（target、receipt）／狗清單保險掃描」，可加註驗證標頭 `X-Sheet-Write-Key`。
4. **註記拆成兩塊**：
   - Cloudflare 區：「Worker 排程：每小時 :05 起每 10 分鐘重試寫回；台灣 09:23、13:23、23:23 今日溜狗保險掃描（Worker→GAS）；每月 1 日 09:23 清照片垃圾桶」。
   - Google 區：「GAS 時間觸發：每 10 分鐘補送待通知；台灣約 09:43、13:53、23:53 狗清單保險掃描（GAS→Worker）」。
5. **「先寫 D1」標成例外**：在志工網站→Apps Script 那條旁加小字「備註、異動紀錄直接寫表，不先存 D1」，或另畫一條虛線。
6. 可選：D1 節點「唯一正本」改成「網站唯一讀取來源」比較精確。狗名、籠位、編號、備註、離所、常遛狗群這些欄位，是人先改在試算表、再由 GAS 推進 D1；管理網站也只能看、不能改（`docs/ARCHITECTURE_NOW.md:27`，程式上 `saveDogEdit` 沒有這些欄位，`worker/src/dog-edit.js:171-231`）。
7. 可選：R2 節點副標加「垃圾桶 trash/」。

---

## 1. 節點與箭頭逐一核對

圖的原始碼：箭頭在 `docs/diagrams/architecture.html:102-121`，節點在 `:152-217`，註記在 `:149-150`。

### 1.1 節點

| 節點 | 判定 | 來源 |
|---|---|---|
| 志工（手機瀏覽器） | 正確 | 前端 `public/`，API 呼叫集中在 `public/js/api.js` |
| 管理者（電腦） | 正確 | 前端 `admin/public/`，API 在 `admin/public/js/api.js`、`settings-api.js` |
| 志工網站 Worker `bq-shelter-dogs`（public/ + /api） | 正確 | `wrangler.jsonc:8`、`:11-16`（`run_worker_first` 是 `/api/*`、`/api`、`/photos/*`）；程式 `worker/src/index.js` |
| 管理網站 Worker `bq-shelter-dogs-admin`（Access 保護） | 正確 | `wrangler.admin.jsonc:9-12`；每個請求先 `verifyAccess`（`worker/src/admin/index.js:61-64`） |
| D1 `bq-shelter-dogs` | 正確 | 兩個 Worker 都綁同一個正式庫（`wrangler.jsonc:21-26`、`wrangler.admin.jsonc:21-25`） |
| R2 `bq-shelter-photos`（原圖與縮圖） | 正確 | `wrangler.jsonc:19`、`wrangler.admin.jsonc:26`；路徑規則 `worker/src/r2.js:14`、`:21` |
| Apps Script `sheet-write.gs` | 正確 | 網頁應用程式 `doPost`（`apps-script/sheet-write.gs:15-23`）＋編輯觸發與時間觸發（`:305-315`） |
| Google 試算表（人工輸入介面） | 正確 | GAS 只讀寫「主清單」「已出所」「常遛狗群」三個分頁（`apps-script/sheet-write.gs:10-11`、`:277`、`:321`） |

### 1.2 箭頭

| 箭頭（圖上行號） | 判定 | 程式證據 |
|---|---|---|
| 志工→志工網站 HTTPS（`:103`） | 正確 | 同網址才收（`worker/src/index.js:811-812`、`:897`） |
| 管理者→管理網站 ACCESS（`:105`） | 正確 | `worker/src/admin/index.js:61-64`；寫入另驗 `Origin` 必須等於 `ADMIN_ORIGIN`（`:19`） |
| 志工網站→D1「先寫 D1」（`:107`） | 大致正確 | 溜了／修改／復原：`acceptWalk` 先在一個 D1 批次寫好（`worker/src/walk-accept.js:213-223`），之後才 `waitUntil(dispatchWalk)` 寫回（`worker/src/index.js:584-587`）。**例外**：`note`／`log` 先同步呼叫 GAS 寫表，成功後才在 D1 記修改紀錄（`worker/src/index.js:595-611`） |
| 管理網站→D1（`:109`） | 正確 | 設定、狗資料、合併、活動都寫 D1（`worker/src/admin/index.js:67-104`） |
| 志工網站→R2 照片（`:111`） | 正確 | 上傳 `POST /api/photos/{編號}`（`worker/src/index.js:953-962` → `:339-351` → `worker/src/dog-photo.js:64-104`）；讀照片 `GET /photos/*`（`worker/src/index.js:829`）；每月清垃圾桶（`:801`、`:327-335`） |
| 管理網站→R2（`:113`） | 正確 | 換照片、從垃圾桶復原、看照片（`worker/src/admin/index.js:81`、`:87`、`:90-93`、`:118`） |
| 志工網站→Apps Script 寫回試算表（`:115`） | 正確，標籤不完整 | 全部經過 `callSheet`（`worker/src/sheet-write.js:24-46`），動作只有 `note`、`log`、`walkWake`、`walkWakeBatch`、`walkScan`（`:6`） |
| Apps Script→志工網站 推送改動（`:117`） | 正確，標籤不完整 | GAS 的 `walkWorker` 打 `/api/walk-writeback/{target,receipt,observe,rows,dog-list,dog-list-scan}`（`apps-script/sheet-write.gs:61-72`；Worker 收在 `worker/src/index.js:857-895`，驗 `X-Sheet-Write-Key` 在 `:858-864`） |
| 試算表→Apps Script 編輯觸發（`:119`） | 正確 | `onWalkSheetEdit` 由可安裝的 onEdit 觸發（`apps-script/sheet-write.gs:310`、`:317-343`）。程式寫入不會觸發（`:275`） |
| 管理者→試算表 人工改表（`:121`） | 正確 | — |
| **（漏）Apps Script→試算表** | 缺 | 寫回兩欄 `setValue`（`apps-script/sheet-write.gs:143-147`）；備註、異動紀錄追加（`:48-55`、`:227-255`）；讀表（`:95-112`、`:447-451`） |
| （未畫，可接受）GitHub Actions→志工網站 `/api/admin` | 圖下註記已說明不畫 | `r2-thumbs.yml` 用 `ADMIN_KEY` 打 `/api/admin/thumbs`（`scripts/make-thumbs.py:48-63`；`worker/src/index.js:397-414`） |

### 1.3 註記「排程：每 10 分鐘重試寫回，每天三次保險掃描比對試算表」

- 「每 10 分鐘重試寫回」：Worker 排程 `5-59/10 * * * *` 跑 `retryWalks`（`worker/src/index.js:27`、`:798`；`worker/src/walk-retry.js:15-36`），**正確**。但 GAS 也有自己的每 10 分鐘：`flushWalkEdits`、`flushDogList` 補送人工改表的待通知（`apps-script/sheet-write.gs:311`、`:313`），圖上沒有。
- 「每天三次保險掃描比對試算表」：有**兩種**——Worker 的今日溜狗掃描（Worker→GAS）與 GAS 的狗清單掃描（GAS→Worker），時間錯開 20～30 分鐘（`worker/src/index.js:24-28` 的註解）。註記放在 Cloudflare 區、只寫一次，**容易誤讀成只有 Worker 一種**。
- 漏掉：每月 1 日 09:23 清照片垃圾桶（`worker/src/index.js:29`、`:801`）。

---

## 2. 各類資料的流向

縮寫：志工站＝志工網站 Worker（`worker/src/index.js`），管理站＝管理網站 Worker（`worker/src/admin/index.js`），GAS＝`apps-script/sheet-write.gs`。

| 資料 | 誰發起 | 端點／函式 | 存到哪 | 寫回試算表？怎麼寫、失敗怎麼辦 |
|---|---|---|---|---|
| **今日溜狗**（網站按溜了、修改、復原） | 志工 | `POST /api/walk`（action `walk`／`edit`／`undo`，要帶 `requestId`）→ `acceptWalk` | D1 `v3_walk_state`、`v3_walk_requests`、`v3_walk_outbox`（pending）、`v3_walks`、`v3_edit_log`、`v3_walk_write_budget`；觸發器更新 `v3_walk_pack` | 會。背景 `dispatchWalk` → GAS `walkWake`（多隻 `walkWakeBatch`）→ GAS 回呼 `/target` → 寫兩欄 → 讀回 → `/receipt` → outbox 標 `synced`。失敗：outbox 轉 `retry`，間隔 1／2／4／8／15 分鐘，由每 10 分鐘的排程撿；第 10 次失敗或試算表明確拒絕就停 |
| **今日溜狗**（人工改表） | 管理者 | GAS `onWalkSheetEdit` → `flushWalkEdits` → `POST /api/walk-writeback/rows` → `reconcileEditedRows` → `reconcileWalk` | 同上幾張表，outbox 直接 `synced`（同日要跟網站名單合併時才是 `pending`，再寫回合併結果） | 原本就在表上。GAS 送不出去留在 `WALK_EDITS_PENDING`，每 10 分鐘補送；`D1_WALK_NOTIFY` 沒開就回 ack=false 讓 GAS 留著 |
| **今日溜狗**（保險掃描） | Worker 排程 | `scanTick` → `scanWalks` → GAS `walkScan` → `reconcileWalkSnapshot` | 同上 | 讀回比對，不寫表；不一樣的照表收下 |
| **溜狗紀錄**（每狗每天） | 跟著今日溜狗 | `walkDay`／`dropDay`（按溜了同批）、`applyMain`（狗清單同步）、`droppedDay`（改回較早日子） | D1 `v3_walks`（觸發器更新版本，`/walks` 讀 `v3_walk_packs`／`v3_walk_summaries` 快取） | 不另外寫回（試算表只有最近一次的日期與人） |
| **狗清單—主清單**（籠位、編號、犬名、備註、遛狗日期、誰遛的） | 管理者改表 | GAS `onWalkSheetEdit` → `flushDogList` → `POST /api/walk-writeback/dog-list` → `applyDogListRows`／`applyMain` | D1 `v3_sheet_main`、`v3_dogs`（名字）、`v3_dog_numbers`、`v3_walks`；指紋 `v3_sync_state.dog_list_fp`、`synced_at` | 試算表是來源，不寫回。GAS 送不出去留 `DOG_LIST_PENDING`，每 10 分鐘補送；每天三次 `dogListScan` 補漏 |
| **狗清單—已出所** | 管理者把列搬到「已出所」 | 同上 → `applyDeparted` | D1 `v3_dog_departures`，並從 `v3_sheet_main` 移走 | 不寫回；重試同上 |
| **狗清單—常遛狗群** | 管理者改「常遛狗群」 | 同上 → `applyGroup` | D1 `v3_sheet_group_columns`（一欄一列） | 不寫回；網站只讀 |
| **狗清單—異動紀錄**（主清單下方「備註N」） | 管理者改表，或志工按「新增一筆」 | 人工：同上 → `applyNotes`。志工：`POST /api/walk` action `log` → GAS `log` | D1 `v3_sheet_changes` | 志工新增的是**直接同步寫表**；失敗就回錯誤給志工、不重試。程式寫入不觸發 onEdit，D1 要等下一次 `dogListScan` 才收到 |
| **試算表備註**（每隻狗的「備註」欄） | 志工按「加備註」 | `POST /api/walk` action `note` → GAS `note` | 表上；D1 只記修改紀錄 `v3_edit_log`（kind `note`）。`v3_sheet_main.note` 等下一次 `dogListScan` | 同上：同步寫表、失敗不重試 |
| **狗資料—介紹、休養、固定照顧、出入所（含舊編號）** | 志工（受功能開關管）或管理者 | 志工：`PUT /api/intro|rest|fixed-care|stays/{編號}`、`POST|DELETE /api/former/{編號}` → `editDog` → `saveDogEdit`。管理者：`PUT /api/manage/dogs/{dogId}`（`{field,revision,value}`，另可改性別）→ `saveDogEdit` | D1 `v3_dog_edit_state`（revision 比對）、`v3_intros`、`v3_rest`、`v3_dogs.fixed_care`／`sex`、`v3_stays`、`v3_dog_numbers`、`v3_dog_departures`（管理者改離所日記 `manual`）、`v3_edit_log` | 不寫回 |
| **狗資料—合併／取消合併** | 管理者 | `GET|POST /api/manage/dogs/{dogId}/merge`、`POST …/unmerge` → `worker/src/dog-merge.js` | D1 `v3_dogs`、`v3_stays`、`v3_dog_edit_state`、`v3_walk_state` 等＋修改紀錄 | 不寫回 |
| **出入所—離所事件** | 管理者改「已出所」 | 見上「已出所」 | `v3_dog_departures` | 不寫回 |
| **照片（原圖、縮圖）** | 志工（`editPhoto` 開關）或管理者 | 志工：`POST /api/photos/{編號}`（multipart 原圖＋前端做好的縮圖）→ `uploadR2` → `saveDogPhoto`。管理者：`POST /api/manage/dogs/{dogId}/photo`、`…/restore` | R2 `photos/{32 碼}.jpg`、`photos/thumbs/{32 碼}.jpg`；舊固定路徑 `photos/{編號}.jpg`；換掉的先備份到 `trash/{代號}/photo.jpg`、`thumb.jpg`。D1 `v3_photos`（主照片指標）、`v3_edit_log` | 不寫回。沒縮圖時網站顯示原圖，要補就手動跑 `r2-thumbs`；垃圾桶每月 1 日清 30 天以上的 |
| **功能開關** | 管理者 | `PUT /api/manage/settings` → `saveSettings`；志工站 `GET /api/feature-settings`，寫入前 `requireVolunteerEdit` | D1 `v3_feature_settings`（一列、revision）；觸發器記 `v3_feature_settings_log` | 不寫回 |
| **修改紀錄** | 每個寫入動作同批寫 | `editLogWrites`／`logEdit`；讀 `GET /api/edits`、`GET /api/manage/edits` | D1 `v3_edit_log`（來源 `volunteer`／`sheet`／`access`）、`v3_dog_edit_actors`（管理者 Access 身分） | 不寫回 |
| **活動** | 志工（`editActivity` 開關）或管理者（不受開關管） | `POST /api/activities`、`PUT|DELETE /api/activities/{id}`；`/api/manage/activities…` | D1 `v3_activities`、`v3_activity_dogs`、`v3_activity_guard`、`v3_edit_log`（觸發器更新 `v3_activity_versions`） | 不寫回 |
| **志工名字（身分）** | 志工 | `POST /api/identity`、`/identity/rename`、`/identity/merge(-preview)`；`POST /api/walker-code`（只算代號）；`GET /api/walkers`（讀名單，順便記看過的名字） | D1 `v3_identity_names`、`v3_volunteers`、`v3_identity_redirects`、`v3_identity_operations` 等；狗清單同步時也從表上「誰遛的」連結名字（`linkIdentityName`） | 名字本身不寫回；只會以「誰遛的」文字跟著今日溜狗寫回 |
| （附帶）常溜、開卡 | 志工 | `PUT|GET /api/favorites`、`PUT|GET /api/cards/opened` | D1 `v3_volunteer_favorites`、`v3_volunteer_cards` | 不寫回 |

### 2.1 來源（依上表順序）

- **今日溜狗（網站）**
  - 舊網頁沒帶 `requestId` 回 410：`worker/src/index.js:573-574`；接受：`:581-594`（`acceptWalk` 在 `:584`，背景派送 `:586`）。
  - 一個 D1 批次寫完狀態、請求、outbox、溜狗紀錄、修改紀錄：`worker/src/walk-accept.js:213-223`；溜狗紀錄 `:203-205`；修改紀錄 `:209-211`；寫入預算 `:56-65`（以 **UTC** 日期計，台灣 08:00 重置，`:59`）。
  - `v3_walk_pack` 由觸發器維護：`db/compact-schema.sql:65-88`；`GET /api/today?source=d1` 讀它：`worker/src/index.js:746-750`、`worker/src/walk-accept.js:31-33`。
  - 派送核心：`worker/src/walk-accept.js:247-366`；呼叫 GAS `:322-327`；退避 1／2／4／8／15 分鐘與上限：`:254-255`、`:356-357`；明確拒絕（金鑰、試算表 ID、權限）一次就停：`:331`、`worker/src/sheet-write.js:48-54`；重試每日上限用完延到隔天：`worker/src/walk-accept.js:260-264`、`:282-286`（`SYNC_RETRY_DAILY_BUDGET`，`wrangler.jsonc:31`）。
  - GAS 寫回：`apps-script/sheet-write.gs:132-154`（`/target` `:135`、寫前發現人工改過就 `/observe` 並停 `:138-142`、寫格子 `:143-147`、`/receipt` `:152`）；寫回必須有金鑰 `:37`。
  - Worker 收回呼：`writebackTarget` `worker/src/walk-accept.js:510`、`confirmWalk` `:368-394`。
  - 排程重試：`worker/src/walk-retry.js:15-36`（撿中斷超過 60 秒的派送、舊程序留下的 `dispatching`、到期的 `pending`／`retry`／`unconfirmed`，每輪最多 10 隻）；功能開關 `WALK_RETRY_ENABLED==='true'` 且非預覽：`:4`。
- **今日溜狗（人工改表）**：`apps-script/sheet-write.gs:334-340`、`:357-381`（`/rows` 在 `:373`）；`worker/src/index.js:879-882`；`worker/src/walk-reconcile.js:69-79`；收下的寫法 `worker/src/walk-accept.js:484-506`（`status` 在 `:484`）。
- **保險掃描**：`worker/src/walk-reconcile.js:55-64`、`:8-44`；指紋算法要跟 GAS 一致：`worker/src/walk-reconcile.js:47-50`、`apps-script/sheet-write.gs:121-124`、`:533`。
- **溜狗紀錄**：`worker/src/dog-list.js:59-67`（`walkDay`）、`:104`、`:129`；`worker/src/walk-accept.js:83-87`；讀取 `worker/src/index.js:715-729`、`worker/src/packs.js:415-436`、`:483`。
- **狗清單**：GAS 編輯觸發 `apps-script/sheet-write.gs:317-343`、`flushDogList` `:457-483`、`dogListScan` `:498-523`；Worker `worker/src/index.js:870-878`、`worker/src/dog-list.js:224-254`（主清單 `applyMain` `:73`、已出所 `applyDeparted` `:145`、狗群 `applyGroup` `:189`、異動紀錄 `applyNotes` `:207`）、掃描 `:257-286`。D1 有、表上沒有的只列出來不刪：`worker/src/dog-list.js:6`、`:278-284`。讀取：`GET /api/dogs` `worker/src/index.js:168-189`（`readDogsPacked`，`worker/src/packs.js:438`）、`/departures` `:731-737`、`/departed-cards` `:742-743`。
- **備註、異動紀錄**：前端 `public/js/sheet-append.js:57-73`；Worker `worker/src/index.js:595-611`；GAS `apps-script/sheet-write.gs:48-55`、`:227-255`；程式寫入不觸發 onEdit `:275`。
- **狗資料**：`worker/src/index.js:238-280`（`DOG_EDITS`）、`:916-920`（開關）；`worker/src/feature-settings.js:30-39`；`worker/src/dog-edit.js:138-245`（寫入 `:171-231`，性別只准管理者 `:147`）；管理站 `worker/src/admin/index.js:89`、合併 `:83`、`:94-95`。
- **照片**：`worker/src/index.js:953-962`、`:339-351`；`worker/src/dog-photo.js:64-104`（備份 `:87`、新路徑 `:88`、寫原圖與縮圖 `:90-91`）；前端做縮圖 `public/js/photo-images.js:25-37`（管理站共用 `admin/public/js/dog-editor.js:2`）；垃圾桶 `worker/src/r2.js:143-153`、清除 `:186`；補縮圖 `worker/src/index.js:375-383`、`worker/src/r2.js:220`。
- **功能開關**：`worker/src/feature-settings.js:1`（9 個開關）、`:18-29`；`worker/src/admin/index.js:67-75`；`worker/src/index.js:905-920`；紀錄觸發器 `migrations/0003_feature_settings.sql:12-22`。
- **修改紀錄**：`worker/src/editlog.js:64-66`（來源三種）、`:72`、`:84`、`:98`；`worker/src/index.js:754-755`；`worker/src/admin/index.js:116`。
- **活動**：`worker/src/index.js:285-317`；`worker/src/admin/activities.js:13-29`；`worker/src/activities.js:124`、`:153`、`:166`。
- **志工名字**：`worker/src/index.js:684-704`、`:420-448`、`:464-537`（看過的名字寫 `v3_volunteers` 在 `:497-512`）；`worker/src/identity.js:32`、`:56`、`:123`；`worker/src/dog-list.js:39-49`。
- **常溜、開卡**：`worker/src/index.js:621-664`、`worker/src/compact.js:116`。

### 2.2 重點說明

- **「先寫 D1」只適用於溜狗與網站編輯**。備註、異動紀錄是唯二同步寫表的路徑：Worker 等 GAS 回應才回給志工，失敗不排隊重試；成功後 D1 只多一筆修改紀錄，`v3_sheet_main.note`、`v3_sheet_changes` 要等下一次 `dogListScan`（最長約 10 小時，例如 13:53 之後要等到 23:53）。發起的那支手機會先在本機補上（`public/js/sheet-append.js:69-70`），其他人看不到。
- **寫回重試有兩層**：Worker 端是 outbox（網站登記→試算表）；GAS 端是指令碼屬性 `WALK_EDITS_PENDING`、`DOG_LIST_PENDING`（人工改表→D1）。兩邊都靠對方回 ack 才清。
- **今日溜狗與狗清單在 D1 有兩份「誰遛的」**：`v3_walk_state`（網站接受的最新值，今日溜狗讀這份）與 `v3_sheet_main.walked_date`／`walker`（表上值的複本）。`/walkers` 有溜狗狀態就用前者（`worker/src/index.js:479-487`）。

---

## 3. 整個架構：環境、Workflow、排程

### 3.1 四個 Worker 各綁什麼

| Worker | 設定檔 | D1 | R2 | 試算表（GAS） | 排程 | 寫入限制 | 怎麼部署 |
|---|---|---|---|---|---|---|---|
| 正式志工網站 `bq-shelter-dogs` | `wrangler.jsonc` | 正式 `bq-shelter-dogs`（`:21-26`） | `bq-shelter-photos`（`:19`） | 正式 GAS（密鑰 `SHEET_WRITE_URL`／`SHEET_WRITE_KEY`，由 Actions 帶上，`deploy-cloudflare.yml:100-113`） | `5-59/10 * * * *`、`23 1,5,15 * * *`（`:41-43`） | 無；關掉預覽網址（`:46`） | `deploy-cloudflare.yml`（main 推送／手動／被 migration 呼叫） |
| 管理網站 `bq-shelter-dogs-admin` | `wrangler.admin.jsonc` | 正式 `bq-shelter-dogs`（`:21-25`） | `bq-shelter-photos`（`:26`） | **不連**（只放連結） | 無 | Access＋同源檢查 | `deploy-admin.yml`（只手動、只 main） |
| 測試網站 `bq-shelter-dogs-test` | `wrangler.test-site.jsonc` | 測試 `bq-shelter-dogs-test`（`:24-28`） | `bq-shelter-photos-test`（`:23`） | 測試試算表與測試 GAS（密鑰另外用 `wrangler secret put` 設，workflow 不帶，`:7`） | 只有 `5-59/10 * * * *`（`:38-40`），**沒有保險掃描、沒有清垃圾桶** | 不擋寫入；`SITE_ENV=test` 換紫色頁首（`:30`、`worker/src/test-site.js`） | `deploy-test-site.yml`（main 推送／手動指定分支） |
| PR 預覽 `bq-shelter-dogs-preview` | `wrangler.jsonc` 經 `scripts/d1-database.mjs --preview` 換成 `wrangler.preview-db.jsonc` 的名稱、R2、D1 | 測試 `bq-shelter-dogs-test`（跟測試網站**共用**，`wrangler.preview-db.jsonc:10-14`） | `bq-shelter-photos-test`（`:7`） | **不連**：Worker 上只准有 `WALKER_KEY`（`scripts/d1-database.mjs:51-60`） | 強制空的（`wrangler.preview-db.jsonc:9`、`scripts/d1-database.mjs:39-40`、`:103`） | `PREVIEW=1`：除 `/walker-code` 外的非 GET 都擋（`worker/src/index.js:901-903`），`/walk-writeback/*` 也擋（`:858`），排程工作也不跑（`worker/src/walk-retry.js:4`） | `preview-cloudflare.yml`（PR 有 `preview` 標籤），只 `versions upload`，不部署 |

預覽的防呆（`scripts/d1-database.mjs:37-44`、`:77-82`）：名稱要跟正式不同、排程要明寫空的、R2 不能是正式空間、D1 不能是正式庫；正式設定不准帶 `PREVIEW`（`:78`）。

測試 GAS 的 `WALK_WORKER_URL`（GAS 回呼哪個 Worker）設在 GAS 指令碼屬性（`apps-script/sheet-write.gs:62`），repo 看不到；照設計應指向測試網站。

### 3.2 GitHub Actions

| Workflow | 何時觸發 | 綁哪些資源 | 做什麼／部署到哪 |
|---|---|---|---|
| `deploy-cloudflare.yml`「部署到 Cloudflare」 | main 推送且改到 `public/**`、`worker/src/**`、`wrangler.jsonc`、`migrations/**` 等（`:17-31`）；手動；被 `d1-migrations.yml` 呼叫（`:16`）；只准 main（`:46`） | 正式 D1、正式 R2、正式密鑰 `ADMIN_KEY`、`WALKER_KEY`、`SHEET_WRITE_URL`、`SHEET_WRITE_KEY` | 確認 R2 存在（`scripts/r2-bucket.mjs`）→ 產生 `wrangler.deploy.json`（`scripts/d1-database.mjs:96-105`）→ 正式庫有未套 migration 就停（`:94-96`）→ `wrangler deploy` 帶密鑰（`:98-113`）→ 打正式站 API 煙霧測試（`:117-119`）。**不部署管理網站** |
| `deploy-admin.yml`「部署管理網站」 | 只手動、只 main（`:14-15`、`:27`） | 正式 D1、正式 R2；不帶密鑰；`--var` 帶 `ADMIN_ORIGIN` 與連結網址 | 檢查 migration → `wrangler deploy --config wrangler.admin.jsonc` → 確認沒登入會被轉到 Access（`:70-77`） |
| `deploy-test-site.yml`「部署到測試網站」 | main 推送且改到 `public/**`、`worker/src/**`、`wrangler.test-site.jsonc`、`migrations/**` 等（`:19-27`）；手動可填分支（`:13-18`），**不限 main** | 測試 D1、測試 R2；不帶密鑰（保留 Worker 上原有的） | 對測試庫套 migration（`:69-71`）→ 部署（`:73-80`）→ 煙霧測試（`:82-84`） |
| `preview-cloudflare.yml`「PR 預覽網址」 | PR opened／synchronize／reopened／labeled，要有 `preview` 標籤、同 repo、改到 `public/**`、`worker/src/**`、`wrangler.jsonc`、`migrations/**`（`:15-23`、`:37-40`） | 測試 D1、測試 R2、只有 `WALKER_KEY` | 驗證隔離（`:67-70`）→ 對測試庫套 migration（`:73-75`）→ `versions upload --preview-alias pr-<編號> --var PREVIEW:1`（`:84-89`）→ PR 留言（不貼網址，`:94-112`） |
| `d1-migrations.yml`「套用 D1 migration」 | 只手動、只 main（`:13-20`、`:33`） | 正式 D1；有刪資料或搬資料的 migration 先整份複製到備用庫 `bq-shelter-dogs-backup`（`scripts/d1-migrations.mjs:19`、`:74-77`） | 記 Time Travel 書籤 → `d1 migrations apply --remote` → 接著呼叫 `deploy-cloudflare.yml`（`:50-54`）。**不會順便部署管理網站** |
| `seed-preview-db.yml`「準備預覽資料庫」 | 只手動、只 main（`:8-9`、`:17`） | 讀正式 D1（只 `d1 export`）、清空並匯入測試 D1（`scripts/copy-prod-d1.mjs:64-74`） | 整份覆蓋測試庫，核對筆數（`:37-43`）。**會蓋掉測試網站的資料**；R2 測試空間不動 |
| `r2-thumbs.yml`「產生照片縮圖（R2）」 | 只手動（`:8-9`） | 正式站網址＋`ADMIN_KEY` → 正式 R2 | `scripts/make-thumbs.py` 問 `/api/admin/thumbs` 哪些缺縮圖，做好後 `PUT /api/admin/thumbs/…`（`scripts/make-thumbs.py:48-63`）；只寫 R2 `photos/thumbs/`，不碰 D1 |
| `release-please.yml`「版本號」 | 排程 `0 1 * * 1`（`:9-10`）＋手動 | GitHub 本身 | 整理 Release PR（`version.txt`、`CHANGELOG.md`）；不碰 Cloudflare |
| `tests.yml`「測試」 | PR（非草稿、不是只改文件，`:11-18`、`:33`）＋手動 | 不碰任何外部資源（`:5`） | node 測試＋Playwright 跑 `tests/index.html`（`:44-53`） |
| `pr-guard.yml`「重複 PR 提醒」 | PR opened／reopened／edited／closed（`:7-9`） | GitHub 本身 | `scripts/pr-guard.mjs` 檢查重複 PR、票狀態，留言提醒，不擋合併 |

注意兩件常被忽略的事：

- **改到兩站共用的程式（`worker/src/` 共用模組、`public/js/` 共用檔）時，志工網站會自動部署，管理網站要另外手動按**（`deploy-admin.yml:11`）。`d1-migrations.yml` 套完也只部署志工網站。
- **測試網站與 PR 預覽共用同一個測試 D1**；跑 `seed-preview-db` 會把測試網站上的實測資料整份蓋掉（`wrangler.test-site.jsonc:3`）。

### 3.3 排程（cron）

Cloudflare cron 一律是 UTC；台灣是 UTC+8，只差整數小時，所以「每 10 分鐘」那條的分鐘數不變。GAS 觸發器用專案時區 Asia/Taipei（`apps-script/sheet-write.gs:312`）。

| 誰 | 實際字串／設定 | 台灣時間 | 做什麼 | 來源 |
|---|---|---|---|---|
| 正式志工網站 | `5-59/10 * * * *` | 每小時 :05、:15、:25、:35、:45、:55 | `retryWalks`：把到期的寫回工作交給派送核心（每輪最多 10 隻）；沒工作也查 D1 並記一列 `cron_retry` | `wrangler.jsonc:42`、`worker/src/index.js:27`、`:795`、`:798`；`worker/src/cron-status.js` |
| 正式志工網站 | `23 1,5,15 * * *` | 每天 09:23、13:23、23:23 | `scanTick`：今日溜狗保險掃描（Worker→GAS `walkScan`），記 `cron_scan` | `wrangler.jsonc:42`、`worker/src/index.js:28`、`:799-800` |
| 正式志工網站 | 同上那條＋程式判斷 UTC 1 日 01 點 | 每月 1 日 09:23 | 清照片垃圾桶（`trash/` 滿 30 天），記 `cron_trash`、`v3_sync_state.trash_purged` | `worker/src/index.js:29`、`:801`、`:327-335` |
| 測試網站 | `5-59/10 * * * *` | 同正式 | 只有寫回重試 | `wrangler.test-site.jsonc:38-40` |
| PR 預覽、管理網站 | 無 | — | — | `wrangler.preview-db.jsonc:9`、`wrangler.admin.jsonc`（沒有 `triggers`） |
| GAS | `flushWalkEdits` 每 10 分鐘 | 每 10 分鐘（Google 決定起點） | 補送人工改表的今日溜狗到 `/rows` | `apps-script/sheet-write.gs:311` |
| GAS | `flushDogList` 每 10 分鐘 | 同上 | 補送狗清單待通知到 `/dog-list` | `apps-script/sheet-write.gs:313` |
| GAS | `dogListScan` `atHour(9/13/23).nearMinute(43/53/53)` | 約 09:43、13:53、23:53（Google 只保證在那個小時內，前後可能差 15 分鐘） | 狗清單保險掃描（GAS→Worker） | `apps-script/sheet-write.gs:314`、`:498-523` |
| GitHub Actions | `0 1 * * 1` | 每週一 09:00 | release-please 更新 Release PR | `.github/workflows/release-please.yml:9-10` |

另外兩個「日界線」：寫入預算以 UTC 日期計，台灣每天 08:00 重置（`worker/src/walk-accept.js:59`）；今日溜狗的「今天」用台灣日期（`worker/src/sync-plan.js` 的 `taiwanYmd`）。

---

## 4. 架構總覽（文字版）

```
志工 ──HTTPS──▶ 志工網站 Worker ──讀寫──▶ D1（正式）
                  │  │                      ▲
                  │  └──照片──▶ R2           │
                  │                          │
                  ├─walkWake／walkScan／note／log──▶ GAS ──寫兩欄、追加備註──▶ 試算表
                  ◀─target／receipt／observe／rows／dog-list／dog-list-scan── GAS ◀──編輯觸發── 試算表
                                                                                  ▲
管理者 ──Access──▶ 管理網站 Worker ──讀寫──▶ D1、R2（不連 GAS）                  │
管理者 ─────────────────────────────────────────────────────────人工改表────────┘

排程：Worker（每 10 分鐘寫回重試；09:23／13:23／23:23 今日溜狗掃描；每月 1 日清垃圾桶）
      GAS（每 10 分鐘補送待通知；約 09:43／13:53／23:53 狗清單掃描）
```

---

## 5. 文件與程式碼不一致的地方（以程式碼為準）

1. **`docs/ARCHITECTURE_NOW.md:3`** 寫「正式庫已套 migration 0000–0009」；repo 現在有 `migrations/0000`～`0016`。正式庫實際套到哪一版要跑 `node scripts/d1-migrations.mjs check --target production` 才知道，這份文件的數字已落後 repo。
2. **`docs/ARCHITECTURE_NOW.md:26`** 寫功能開關「十項」；程式只有 9 個（`worker/src/feature-settings.js:1`），`editFormer` 已退役、讀的時候拿掉（`:3`、`:13`）。
3. **`docs/ARCHITECTURE_NOW.md:8`**「試算表只剩人工輸入介面」與架構圖的「先寫 D1」都沒提到：志工網站的備註、異動紀錄仍是同步直寫試算表、不先存 D1、失敗不重試（`worker/src/index.js:595-611`）。文件只在第 91 行的「已退役」段落順帶提到 `note`／`log`。
4. **架構圖註記**把 Worker 與 GAS 兩套排程、兩種保險掃描寫成一件事；`docs/ARCHITECTURE_NOW.md:35-44` 的排程表其實是對的（有分 Worker cron 與 GAS 時間觸發），是圖沒照著畫。
5. **`wrangler.jsonc:14` 的註解**說 `dogs.json`（照片版本號）也先經過 Worker；實際 `run_worker_first` 沒有它（`:15`），Worker 對 `/data/*` 一律回 410（`worker/src/index.js:818`）。註解過期，不影響行為。
6. **`.github/workflows/tests.yml:10` 的註解**說「私人 repo 免費方案不能設必要檢查」；repo 已公開（#493，見 `deploy-admin.yml:7` 等）。註解過期。
7. **本機殘留檔**（不在 git 裡，`.gitignore:11-12`）：工作目錄的 `wrangler.deploy.json`、`wrangler.preview.json` 是舊版產物，裡面還是舊排程 `0,30 23,0-14 * * *`，預覽版名稱是舊的而且綁正式 R2。CI 每次會重新產生（`scripts/d1-database.mjs:96-105`），所以線上不受影響；但**不要手動拿這兩個檔部署**，要用時重新跑 `scripts/d1-database.mjs`。
