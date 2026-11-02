# 兩項架構整理的事實查核：狗狀態與離所、試算表列認狗（2026-11-02）

日期：2026-11-02（台灣）。基準 commit `7b2c32c2`，worktree `739-stay-buckets-list-e2468b`。只讀程式、migration、`db/compact-schema.sql`、ADR、git 歷史與規則檔，沒有查正式 D1、沒有改程式、沒有跑測試。行號以本次讀到的版本為準。

查核對象是規劃中的兩項整理。項目 2 把狗狀態（在所／已出所／待核對）、顯示用的編號、記離所收成一個 module。項目 1 接著把 `worker/src/dog-list.js` 裡「這一列是哪隻狗」的邏輯（`applyMain` 等）收成一個 module。查核方式是逐條試著推翻。

## 先看：會改變計畫的事

1. **「只要改 GLOSSARY、不用新 ADR」不成立**（說法 14）。在 `worker/src/` 或 `worker/src/admin/` 新增檔案，`scripts/diagram-facts.test.mjs:135-143` 會直接失敗，一定要改 `docs/ARCHITECTURE.md` 的元件段落。`docs/ARCHITECTURE_NOW.md:28`、agent-log、`scripts/diagram-reminder.mjs` 的 `WATCH` 也要跟著動，agent-hub 總覽頁要重新產生。清單見說法 14。
2. **既有測試不能全當安全網**（說法 13）。`worker/test/standards.test.mjs:80` 的 #747 守門和 `worker/test/dog-list.test.mjs:424` 的 `fixed_care` 守門都只掃 `dog-list.js` 這一個檔。`applyMain` 搬走之後這兩條照樣通過，但已經保護不到搬走的程式，要手動把新檔加進去。`FULL_SCAN_OK` 的 3 個鍵帶檔名，搬了就失敗（這個是好事）。另外 `groups_json`、`last_walked_date` 的內容、一隻狗有多個編號時 pair 紀錄寫哪個編號，都沒有測試釘住。
3. **`groups_json` 不要順手對齊**（說法 6、7）。`[]` 是 K 確認過的決定（ADR 0026 第 3 點「試算表備註與常遛狗群空著」），依 CORE_RULES §3 視為鎖定。而且 `last.groups` 雖然寫進 API 和資料包，repo 裡沒有任何畫面讀它，對齊了使用者也看不到。`last_note` 根本對齊不了，主清單那列已經刪了，表上備註沒有來源。
4. **「其他地方都用 MAX」不精確，統一會多出第二個行為改變**（說法 2、5）。實際規則是「主清單那列優先，沒有才取最大」。純 MAX 只有 `activities.js:75` 和 `dog-depart.js:39`，其中 `activities.js:75` 對在所的狗也走 MAX，主清單編號不是最大時會跟別頁不同。項目 2 若把「顯示的編號」收成一個函式，這裡就會變。
5. **MAX 本身是有條件成立的規則**（說法 3）。編號都是 10 碼時字串比較等於日期先後。試算表寫進來的編號沒有格式檢查，合併狗搬編號也沒有比大小，這兩條路都可能讓 MAX 不是最新。repo 查不到正式資料有沒有這種編號。
6. **項目 2 不會讓項目 1 明顯變小**（說法 1）。`applyDeparted` 那 9 行不在 `applyMain` 裡。`applyMain` 自己也寫 `v3_dog_departures`（`dog-list.js:189-190`），如果項目 2 要把離所寫入都收走，反而會碰到項目 1 的範圍。
7. **修改歷史要改**（說法 16）。#771、#784 沒有改 `applyMain`，清單漏掉的 #775（`05d31f00`）反而有改。

## 判定總表

