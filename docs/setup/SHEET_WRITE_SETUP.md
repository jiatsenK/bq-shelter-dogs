# 網站寫進試算表：設定步驟（#138；#281 加上只追加的備註與異動紀錄）

設定好之後，志工在網站按「溜了」，網站會把那隻狗在試算表「主清單」的 **遛狗日期** 改成今天、**誰遛的** 填上自己的名字；按「復原」或在今天已溜按「放回」，就改回原本的樣子。

寫入是由一個 **Google Apps Script 小程式** 做的。這個小程式要用 K 自己的 Google 帳號部署，因為只有對試算表有編輯權的人才能寫入。全部在網頁上完成，大約 10 分鐘。

> 小程式只會改「主清單」的「遛狗日期」「誰遛的」兩欄，別的欄、別的分頁都不會碰。
> 同一天已經有人寫了，名字會接在後面（例如「小華、小明」），不會蓋掉別人。

## 1. 建立小程式

1. 用電腦打開 <https://script.google.com>，登入 K 的 Google 帳號（要是對試算表有編輯權的那個帳號）。
2. 左上角 **新專案**，把專案名稱改成「溜狗表寫入」。
3. 把編輯器裡原本的 `function myFunction() {}` 全部刪掉，貼上 repo 裡 [`apps-script/sheet-write.gs`](../../apps-script/sheet-write.gs) 的全部內容，按 **儲存**（磁碟圖示）。

## 2. 設定試算表 ID

1. 左邊齒輪 **專案設定**。
2. 「時區」選 **(GMT+08:00) 台北**。
3. 往下到 **指令碼屬性** → **新增指令碼屬性**，加一個：
   - `SHEET_ID`：試算表 ID（跟 GitHub Secret `SHEET_ID` 一樣，網址 `/d/` 和 `/edit` 中間那串）
4. 按 **儲存指令碼屬性**。

## 3. 部署成網頁應用程式

1. 右上角 **部署** → **新增部署作業**。
2. 「選取類型」旁的齒輪選 **網頁應用程式**。
3. 設定：
   - 說明：`溜狗表寫入`
   - 執行身分：**我**（K 的帳號）
   - 誰可以存取：**所有人**（網站經過 Cloudflare 來呼叫，沒有 Google 登入；這個網址只放在 GitHub Secret 裡，不要貼到別的地方）
4. 按 **部署**。第一次會跳出「授權存取權」：選 K 的帳號 → 如果出現「Google 尚未驗證這個應用程式」，按 **進階** → **前往「溜狗表寫入」（不安全）** → **允許**。這是因為這個小程式是 K 自己寫的，沒有送 Google 審核，屬於正常情況。
5. 部署完成會顯示 **網頁應用程式網址**（`https://script.google.com/macros/s/.../exec`），複製起來。
6. 用瀏覽器打開這個網址，看到 `{"ok":true,"service":"板收志工溜狗表 寫入試算表"}` 就代表有在跑。

## 4. 把網址交給網站

1. 打開 GitHub 上的這個 repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**，加一個：
   - `SHEET_WRITE_URL`：第 3 步複製的網址
2. 到 **Actions** → 「部署到 Cloudflare」→ **Run workflow** 手動跑一次，讓 Worker 拿到新的設定。
3. 打開 <https://bq-shelter-dogs.jiatsen-k.workers.dev/api/>，看到 `"sheetWrite":"已設定"` 就完成了。

## 5. 志工這邊要做的

每個志工到網站「我溜過」設定一次名字（之前已經設定過的，要按「修改」再輸入一次）。設定好之後按「溜了」就會寫進試算表，提示條會多一句「已寫進試算表」。沒有設定名字的人，按「溜了」還是只記在自己手機上。

## 之後要改小程式

改了 `apps-script/sheet-write.gs` 之後，貼到同一個專案、儲存，再到 **部署** → **管理部署作業** → 鉛筆圖示 → 版本選 **新版本** → **部署**。網址不會變，GitHub 不用改。

## 出問題時

- 網站提示「試算表沒有回應（401）」：部署時「誰可以存取」不是「所有人」，或 GitHub 填的是結尾 `/dev` 的測試網址（要用 `/exec`）。改「誰可以存取」要到 **管理部署作業** 部署新版本。
- 網站提示「試算表 ID 不對」：指令碼屬性 `SHEET_ID` 少複製或多了字。重新複製網址 `/d/` 和 `/edit` 中間那整串（貼整個網址也可以），改完不用重新部署。

