# D1 每張表的讀取量審核

日期：2026-10-16（研究筆記，未改程式）
相關：ADR 0009（最新版在分支 `docs/d1-pack-growth-research`）、#315、#320、`docs/research/2026-10-16-d1-pack-growth.md`、`docs/research/2026-10-16-d1-monthly-prototype.md`（分支 `prototype/d1-monthly-packs`）
範圍：`db/compact-schema.sql` 的 33 張表，以 `origin/main`（含 #315）的程式為準。

## 結論先講

1. **最大的讀取來源不是網站，是同步。** `scripts/sync-compact-d1.mjs:25-38` 每次同步用 `SELECT *` 讀 12 張表（含整張 `v3_walks`）。目前每次約 1,800 列，一天約 50 次 ≈ **9 萬列／天**；三年後 `v3_walks` 約 4.5 萬列，變成每次約 4.7 萬列 ≈ **230 萬列／天**（免費額度 500 萬的四成多）。這不是「改成大列」能解決的，建議另外處理（見建議 1）。
2. 網站讀取在 #315 之後大多只讀 1 列版本號；剩下會隨時間長大的是 **walks 資料包跨日重算**（#320 已在處理）和幾個**沒索引的子查詢**（開卡 `/cards/opened`、名字清單 `/walkers`）。
3. 有 4 張表程式完全沒讀（`v3_sheet_departed`、`v3_photos`、`v3_volunteer_codes`，以及只剩匯入用的 `v3_sheet_former_numbers`），不影響讀取量，只是待清理。

## 怎麼量、根據

- 現在列數：`gh run view 38905221144 --log`（10/16 21:06 台灣時間的同步）印出「共 118 隻狗、1042 筆溜狗紀錄、6 筆離所、11 欄常遛狗群」；其餘表用本機 `proto-seed.sql`（正式 D1 的快照，`v3_walks` 1,221 列，日期 2026-09-16～2026-10-16）。志工、開卡、常溜、編輯紀錄沒有快照，下面標「未知」並給推估範圍。
- 同步頻率：`gh run list --workflow sync-sheet.yml` 10/15 有 48 次、10/16 有 52 次（含所有狀態）。程式上限是「有改才同步」每天最多 30 次（`worker/src/sync-plan.js:8`）＋ 6:30 保險一次（`:22-26`）＋頁首「更新」（`worker/src/index.js:1249-1264`）。
- 三年推估：`v3_walks` 現在約 40 列／天（1,221 列 ÷ 31 天）→ 一年約 1.5 萬、三年約 4.5 萬列。之前的研究用每年 4 萬列（偏保守），兩個都列。離所約每月 6 筆 → 三年約 200 筆，`v3_dogs`／`v3_dog_numbers` 跟著長到約 350。
- 實測：用 `worker/test/fakes.mjs` 的 `fakeD1`（`stats.rowsRead` 記的是**回傳列數**）載入 `proto-seed.sql` 跑 Worker 的讀取函式；掃描行為用 SQLite `EXPLAIN QUERY PLAN` 確認。D1 計的是「掃過的列」，所以 `COUNT(*)`、沒索引的子查詢、排序在正式環境會比 fakeD1 數字多（原型研究實測：走索引一列常算 2 列）。量測腳本放在 scratchpad，沒進 repo。

| 實測（fakeD1，目前資料） | 回傳列數 |
|---|---|
| 狗清單直接讀表 `readDogsPayload` | 333 |
| small 資料包：重算並存 | 345 |
| small 資料包：新開的 Worker 讀資料包 | 2 |
| small 資料包：沒變 | 1 |
| walks：重算（整份歷史） | 1,222 |
| walks：新開的 Worker 讀資料包＋今天 | 32 |
| walks：沒變 | 1 |
| 今日溜狗紀錄 `readTodayWalks` | 1（沒變）／今天筆數＋1 |
| 同步讀現況（12 張表 `SELECT *`） | 1,815 |

資料包大小：small 約 30 KB、walks 約 80 KB，各 1 列。

## 總表

「讀」是每次大約掃幾列；「涵蓋」指是否已由 #315 資料包（small／walks）供網站讀取。