| # | 說法 | 判定 |
|---|---|---|
| 1 | 兩項都要改 `dog-list.js`，項目 2 讓項目 1 變小 | 部分正確 |
| 2 | `dog-pairs.js:47` 用 MIN，其他都用 MAX | 部分正確 |
| 3 | 修改紀錄可能顯示舊編號，MAX 是字串比較 | 部分正確（現象正確，MAX 的前提要補） |
| 4 | 改 MAX 只影響新紀錄 | 正確 |
| 5 | MIN 改 MAX 是項目 2 唯一刻意的行為改變 | 部分正確 |
| 6 | `groups_json` 差異，其他欄位差異 | 正確（差異比題目多，見表） |
| 7 | 對齊會改變存的資料 | 部分正確（`groups_json` 使用者看不到，其他 `last_*` 看得到） |
| 8 | agent-split 與 codex.md 的內容 | 部分正確（地基沒有寫死給 Claude） |
| 9 | `dogEdit.crash` 不存在，500 沒有訊息 | 部分正確（後端對，使用者仍看得到通用訊息） |
| 10 | compact.js 四個函式沒人用 | 正確 |
| 11 | 不用改表、不用 migration | 正確（有前提） |
| 12 | `syncDogList`、`scanDogList` 是對外介面 | 部分正確 |
| 13 | 既有測試可當「行為不變」的安全網 | 部分正確 |
| 14 | 只要改 GLOSSARY、不用新 ADR | 錯誤 |
| 15 | `dog-list.test.mjs` 65 行 raw prepare，fixture 跑真的 GAS | 正確（有補充） |
| 16 | #771、#772、#773、#774、#784、#787 都改了 `applyMain` 或它的 helper | 部分正確 |

## 排程

### 1. 兩項都要改 dog-list.js，項目 2 讓項目 1 變小：部分正確

- 兩項都要改 `dog-list.js`：正確。項目 2 動 `dog-list.js:25` 的 import、`:256-264` 的寫入、`:274-277` 的待核對判斷。行號正確，`:256-259` 是讀舊編號、狗群、性別介紹，`:260` 刪舊離所，`:261-264` 是 INSERT。
- 「讓項目 1 變小」：證據很弱。`applyMain` 在 `:118-200`，搬走 `:256-264` 不影響它。`applyDeparted` 留在原檔的部分仍有「這列是哪隻狗」（`:252` 的 `findMain`、`:274` 用編號找待核對的狗）。
- 重疊：`applyMain` 也寫離所表（`:189` 的 `dropDeparture`、`:190` 的 `returned_number`），`returnedDog`（`:236-240`）也讀離所表。離所表的其他寫入者還有 `dog-list.js:286`、`dog-edit.js:204`、合併狗（`dog-merge.js:46` 的 `TABLES`）。項目 2 要先決定這幾處算不算「記離所」，算的話會碰到項目 1 的 `applyMain`。

## 編號規則（MIN 與 MAX）

### 2. 除了 dog-pairs.js:47 都用 MAX：部分正確

`dog-pairs.js:47` 確實是 `MIN(number)`，而且是整個 `worker/src` 和 `admin/` 唯一對編號取 MIN 的地方。其他的分三種，不是全部 MAX。

| 位置 | 實際規則 |
|---|---|
| `compact.js:131-132`、`:143-144` | 主清單那列（`number<>''`）優先，沒有才 MAX |
| `admin/dogs.js:9`（實際路徑 `worker/src/admin/dogs.js`） | 主清單那列（`NULLIF(m.number,'')`）優先，沒有才 MAX |
| `activities.js:75` | 純 MAX，在所的狗也一樣 |
| `dog-depart.js:39` | 純 MAX，但前面要求待核對，實際上都不在主清單 |
| `dog-merge.js:68`、`:76` | **不是 MAX**。`:68` 取主清單那列（`ORDER BY row_index LIMIT 1`，沒排除空字串），`:76` 退回 `numbers.at(-1)`（`:69` 依編號升冪排，等於程式裡的 MAX） |

題目沒列到的：

- `dog-photo.js:73-74`：`currentNumbers[0] || numbers.at(-1)`，同樣是主清單優先再取最大。
- `dog-edit.js:119-121`、`stays.js:65`：主清單編號裡 10 碼的那些 `.sort().at(-1)`，用來擋「舊編號不能晚於目前編號」。
- `dog-pairs.js:27-39`（`goneWrites`）：直接用主清單那列的 `m.number`，沒有查表。`readPairs`（`:64-69`）也是主清單那列。
- 不是編號的 MIN，不相關：`dog-pairs.js:64`、`admin/dogs.js:6` 的 `MIN(row_index)`，`compact.js:95` 的 `MIN(dog_id)`。
- `admin/public/js` 沒有自己挑編號，都用 API 給的。入所日要最舊編號是另一件事（ADR 0005、`BQDates.firstIntake`），不是「目前編號」。

### 3. 修改紀錄可能顯示舊編號：部分正確

**現象成立，但條件窄。** `newDogPairs` 讀 MIN（`dog-pairs.js:47`），經 `pairLog`（`:21-23`）寫進 `editLogWrites` 的兩處：`number`（`v3_edit_log.dog_number`）和 `before.number`（`before_json`，`editlog.js:86-87`）。這個值沒有其他用途，`v3_dog_pairs` 不存編號。