- 想多一層保護（之後再說也可以，K 2026-10-04 決定先不設）：小程式指令碼屬性加 `WRITE_KEY`，GitHub Secret 加一模一樣的 `SHEET_WRITE_KEY`，重跑第 4 步的部署。設了以後，就算小程式網址外流，沒有金鑰也改不了試算表。
- 網站提示「寫入試算表的金鑰不對」：上一點的兩個值不一樣，改成一樣後重跑部署。
- 提示「主清單找不到…欄」：試算表表頭被改掉了，「編號」「犬名」「遛狗日期」「誰遛的」要在。
- 想暫時關掉：刪掉 GitHub Secret `SHEET_WRITE_URL` 不會關掉（Cloudflare 上還留著），要到小程式 **部署** → **管理部署作業** → **封存**。網站會提示沒寫進去，志工照舊手動填。


## #141 更新與驗收（管理者操作）

此版「修改溜狗人」需要同步更新 Apps Script，僅合併網站 PR 不足以啟用。

1. 開啟原「溜狗表寫入」Apps Script 專案。
2. 將 `apps-script/sheet-write.gs` 的完整內容貼入原程式檔，按儲存。
3. **部署 → 管理部署作業 → 鉛筆 → 版本：新版本 → 部署**。保留原網址與指令碼屬性，GitHub Secret 不必更改。
4. 網站部署後，用測試犬確認：原有其他人 → 自己按溜了 → 畫面與 Sheet 顯示完整名單，立即出現在「我溜過」。
5. 關閉提示條、重新整理，從犬隻詳細資訊「今天的登記」新增／修改人員，再按復原，確認 Sheet 與網站一致。
6. 另一人更改同一筆後再送修改／復原，應提示已被修改並保留對方資料。

新增一起溜的人採追加；修改採原始名單快照比對。修改的復原回到該次編輯前，新增人員的復原保留原登記前的快照。持續入口與即時紀錄存於本機，限今天及這支手機；歷史資料仍由排程同步。預覽站禁止試算表寫入，因此上述真實寫入驗收要在正式部署後進行。

## 6. 試算表有改時通知網站（ADR 0012，#305）

> #501 起退役：狗清單改由第 8 節的編輯觸發送 Worker，`installWalkEditTriggers` 會刪掉這裡的 `notifyWorker` 觸發器；#512 起 Worker 的 `/api/sheet-changed`、小程式的 `notifyWorker` 與 Secret `SHEET_NOTIFY_KEY` 都已刪除（GitHub 上的 Secret 可以一併刪掉）。下面留作歷史。

網站不再每 30 分鐘同步一次，改成：有人**直接在試算表畫面**改了東西，Apps Script 通知 Worker，Worker 每 10 分鐘看一次、有改才同步（一天最多 30 次）；另外每天台灣 6:30 保險同步一次。網站上按的（溜了、狗群等）本來就馬上進資料庫，不會觸發通知。

通知用一組**專用密碼**，只能說「試算表有改」，不是 `WALKER_KEY`。K 自己設定，不要給別人。

1. **產生密碼**（PowerShell，複製印出來的那串）：
   ```powershell
   -join ((48..57) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
   ```
2. **交給 Worker**：GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**，名稱 `SHEET_NOTIFY_KEY`，貼上密碼。下次部署（推到 main 或手動跑「部署到 Cloudflare」）會一起帶上去。
   確認：打開 `https://bq-shelter-dogs.jiatsen-k.workers.dev/api/sheet-changed`，看到「試算表通知只能用 POST」就是設好了；看到「還沒設定試算表通知」就是還沒帶上去。
3. **更新小程式**：照「之後要改小程式」把最新的 `apps-script/sheet-write.gs` 整份貼上、存檔（這次多了 `notifyWorker`，不用重新部署網頁應用程式）。
4. **指令碼屬性**：專案設定 → 指令碼屬性，新增兩個：
   - `NOTIFY_URL`：`https://bq-shelter-dogs.jiatsen-k.workers.dev/api/sheet-changed`
   - `NOTIFY_KEY`：第 1 步的密碼
5. **觸發器**：左邊鬧鐘圖示「觸發條件」→ 右下 **新增觸發條件**：函式選 `notifyWorker`、活動來源「試算表」、活動類型「變更時」→ 儲存，照畫面授權（會多要一個「連線到外部服務」的權限）。
6. **驗收**：在試算表隨便改一格再改回來，等 10 分鐘左右，GitHub repo 的 **Actions** → **同步試算表** 應該多一筆 `workflow_dispatch` 的綠勾。

沒做完這幾步也不會壞：網站照樣每天 6:30 同步，按「更新」時試算表有變也會同步。

## 7. 今日溜狗：有人編輯才同步（#500，ADR 0018，**尚未授權啟用**）

改「主清單」或「已出所」時，Apps Script 只把受影響的列（編號＋當下的日期、名單）送到 `POST /api/walk-writeback/rows`；Worker 只比這幾隻，不讀整張表。換籠、移到「已出所」標成狗清單有改，交給既有同步。送不出去會留在指令碼屬性 `WALK_EDITS_PENDING`，下次編輯或每 10 分鐘補送；Worker 確認收到才清，而且只清送出時的那一版。