| 表 | 現在列數 | 三年後 | 主要讀者 | 涵蓋 | 多久變 | 同步每次讀 | 建議 |
|---|---|---|---|---|---|---|---|
| v3_walks | 1,221 | 4.5 萬～12 萬 | `/walks`、同步、合併預覽 | walks＋今天另讀 | 每次同步加約 40 列 | 全表 | 改成大列（#320 進行中）＋同步另外處理 |
| v3_sheet_main | 118 | ~120 | `/dogs`、狗群編輯、開卡子查詢 | small | 每次同步（`walked_date`） | 全表 | 維持現狀；開卡子查詢另外處理 |
| v3_sheet_main_walkers | 146 | ~150 | `/dogs` | small | 同步 | 全表 | 維持現狀 |
| v3_dog_numbers | 124 | ~350 | `/dogs`、常溜、開卡、編號換 ID | small（部分直讀） | 入所／離所 | 全表 | 維持現狀 |
| v3_dogs | 126 | ~350 | 常溜對照、狀態頁備援 | 否 | 入所／離所 | 全表 | 維持現狀 |
| v3_sheet_groups | 61 | ~80 | `/dogs`、狗群編輯 | small | 偶爾 | 全表 | 維持現狀 |
| v3_sheet_group_labels | 7 | ~15 | `/dogs` | small | 偶爾 | 全表 | 維持現狀 |
| v3_sheet_changes | 0 | 個位數 | `/dogs` | small | 偶爾 | 全表 | 維持現狀 |
| v3_sheet_former_numbers | 1 | ~1 | 無（只有刪除） | — | 幾乎不變 | 全表 | 另外處理（清理） |
| v3_sheet_departed | 0 | 0 | 無 | — | 不變 | 不讀 | 另外處理（清理） |
| v3_departures | 6 | ~200 | `/departures` | small | 離所時 | 全表 | 維持現狀 |
| v3_departure_items | 5 | ~200 | `/departures` | small | 離所時 | 全表 | 維持現狀 |
| v3_intros | 0 | ~120 | `/dogs` | small | 網站編輯 | 全表 | 維持現狀 |
| v3_intake_events | 0 | ~150 | `/dogs` | small | 網站編輯 | 不讀 | 維持現狀 |
| v3_rest | 0 | 個位數 | `/rest` | small | 網站編輯 | 不讀 | 維持現狀 |
| v3_today_walks | 今天筆數 | 同左（每天清） | `/today` | 版本號快取 | 每次按溜了 | 不讀 | 維持現狀 |
| v3_volunteers | 未知（約 100～300） | 數百 | `/walkers`、身分 | 否 | 每次讀 `/walkers` 都寫 | 不讀 | 另外處理 |
| v3_identity_names | 未知 | 數百 | 每個帶代號的請求 | 否 | 設定名字 | 不讀 | 維持現狀 |
| v3_identity_redirects | 未知（少） | 幾十 | 身分、`/walkers` | 否 | 合併時 | 不讀 | 維持現狀 |
| v3_volunteer_favorites | 未知 | 數百～數千 | `/favorites` | 否 | 按常溜 | 不讀 | 維持現狀 |
| v3_volunteer_cards | 未知 | 數千 | `/cards/opened` | 否 | 開卡 | 不讀 | 另外處理（子查詢） |
| v3_favorites／v3_card_opened | 未知（舊資料） | 不再長 | 只在第一次設定名字時搬資料 | 否 | 不變 | 不讀 | 維持現狀 |
| v3_volunteer_codes | 未知 | 數百 | 無（只寫） | — | 設定名字 | 不讀 | 另外處理（清理） |
| v3_identity_operations | 未知（少） | 幾十 | 改名／合併防重送 | 否 | 改名／合併 | 不讀 | 維持現狀 |
| v3_identity_guard／v3_identity_revision | 0／1 | 0／1 | 改名／合併 | — | 身分相關每次寫入 | 不讀 | 維持現狀 |
| v3_photos | 未知 | — | 無（照片在 R2） | — | 不變 | 不讀 | 另外處理（清理） |
| v3_edit_log | 未知 | 數千 | `/edits`（最新 N 筆） | 否 | 每次網站編輯 | 不讀 | 維持現狀 |
| v3_data_versions／v3_pack_versions | 1／1 | 1／1 | 每次 `/today`、`/dogs`、`/walks` 等 | 本身就是版本號 | 每次寫入（觸發器） | 不讀 | 維持現狀 |
| v3_packs | 2 | 3 年約 13～40 | 新開的 Worker、重算時 | 本身就是資料包 | 資料變時重寫 | 不讀 | 維持現狀（#320 會改 walks 的切法） |
| v3_sync_state | 3 | 3 | Cron 每 10 分鐘、`/sync` | 否 | 每次 Cron／更新 | 不讀 | 維持現狀 |