顯示的地方：

- 管理網站修改紀錄頁：`admin/public/js/updates.js:40` 顯示 `dogNumber`，改前欄經 `edit-values.js:33` 顯示 `before.number`。資料頁「系統自動判斷」列表、編輯抽屜讀同一份（`editlog.js:34`）。
- 志工網站編輯紀錄頁：`readEdits` 只排除 `walk`（`editlog.js:121-124`），所以 pair 也會出現，`public/js/edits.js:22-24` 顯示。
- 資料頁的「可能是同一隻」列表（`readPairs`）不受影響，它不顯示待核對那隻的編號。

要同時滿足才會看到：那隻狗有兩個以上編號、確認消失、7 天內（`GONE_KEEP_MS`）同籠新建了狗。紀錄保留 14 天（`editlog.js`，pair 不在 `MERGE_KINDS`）。同一隻狗的兩條路徑寫的值也可能不同：確認消失時的配對記主清單那列的編號，之後同籠新建狗的配對記 MIN。MIN 是 #775（`05d31f00`）加修改紀錄時帶進來的，程式和 commit 都沒有寫理由。

**MAX 的前提要補：**

- `v3_dog_numbers.number` 是 TEXT（`db/compact-schema.sql:100`），只有 `length(number)>0` 的 CHECK，MAX 是字串比較。
- 10 碼、前 8 碼是日期（GLOSSARY「編號」、ADR 0005、ADR 0021）時，字串順序等於日期先後，同一天再比後 2 碼。在這個範圍內 MAX 就是最新。
- 沒有 ADR 規定「目前編號等於 MAX」。依據只有 ADR 0026 第 2 點「最新的編號」和 `activities.js:74`、`compact.js:142` 的註解。

**會讓 MAX 不是最新的情況：**

1. 試算表寫入沒有格式檢查：`applyMain` 把 `dog.id` 直接寫進表（`dog-list.js:143`、`:173`、`:180`），`cleanDog`（`:49`）只去空白。例如 `9001`（測試資料就用這種）字串上大於 `2026103001`。repo 裡看得到的真實編號都是 10 碼，正式資料有沒有例外查不到。
2. 合併狗搬編號不比大小：`dog-merge.js:31` 的 `move: row => row`。留下那隻在主清單的編號比被併那隻小時，MAX 取到被併那隻。這時主清單優先的頁面顯示主清單的，`activities.js:75` 顯示另一個。試算表改編號留下的重複（#621）是常見來源。
3. 網站補舊編號的擋法有缺口：`dog-edit.js:119-123`、`stays.js:65`、`:77` 只在有 `current` 時才擋「不能晚於目前編號」。待核對和已出所的狗沒有主清單編號，可以補一個更晚的日期，MAX 就換成它。目前編號不是 10 碼時同樣不擋。

結論：MAX 當「不在主清單的狗」的最佳猜測可以接受，當「目前編號」的定義則不夠，主清單那列才是準的。

要確認正式資料，可以交給 K 跑唯讀查詢（找出不是 10 碼的編號）：

```sql
SELECT number, dog_id FROM v3_dog_numbers WHERE number NOT GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]';
```

### 4. 改 MAX 只影響新紀錄：正確

`worker/src` 沒有任何 `UPDATE v3_edit_log`，舊紀錄不會被改寫，超過 14 天由 `pruneEdits` 清掉。值只走 `pairLog` 一條路（見說法 3）。後台用編號篩選也不受影響，`admin/edits.js:53` 同時比 `dog_number`、`dog_id` 和這隻狗的所有編號。

### 5. MIN 改 MAX 是唯一刻意的行為改變：部分正確

四處待核對定義的差異：

| 位置 | 定義 | 跟 `pendingDog` 的差別 |
|---|---|---|
| `dog-depart.js:15` `pendingDog` | 不在主清單、沒有離所紀錄 | 基準。不檢查狗還在，呼叫端各自保證（`:21` `FROM v3_dogs`、`:39` `FROM v3_dogs`、`dog-list.js:274` 從 `v3_dog_numbers` 找、`:52` 的 batch 條件靠 `dogRevisionIs`） |
| `dog-pairs.js:43-44` `STILL_GONE` | 多 `EXISTS(v3_dogs)` | `v3_sheet_gone` 沒有外鍵（`db/compact-schema.sql:554-558`），所以要多查。寫死別名 `g`。寫入條件（`:50`）另外要求 `v3_sheet_gone` 有這隻。讀取另有籠位和 `gone_at` 條件（`:48`） |
| `dog-pairs.js:63-66` `PENDING` | 別名 `p.gone_dog_id`、靠 JOIN `v3_dogs` 保證狗還在 | 額外要 `status='pending'`，而且表上那隻要在主清單 |
| `admin/dogs.js:29` | JS 判斷，不是 SQL | 主清單優先於離所紀錄，同時有兩者算在所。沒辦法共用 SQL 片段，module 要提供兩種形式 |

