# 溜狗歷史（v3_walks）該由誰寫：D1 當正本時的做法比較

- 日期：2026-10-26（台灣時間）。Agent：Claude Code 研究代理。
- 問題（K）：ADR 0018 定 D1 為正本，但「溜狗歷史」`v3_walks` 還是從試算表主清單抄回來，很奇怪。有沒有更好的做法？
- 範圍：只讀 repo（`claude/determined-archimedes-03a127`，基準 `0fadda8`）和官方文件。沒有改程式、沒有查正式 D1、沒有部署。
- 標記：每個主張附來源；從程式推得、沒實測的寫【推論】。

## 1. 給 K 的白話結論

- **建議 B：網站收下（D1 接受）的那一刻，就在同一批寫入裡把「歷史」一起改好。** 不管是網站按溜了／改名單／復原，還是有人直接改試算表、D1 收下了，都走同一個小函式改歷史。
- 狗清單同步（從試算表抄回）**只管籠位、狗名這些**，對「D1 已經在管今天溜狗」的狗不再寫歷史。
- 為什麼：
  - 現在網站登記要等 GAS 每天三次的掃描，圖鑑／我溜過最多慢十小時。B 之後按完就有。
  - 試算表一隻狗只留最新一天，掃描失敗又剛好隔天早上再溜，前一天就永遠漏掉。B 不經過試算表，不會漏。
  - 改回較早日期時，現在用「D1 記的試算表舊值」判斷要刪哪天，這個舊值可能是好幾小時前的，會刪錯或刪不掉。B 用 D1 自己的「目前狀態」判斷。
  - 同一次人工改表現在走兩條路各寫各的，可能一條寫了網站加的人、一條沒有。B 只剩一條。
- 代價小：每次按溜了多寫約 4～12 列（免費額度一天 10 萬列，一天約 45 隻次，合計約 200～700 列）；不用改資料表、不用 migration；前端不用改。
- 不建議 C（事件紀錄當正本、歷史重算）：太大，好處 B 都拿得到。D（讀的時候疊今天）只解決「慢」，不解決漏記和刪錯天。
- 要 K 決定的事見第 4 節：人工「清空日期」要不要刪那天的歷史、復原時要不要動前一天。

## 2. 現況

### 2.1 誰寫 `v3_walks`

| 寫入點 | 什麼時候 | 怎麼寫 |
|---|---|---|
| `worker/src/dog-list.js:96-97`（`applyMain`） | GAS 送主清單某列到 `/walk-writeback/dog-list`（`worker/src/index.js:911-913`） | 試算表日期比 `v3_sheet_main.walked_date` 新、或同天換人 → `walkDay` 整天刪掉再寫；比較舊 → 刪 `v3_sheet_main.walked_date` 那天、重寫表上那天 |
| `worker/src/dog-list.js:120` | 主清單出現 D1 沒有的狗 | 那天還沒有紀錄才寫 |
| `worker/src/dog-list.js:82` | 補編號 | 只改 `dog_number` |
| `scripts/import-compact-profiles.mjs` | 一次性匯入 | — |

`walkDay` 本身：`worker/src/dog-list.js:55-61`，一隻狗一天一組，`DELETE` 那天再 `INSERT` 每個代號一列（沒有代號寫一列 `NULL`）。

**網站按溜了不寫 `v3_walks`。** `acceptWalk` 的 batch（`worker/src/walk-accept.js:149-160`）只寫 `v3_walk_guard`、預算、`v3_walk_state`、`v3_walk_requests`、`v3_walk_outbox`、`v3_edit_log`。人工改表的兩條比對路徑也一樣只寫 `v3_walk_state`／`v3_walk_outbox`：`compareTrustedWalk`（`worker/src/walk-accept.js:402-412`）、`reconcileWalkSnapshot`（`worker/src/walk-reconcile.js:26-36`）。

### 2.2 網站登記為什麼要等幾小時才進歷史