## 逐表說明

### v3_walks（溜狗歷史）——最大的資料來源

1. **誰讀**：
   - `/walks`：`readWalksPacked`（`worker/src/packs.js:134-145`）。沒變只讀 1 列版本號（`:118`）；跨日或歷史有改時重算整份 `walk_date<今天`（`:99`），**掃全部歷史**，現在 1,222 列、三年後 4.5 萬～12 萬列／天至少一次；今天的另讀（`:110`，走 `v3_walks_date` 索引，今天筆數）。
   - 狀態頁：`packStatus`（`packs.js:155-163`）用資料包算筆數；版本號表不存在時退回 `compactStatus` 整表 `COUNT(*)`（`worker/src/compact.js:99-106`）。
   - 合併身分預覽／確認：`summary`（`worker/src/identity.js:93`），`walker_code` 沒索引，`EXPLAIN` 顯示 `SCAN v3_walks`，每次掃全表，一次合併 2～4 次（`:108-109`、`:126`）。很少用。
   - 同步：`SELECT * FROM v3_walks`（`scripts/sync-compact-d1.mjs:33`），每次全表。
2. **涵蓋**：歷史在 walks 資料包；今天直接讀（有索引）。
3. **變動**：同步每次把新紀錄寫進來（差異同步，`sync-compact-d1.mjs:64-71`）。每寫一列觸發 2 個觸發器：身分版本號（`db/compact-schema.sql:221-223`）、資料包版本號（`:294-296`），各讀寫 `v3_*_revision`／`v3_pack_versions` 1 列。原型實測今天加一筆約讀 2、寫 4 列（`d1-monthly-prototype.md`）。
4. **同步掃**：全表。現在 1,221，三年後 4.5 萬～12 萬列，**乘以一天約 50 次同步**。
5. **結論：改成大列（#320 按月失效、按年大列）＋同步另外處理**。#320 把跨日重算從「全部歷史」降到「昨天＋今天」（原型：18 萬列 → 14 列）。但同步那邊每天 50 次全表讀，三年後約 230 萬列／天，比網站讀取大兩個數量級，資料包管不到。代價：#320 改舊紀錄要重寫那一年的大列（原型約 4,962 讀、12 寫），兩台機器同時重算要靠版本號比對避免舊包蓋新包（原型未處理）。

### v3_sheet_main、v3_sheet_main_walkers、v3_sheet_groups、v3_sheet_group_labels、v3_sheet_changes（試算表複本）

1. **誰讀**：`/dogs` 的 `readDogsPayload`（`compact.js:15-58`）一次 batch 讀這幾張＋`v3_intros`、`v3_dog_numbers`、`v3_intake_events`，現在約 333 列；#315 後只在 small 版本號變了才重算（`packs.js:78-91`），沒變讀 1 列。其他直接讀：
   - 狗群編輯 `POST /groups`：讀整張 `v3_sheet_main` 的名字（`worker/src/index.js:938`，118 列）＋該欄 `v3_sheet_groups`（`:958`）。偶爾。
   - 開卡讀回 `openedBooks`（`compact.js:145-155`）和休養 `readRest`（`compact.js:158-166`）的子查詢 `SELECT m.number FROM v3_sheet_main m WHERE m.dog_id=…`：`v3_sheet_main.dog_id` 沒索引，`EXPLAIN` 顯示**每一張卡都整表掃一次** `v3_sheet_main`。開卡 50 張的人讀一次約 50×118 ≈ 6,000 列（推算）。`readRest` 已在 small 包裡，影響小；`openedBooks` 每次 `GET /cards/opened` 都直接跑。