對 `v3_dogs` 裡的狗，四處算出的「是不是待核對」相同。會出問題的是合併的寫法：

- `pendingDog` 用 `?` 綁兩次（`dog-depart.js:52` 的 `args: [dogId, dogId]`）。把 `EXISTS(v3_dogs)` 加進去，參數數量會變。
- 拿掉 `EXISTS`，寫入條件就少一道檢查。實際風險低：`v3_dogs` 只有 `dog-merge.js:191` 會刪，`mergedPairWrites`（`dog-pairs.js:57-60`）同批刪掉籠位紀錄。
- 沒有一處看 `returned_number`。退養回來換新編號的狗留著舊離所列（`dog-list.js:189-190`），之後再從主清單消失，狀態是已出所而不是待核對，晚到的已出所列也不會記（`:274-275`）。ADR 0026 第 1 點把「已有離所紀錄的狗不動」當成刻意的，但這個情況的結果值得在 module 裡寫清楚。

所以待核對可以零行為改變地合併。「唯一」不成立的地方在編號：把顯示編號收成一個函式會改到 `activities.js:75`（見說法 2），其他差異還有 `compact.js` 排除空字串，`dog-merge.js:68` 不排除但靠 `||` 退回，沒編號時 `activities.js` 回 `''`，`compact.js` 回 NULL 後被濾掉。要維持零改變，項目 2 就得保留這些差異或明講改了哪些。

## 離所快照

### 6. 兩句 INSERT 的差異：正確（差異比題目多）

`groups_json` 成立，但內容不是「群」：`dog-list.js:257` 存的是跟這隻狗同欄的**其他狗的名字**（用 `old.name` 比對），不是群名。全部欄位：

| 欄 | 一般離所 `dog-list.js:261-264` | 待核對 `dog-depart.js:19-23` | 差在哪 |
|---|---|---|---|
| `dog_id` | `old.dog_id` | `d.dog_id` | 同一隻 |
| `number`、`last_number` | 已出所那列的編號 | 呼叫端給 | 手動時是 MAX（`dog-depart.js:39`） |
| `name`、`last_name` | `old.name`（主清單複本） | `d.name`（`v3_dogs`） | 來源不同，平常同步（`dog-list.js:155`） |
| `departed_date`、`date_source` | 判讀，否則今天、`seen` | 同步路徑相同，手動是填的日期、`manual` | 來源不同 |
| `seen_date` | 今天 | 今天 | 相同 |
| `reason`、`matched`、`flags_json` | 判讀 | 同步路徑相同，手動是選的原因、`''`、`[]` | 手動不判讀 |
| `last_cage` | `old.cage` | `COALESCE(v3_sheet_gone.cage,'')` | 籠位可能是空字串 |
| `last_walked_date` | `old.walked_date`（表上的欄，可能 NULL） | `MAX(v3_walks.walk_date)` | 來源不同，值可能不同 |
| `last_note` | `old.note` | 固定 `''` | 待核對沒有備註 |
| `last_sex` | `extra?.sex \|\| ''` | `d.sex` | 實際相同（NOT NULL DEFAULT `''`） |
| `last_intro` | `extra?.intro \|\| ''` | `COALESCE(intro,'')` | 實際相同 |
| `former_json` | 程式先讀再 `JSON.stringify` | SQL 內 `json_group_array` | 內容相同（都排除本編號、依編號排），讀取時機不同 |
| `groups_json` | 同欄其他狗的名字 | 固定 `'[]'` | 題目所說 |

句子層級的差異：一般離所先 `dropDeparture`（`:260`）、同批 `dropMainRow`（`:266`），INSERT 用 VALUES 沒有條件。待核對是 `INSERT…SELECT … WHERE pendingDog`，不刪別的。手動另外寫 `depart` 修改紀錄和操作者，同步兩條路徑都不寫修改紀錄。Guard 也不同：`guardedDogBatch`（`dog-list.js:276`、`:288`）對手動的 `batchIf`（`dog-depart.js:52`）。

### 7. 對齊會改變存的資料：部分正確