啟用前（需 K 另行授權）：

1. 指令碼屬性要有 `WALK_WORKER_URL`（Worker 網址）與 `WRITE_KEY`（同 `SHEET_WRITE_KEY`）。
2. 貼上最新 `apps-script/sheet-write.gs`，在編輯器選 `installWalkEditTriggers` 執行一次並授權：會建立「編輯時」→ `onWalkSheetEdit`、每 10 分鐘 → `flushWalkEdits`。#501 起同一個函式也會建立狗清單的觸發器（見第 8 節），並刪掉第 6 節留下的 `notifyWorker` 舊觸發器。
3. Worker 的 `D1_WALK_NOTIFY` 維持未設定時，送來的列不動今日溜狗（狗清單由第 8 節另外送）。
4. 先在測試試算表照 `docs/research/2026-10-23-gas-trigger-structure-changes.md` 的「需實測清單」逐項操作（貼上多格、剪下貼到「已出所」、清空、Ctrl+Z、手機 App），看 Apps Script 執行紀錄與 D1 結果。

保險掃描改成每天台灣 09:43、13:53、23:53 由 Worker 向 Apps Script 要指紋（`walkScan`），一樣就結束；寫回重試每 10 分鐘只查 D1 有沒有待寫回，沒有就結束。

## 8. 狗清單：有人編輯才同步（#501，ADR 0018 第 5–7 點，**正式切換需 K 授權**）

取代 GitHub Actions「同步試算表」（`sync-sheet.yml` 已刪）。改「主清單」「已出所」「常遛狗群」時，Apps Script 把受影響的單位記進指令碼屬性 `DOG_LIST_PENDING`，在 script lock 內讀當下的值送到 `POST /api/walk-writeback/dog-list`（每批 10 個）；Worker 只改那幾隻、只寫有變的欄。送不出去就留著，下次編輯或每 10 分鐘（`flushDogList`）補送；Worker 確認收到才清，只清送出時的那一版。

- 單位：主清單一隻狗（籠位、編號、犬名、遛狗日期、誰遛的、備註）、已出所一隻狗（整列文字＋出所日期欄）、常遛狗群一欄（名單＋最下面的群名）、主清單下方異動紀錄整段。
- 換籠、離所：看狗新出現在哪裡。出現在「已出所」就記離所（原因照 `worker/src/departure-rules.js`，跟舊同步同一份規則）並從網站主清單移走；又出現在主清單就不算離所。
- 回所：狗回來會拿新編號，如果離所紀錄裡剛好一筆同名、主清單上沒有別的同名，就認定是同一隻：新編號連到原本的狗、舊離所註明用哪個編號回所，並記一筆編輯紀錄（舊編號）。認錯就在網站「舊編號」拆開；同名多筆不猜，當新狗。
- 名字換代號用 Worker 的 `WALKER_KEY`。（`MY_NAME` #557 起不再使用。）
- 保險掃描：每天台灣 09:43、13:53、23:53（`dogListScan`，Google 只保證在那個小時內）送每個單位的指紋，Worker 回不一樣的，再分批只送那幾個；一樣就結束，不送資料，只在 D1 `v3_sync_state` 的 `dog_list_extra` 更新掃描時間（1 列，#567）。D1 有、試算表沒有的只寫在執行紀錄和 `dog_list_extra`，管理網站「資料檢查」顯示，不自動刪。
- 手動補漏／重新灌資料：在 Apps Script 編輯器執行 `dogListScan`；D1 是空的時會全部重送（每次最多 600 個單位，沒送完再執行一次）。（本機備援腳本 `scripts/sync-compact-d1.mjs` 已隨 #512 刪除。）

切換順序（K 授權後）：

1. 先 `wrangler d1 export` 留一份正式 D1 還原點。
2. 合併部署 Worker（`/api/walk-writeback/dog-list`、`dog-list-scan` 上線；每 10 分鐘叫 GitHub 的排程同時停止）。
3. 貼上最新 `apps-script/sheet-write.gs`，確認專案時區是 Asia/Taipei，執行一次 `installWalkEditTriggers` 並授權。
4. 手動執行一次 `dogListScan`，看執行紀錄：第一次 Worker 沒有指紋，會全部重送；之後再執行一次應該只回「沒有要送的」。
5. 改一格籠位、新增一隻狗、把一隻狗剪下貼到「已出所」，看網站與 D1。

照片垃圾桶：Worker 每月 1 日台灣 10:17 清掉超過 30 天的，結果在 `GET /admin/trash` 的 `lastPurge`（D1 `v3_sync_state` 的 `trash_purged`）。