2. **涵蓋**：是（small），除了上面兩個直接讀。
3. **變動**：`v3_sheet_main` 每次同步幾乎都會改（溜狗日期、`walked_date`），觸發 small 版本號（`compact-schema.sql:260-262`）→ small 包重算約 345 列＋重寫 1 列。`sync-diff.mjs:37` 已讓非第一列的 `synced_at` 不算差異，避免每次同步都整包失效。
4. **同步掃**：5 張全表，共約 330 列。
5. **結論：維持現狀**。small 包一包約 30 KB，一次重算 345 列，一天就算重算 50 次也約 1.7 萬列。拆更細不划算：這幾張表每次同步都會一起變。**`openedBooks` 子查詢另外處理**（見建議 3）。

### v3_dog_numbers、v3_dogs（永久狗 ID）

1. **誰讀**：`/dogs`（small 包，`compact.js:20`）。直接讀的：`dogIdsFor`（`compact.js:109-115`，用主鍵 `number IN (...)`，只讀要的幾列），由開卡、常溜、休養、介紹、舊編號寫入時呼叫；`favoriteAliases`（`compact.js:118-126`）每次 `GET/PUT /favorites` 讀**整張** `v3_dog_numbers`＋`v3_dogs GROUP BY name`，現在約 250 列、三年後約 700 列；`saveFavorite` 用主鍵查 `v3_dogs`（`:136`）。
2. **涵蓋**：`v3_dog_numbers` 部分在 small 包；`favoriteAliases` 直接讀全表。
3. **變動**：入所新編號、離所時同步寫入；網站補舊編號（`compact.js:214`、`:227`）。觸發 small（`compact-schema.sql:269-271`；`v3_dogs` 沒有觸發器）。
4. **同步掃**：兩張全表，約 250 列。
5. **結論：維持現狀**，但 `favoriteAliases` 可以順手改從 small 包取得或只在需要時讀（見建議 4），每次常溜請求省約 250～700 列。

### v3_sheet_former_numbers、v3_sheet_departed

- `v3_sheet_former_numbers`：Worker 只在刪舊編號時 `DELETE`（`compact.js:226`），讀舊編號已改讀 `v3_dog_numbers`（`compact.js:7`、`:20`）。同步仍 `SELECT *`（`sync-compact-d1.mjs:30`）並由匯入重建（`scripts/import-compact-dogs.mjs:90`）。1 列，讀取量可忽略。
- `v3_sheet_departed`：`worker/src`、`scripts` 都沒有任何讀寫（grep 無結果）。
- **結論：另外處理（清理）**，對讀取量沒影響，只是減少維護負擔；是否刪表要 K 決定。

### v3_departures、v3_departure_items（離所）

1. **誰讀**：`/departures` → `readSmall(db,'departures')`（`index.js:1147`），沒變 1 列；重算時 `readDepartures`（`compact.js:233-237` 一帶）讀兩張全表，現在 11 列。
2. **涵蓋**：small。
3. **變動**：狗離開主清單時同步加；觸發 small（`compact-schema.sql:281-286`）。
4. **同步掃**：兩張全表，三年後約 400 列。
5. **結論：維持現狀**。

### v3_intros、v3_intake_events、v3_rest（網站直接寫的資料）

1. **誰讀**：都在 small 包（`/dogs`、`/rest`）。`readIntakeEvents`（`worker/src/intake.js:23`）用主鍵前綴只讀一隻狗；`saveIntro`、`saveRest` 先讀舊值 1 列（`compact.js:172`、`:183`）。
2. **涵蓋**：small。
3. **變動**：網站編輯時，一次寫 1～數列，觸發 small 版本號（`compact-schema.sql:263-265`、`:287-292`）→ 下一次讀 `/dogs` 重算約 345 列。
4. **同步掃**：`v3_intros` 全表（`sync-compact-d1.mjs:36`，離所時記下最後的介紹）；另兩張不讀。
5. **結論：維持現狀**。這幾張是常被網站改的，如果拆成獨立大列，每改一隻狗的介紹就要重寫整包；現在讓 small 包失效、下次重算 345 列，比較便宜也沒有覆蓋風險。