存的資料確實會變，只影響之後新寫的列（既有列除非另外回填）。使用者看不看得到要分開看：

| 欄 | 讀取 | 使用者看得到嗎 |
|---|---|---|
| `groups_json` | `compact.js:241-243` 放進 `last.groups`，送到 `/api/departures` 和資料包 | **看不到**。`public/js/dog-data.js:7-26` 不讀每隻狗的 `groups`，`readDepartureIndex`（`packs.js:383-386`）也不帶，已出所詳情（`detail.js:91-132`）沒有狗群段落。`admin/public/js` 同樣沒讀 |
| `last_cage` | 同上，`last.cage` | 看得到，「最後籠位」（`detail.js:110`）和分析頁 |
| `last_walked_date` | `last.walkedDate` | 看得到，「上次溜」（`detail.js:114`） |
| `last_note` | `last.note` | 看得到，「試算表備註 離所前最後一次」 |
| `last_intro` | `last.intro` | 看得到，介紹段落 |
| `last_sex` | `last.sex` | 看不到，`analysis.js:487` 用 `e.sex` 蓋掉（`r.current_sex`） |
| `former_json` | `last.formerIds` | 看得到，影響入所日 |

另外三點：

- `groups_json` 走 API 公開，其他系統若有讀 repo 裡看不到。
- ADR 0026 第 3 點把空著當成決定，要對齊得先讓 K 重新開放。待核對的狗消失後，`applyGroup` 下一次處理那一欄就會把牠濾掉（`dog-list.js:298-299`），所以就算對齊，內容也不可靠。
- 反方向也是選項：既然沒有人讀，一般離所可以不再查狗群（`:257` 每次離所省一次讀取），但那是新決定，不在這次範圍。

`last_note` 無法對齊，主清單那列確認消失時已經刪了，`v3_sheet_gone` 只存籠位。

## Agent 與 Codex 規則

### 8. agent-split 與 codex.md：部分正確

- `docs/agents/agent-split.md:3`「Worker 和網站給 Claude」：正確。
- 地基：`:4` 寫的是「交給參與過決策討論的那一方」，沒有寫死給 Claude。這次討論是 Claude 參與所以結果相同，但原文另外容許「已經交出去的話，合併前由握有脈絡的一方跑 `/code-review`」。
- `agent-hub/docs/rules/codex.md`：`-m gpt-6-luna` 一律要加、Sol 約為 Luna 的 20 倍、依讀進去的 token 計算、「規格明確、可自己驗證的小腳本」都正確。補充：原文還限定「腳本短到 Claude 自己寫比交辦快時，也不交辦」，可能消耗 credits 時要先取得使用者確認。
- 跟這次的關係：`agent-split.md:8` 碰表結構、API 介面的票要跑完整 `/code-review`。這兩項不動表，但有動 Worker，分級要自己判斷。

## 順帶發現

### 9. dogEdit.crash：部分正確

- `index.js:930` 讀 `dogEdit.crash`：正確。`DOG_EDITS`（`:278-285`）五種都沒有 `crash`，這一行從 `3eba0194`（#472）就在。`:640-643` 的 `crash` 陣列是另一張路由表（`SITE_ROUTES`）的。
- 回應：`fail(500, undefined, allowed)` 經 `:110-112`、`:121` 的 `JSON.stringify` 拿掉 `error`，本文是 `{"ok":false}`，狀態碼 500。
- 只有非預期錯誤會走到：`editDog` 內帶 `status` 的錯誤自己回（`:274`）。
- 前端不是空白：`api-response.js` 回 `{ ok:false, status:500, data:{ok:false}, error:'http' }`，休養、介紹、出入所顯示「沒有存進去（500），請稍後再試」（`detail-rest.js:69`、`detail-intro.js:70`、`detail-stays.js:118`），固定照顧顯示「沒有存進去，請稍後再試」（`detail-fixed-care.js:45`）。所以影響是少了原本要給的那句，不是使用者看不到訊息。

### 10. compact.js 沒人用的函式：正確

- 定義在 `compact.js:157`、`:169`、`:193`（`saveFixedCare`、`saveRest`、`saveStays`）和 `:180`（`removeFormerNumber`）。
- import compact.js 的全部是具名匯入：`worker/src/index.js:19`、`packs.js:5`、`dog-list.js:20`、`worker/test` 六個檔、`scripts/migration-0006`、`migration-0008`，都沒有前三個。`worker/`、`admin/`、`scripts/` 沒有 `import * from compact`、`export *`、動態 import compact。
- `removeFormerNumber` 只有 `worker/test/dog-list.test.mjs:10`、`:99` 用。這個測試靠它準備資料，刪函式要一起改測試。
- 同名的 `BQApi.saveRest`（`public/js/api.js:65-68`、`scripts/api.test.mjs:21`）是前端呼叫 API，不是這幾個。