1. 網站接受後背景派送，GAS `doPost` 用程式把值寫進主清單（`worker/src/walk-accept.js:237-241` 呼叫 `walkWake`）。
2. GAS 程式寫入不會觸發編輯觸發器：repo 註解「網站寫回（doPost）是程式寫入，不會觸發」（`apps-script/sheet-write.gs:333`）。Google 官方原文：「Script executions and API requests don't cause triggers to run. For example, calling Range.setValue() to edit a cell does not cause the spreadsheet's onEdit trigger to run.」（[Triggers 指南](https://developers.google.com/apps-script/guides/triggers)；安裝型觸發器同一句，見 [Installable triggers](https://developers.google.com/apps-script/guides/triggers/installable)）。
3. 所以只剩 GAS `dogListScan` 每天三次（`apps-script/sheet-write.gs:349`，台灣 09:43／13:53／23:53）比對指紋，看到那列變了才送 `/dog-list`，`applyMain` 才寫 `v3_walks`。
4. 讀歷史的地方全部只讀 `v3_walks`：
   - 圖鑑／我溜過：`readMineWalks`（`worker/src/packs.js:418-424`）= 各年摘要＋`liveWalks`（`worker/src/packs.js:264-269`，`SELECT … FROM v3_walks WHERE walk_date>=cutoff`）。
   - 已出所狗卡溜過幾天：`readDogWalkDays`（`worker/src/packs.js:427-434`）。
   - `/walks`、`/walks?year=`：`packedWalks`（`worker/src/packs.js:289-295`）。
   - 復原找上一次：`previousWalk`（`worker/src/today.js:5-23`），`acceptWalk` 在 `v3_walk_state` 沒有 `previous_date` 時才用（`worker/src/walk-accept.js:126-127`）。

### 2.3 已知問題（從程式推得）

- **慢**：下午 14:00 按的溜了，到 23:53 掃描才進「我溜過」，約 10 小時。前端只在同一支手機補今天：`bqTodayWrites` 讀 `bq-sheet-writes`（`public/js/cards.js:145-152`），`bqMineFrom` 加上去、Worker 已有今天就不重複（`public/js/cards.js:155-166`）。別的裝置看不到。
- **漏記**【推論】：試算表一隻狗只留最新日期。網站 D 天登記後，如果 D 天 23:53 的掃描失敗（ADR 0018 第 5 點自己寫「觸發器會漏（失敗不重跑、每日執行時間用完即遺失）」，`docs/adr/0018-today-walks-d1-event-sync.md`），D+1 天 09:43 前又有人溜了，掃描只會看到 D+1，D 天永遠不進歷史。Google 官方：安裝型觸發器失敗時「no error message appears on your screen」，只寄失敗摘要信（[Installable triggers](https://developers.google.com/apps-script/guides/triggers/installable)）；觸發器每日總執行時間個人帳號 90 分鐘（[Quotas](https://developers.google.com/apps-script/guides/services/quotas)）。
- **刪錯天／刪不掉**【推論】：`applyMain` 判斷「改回較早日期」時比的是 `v3_sheet_main.walked_date`（`worker/src/dog-list.js:96-97`），這是 D1 上次收到的試算表值，網站寫回不會更新它。例：
  - 網站今天按錯溜了，有人直接在表上把日期改回昨天。`v3_sheet_main.walked_date` 若還是昨天（今天的寫回沒觸發同步），兩邊相同、名單也同 → 什麼都不做。今天的紀錄如果是之後掃描才會進來，就沒事；但如果改成 A 方案（網站先寫了今天），**今天那筆就刪不掉**。
  - 有人只改日期那一格（名單格還是今天的人），編輯觸發器逐格送（`apps-script/sheet-write.gs:352-376`），`walkDay` 會用「今天的名單」重寫「舊那天」，蓋掉那天原本的人。
  - 撤銷後表上是前一次（日期 P、名單由 `previousWalk` 從代號換回名字，對不到名字的代號略過，`worker/src/today.js:21-22`）。掃描若已把今天收進 `v3_sheet_main`，`applyMain` 會刪今天、再用表上名單**重寫 P 那天**，對不到名字的人就從 P 那天消失。
- **兩條人工路徑各寫各的**：一次人工改表，`onWalkSheetEdit` 先送 `/rows`（`flushWalkEdits`），再送 `/dog-list`（`flushDogList`）（`apps-script/sheet-write.gs:367-375`）。
  - `/rows` → `reconcileEditedRows` → `reconcileWalk` → `compareTrustedWalk`（`worker/src/walk-reconcile.js:65-74`、`worker/src/walk-accept.js:332-414`）更新 `v3_walk_state`。它會合併：同一天、網站剛加的人還沒寫回時，人工刪名保留網站加的人（`worker/src/walk-accept.js:388-391`），結果和表上不同、還要再寫回（`status='pending'`）。
  - `/dog-list` → `applyMain` 照表上原文寫 `v3_walks`。
  - 【推論】所以這種情況下「今日溜狗」是合併後的名單，「歷史」是表上的名單，直到寫回後（程式寫入，不觸發）下一次掃描才一致。

## 3. 方案比較

### 3.1 比較表

| | A：`acceptWalk` 同批寫歷史 | **B：所有改 `v3_walk_state` 的地方共用一個 helper 寫歷史，dog-list 不再寫這些狗** | C：事件紀錄為正本，歷史衍生 | D：讀時疊上今天 | E：GAS 寫回後自己送 dog-list |
|---|---|---|---|---|---|
| 網站登記多快進歷史 | 立刻 | 立刻 | 看重算時機 | 立刻（只有讀端） | 幾秒（多一次 GAS→Worker） |
| 漏記（試算表只留最新） | 網站的不漏；人工的照舊 | 不漏 | 不漏 | **照舊會漏** | 寫回成功才補，失敗照舊 |
| 刪錯天 | **新增「刪不掉」**（見 3.2） | 用 D1 目前狀態判斷，解決 | 解決 | 照舊 | 照舊 |
| 復原（ADR 0016） | 刪今天，可 | 刪今天，可 | 可 | 讀端要處理 | 照舊 |
| 人工改表、最後改的算數 | 仍靠 dog-list，和 `v3_walk_state` 可能不同 | 跟 `v3_walk_state` 同一個結果 | 同 B | 照舊 | 照舊 |
| 兩條人工路徑競爭 | 照舊，且多一個寫入者 | 只剩一條 | 只剩一條 | 照舊 | 照舊 |
| 每次按溜了多寫幾列 | 約 4～12 | 約 4～12（dog-list 同量省掉） | 0（寫事件已有） | 0 | 0（D1）；GAS 多一次 UrlFetch |
| 版本號多跳 | `v3_walk_versions.live` 隨每列 +1；之後掃描再跳一次 | 只跳一次 | 重算時才跳 | 讀端快取要加 `v3_walk_pack.version`，每次接受、寫回狀態都失效 | 同現在 |
| migration | 不用 | 不用 | 要（新表或欄、回填） | 不用 | 不用（GAS 部署） |
| 改動 | 小 | 中（3 個寫入點＋dog-list 一個判斷＋測試） | 大 | 中 | 小（GAS） |
| 前端 | 不用改；`bqTodayWrites` 變多餘 | 同 A | 同 A | 同 A | 同現在 |

### 3.2 A：網站接受時同一批寫 `v3_walks`

做法：`acceptWalk` 的 batch（`worker/src/walk-accept.js:149-160`）加 `walkDay(today)`；undo 改成刪今天。

- 原子性：D1 官方說 batch 的語句是「SQL transactions」，「If a statement in the sequence fails, then an error is returned for that specific statement, and it aborts or rolls back the entire sequence」，且「each statement in the list will execute and commit, sequentially, non-concurrently」（[D1 Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)）。repo 也靠這點做版本守門（`v3_walk_guard`，`worker/src/walk-accept.js:150,159`；`db/compact-schema.sql:74-75`）。所以「今日狀態」和「歷史」會一起成功或一起失敗。
- 問題 1：**dog-list 照舊寫**。網站寫回後，下一次掃描 `applyMain` 看到表上日期比 `v3_sheet_main.walked_date` 新，又 `walkDay` 一次（`worker/src/dog-list.js:96`）。結果一樣，但寫入量、`v3_walk_versions.live` 跳兩次。
- 問題 2：**人工改回，今天刪不掉**（3.1 表「新增」那格）。網站寫了今天，`v3_sheet_main.walked_date` 還是昨天；有人在表上改回昨天＋昨天的名單 → `applyMain` 看到和 `v3_sheet_main` 一樣，不動 → 今天那筆留在歷史裡。`compareTrustedWalk` 把 `v3_walk_state` 改回昨天，但它不寫歷史。【推論】
- 問題 3：兩條人工路徑仍各寫各的（2.3）。
- 結論：比現在快，但多了一種錯，不建議單獨做。

### 3.3 B：一個 helper 依「狀態轉移」寫歷史（建議）

做法【推論，設計草案】：

1. 新增一個純函式，例如 `historyStatements(db, { dogId, number, name }, before, after, source)`，`before`／`after` 是 `{ date, codes }`：
   - `after.date === before.date`：名單有變才 `DELETE` 那天＋`INSERT` 新名單（跟 `walkDay` 一樣）。
   - `after.date > before.date`：寫 `after.date` 那天；`before.date` 留著（那是上一次）。
   - `after.date < before.date`（復原、人工改回）：刪 `before.date` 那天。`after.date` 那天要不要重寫，見第 4 節決定 2。
   - `after.date === ''`（人工清空）：見第 4 節決定 1。
2. 三個改 `v3_walk_state` 的 batch 都加上它，`before` 用 D1 自己的 `old.effective_date`／`old.members_json`，不再用 `v3_sheet_main.walked_date`：
   - `acceptWalk`（`worker/src/walk-accept.js:149-160`）；
   - `compareTrustedWalk`（`worker/src/walk-accept.js:402-412`）；
   - `reconcileWalkSnapshot`（`worker/src/walk-reconcile.js:26-36`）。
   `confirmWalk`（`worker/src/walk-accept.js:295-303`）只改 `base_*`，不是狀態轉移，不用寫。
3. `applyMain`：這隻狗有 `v3_walk_state` 列就跳過 `walkDay`（`worker/src/dog-list.js:96-97,120`），其他欄照舊更新（`v3_sheet_main` 仍要記，`seedState` 會讀，`worker/src/walk-accept.js:69-75`）。沒有 `v3_walk_state` 的狗（D1 從沒接手過）照舊從表上抄。
   - 註：只要有人改過主清單溜狗欄，`compareTrustedWalk` 就會 `seedState` 建出 `v3_walk_state`（`worker/src/walk-accept.js:365`），而 `D1_WALK_NOTIFY` 正式已開（`wrangler.jsonc:31`），所以在所狗會逐漸都由 B 管。
4. 代號：`walkerCode(name, WALKER_KEY)`（`worker/src/editlog.js:35-41`）跟 dog-list 的 `walkersOf`（`worker/src/dog-list.js:38-52`）同一個算法，網站寫的和表上抄的代號相同。新名字連到志工名單（`linkIdentityName`）仍由 dog-list 的 `walkersOf` 做，不受影響。

正確性：

- 漏記：網站和人工改表都在 D1 接受的同一個交易裡寫歷史，不經過「試算表只留最新」。
- 刪錯天：`before` 是 D1 的目前狀態（每次轉移都更新），不是幾小時前的試算表複本。
- 最後改的算數：歷史跟 `v3_walk_state` 同一次轉移，`v3_walk_state` 怎麼判斷（ADR 0018 第 1 點「直接改表採方案 A」、合併規則），歷史就怎麼跟。`compareTrustedWalk` 認不出的（未確認派送，`worker/src/walk-accept.js:380-384`）不轉移，歷史也不動，等釐清。
- 競爭：只剩 `/rows` 一條寫歷史；`/dog-list` 不再碰這些狗的歷史。各轉移都有 `v3_walk_guard` 版本守門（`worker/src/walk-accept.js:150,403`、`worker/src/walk-reconcile.js:27`），失敗整批回復。
- 復原（ADR 0016）：撤銷是 `after.date < before.date`，刪今天。前一天的紀錄本來就在歷史裡，不必重寫。ADR 0016 寫「撤銷後…『我溜過』…照現有同步規則跟著更新」（`docs/adr/0016-undo-walk-from-server-history.md`），B 之後是立刻更新。

寫入量（免費方案）：

- 官方：免費方案每天寫 100,000 列、讀 5,000,000 列；「Indexes will add an additional written row when writes include the indexed column」（[D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/)）。官方沒寫觸發器算不算；repo 先前用正式用量對過，要把觸發器算進去才對得上（`docs/research/2026-10-18-d1-usage-1018.md:115`、`docs/research/2026-10-24-521-d1-triggers-audit.md`「連帶寫入量測」），`writeBudget` 註解也照這個保守估（`worker/src/walk-accept.js:36`）。
- `v3_walks` 一列【推論】：表 1＋主鍵索引 1（`PRIMARY KEY(dog_id,walk_date,position)`，`db/compact-schema.sql:138-147`）＋`v3_walks_date` 索引 1（`db/compact-schema.sql:327`）＋觸發器 `walkpack_v3_walks_*` 改 `v3_walk_versions` 1（`db/compact-schema.sql:343-345`）≈ 4 列。刪一列也約 4 列。
  - `identity_v3_walks_*` 已由 `migrations/0002_trigger_plan_a.sql:18-20` 刪掉，`v3_identity_revision` 不會跟著跳。
  - `packs_v3_sheet_main_*`（`db/compact-schema.sql:399-401`）是 `v3_sheet_main` 的觸發器，B 不多寫 `v3_sheet_main`，`v3_pack_versions.small` 不多跳。
- 每次轉移：一人第一次溜 ≈ 4 列；同天加第二人 = 刪 1＋寫 2 ≈ 12 列；n 人改 m 人 ≈ 4×(n+m)。
- 一天：平均 45 狗次、尖峰 84（`docs/research/2026-10-22-460-real-walk-load.md`「2. 實際登記量」）→ 約 200～700 列，免費額度的 1% 以下，`SYNC_DAILY_BUDGET` 40,000（`wrangler.jsonc:29`）的 2% 以下。同一批寫入原本由 dog-list 掃描時做，B 之後 dog-list 不做，**總量大致不變**。
- `writeBudget` 預留（`worker/src/walk-accept.js:151` 的 32／40、`:404` 的 32、`worker/src/walk-reconcile.js:28` 的 40）要加上 `4×(舊人數＋新人數)`；人數在 batch 前就知道，可以算準。單次上限 `SYNC_MAX_ROWS` 預設 500（`worker/src/walk-accept.js:39`），名單 50 人以內不會碰到。
- 查詢次數：免費方案每次 Worker 呼叫 50 個查詢，batch 算一個（[D1 Limits](https://developers.cloudflare.com/d1/platform/limits/)）。B 的語句放進既有 batch，不多一次往返；`applyMain` 多查一次「有沒有 `v3_walk_state`」【推論】可併進既有讀取，注意 `DOG_LIST_ROWS_MAX` 的註解「每列最多 3–4 次 D1 往返」（`worker/src/dog-list.js:15`）。

版本號與前端多讀：

- `v3_walk_versions.live` 每寫／刪一列 +1（觸發器逐列，`db/compact-schema.sql:343-345`）。現在是掃描時一次跳一批；B 之後分散在白天。`liveWalks` 用 `live` 當記憶體快取鍵（`worker/src/packs.js:265`），失效後重讀今天以後的列（走 `walk_date` 索引，一天幾十到一百多列）。讀量相對 500 萬列很小。
- 圖鑑頁只在開頁時讀一次 `/dogs`、`/walks`、`/walks/mine`（`public/js/cards.js:700-722`），沒有輪詢，不會因為版本號跳得勤而多讀。
- `v3_pack_versions.small`、`v3_identity_revision` 不受影響（見上）。

改動與 migration：

- 不新增表、欄、索引、觸發器 → 依 `docs/agents/data-changes.md`「D1 結構變更」不用 migration。
- 上線順序【推論】：切換那一刻，「已在 `v3_walk_state`、還沒被掃描收進歷史」的網站登記會兩邊都不寫。部署前先手動跑一次 `dogListScan`（`apps-script/sheet-write.gs:470-471` 說可手動執行），或部署時附一次性補寫：`v3_walk_state.effective_date` 在 `v3_walks` 沒有那天的就補。
- 要改的測試【推論】：`worker/test/walk-accept.test.mjs`、`walk-edit.test.mjs`（batch 內容、預算）、`walk-reconcile.test.mjs`、`dog-list.test.mjs`（有 `v3_walk_state` 不寫歷史）、`packs.test.mjs:310-323`（`v3_walks` 只讓改到的月份／`live` 變）。

前端：

- `bqTodayWrites`（`public/js/cards.js:145-152`）是補「還沒同步」的今天；D1 模式下 `bq-sheet-writes` 仍由 `saveCurrent` 寫（`public/js/walk-registration.js:90-92` → `public/js/walk-flow.js:64-69`）。B 之後 Worker 已有今天，`bqMineFrom` 會因 `m.last === date` 跳過（`public/js/cards.js:162`），不重複、不必馬上改；之後可以在 `SITE.d1WalkAccept` 時拿掉。

### 3.4 C：事件紀錄為正本，歷史重算

- 現成素材：`v3_walk_outbox` 每個 `v3_walk_state` 版本一列（`target_date`、`target_walker`、`status`，主鍵 `(dog_key,version)`，`db/compact-schema.sql:26-38`），程式裡沒有任何 `DELETE FROM v3_walk_outbox`（`worker/src` 搜尋無結果），等於只增不減的紀錄；`v3_walk_requests` 存每個網站請求的結果（`db/compact-schema.sql:18-25`），也沒刪。
- 但缺：代號（只有名字文字）、`dog_id`（要靠 `v3_walk_state`）、D1 接手前的歷史（只在 `v3_walks`）。要嘛加欄（migration），要嘛重算時再算代號。
- 重算規則其實就是 B 的轉移規則（每一版相對上一版：同天改人、往後新增、往前刪）。差別只在「寫的時候算」還是「讀的時候算」。讀的時候算要整段重播，讀量和 CPU 都比 B 大，ADR 0009 也反對讀時做大量工作（`worker/src/packs.js:271-272` 註解：「整表讀取量隨歷史一直變多…悄悄吃光 D1 免費額度」）。
- 結論：不建議當正本。但 outbox 很適合拿來**稽核 B**：寫一個只讀腳本，用 outbox 重播出每隻狗每天，跟 `v3_walks` 比，找漏記。另外 outbox 無限長大是另一個題目。

### 3.5 D：不改寫入，讀時合併

- 做法：`readMineWalks`、`readDogWalkDays`、`packedWalks` 讀完 `v3_walks` 後，再疊上 `v3_walk_pack.payload`（一列，`db/compact-schema.sql:68-73`）裡 `walkedDate === today` 的狗。
- 只解「慢」。漏記、刪錯天、兩條人工路徑都照舊。
- 麻煩【推論】：payload 只有名字（`db/compact-schema.sql:83-88`），要換代號得逐名算 HMAC 或另讀 `members_json`；快取鍵要加 `v3_walk_pack.version`，而它在每次接受、每次寫回狀態變化都 +1（`walk_pack_*` 觸發器），快取幾乎常失效；還要處理「歷史已有今天」去重。
- 結論：當 B 上線前的過渡可以，但不值得單獨做。

### 3.6 E（第五種）：GAS 寫回後自己送 dog-list

- 做法：`doPost` 的 `walkWake` 寫完那列，把該列加進狗清單待送（同 `onWalkSheetEdit` 的 `updateDogListPending`，`apps-script/sheet-write.gs:362-366`）再 `flushDogList`。
- 好處：只改 GAS，網站登記幾秒內進歷史。
- 壞處：歷史仍從試算表抄，刪錯天、兩條路徑競爭都照舊；寫回失敗就照舊等掃描；每次寫回多一次 UrlFetch（個人帳號每天 20,000 次，[Quotas](https://developers.google.com/apps-script/guides/services/quotas)），還在 script lock 期間多一段 HTTP。這正是 K 覺得奇怪的「從試算表抄回」，只是抄得快一點。
- 結論：不建議。

## 4. 建議與要 K 決定的事

**建議：做 B。** 歷史跟著 D1 的「今日溜狗狀態」走，同一個交易寫；狗清單同步不再替 D1 已接手的狗寫歷史。這是 ADR 0018「D1 為準」的自然延伸，不用 migration。建議補一段 ADR 0018 或新 ADR，寫明「溜狗歷史由 D1 接受時寫，試算表不再是歷史來源（D1 未接手的狗除外）」。

要 K 決定：

1. **人工在表上把日期清空**：歷史要不要刪掉原本那天？
   - 現在 dog-list 是「清空不記也不刪」（`worker/src/dog-list.js:94`）。
   - ADR 0018 第 1 點說人工「清空」對今日狀態有效。
   - 建議：清空的是今天就刪今天（等同撤銷）；清空的是更早的日子就不動歷史（多半是整理表格，不是說那天沒溜）。
2. **往前改（撤銷、人工改回較早日期）時，前一天要不要用表上名單重寫？**
   - 撤銷：建議不動前一天。理由：那天本來就在歷史裡；重寫會把對不到名字的代號弄掉（`worker/src/today.js:21-22`）。
   - 人工改回較早日期並改了名單：建議照現在 dog-list 的作法重寫那天（人工明確改的）。
3. **上線時怎麼補洞**：部署前手動跑一次 `dogListScan`，還是附一次性補寫腳本（3.3「上線順序」）。
4. 要不要順便用 outbox 寫一個只讀稽核（3.4），一次性確認現在 `v3_walks` 有沒有漏記。

## 5. 來源

官方文件（2026-10-26 讀取）：

- Cloudflare D1 Worker API（batch 為 SQL 交易、失敗整批回復、依序執行）：https://developers.cloudflare.com/d1/worker-api/d1-database/
- Cloudflare D1 Pricing（免費每天寫 100,000 列、讀 5,000,000 列；索引多算一列；沒提觸發器）：https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare D1 Limits（免費每次呼叫 50 查詢、batch 算一個；沒提觸發器）：https://developers.cloudflare.com/d1/platform/limits/
- Google Apps Script Triggers（程式寫入不觸發 onEdit）：https://developers.google.com/apps-script/guides/triggers
- Google Apps Script Installable triggers（同上；失敗不顯示、寄摘要信）：https://developers.google.com/apps-script/guides/triggers/installable
- Google Apps Script Quotas（觸發器每日總時間 90 分鐘、UrlFetch 每日 20,000）：https://developers.google.com/apps-script/guides/services/quotas

本 repo：

- `worker/src/dog-list.js:15,38-61,66-126`
- `worker/src/walk-accept.js:28-75,99-170,277-305,332-414`
- `worker/src/walk-reconcile.js:8-41,51-74`
- `worker/src/packs.js:264-295,418-434`
- `worker/src/today.js:5-23`
- `worker/src/editlog.js:35-41`
- `worker/src/index.js:898-922`
- `apps-script/sheet-write.gs:331-376,470-471`
- `db/compact-schema.sql:3-91,138-147,327,343-345,399-401`
- `migrations/0002_trigger_plan_a.sql:1-20`
- `public/js/cards.js:145-172,700-722`、`public/js/walk-registration.js:89-101`、`public/js/walk-flow.js:57-70`
- `wrangler.jsonc:29,31`
- `docs/adr/0016-undo-walk-from-server-history.md`、`docs/adr/0018-today-walks-d1-event-sync.md`、`docs/agents/data-changes.md`
- `docs/research/2026-10-18-d1-usage-1018.md:115`、`docs/research/2026-10-22-460-real-walk-load.md`、`docs/research/2026-10-24-521-d1-triggers-audit.md`