### v3_today_walks、v3_data_versions（今日溜狗紀錄）

1. **誰讀**：`/today`，網站每分鐘一次（`worker/src/today.js:1`）。`readTodayWalks`（`today.js:47-55`）先讀 1 列版本號，沒變回快取；有變走主鍵讀今天的列。
2. **涵蓋**：本身就是版本號快取的設計（ADR 0007／0009）。
3. **變動**：每次按溜了／復原（`today.js:36-44`），`DELETE ... WHERE walk_date<?` 走索引，加上每列 upsert；觸發器加版本號（`compact-schema.sql:242-244`）。
4. **同步掃**：不讀。
5. **結論：維持現狀**。每天最多幾十列，已經是最小。

### v3_volunteers、v3_identity_names、v3_identity_redirects（志工身分）

1. **誰讀**：
   - `GET /walkers` → `rememberWalkerNames`（`index.js:782-795`）：每次都把試算表上的名字 upsert 一遍（每個名字 1 個寫入，加上 `v3_identity_names` 唯一索引查一次），然後 `SELECT name FROM v3_volunteers ... ORDER BY last_seen DESC, name LIMIT 300`。`EXPLAIN` 顯示 `SCAN v3_volunteers` ＋ 暫存排序，**每次掃全表**（D1 排序會讓計數再加倍，見 ADR 0009）。另外每次 upsert 都改 `last_seen`，觸發身分版本號（`compact-schema.sql:212-214`），每個名字多讀寫 1 列。
   - 每個帶代號的請求（常溜、開卡）：`identitiesForCodes`→`identityByCode`（`identity.js:9-21`），全部走主鍵／唯一索引，每個代號約 4～5 列。
   - 設定名字第一次：`linkIdentityName` 讀整張 `v3_volunteers`（`identity.js:34`）。偶爾。
2. **涵蓋**：否。
3. **變動**：`v3_volunteers.last_seen` 每次 `/walkers` 都寫；其他只在設定名字、改名、合併時。
4. **同步掃**：不讀。
5. **結論：`/walkers` 另外處理**（見建議 2）；身分查詢維持現狀（都走索引）。`/walkers` 的呼叫頻率要看網站多常讀名字清單，沒有正式數字；若每個使用者每次開頁讀一次、試算表上約 100 個名字，一次約「100 寫＋100 觸發器讀寫＋志工總數×2 讀」。這張表是每次都改的，不適合大列。

### v3_volunteer_favorites、v3_volunteer_cards、v3_favorites、v3_card_opened

1. **誰讀**：
   - `/favorites`：`readFavorites`（`compact.js:129-133`）走主鍵前綴，只讀自己的常溜；但每次加上 `favoriteAliases` 全表（見上）。
   - `/cards/opened` GET：`openedBooks`（`compact.js:145-155`），自己的卡走主鍵，但每張卡的子查詢整表掃 `v3_sheet_main`（見上）。PUT：`index.js:1020` 每張卡 1 個 `INSERT OR IGNORE`，觸發身分版本號（`compact-schema.sql:218-220`）。
   - 舊表 `v3_favorites`／`v3_card_opened`：只在第一次設定名字、改名時搬到新表（`identity.js:41-42`、`:71-73`），沒有 `walker_code` 以外的條件，依主鍵前綴查。
2. **涵蓋**：否，各人自己的資料。
3. **變動**：按常溜、開卡時 1～50 列。
4. **同步掃**：不讀。
5. **結論：維持現狀（表本身）**，`openedBooks` 子查詢另外處理。個人資料常改、各人只讀自己的，做成大列反而每次要重寫全部人的資料、多人同時按會互相覆蓋。

### v3_volunteer_codes、v3_photos

- `v3_volunteer_codes`：只有寫入（`identity.js:44`、`:75`、`:136`），沒有讀。
- `v3_photos`：Worker 不讀（照片版本在 R2，`index.js:196-199`），只剩 `scripts/import-compact-profiles.mjs:133`、`:144` 匯入用。
- **結論：另外處理（清理）**，不影響讀取量；要不要刪表由 K 決定。