## 宣稱不用額外工作的決定

### 11. 不用改表、不用 migration：正確

搬程式和 MIN 改 MAX 都不碰結構，`v3_numbers_dog` 索引照用。ADR 0026 第 4 點也是同樣的結論。前提是不回填舊資料，要回填 `groups_json` 或舊的 pair 紀錄才需要資料變更（`docs/agents/data-changes.md`）。

### 12. syncDogList、scanDogList 是對外介面：部分正確

正式程式對了一大半，但還要加 `DOG_LIST_ROWS_MAX`，測試和外部約定也算介面。

| 匯出 | 誰匯入 |
|---|---|
| `syncDogList` | `worker/src/index.js:17`、`worker/test/sheet-automerge.test.mjs:10` |
| `scanDogList` | `worker/src/index.js:17` |
| `DOG_LIST_ROWS_MAX` | `worker/src/index.js:17`（`:854` 用） |
| `applyDogListRows` | `worker/test/dog-edit.test.mjs:9`、`worker/test/walk-log.test.mjs:8`，正式程式不用 |
| `MISSING_MAX` | `worker/test/sheet-missing.test.mjs:7` |
| `MISSING_CONFIRM_MS` | 沒有人匯入，只在 `dog-list.js:347` 用 |
| `unitKey` | 沒有人匯入，只在 `dog-list.js:400` 用 |
| `stayTarget` | 沒有人匯入。`migrations/0021_sheet_stays.sql:15` 只在註解提到，規則用 SQL 另外寫了一份 |
| `admin`、`scripts`、`migrations` | 都沒有匯入 `dog-list.js` |
| `pendingDog` | `dog-list.js:25`（`:274` 用），其餘在 `dog-depart.js` 內 |
| `pendingDepartureWrite` | `dog-list.js:25`（`:276` 用），其餘在 `dog-depart.js` 內 |
| `departDog` | `worker/src/admin/index.js:4` |
| `DEPART_REASONS` | 沒有人匯入 |

程式碼 import 看不到的介面：

- GAS 跟 Worker 的單位 key：`apps-script/sheet-write.gs:417`、`:528`、`:584` 另外寫一份 `main:編號`、`名:犬名`，對應 `dog-list.js:38-47`。
- 網站也有一份暫住合併：`public/js/app.js:75` 的 `mergeTempCages`（見 `dog-list.js:10`）。
- 測試直接讀 `v3_sync_state` 的 `dog_list_fp`（`worker/test/dog-list.test.mjs:275`、`:294`、`:410`、`worker/test/dog-edit.test.mjs:495`、`:525`）。

### 13. 既有測試當安全網：部分正確

**搬程式就會失敗的（會提醒人，算好事）：**

- `worker/test/standards.test.mjs:20-23`：`FULL_SCAN_OK` 的鍵是「檔名: SQL 開頭」。`readSheetRows` 的兩句（`:20`、`:21`）和 `applyNotes` 那句（`:23`）換檔就同時報「新的整張讀」和「例外已不在程式裡」。項目 2 碰到的 SQL 都帶 WHERE，不受影響。
- `scripts/diagram-facts.test.mjs:135-143`：新檔沒寫進元件段落就失敗。刪掉或改名段落提到的檔（`dog-depart.js`、`dog-pairs.js`）也失敗。檢查只看 `worker/src`、`worker/src/admin`、`worker/src/today-walks` 三個資料夾，開新子資料夾時檔名寫進段落反而失敗，要一起改測試。
- `scripts/diagram-facts.test.mjs:145-160`：依據行號超過檔案長度就失敗。`docs/ARCHITECTURE.md:266` 引用 `worker/src/dog-list.js:324-351`，項目 1 讓檔案少於 351 行就會失敗。
- 把匯出搬走時，上表列的測試 import 會壞。留轉出口（re-export）就不會。

**搬了不會失敗、但悄悄失效的（這才是風險）：**

- `worker/test/standards.test.mjs:79-85`（#747，不寫 `v3_walks`、不記溜狗類紀錄）只掃 `dog-list.js`。`applyMain` 搬走之後仍通過，新檔卻不受保護。`dog-list.js` 整個刪掉則會 TypeError。
- `worker/test/dog-list.test.mjs:424`（#512，不碰 `fixed_care`）同樣只讀這個檔。

