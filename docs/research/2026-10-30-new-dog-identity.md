# 新狗從暫用名、正式名到有編號維持同一隻，以及重複的狗怎麼清掉與合併

日期：2026-10-30（台灣）。worktree `frontend-issue-discussion-eb42e1`，基準 main `33bc03e5`。只讀程式、官方文件與正式 D1（只下 SELECT，`rows_written=0`），沒有改程式、沒有寫入 D1 或試算表、沒有實測 Apps Script。行號以本次讀到的檔案為準。

來源：
- Apps Script：[事件物件](https://developers.google.com/apps-script/guides/triggers/events)、[簡易觸發器](https://developers.google.com/apps-script/guides/triggers)、[安裝型觸發器](https://developers.google.com/apps-script/guides/triggers/installable)、[配額](https://developers.google.com/apps-script/guides/services/quotas)
- Developer Metadata：[Sheets API 指南](https://developers.google.com/sheets/api/guides/metadata)、[Sheets API `spreadsheets.developerMetadata`](https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.developerMetadata)、Apps Script [`Range`](https://developers.google.com/apps-script/reference/spreadsheet/range)、[`DeveloperMetadata`](https://developers.google.com/apps-script/reference/spreadsheet/developer-metadata)、[`DeveloperMetadataFinder`](https://developers.google.com/apps-script/reference/spreadsheet/developer-metadata-finder)、[`DeveloperMetadataLocation`](https://developers.google.com/apps-script/reference/spreadsheet/developer-metadata-location)
- Cloudflare：[D1 限制](https://developers.cloudflare.com/d1/platform/limits/)
- 前一份觸發器研究：`docs/research/2026-10-23-gas-trigger-structure-changes.md`（剪下貼上、排序、刪列的事件行為那時就列為需實測，本次沒有新的官方說明）

## 1. 結論

**一定要做**

1. **殘留列移出主清單（不刪狗）**：保險掃描連續兩次都說「D1 有、試算表沒有」的主清單列，而且那隻狗沒有寫回中的溜狗工作，才刪掉 `v3_sheet_main` 那一列，狗本身留著變成待核對。理由：殘留列讓網站出現兩隻暖暖、讓皮蛋一直顯示暫住在新A08、按殘留列的溜了寫回會失敗，也擋住合併（`dog-merge.js:101`）。要連續兩次，是因為掃描送指紋時已經放開鎖，單次結果可能把剛加的列誤算進去（`sheet-write.gs:501-506`）。
2. **括號暫用名不拿名字找回舊狗**：沒編號的新列，Worker 會用溜狗紀錄裡「沒編號、同名」的舊狗當同一隻（`dog-list.js:107`）。顏色暫用名會重複用（下個月可能又來一隻 `(乳白)`），這條規則會把新狗接到舊狗身上。括號名字跳過這一步就好。
3. **網站按溜了要核對溜狗狀態屬於主清單上這隻狗**：補編號後，舊的溜狗狀態仍用 `名:暖暖` 當 key、指向有編號那隻（正式資料查到，見第 2 節），按溜了時直接沿用它（`today-walks/accept.js:50`），沒有像人工改表那樣核對 `dog_id`（`today-walks/observe.js:69`）。之後再來一隻沒編號的「暖暖」，溜狗紀錄會記到舊暖暖身上。

**選擇（建議做 4、5，6 先實測再說）**

4. **自動認定同一隻，認定後用系統合併**：(a) 單格改犬名時，GAS 把 `e.oldValue`（改之前的名字）一起送，Worker 直接找舊列（官方明寫單格才有，最準）。(b) 多格貼上等沒有舊值的情況，GAS 附上表上目前所有主清單 key，Worker 找「同籠位、沒編號、已經不在表上」剛好一隻的舊狗。認定後不直接改寫舊狗，而是建新狗後把舊狗併進來，留 `merge` 紀錄，認錯可以在管理網站取消合併。
5. **管理網站「可能重複」加同籠位配對**：現在只配同名（`admin/public/js/dog-merge.js:34-46`），`(乳白)` 和 `暖暖` 名字不同配不到。自動認定沒把握時不猜，留給管理者在這裡合併。
6. **Developer Metadata 讓每一列帶 dog_id**：不改試算表外觀，官方寫明插入列會跟著列走、刪列會一起刪。排序、剪下貼上、複製整列官方沒寫，要先實測。實測通過才值得做，可以從根本解決改名、改編號（#621）。

**不建議**：隱藏欄放 dog_id。碰到 ADR 0006「其他欄位一律不寫入」，複製整列會把 dog_id 一起複製，只選幾欄排序會讓 dog_id 跟狗錯開。

## 2. 現況與問題

### 認狗規則

| 位置 | 行為 |
|---|---|
| `worker/src/dog-list.js:37` `findMain` | 有編號用編號找，沒編號用「編號空白且同名」找，只看 D1 的主清單複本 |
| `dog-list.js:80-89` | 唯一的特例：找不到時，主清單上同名沒編號的那隻就是牠，補上編號（編號還沒給別隻才算）。同一批也把溜狗紀錄補編號（`today-walks/version.js:98`） |
| `dog-list.js:107` | 主清單找不到時，有編號查 `v3_dog_numbers`，沒編號查 `v3_walks` 裡「沒編號、同名」的任一隻（`LIMIT 1`） |
| `dog-list.js:110`、`139-143` | 有編號才試回所認定：離所紀錄剛好一筆同名、主清單沒有同名 |
| `dog-list.js:115-118` | 都找不到就 `newId()` 建新狗，`dog-list.js:121-123` 在主清單複本加一列 |
| `apps-script/sheet-write.gs:317-342` `onWalkSheetEdit` | 只用 `e.range` 算受影響的列，讀的是改完的值，沒有用 `e.oldValue` |
| `sheet-write.gs:604-621` `dogListKeysForEdit`、`544-601` `dogListUnits` | 單位 key 是 `main:編號` 或 `main:名:犬名`，沒有「這是哪一列」的身分。犬名或籠位空白的列不算狗（`sheet-write.gs:559`） |
| `sheet-write.gs:469-475` | 待送的 key 在表上已經找不到（改名、刪列）就直接 ack |
| `dog-list.js:256-286` `scanDogList` | 指紋表有、這次掃描沒有的 key 記進 `v3_sync_state.dog_list_extra`，只列出來不刪 |
| `dog-list.js:153-154`、`169` | 只有有編號的狗搬到「已出所」才會從主清單複本移走。沒編號的狗搬走也會留在主清單複本 |
| `worker/src/dog-merge.js:101` | 被併的狗還在主清單複本上就拒絕合併，所以兩隻都在時不能併 |

### 三個階段各會怎樣

| 管理者的操作 | 現在的結果 | 依據 |
|---|---|---|
| `(乳白)` 改名 `暖暖`，還沒編號 | 多一隻新狗，`(乳白)` 那列留在主清單複本 | `dog-list.js:37`、`107`、`115-118` |
| 沒編號的 `暖暖` 之後補編號 | 同一隻（特例） | `dog-list.js:80-89` |
| `(乳白)` 先補編號，之後才改正式名 | 同一隻：補編號靠同名特例，改名時用編號找到 | `dog-list.js:81`、`37`、`97` |
| 一次貼上同時改名又補編號 | 多一隻新狗：用新編號、新名字都找不到 | `dog-list.js:37`、`81` |
| 清掉編號再打回去、或複製整列再刪掉一列 | 多一隻沒編號的新狗（暖暖可能就是這樣，見下方） | `dog-list.js:107`（補編號後舊溜狗紀錄已經有編號，用名字找不到） |
| 有編號後改名 | 同一隻 | `dog-list.js:37`、`97` |
| 改編號（#621） | 多一隻新狗 | `dog-list.js:107-118`，本研究不處理 |

正式資料目前的 `(乳白)`（C區11，dog_id `7a90c096…`）已經有編號 2026102901，之後改正式名不會多一隻。所以三個階段不一定照順序，危險的只有「還沒編號就改名」和「一次改兩格」。

### 正式資料（10/30 唯讀查詢）

- **暖暖**：主清單複本舊B06 兩列。row 119 是 `8e826f8b…`，編號 2026101403。row 121 是 `4baf2fac…`，沒編號，在 `dog_list_extra`（記錄時間 10/29 23:46）。兩隻 10/29 都有同樣三位志工（position 0–2）的溜狗紀錄，`8e82` 那三筆帶編號，`4baf` 的沒有。
- `8e82` 的修改紀錄：10/29 16:58、16:58 志工網站按溜了（當時沒編號），17:02 試算表改溜狗人。溜狗狀態 key 是 `名:暖暖`、指向 `8e82`，寫回三版都 synced。補編號後這個 key 沒有跟著改，現在 `withTodayWalks`（`today-walks/read.js:28-38`）照 key 把它配到殘留的 `4baf` 那列。
- `4baf` 沒有任何修改紀錄，row_index 比 `(皮蛋）` 還大，溜狗紀錄的名單跟 17:02 的表一樣。最符合的經過是：`8e82` 補上編號（溜狗紀錄同時補編號），之後某次表上又出現沒編號的「暖暖」（清掉編號再打回，或複製整列），`dog-list.js:107` 用名字找不到，就建了 `4baf`。D1 看不出是哪一種，要看試算表的版本記錄才能確定。
- **(皮蛋）**：新A08（跟錢錢 2018012909 同籠），`79616fc7…`，沒編號、沒溜狗紀錄。這是暫住的標記列（GLOSSARY.md:117-119），不是新狗。表上已經刪了，D1 還留著，正是 `docs/ARCHITECTURE_NOW.md:57` 說的情況。另外留意它是半形左括號配全形右括號。
- 規模：主清單複本 119 列，扣掉兩列殘留是 117 隻、78 個籠位，其中 26 個籠位有兩隻以上（母幼A 7 隻、新B08 4 隻）。「通常一狗一籠」只對一半左右的狗成立。
- 待核對（不在主清單、沒離所紀錄）還有 4 隻：芊芊 2026072401、豆花 2026091401，以及兩隻沒名字只有編號的（2021100407、2022121503），可能是 #621 的舊殘留，不在本研究範圍。

### 殘留列造成的影響

1. 志工網站列出兩隻暖暖（資料包整張讀主清單複本，`worker/src/packs.js:129`）。
2. 皮蛋一直顯示暫住在新A08：網站把沒編號的括號列合到同名狗（`public/js/app.js:75-86`），表上已刪但 D1 還在。
3. 按殘留列的溜了：`accept.js:50` 沿用 `名:暖暖` 的狀態（`8e82`），寫回時 GAS 找不到「沒編號的暖暖」，丟「找不到唯一的狗，停止寫回」（`sheet-write.gs:75-83`），第 10 次失敗後停止重試（`docs/ARCHITECTURE_NOW.md:53`）。
4. 不能合併：兩隻都在主清單（`dog-merge.js:101`），管理網站「可能重複」也只配一隻在所、一隻不在所（`admin/public/js/dog-merge.js:42-43`），所以暖暖和皮蛋都不會出現在那裡。
5. 下一隻同暫用名的狗會接到舊狗：殘留的 `(乳白)` 列還在時，任何籠位出現沒編號的 `(乳白)`，`findMain` 都會找到舊列、改掉牠的籠位（`dog-list.js:37`、`94-96`）。殘留列清掉後，還有 `dog-list.js:107` 用溜狗紀錄名字找回的同一個問題。

## 3. 方案比較

| 方案 | 做法 | 能處理 | 會誤判或失效 | 要改的檔 | 碰到的既有決定 | 使用者看得到的改變 |
|---|---|---|---|---|---|---|
| 甲 殘留列清理 | 掃描連續兩次都在 `dog_list_extra`、沒有寫回中工作的主清單列，刪 `v3_sheet_main` 那列，記一筆修改紀錄 | 暖暖、(皮蛋）、沒編號離所的狗、刪掉的暫住列 | 掃描間隔約 4–10 小時，清掉前仍會重複顯示。被誤清的列下次編輯或掃描會重建（有編號時靠 `v3_dog_numbers` 認回同一隻） | `worker/src/dog-list.js`（`scanDogList`）、`worker/test/dog-list*.test.mjs`、`docs/ARCHITECTURE_NOW.md` | ARCHITECTURE_NOW.md:57「再發生時才處理」，現在已經發生 | 重複的狗與錯的暫住半天內消失，管理網站待核對多出來、可以合併 |
| 乙 括號名不用名字找回 | `dog-list.js:107` 沒編號又是括號名時不查 `v3_walks` | 下一隻 `(乳白)` 不會接到舊 `(乳白)` | 暫住標記列被刪後又寫回，會多建一隻假狗（本來就會建，影響小） | `dog-list.js`、測試 | 無 | 平常看不出來 |
| 丙 溜了核對 dog_id | `accept.js` 跟 `observe.js:69` 一樣核對溜狗狀態的 `dog_id` 等於主清單那隻 | 補編號後殘留的 `名:暖暖` 狀態不會被新同名狗沿用 | 核對不過時回 409，要決定是否改用新狀態 | `worker/src/today-walks/accept.js`、測試 | ADR 0018 的今日溜狗 module 只由入口呼叫（不受影響） | 平常看不出來 |
| 丁 單格改名帶舊值 | 單格改犬名且有 `e.oldValue` 時，GAS 送舊 key，Worker 用舊 key 找到舊列 | 打字蓋掉 `(乳白)` 改成 `暖暖`，最常見的情況 | 多格貼上、先清空再打（第二次沒有舊值）、Ctrl+Z 沒有舊值。管理者故意把離所狗那列直接改成另一隻新狗時會認成同一隻 | `apps-script/sheet-write.gs`（`onWalkSheetEdit`、待送內容要存舊 key）、`dog-list.js`、兩邊測試 | ADR 0018 第 4 點「只看出現，不追從哪裡消失」 | 改名後不再多一隻，溜狗紀錄接著算 |
| 戊 同籠位候選 | GAS 每批附上表上目前全部主清單 key，Worker 建新狗前找「同籠位、沒編號、不在表上」的舊狗，剛好一隻才認 | 多格貼上、同時改名又補編號、清掉編號再打回（暖暖）。同籠的狗一隻一隻改也行 | 同籠兩隻新狗同一次貼上改名（兩個候選，不猜）。改名同時換籠（找不到）。沒編號的狗刪列後同籠馬上進新狗（誤認）。暫住標記列要排除 | `sheet-write.gs`（`flushDogList`、`dogListScan` 的送出內容）、`dog-list.js`、`worker/src/index.js`（收新欄位）、測試 | ADR 0018 第 4 點、`docs/operations/dog-editing.md:67`「自動認改編號之後再說」 | 同上 |
| 己 認定後系統合併 | 丁、戊認定後照常建新狗，同一流程移出舊列，再呼叫系統版 `mergeDogs` 把舊狗併進來 | 認錯可以取消合併，快照永久保留 | 合併失敗（版本變了）就留成待核對，交給管理者 | `worker/src/dog-merge.js`（不需 Access 身分的入口、紀錄來源 `sheet`）、`dog-list.js`、測試 | #621 方案乙（管理者手動合併）只是先做的部分 | 修改紀錄出現「合併狗」，管理者可取消 |
| 庚 同籠位配對 | 管理網站「可能重複」加「同籠位、一隻在所一隻待核對」 | 自動認定沒把握的情況 | 共用籠位會多列幾組，要人判斷 | `admin/public/js/dog-merge.js`、`admin/public/js/checks.js`、測試 | 無 | 管理網站多一種提示 |
| 辛 Developer Metadata | 每列掛 `ROW` metadata 存 dog_id，GAS 讀列時帶上，Worker 先用 dog_id 認狗，建新狗後回傳 dog_id 讓 GAS 掛上 | 改名、改編號、同時改兩格、同籠多隻，都不用猜 | 排序、剪下貼上、複製整列、搬到已出所的行為官方沒寫，要實測。複製若連 metadata 一起複製，會兩列同一個 dog_id | `sheet-write.gs`（讀寫 metadata、一次性補掛）、`dog-list.js`、`index.js`、測試，要重新部署 Apps Script | ADR 0006（程式寫試算表的範圍）要 K 確認算不算「寫入」。`docs/research/2026-10-20-sheet-editors-in-d1-sync.md:12`「絕不用列號」（metadata 不是列號，不衝突） | 表面上看不出來 |
| 壬 隱藏欄 | 主清單加一欄隱藏的 dog_id，GAS 寫入 | 同辛 | 複製整列一定會複製 dog_id，只選部分欄排序會錯開，任何人取消隱藏都能改 | 同辛，外加試算表結構 | ADR 0006:21「其他欄位一律不寫入」 | 試算表多一欄 |

## 4. 外部文件查證

### Apps Script 編輯觸發

| 項目 | 結果 | 來源 |
|---|---|---|
| `e.value`、`e.oldValue` | 文件明寫：只有改的是單一儲存格才有。`oldValue` 在格子原本沒內容時是 undefined | [事件物件](https://developers.google.com/apps-script/guides/triggers/events) |
| `e.range` | 文件明寫：被編輯的格子或範圍 | 同上 |
| 多格貼上 | 文件只寫沒有 value／oldValue。一次貼上是不是一個事件、range 是否涵蓋全部：沒寫，要實測 | 同上 |
| 剪下貼上、拖曳移列 | 沒寫，要實測（2026-10-23 研究已列） | `docs/research/2026-10-23-gas-trigger-structure-changes.md` |
| 插入、刪除列 | onEdit 沒寫。`onChange` 只有安裝型，欄位沒有 `range`，`changeType` 有 `EDIT`、`INSERT_ROW`、`INSERT_COLUMN`、`REMOVE_ROW`、`REMOVE_COLUMN`、`INSERT_GRID`、`REMOVE_GRID`、`FORMAT`、`OTHER`，各值對應哪些操作沒寫。所以刪了哪一列官方給不出來 | [事件物件](https://developers.google.com/apps-script/guides/triggers/events)、[安裝型](https://developers.google.com/apps-script/guides/triggers/installable) |
| 程式寫入 | 文件明寫：程式執行與 API 要求不會觸發觸發器，例如 `Range.setValue()` | [簡易](https://developers.google.com/apps-script/guides/triggers)、[安裝型](https://developers.google.com/apps-script/guides/triggers/installable) |
| 漏事件 | 文件明寫：簡易 `onEdit` 最多排隊 2 個事件。安裝型（本 repo 用的，`sheet-write.gs:310`）有沒有同樣限制：沒寫 | [簡易](https://developers.google.com/apps-script/guides/triggers) |
| 安裝型以誰的身分跑 | 文件明寫：建立者的帳號 | [安裝型](https://developers.google.com/apps-script/guides/triggers/installable) |

對方案丁的意思：單格改名一定拿得到舊名字。先清空再打字是兩次單格編輯，第二次的 `oldValue` 是 undefined，拿不到 `(乳白)`，要靠方案戊補。

### Developer Metadata

| 項目 | 結果 | 來源 |
|---|---|---|
| 能掛在哪 | 文件明寫：列、欄、工作表、整份試算表。列的位置必須是單一一列 | [指南](https://developers.google.com/sheets/api/guides/metadata)、[`developerMetadata`](https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.developerMetadata) |
| 移動時 | 文件明寫：會隨位置移動與試算表編輯保持在原本的位置上。例子是第 5 列上方插入一列後，metadata 跟著到第 6 列 | [`developerMetadata`](https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.developerMetadata) |
| 刪除時 | 文件明寫：掛的對象被刪掉，metadata 跟著刪 | 同上 |
| 排序、剪下貼上、拖曳移列、複製整列、搬到另一個分頁 | 沒寫，要實測 | 同上、[`Range`](https://developers.google.com/apps-script/reference/spreadsheet/range)（`moveTo`、`sort` 說明沒提 metadata） |
| Apps Script 用法 | `Range.addDeveloperMetadata(key, value)`（範例用 `getRange('2:2')` 整列）、`getDeveloperMetadata()`、`createDeveloperMetadataFinder()` 搭配 `withKey`、`withLocationType`、`find()`。`DeveloperMetadataLocation.getRow()` 回傳那一列的 Range。`DeveloperMetadata.moveToRow`、`remove`、`setValue` 可以改 | [`Range`](https://developers.google.com/apps-script/reference/spreadsheet/range)、[`DeveloperMetadataFinder`](https://developers.google.com/apps-script/reference/spreadsheet/developer-metadata-finder)、[`DeveloperMetadataLocation`](https://developers.google.com/apps-script/reference/spreadsheet/developer-metadata-location)、[`DeveloperMetadata`](https://developers.google.com/apps-script/reference/spreadsheet/developer-metadata) |
| 數量上限 | 文件明寫：整份試算表 30,000 字元，每個工作表另有 30,000 字元，key 與 value 每個字元都算。dog_id 32 字元加短 key 約 35 字元一列，主清單 117 列約 4,100 字元，夠用 | [指南](https://developers.google.com/sheets/api/guides/metadata) |
| 誰看得到 | 文件明寫：有 `PROJECT`、`DOCUMENT` 兩種，可能被有檢視權限的人看到，不能放機密。dog_id 不是機密 | 同上 |
| 寫 metadata 會不會觸發 onEdit | 只有「程式執行不觸發」這條通則，沒有針對 metadata 的說明 | [簡易](https://developers.google.com/apps-script/guides/triggers) |

### 隱藏欄

官方沒有專門說明，以下是試算表的一般行為，要實測確認：複製整列會連隱藏格一起複製，兩列會帶同一個 dog_id。排序整個範圍時值跟著列走，只選幾欄排序就會錯開。手機 App 與網頁是否一致也沒寫。

### 配額

| 項目 | 消費者帳號 | Workspace | 來源 |
|---|---|---|---|
| 觸發器每日總執行時間 | 90 分鐘 | 6 小時 | [配額](https://developers.google.com/apps-script/guides/services/quotas) |
| 單次執行 | 6 分鐘 | 6 分鐘 | 同上 |
| UrlFetch | 每日 20,000 次 | 每日 100,000 次 | 同上 |
| 屬性讀寫 | 每日 50,000 次 | 每日 500,000 次 | 同上 |
| 超過時 | 拋例外、執行停止 | | 同上 |

方案辛每次編輯多一次 metadata 查詢，算在觸發器執行時間裡，要量。SpreadsheetApp 的呼叫次數官方沒有列額度。

Cloudflare D1：免費方案每次 Worker 呼叫最多 50 次查詢，文件明寫 `db.batch()` 整批只算一次（[D1 限制](https://developers.cloudflare.com/d1/platform/limits/)）。所以要數的是往返次數。`mergeDogs` 讀兩隻狗 1 次、每張表 1 次（12 張表），加最後 1 個 batch，約 14 次（`dog-merge.js:57-77`、`170`）。狗清單同步每批最多 10 列、每列 3–4 次（`dog-list.js:17-19`），所以一次請求最多再加 1 次自動合併，多的要留到下一次請求。repo 裡「50 句以內」的寫法（`dog-merge.js:8`）比文件保守，照著做不會超。

### 需實測清單（測試試算表，安裝型 onEdit 與 onChange 都記下事件內容與每列 metadata）

1. 單格改犬名、先清空再打字、多格貼上同時改犬名與編號：`oldValue`、`range` 各是什麼。
2. 列掛 metadata 後：資料，排序範圍（整個範圍與只選幾欄）、拖曳移列、Ctrl+X 貼到別列、Ctrl+X 貼到「已出所」、複製整列貼到新列、刪列、插入列、Ctrl+Z。每次看 metadata 在哪一列、有沒有被複製、有沒有消失。
3. 同樣操作在手機 App 做一次。
4. GAS 寫 metadata 會不會觸發 onEdit、onChange。
5. 每次編輯用 finder 讀整張主清單 metadata 要多少時間。

## 5. 殘留列清理（C）

- **判斷**：`scanDogList` 已經存上一次的 `dog_list_extra.keys`（`dog-list.js:279-284`）。這次的 `extra` 和上一次都有、開頭是 `main:` 的 key 才處理。單次不夠，因為 GAS 讀表後放開鎖才送指紋（`sheet-write.gs:501-506`），中間有人加列、編輯觸發先送到，指紋表有了這個 key，掃描卻沒有，會被誤列。
- **寫法**：刪 `v3_sheet_main` 那列，用 `guardedDogBatch`（`dog-list.js:1`、`133`）帶這隻狗的 revision，同批記一筆修改紀錄（來源 `sheet`）。指紋表照 `applyDeparted` 的做法刪掉那個 key（`dog-list.js:184`）。不刪 `v3_dogs`，狗變成待核對（GLOSSARY.md:121-123）。
- **溜狗狀態 `v3_walk_state`**：不刪，它是寫回佇列的外鍵目標（`db/compact-schema.sql:20`、`27`）。`withTodayWalks` 只回主清單上有的 key（`today-walks/read.js:38`），網站就不會顯示。那隻狗的寫回佇列還有沒完成的工作（`v3_walk_outbox` 狀態不是 synced、superseded）就先不移，等下一次掃描，免得寫回失敗卡住。暖暖的 `名:暖暖` 三版都已 synced。
- **資料包**：刪主清單列會觸發 `packs_v3_sheet_main_DELETE`（small 加 1，有離所紀錄時那年也加）、`walked_v3_sheet_main_DELETE`（walked 加 1）、`dog_edit_v3_sheet_main_DELETE`（revision 加 1）（`db/compact-schema.sql:403`、`407`、`496`），網站自動更新，不用新觸發器、不用 migration。
- **today-walks module**：不碰 `v3_walks` 與溜狗修改紀錄（只由 module 寫，ADR 0018 補充，`worker/test/standards.test.mjs` 擋）。
- **D1 量**：掃描一天三次，每次多 1 次讀「殘留 key 對應的主清單列與寫回工作」、每隻殘留 1 個 batch，跟資料量無關，符合 CODING_STANDARDS.md:5-11。每次掃描最多處理幾隻要設上限，避免超過每次呼叫 50 次查詢。
- **清掉後還要人工合併**：暖暖清掉後，`4baf` 變待核對，管理網站「可能重複」會配出 `暖暖（在所）` 和 `暖暖（待核對）`，把 `4baf` 併到 `8e82`。同一天同一位志工的溜狗紀錄不會重複（`dog-merge.js:24`、`31`）。`(皮蛋）` 去掉括號後跟皮蛋配對，可以併到皮蛋 `55c592b9…`。

## 6. 自動合併（D）

- `mergeDogs` 要 Access 的 `actor`（`dog-merge.js:134-137`），紀錄寫死「管理者」與來源 `access`（`dog-merge.js:130-133`）。系統用要另開入口：不需 actor、名字寫「試算表（自動認定同一隻）」、來源 `sheet`（`editlog.js:64` 已有）。前例是回所認定記「試算表（自動認回所）」（`dog-list.js:113`）。
- 版本：同一流程先讀兩隻的 revision 再傳，被擋（409）就不合併，留給管理者。
- 被併的狗必須先不在主清單（`dog-merge.js:101`）。方案丁、戊認定時已經知道舊列不在表上，可以在建新狗那一批一起刪舊列，下一次往返再合併。
- **取消合併照用**：`unmergeDogs` 只看 `kind='merge'` 與留下那隻的 dog_id（`dog-merge.js:180`），不看來源，由管理者在修改紀錄按。取消後舊狗重建但不回主清單，變成待核對，這正是要的。合併紀錄永久保留（`editlog.js:28`、`98-106`），一般修改紀錄只留 14 天。
- **陷阱**：合併搬過去的溜狗紀錄，編號用留下那隻的目前編號，沒編號就維持空白，狗名照當時的（`dog-merge.js:34`）。留下那隻還沒編號時，這些 `(乳白)` 紀錄仍然「沒編號、名字是 (乳白)」，下一隻 `(乳白)` 會被 `dog-list.js:107` 找到。所以結論第 2 項要跟自動合併一起做。
- 為什麼不直接沿用舊 dog_id 改名：最省，但認錯時沒有工具拆回來，修改紀錄 14 天後也會清掉。方案戊是推測，用可以取消的合併比較安全。方案丁是管理者自己蓋掉那一格，直接沿用也可以，這點是技術選擇，實作時記進 ADR。

## 7. 既有決定（E）

| 決定 | 內容 | 擋住什麼 |
|---|---|---|
| ADR 0006:21 | 網站寫試算表只限兩欄與備註，其他欄位、分頁一律不寫 | 隱藏欄（壬）直接衝突。metadata（辛）不是欄位，但仍是程式寫試算表，要 K 確認 |
| ADR 0018:13 第 4 點 | 換籠、離所只看狗新出現在哪，不追從哪裡消失、不處理排序與刪列 | 方案丁、戊要看「從哪裡消失」，要 K 重新開放這點。方案甲只用既有掃描結果，比較接近現行做法 |
| `docs/ARCHITECTURE_NOW.md:57` | 主清單刪掉的列 D1 不跟著刪，K 2026-10-26 決定再發生時才處理 | 方案甲，現在已經發生（皮蛋、暖暖） |
| `docs/operations/dog-editing.md:67`、`dog-merge.js:1` | #621 選方案乙：先手動合併，自動認改編號之後再說 | 方案丁、戊、己是「之後」的部分，不違反，但要 K 決定現在做 |
| `docs/operations/dog-editing.md:70` | 主清單上的狗只能當留下的那隻，兩隻都在主清單不能合併 | 自動合併前必須先移出舊列 |
| GLOSSARY.md:117-119 暫住 | 括號名、沒編號、有同名狗的列是暫住標記 | 方案戊與乙要把「括號裡的名字是主清單上另一隻狗」排除，不能把括號一律當暫用名 |
| `docs/research/2026-10-20-sheet-editors-in-d1-sync.md:12` | 列對狗用編號、沒編號用犬名，絕不用列號 | 不擋 metadata（跟著列走，不是列號） |
| `docs/design/history/267-identity-rollout.md` | 是志工身分（`v3_volunteers`、`v3_identity_names`）的上線紀錄，不是狗的身分 | 不相關，不擋 |

## 8. 要使用者決定的問題

1. **殘留列要不要自動移出主清單？** 例：表上已經沒有沒編號的暖暖、也沒有 `(皮蛋）`，系統等兩次保險掃描（最多約一天）確認後，網站上那隻多的暖暖和「皮蛋暫住新A08」就消失，多的那隻暖暖變成管理網站待核對，等你合併。不移的話，要你在試算表外另外處理，現在也合併不了。
2. **要不要自動認定同一隻，還是維持手動合併？** 例：`(乳白)` 在 C區11 還沒編號時改成「小白」，自動認定的話網站上只有一隻小白、之前溜 `(乳白)` 的紀錄接著算，修改紀錄記一筆「合併狗」，認錯可以取消。手動的話會先多一隻 `(乳白)` 待核對，你在管理網站併。
3. **同籠位認定要不要以「舊名字有括號」當條件？** 例：母幼A 有 7 隻。條件加上，只有 `(乳白)` 這種暫用名改名才會自動認，沒編號的「暖暖」離所、同一天同籠進來的新狗不會被認成暖暖，但沒編號的暖暖改成「暖暖寶」就要手動合併。條件不加，兩種都會自動認，前者會認錯（可以取消合併）。
4. **要不要先花時間實測 Developer Metadata？** 例：實測通過的話，`(乳白)` 那一列從頭到尾都帶同一個 dog_id，改名、補編號、一次貼兩格都不用猜，試算表看起來不變，但 Apps Script 要重新部署、每列補掛一次。不通過（例如排序後 metadata 跑掉）就停在方案丁、戊。
5. **程式在試算表每列掛看不見的 dog_id，算不算 ADR 0006 禁止的「寫入」？** 只有選擇做第 4 題時需要回答。