### v3_identity_operations、v3_identity_guard、v3_identity_revision

改名／合併時用主鍵讀 1 列（`identity.js:51`、`:56`、`:97`、`:112`、`:118`）。`v3_identity_revision` 被 15 個觸發器更新（`compact-schema.sql:206-223`），每次相關寫入多讀寫 1 列。**維持現狀**。值得注意的副作用：`/walkers` 每次 upsert 和同步每寫一列溜狗紀錄都會加這個版本號，會讓正在進行的合併預覽失效（`identity.js:112`），但不影響讀取量。

### v3_edit_log

`/edits` 讀最新 N 筆（`worker/src/editlog.js:65-75`），`ORDER BY id DESC LIMIT ?` 走 rowid，只掃 N 列；寫入每次編輯 1 列（`editlog.js:55`）。只增不刪（ADR 0004）。**維持現狀**。

### v3_pack_versions、v3_packs

- 每次 `/dogs`、`/walks`、`/departures`、`/rest`、狀態頁讀 1 列 `v3_pack_versions`（`packs.js:118`）。
- `v3_packs`：新開的 Worker 或版本號變了讀那一包（`packs.js:59`，現在 1 列）；重算後 `DELETE`＋`INSERT` 重寫（`packs.js:66-75`）。walks 包是一包一段，歷史超過 1 MB 會切多段（`packs.js:8`）。
- **維持現狀**；#320 會把 walks 改成按月版本號、按年大列。

### v3_sync_state

Cron 每 10 分鐘（`wrangler.jsonc:33`）`planTick` 讀 1～2 列（`sync-plan.js:34-47`），每次還跑一次 `CREATE TABLE IF NOT EXISTS`（`:16`、`:29`、`:62`）。一天 144 次，約 300 列。**維持現狀**（`CREATE TABLE IF NOT EXISTS` 在 D1 是否計讀取沒有確認，若有可移除）。

## 建議（agent 的建議，不是 K 的決定）

1. **同步讀現況改成不讀整張 `v3_walks`**（最大來源，預估三年後省約 220 萬列／天）。可能的做法：
   - 同步只需要知道「上次之後新增了什麼」，溜狗紀錄可以只讀最近一段（例如 `walk_date >= 今天-N 天`，走既有索引 `v3_walks_date`），舊的不比對；
   - 或讀 walks 資料包（大列）取代 `SELECT * FROM v3_walks`。
   代價：同步目前「以 D1 上一次的內容為基準往上加」（`sync-compact-d1.mjs:5-6`），比對範圍縮小後，若有人直接改到很舊的紀錄就看不到；要先確認同步需不需要舊紀錄（例如算「我溜過」）。
2. **`/walkers` 名字清單**：不要每次都 upsert 所有名字（例如一天只記一次、或只寫新的名字），排序讀取可改為加 `last_seen` 索引或放進快取。省的列數取決於 `/walkers` 頻率，沒有正式數字。
3. **`v3_sheet_main(dog_id)` 加索引**，或 `openedBooks` 改用 small 包裡的編號對照：開卡多的人每次讀省約「卡數×118」列。加索引的代價：同步每寫一列 `v3_sheet_main` 多算 1 列寫入。
4. **`favoriteAliases` 改從 small 包取得**：每次常溜請求省約 250～700 列。
5. **清理沒用的表**：`v3_sheet_departed`、`v3_photos`、`v3_volunteer_codes`、`v3_sheet_former_numbers`（同步仍讀它）。不影響讀取量。

## 待 K 決定

- 建議 1 要不要做、做哪一種（同步縮小比對範圍 vs. 讀資料包）；是否接受「很舊的紀錄不再比對」。
- 建議 2～4 要不要開票，或併進 #320。
- 沒用的表要不要刪（涉及正式 D1，刪表要 K 自己執行）。
- 要不要在正式環境量一次 `/walkers`、`/cards/opened` 的呼叫次數（Cloudflare 分析或 Worker 日誌），以確認建議 2、3 的實際效果。