**目前沒有衝到，但有條件的：**

- `worker/test/edit-log-single.test.mjs:17-20`：`DYNAMIC_INSERT_OK` 只允許 `dog-merge.js`、`identity.js` 用 `INTO ${…}`。新 module 照寫靜態 SQL 就沒事。`editlog.js` 以外寫 `v3_edit_log` 一律被擋，兩項都走 `editLogWrites` 就好。
- `worker/test/dog-list-walks.test.mjs:100`、`worker/test/walk-log.test.mjs:155` 靠「batch 累積 8 句」插入競爭，`worker/test/sheet-automerge.test.mjs:195` 靠 SQL 開頭字串比對。只搬不改順序和文字就不會壞，順手調整句子就會。
- `worker/test/walk-accept.test.mjs:129` 只掃 `today-walks/`，不相關。

**測試沒釘住的（行為變了也不會紅）：**

- 一般離所的 `groups_json` 內容：`dog-list.test.mjs`、`pending-depart.test.mjs` 都沒有檢查。
- `last_walked_date`：兩邊都沒有檢查（`dog-list.test.mjs:78` 只看 `last_cage`、`last_note` 等，`pending-depart.test.mjs:46` 看 `last_cage`、`last_name`、`date_source`、`former_json`）。
- 多編號的 pair 紀錄：`judgements.test.mjs:78-79` 是沒編號的例子，`dog-pairs.test.mjs` 沒有兩個編號的待核對狗。所以 MIN 改 MAX 不會有測試失敗，要先補一個會失敗的測試。

### 14. 只要改 GLOSSARY、不用新 ADR：錯誤

新增 `worker/src` 模組要做的事：

| 項目 | 依據 | 強制程度 |
|---|---|---|
| `docs/ARCHITECTURE.md` 元件段落寫上新檔（放進方塊或列在「沒畫」），依據行號重對 | `scripts/diagram-facts.test.mjs:135-143`，規則「元件圖上的模組新增、搬移、改名，或模組之間誰呼叫誰改了」要同一個 PR 更新 | 測試擋 |
| 更新開頭核對日與依據 commit | `agent-hub/docs/rules/architecture-diagrams.md`「什麼時候要更新」 | 規則 |
| 重新產生 agent-hub 總覽頁 | 同檔，`docs/architecture/README.md` | 規則 |
| 判斷放哪一框：項目 2 的 module 要給 `admin/dogs.js` 和 `dog-list.js` 用，屬於「共用」框。目前 `dog-depart.js`、`dog-pairs.js` 就在共用框（`docs/ARCHITECTURE.md:287`），`dog-list.js` 在志工網站框（`:292`） | 同檔 | 規則 |
| `docs/ARCHITECTURE_NOW.md`：`:28` 的離所列寫明 `dog-list.js` 的 `applyDeparted`、`dog-depart.js`。`:24`、`:58`、`:60`、`:62` 也描述同步行為，檔名變了要改 | `AGENTS.md`「資料在哪、誰寫」先讀這份 | 規則 |
| `scripts/diagram-reminder.mjs`：`WATCH` 只認 `dog-list\|today-walks/(observe\|scan)`，搬走的同步邏輯不會再提醒「改表回 D1」段落，要加新檔 | `diagram-reminder.mjs` 開頭的 `WATCH` | 不擋合併，但會默默失效 |
| 同一 PR 一筆 `docs/agent-log/YYYY-MM-DD-主題.md`，兩項是兩張 PR 就兩筆 | `AGENTS.md`、`docs/agent-log/README.md`，`scripts/agent-log.test.mjs` 擋檔名 | 規則與測試 |
| 兩條只掃 `dog-list.js` 的測試要把新檔加進去 | 說法 13 | 自己要記得 |

註解與文件提到這些檔的地方（改名或搬走時要跟著改）：

- 程式註解：`dog-depart.js:3`、`dog-pairs.js:2-3`、`dog-list.js:11-13`、`departure-rules.js:2`、`sync-plan.js:2`、`public/js/analysis.js:466`。
- 文件：`docs/operations/dog-editing.md:67`、`:73`、`docs/operations/admin-records.md:66`。
- 不能改的：`migrations/0011`、`0015`、`0021` 的註解（`docs/agents/data-changes.md`「不改已合併的檔」），舊 ADR 與舊研究當歷史留著。ADR 0026 第 3 點寫 `worker/src/dog-depart.js`，刪掉這個檔就要一併處理。

**ADR：** 兩邊都有依據，要由 K 決定，查到的是：

- 只搬程式、不推翻決定時，`agent-hub/docs/rules/workflow.md:6` 寫「推翻既有契約時加 ADR」，不必新增。
- 但 CORE_RULES §7 寫「技術選擇自己決定，記在 ADR」，`#746` 今日溜狗 module 也有 ADR 0018 補充和專屬測試作為前例。
- 碰到 ADR 0026 第 3 點（`groups_json`、備註空著）或第 2 點（編號用最新的），一定要加。新增 ADR 時 `docs/adr/README.md` 要重新產生（`scripts/adr-index.test.mjs` 擋），決策圖也算更新條件。

順帶發現：`docs/ARCHITECTURE.md` 的 `dog-list.js` 行號已經飄移。例如 `:343` 寫今日溜狗在 `dog-list.js:18`，實際 import 在 `:22`（`:18` 是 `departure-rules.js`），`:266` 寫掃描在 `:324-351`，實際 `scanDogList` 在 `:448-473`。測試只比檔案長度抓不到，這次要整段重對，不是只改新增的部分。

### 15. dog-list.test.mjs 與 fixture：正確（有補充）

- `grep -c 'prepare('` 得 65 行（是行數不是呼叫次數，全檔 546 行），`appsScript` 0 次。`sheet-automerge`、`sheet-missing`、`sheet-stays` 各有 import 和呼叫。
- 使用 fixture 的測試還有 `dog-pairs`、`judgements`、`pending-depart` 等，共十多個檔。
- fixture 跑真的 GAS：`worker/test/apps-script.mjs:40` 用 `vm.Script` 載入 `apps-script/sheet-write.gs`，`UrlFetchApp` 接到 `worker.fetch`（同一個 D1）。試算表、指令碼屬性、lock 是記憶體模擬，所以真的是小程式和 Worker，假的是 Google 那一側。
- 補充：`dog-list.test.mjs:171-216` 自己用 `vm.runInContext` 載入 GAS 測 `dogListUnits` 這類純函式，只是沒走端到端。主要部分是手寫列直接 `POST /dog-list`（`:16`）。

### 16. 各修補都改了 applyMain 或 helper：部分正確

用 `git log -L` 追 `applyMain` 的改動，再對每個 commit 看 diff。這幾張多半是新功能，不算修補。

| 票 | 合併 commit | `applyMain` | 實際改的 |
|---|---|---|---|
| #771 | `ee7b4ef8`（PR #779） | **沒改** | 新增 `rowKey`、`reconcileMissing`、`missingOf`、`syncDogList`（從 `applyDogListRows` 拆）、`scanDogList` 帶 key |
| #772 | `20e4dd26`（PR #781） | 有改 | 新增 `stayTarget`、`applyStay`，`applyMain` 多 `stays` 參數，開頭判斷暫住 |
| #773 | `939b1ba5`（PR #780） | 有改 | 新增 `sameCageCandidate`、`mergeCandidate`、`bracketed`、`looksLikeWrongSheet`，加 `merge` 參數 |
| #774 | `d8ea16e4`（PR #782） | 有改 | `applyMain` 接 `newDogPairs`、多 `now`。新檔 `dog-pairs.js`，拿掉 `EXTRA_KEY` |
| #784 | `70bc23ca`（PR #785） | **沒改** | 只改 `applyDeparted`（`!prev` 分支）加 import。新檔 `dog-depart.js` |
| #787 | `068892e3` | 有改 | 新增 `leftBehind`、`HELD`，`syncDogList` 跳過 HELD 的指紋 |

清單漏掉：**#775（`05d31f00`，PR #783）也改了 `applyMain`**（`newDogPairs` 改成 `await`、傳整隻狗），`MIN(number)` 也是這張帶進來的。

對計畫的意義：這幾張確實都集中在 `dog-list.js`（#771、#784 也有動這個檔），項目 1 的動機不受影響，引用時把 `applyMain` 的範圍改成 #772、#773、#774、#775、#787。

## 查不到的事

- 正式 D1 有沒有不是 10 碼的編號、有沒有主清單編號小於最大編號的狗。這次依指示沒查，上面的 SQL 可以確認第一項。
- `/api/departures` 的 `last.groups` 有沒有 repo 以外的使用者。
- 測試判斷是讀程式得到的，沒有實際搬程式跑過。
