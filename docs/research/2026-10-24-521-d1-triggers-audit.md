# D1 觸發器稽核（#548，#521 子票）

日期：2026-10-24。Claude 稽核，只盤點和建議，沒有改程式，也沒有寫入正式 D1（正式 D1 只送了 SELECT，`rows_written` 都是 0）。main 基準 `2a05e25`。

和資料表稽核（#549，`docs/research/2026-10-24-521-d1-tables-audit.md`）平行進行。K 的原則是先確定表的設計，再決定觸發器怎麼改，所以每個建議都標出它依賴哪張表。結論會隨表的去留改變的，標「待確認（依表稽核結果）」。

## 摘要

1. **正式 D1 只有 57 個觸發器，schema 有 75 個。** 缺的是全部 18 個 `identity_*`，而且 `v3_identity_revision` 沒有那一列。其餘 57 個的 SQL 和 `db/compact-schema.sql` 逐字相同。
   - 連帶發現一個**正式環境的 bug**（不在本票範圍）：「我是誰」更名、合併讀 `v3_identity_revision` 拿到 null，`identity.js:56` 丟 TypeError，`index.js:1106` 把它當成 409「身分資料已變動，請重新檢視」回給網站。正式庫 `v3_identity_operations` 是 0 列，表示更名、合併從來沒成功過。
2. 75 個觸發器實際上只維護 **7 個版本號**，每個版本號都有程式在讀（見〈版本號與讀取端〉）。沒有「維護沒人讀的版本號」的觸發器，但有兩組讀取端已經接近退場：
   - `version_v3_today_walks_*`（3 個）：`SITE.d1WalkAccept=true` 後，網站改讀 `/today?source=d1`。舊的 `/today` 只剩還沒更新網頁的舊手機在用，正式庫今天（2026-10-24）仍寫進 1 列。
   - `identity_*`（18 個）：只在更名、合併時當樂觀鎖用；正式庫根本沒建。
3. **重複**：今天的溜狗記在三個地方，各自有版本號：`v3_walk_pack`（網站接受的狀態）、`v3_today_walks`（舊流程）、主清單的 `walked_date`／溜狗人加上 `v3_walks`（歷史）。按一次溜了，三套都可能動。這是表的設計問題，觸發器只是跟著表走。
4. **過度觸發**（實際量到的，見〈連帶寫入量測〉）：
   - 觸發器是逐列觸發，整段刪掉再寫回會放大很多倍：異動紀錄整段換 21 列，資料寫 42 列，觸發器也寫 42 列，讓同一個版本號加 42 次。
   - `walk_pack_UPDATE` 不看改了哪一欄：寫回成功時只改 `base_date`／`base_walker`，網站要的內容沒變，版本號還是加 1，還把 payload 重寫一次。
   - `packs_v3_sheet_main_UPDATE` 不看改了哪一欄：只改 `walker` 原文、`covered`、`synced_at` 這幾個在所資料包不讀的欄，也讓在所資料包失效。
   - `*_UPDATE` 對 OLD、NEW 各加一次：狗沒換，同一個版本號也會加 2。
   - 觸發器裡的 `EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=…)` 沒有索引可用，每次都整張掃主清單（目前 116 列）。
5. **成本不是主要理由**：照本機量測和正式版本號累計數估算，觸發器一天約多寫 300～500 列，約占 `SYNC_DAILY_BUDGET`（40,000）1% 左右。精簡主要是為了好懂、好改，以及讓 schema 和正式庫一致，不是為了省額度。
6. **建議分兩步**：
   - **甲（建議先做，不用改 ADR）**：刪掉 21 個（identity 18 個、today_walks 3 個），收窄 9 個的觸發條件，修好更名的 bug。觸發器 75 → 54 個；正式庫 57 → 54 個。
   - **乙（要 K 決定是否修訂 ADR 0009）**：寫入點少、全部集中在一支程式的，改成寫入程式自己在同一個 batch 把版本號加 1。活動 6 個、已出所狗卡 3 個先做，再評估 dog-list 那幾張表。觸發器最少可以再減 9 個。ADR 0009 當初選觸發器，理由是「不靠各寫入路徑自己記得」，這一步會推翻這個原則，所以要 K 決定。

## 版本號與讀取端

| 版本號（表.欄） | 觸發器數（schema／正式） | Worker 誰讀、拿來做什麼 | 網站哪個頁面用到 | 觸發它的表誰在寫 |
|---|---|---|---|---|
| `v3_walk_pack.version`＋`payload` | 3／3 | `walk-accept.js:30` `readAcceptedWalks`：版本和內容同一列，是 `/today?source=d1`、`POST /walk` 回應的 snapshot | `walk-flow.js:117` 每分鐘輪詢；`walk-registration.js:99` 用 version 丟掉比較舊的 snapshot | `v3_walk_state`：`walk-accept.js:152,298,405`、`walk-reconcile.js:30`；`v3_walk_outbox.status`：`walk-accept.js:155,208,269,300,408-410,445`、`walk-reconcile.js:34` |
| `v3_walk_versions.total/live/months` | 3／3 | `packs.js:277`：`/walks`、`/walks?year=`、`/walks/mine` 的摘要、`/departed-cards` 的溜狗天數；切點換日時 `packs.js:199,225` 由程式自己加 1 | `app.js`、`analysis.js`、`cards.js`、`desk.js`（`api.walks`、`walksYear`、`myDogs`） | `v3_walks`：`dog-list.js:56-57,81,100,126`，`scripts/import-compact-profiles.mjs:129` |
| `v3_pack_versions.small` | 39 個 `packs_` 裡的 36 個／同 | `packs.js:276`：`/dogs`、`/rest` 的在所資料包；`activities.js:89`：活動名單快取的鍵也含 small（活動顯示狗名、編號） | `app.js`、`cards.js`、`edits.js`、`groups.js`（`api.dogs`）、`app.js`（`api.rest`）、`activities.js` | 見〈packs_〉逐表 |
| `v3_departure_versions.years` | 39 個 `packs_` 裡的 24 個／同 | `packs.js:110` `departurePacks`：`/departures/index`、`/departures?year=`、`/rest`、`/departed-cards` | `analysis.js` 離所名冊、`cards.js` 圖鑑的已出所 | 見〈packs_〉逐表 |
| `v3_activity_versions.ver` | 9／9 | `activities.js:89`、`departed.js:12` | `activities.js`、`cards.js` | `activities.js:117-164`、`scripts/import-activities.mjs`、`scripts/departed-card.mjs` |
| `v3_data_versions.today` | 3／3 | `today.js:48` `readTodayWalks`：只有不帶 `source=d1` 的 `/today` | 目前的網頁不會呼叫（`site-config.js:8` `d1WalkAccept: true` → `walk-flow.js:117` 帶 `d1`）；只剩舊網頁 | `today.js:39-42` `saveTodayWalks` ← `index.js:948`（沒有 requestId 的舊版 `POST /walk`） |
| `v3_identity_revision.revision` | 18／**0**（而且沒有那一列） | `identity.js:56,69,97,112,129`：更名、合併預覽、合併的樂觀鎖 | `welcome.js:25,31,43`（我是誰 → 改名字 → 合併） | `identity.js`、`compact.js:178-179`（常溜）、`index.js:787`（名字 last_seen）、`index.js:1064`（開卡）、`dog-list.js:46`（`linkIdentityName`）、`v3_walks` 的寫入點 |

另外 `v3_pack_versions` 在正式庫還留著舊欄 `walks`、`live`、`cutoff`，沒有程式讀寫（資料表稽核視窗查到的）。

## 現有測試對觸發器的要求

改觸發器時，這些測試要一起改或保持通過：

- `worker/test/packs.test.mjs`
  - `:325-366`：攔截在所資料包（`readDogsPayload`）、某一年離所（`readDepartures`）、休養（`readRest` main／年）實際讀到的 `v3_` 表，**每張都要有 `packs_<表>_INSERT/UPDATE/DELETE`**，拿掉任何一個都要抓得到。改成程式自己加 1 的話，這個測試要換成「每個寫入點都會讓版本號變」的測試。
  - `:310-323`：`v3_walks` 只讓改到的月份變，今天的紀錄只動 `live`。
  - `:336-345`：只改同步時間，small 不變（#361）。
  - `:460-478`：離所只讓那一年加 1；離所狗的休養、出入所紀錄不動在所的版本號。
  - `:509`：第一次補建 `v3_departure_versions` 時補上每年的鍵。
- `worker/test/d1-read.test.mjs:184-203`：名字 last_seen 只寫有變的；用 `total_changes()/2` 計數，**假設 `identity_v3_volunteers_*` 存在**（每寫 1 列多 1 列）。刪掉 identity 觸發器時，這裡的 `/2` 要拿掉。
- `worker/test/walk-accept.test.mjs:40-43`、`walk-edit.test.mjs:38-48`：注入 `v3_walk_pack` UPDATE 失敗時整批要回復（靠 `walk_pack_*` 觸發器在同一個交易裡）。
- `worker/test/walk-retry.test.mjs`、`walk-writeback.test.mjs`、`walk-reconcile.test.mjs`、`walk-pack-size.test.mjs`：snapshot 的 `syncStatus` 要跟著 outbox 變（`walk_pack_outbox_UPDATE`）。
- `worker/test/cpu-bench.test.mjs:33`、`scripts/cpu-bench.mjs:32`：直接改 `v3_walk_pack`。
- `worker/test/identity.test.mjs`：更名、合併、失敗回復；測試庫有 revision 列，所以抓不到正式庫的 bug。
- `scripts/compact-schema.test.mjs:26`：表清單；`scripts/copy-prod-d1.test.mjs`：複製正式庫時先刪觸發器。

## 連帶寫入量測

方法：本機 `node:sqlite` 載入 `db/compact-schema.sql`，照 `worker/src` 的寫法跑每一種寫入，用 `total_changes()`（含觸發器）減掉「拿掉全部觸發器再跑一次」的值。腳本不進 repo，作法和 `worker/test/walk-cost-preview.mjs` 相同。D1 會不會把觸發器的寫入算進 `rows_written`，官方文件沒寫；`docs/research/2026-10-18-d1-usage-1018.md:115` 用正式用量對過，要把 `packs_*` 觸發器算進去數字才對得上，`walk-accept.js:36` 的預算也照這個假設保守估。

| 寫入（程式位置） | 資料列 | 觸發器多寫 | 正式庫（沒有 identity） | 甲之後 | 乙之後（每批加 1 次） |
|---|---:|---:|---:|---:|---:|
| 狗清單：一隻狗今天溜了，2 人、昨天也 2 人（`dog-list.js:91-99`） | 7 | 9 | 7 | 7 | 2 |
| 同上，溜狗人沒變、只改日期 | 3 | 5 | 3 | 3 | 2 |
| 狗清單：回所過的狗改籠位（`dog-list.js:91`） | 1 | 3 | 3 | 1 | 1 |
| 狗清單：只補 `walker` 原文（#519 補填） | 1 | 1 | 1 | **0** | 0 |
| 狗清單：異動紀錄整段換 21 列（`dog-list.js:215`） | 42 | 42 | 42 | 42 | **1** |
| 狗清單：狗群一欄換 5 隻（`dog-list.js:199-200`，網站 `compact.js:129-134` 同） | 10 | 10 | 10 | 10 | **1** |
| 狗清單：一隻狗離所（`dog-list.js:159-166`） | 6 | 7 | 7 | 7 | 2 |
| 網站：固定照顧（`compact.js:217-219`） | 1 | 1 | 1 | 1 | 1 |
| 網站：休養（`compact.js:229`） | 1 | 1 | 1 | 1 | 1 |
| 網站：介紹＋2 筆入所事件（`compact.js:235-254`） | 3 | 3 | 3 | 3 | 1 |
| 網站：活動，5 隻狗（`activities.js:150-154`） | 11 | 11 | 11 | 11 | **1** |
| 網站：按溜了（`walk-accept.js:152-156`） | 3 | 1 | 1 | 1 | 1 |
| 網站：寫回成功（`walk-accept.js:298-300`） | 2 | 2 | 2 | **1** | 1 |
| 網站：開卡 1 張（`index.js:1064`） | 1 | 1 | 0 | 0 | 0 |
| 網站：名字 last_seen 每天更新 2 名（`index.js:787`） | 2 | 2 | 0 | 0 | 0 |
| 舊流程：今日溜狗 1 隻（`today.js:39-42`） | 1 | 1 | 1 | **0**（整條刪掉） | 0 |

正式庫累計的版本號（2026-10-24 查，等於各觸發器加 1 的次數）：small 1,383、today 600、walk live 368、total 81、departure 2026 年 38、walk_pack 36、activity 28。大部分表約 10-16 至 10-17 建，約 8 天，平均一天約 300 次。

**每天估算**（以 ADR 0014 的「每天約 55 筆溜狗紀錄」為準，正式 `v3_walks` 1,658 列／約 30 天也相符；假設約 30 隻狗經狗清單寫進主清單、30 次網站按溜了、2 次異動紀錄、1 次狗群、零星網站編輯）：

| | 觸發器數 | 一天觸發器多寫的列 | 占 `SYNC_DAILY_BUDGET` 40,000 |
|---|---:|---:|---:|
| schema 現況 | 75 | 約 500 | 約 1.3% |
| 正式庫現況 | 57 | 約 440 | 約 1.1% |
| 甲之後 | 54 | 約 400 | 約 1.0% |
| 乙之後（活動＋已出所狗卡；dog-list 也改的話） | 45（dog-list 也改：約 30） | 約 380（約 150） | 約 1%（約 0.4%） |

讀取這邊：在所資料包每失效一次，第一個 `/dogs` 要重算約 607 列（ADR 0014 實測）。一天約 40 批狗清單寫入，最多約 2.4 萬列讀取，約占讀取免費額度（一天 500 萬列）0.5%。觸發器內的 `EXISTS` 整張掃主清單，每次約 116 列，官方沒寫觸發器內的讀取怎麼計費。乙方案把同一批的多次失效合成一次，對讀取沒影響（讀取看的是兩次 `/dogs` 之間有沒有變，不是變了幾次）。

## 逐個觸發器

判定用語：**保留**（照舊）、**收窄**（保留，但加上 `UPDATE OF 欄位` 或 `WHEN`，只在網站讀的內容真的變了才寫）、**合併**（改成寫入程式在同一個 batch 自己加 1）、**刪除**、**待確認（依表稽核結果）**。

### walk_pack_（3 個，`compact-schema.sql:93-102`）

依賴的表：`v3_walk_state`、`v3_walk_outbox`、`v3_walk_pack`。#456／#500 新設計的表，ADR 0018 的核心，預期會留下。

| 觸發器 | 判定 | 證據與理由 |
|---|---|---|
| `walk_pack_INSERT` | 保留 | 第一次登記這隻狗，把它寫進 payload。版本號和內容存在同一列，讀取 1 列就夠，這是 #460 為了 CPU 刻意設計的。改成程式寫，就要在 `walk-accept.js:152,405`、`walk-reconcile.js:30` 三處各自組 JSON。 |
| `walk_pack_UPDATE` | 收窄 | 每次 UPDATE 都會加 1 並重寫 payload。但 payload 只用到 `version`、`effective_date`、`walker`、`updated_at`，寫回成功時 `walk-accept.js:298` 只改 `base_date`／`base_walker`，版本號仍然加 1（量測：寫回成功多 1 列）。改成 `AFTER UPDATE OF version,effective_date,walker,updated_at`。手機用 version 判斷新舊（`walk-registration.js:99`），少加這一次不影響。 |
| `walk_pack_outbox_UPDATE` | 保留 | 已經有 `UPDATE OF status WHEN NEW.status<>OLD.status AND 是目前版本`，網站顯示的寫回狀態（`syncStatus`）靠它。 |

### walkpack_v3_walks_（3 個，`:437-439`）

依賴的表：`v3_walks`、`v3_walk_versions`、`v3_walk_packs`、`v3_walk_summaries`。

| 觸發器 | 判定 | 證據與理由 |
|---|---|---|
| `walkpack_v3_walks_INSERT` | 保留（乙可合併） | 依日期決定動 `live` 或那個月（ADR 0009 按月分段）。`/walks` 的歷史資料包、我溜過的摘要都看它。寫入點只有 `dog-list.js` 和一支匯入腳本，乙方案可以改成 `dog-list.js` 在 batch 裡自己加；但月份要 JSON 加 1，寫在程式裡不會比較簡單。 |
| `walkpack_v3_walks_UPDATE` | 保留 | 只有 `dog-list.js:81` 補編號會 UPDATE，OLD、NEW 都在同一個月時加 2，影響很小。 |
| `walkpack_v3_walks_DELETE` | 保留 | `walkDay` 先刪後寫（`dog-list.js:56`）；刪舊日期（`:100`）時舊的那個月要失效。 |

### identity_（18 個，`:361-378`；正式庫 0 個）

依賴的表：`v3_identity_revision`、`v3_volunteers`、`v3_identity_names`、`v3_volunteer_codes`（和 `identity_names` 重複，看表稽核）、`v3_identity_redirects`、`v3_volunteer_favorites`、`v3_volunteer_cards`、`v3_walks`。**全部標「待確認（依表稽核結果）」**，以下是表不變時的建議。

這組在正式庫沒建，`v3_identity_revision` 也是空的，所以「刪掉」對正式庫是零變動，只是讓 schema 和正式庫一致。revision 只用在更名、合併的樂觀鎖。合併時，常溜、開卡在同一個 batch 用 `INSERT … SELECT` 一起搬走（`identity.js:131-134`），中途有人加常溜也會一起搬，不需要靠 revision 擋。真正要擋的只有「確認期間有人改了這兩個身分的名字對照或合併關係」。

| 觸發器 | 判定 | 證據與理由 |
|---|---|---|
| `identity_v3_walks_INSERT/UPDATE/DELETE` | 刪除 | 更名、合併不會改 `v3_walks`（歷史保留當時的代號，`docs/267-identity-rollout.md`）。版本號一變，只影響合併預覽上「溜過幾列」的顯示數字。每寫 1 列溜狗紀錄就多寫 1 列，是最大的連帶寫入來源（量測：一天溜了一隻狗多 2 列）。 |
| `identity_v3_volunteer_favorites_*`、`identity_v3_volunteer_cards_*` | 刪除 | 同上，合併時會在 batch 內一起搬；只影響預覽上的數字。每次加常溜、開卡都會多寫 1 列。 |
| `identity_v3_volunteers_*` | 刪除 | UPDATE 主要來自 `index.js:787` 每天更新 last_seen，跟身分無關，屬於過度觸發。改名（`identity.js:76`）、合併（`:138`）都在 identity 自己的 batch 裡，可以自己加 1。 |
| `identity_v3_identity_names_*`、`identity_v3_identity_redirects_*` | 合併 | 寫入點只有 `identity.js` 的 `linkIdentityName`、`renameIdentity`、`mergeIdentity`（`dog-list.js:46` 也是呼叫 `linkIdentityName`）。改成這三個 batch 自己 `UPDATE v3_identity_revision SET revision=revision+1`，並先補上 revision 那一列（正式庫目前沒有）。 |

前提：要先修好正式庫更名失敗的問題（補 revision 列，或改成沒有列時當 0），這是另一張票。

### version_v3_activities_、version_v3_activity_dogs_（6 個，`:308-313`）

依賴的表：`v3_activities`、`v3_activity_dogs`、`v3_activity_versions`。

| 觸發器 | 判定 | 證據與理由 |
|---|---|---|
| `version_v3_activities_INSERT/UPDATE/DELETE` | 甲：保留；乙：合併 | 網站寫入點只有 `activities.js:122,151,163` 三個 batch，本來就有 guard（`v3_activity_guard`）。量測：改一場 5 隻狗的活動，版本號加 11 次，加 1 次就夠。不過正式庫到現在才 5 次活動編輯，成本可以忽略，改的理由只有少 6 個觸發器。匯入腳本 `scripts/import-activities.mjs` 也要記得加 1。 |
| `version_v3_activity_dogs_INSERT/UPDATE/DELETE` | 甲：保留；乙：合併 | 同上。另外：刪活動時 `ON DELETE CASCADE` 會逐列觸發。`scripts/departed-card.mjs:51` 補狗 ID 時會 UPDATE。 |

### version_v3_departed_cards_（3 個，`:324-326`）

依賴的表：`v3_departed_cards`（正式庫 0 列）。**待確認（依表稽核結果）**：這張表可能併進離所或狗卡的設計。

| 觸發器 | 判定 | 證據與理由 |
|---|---|---|
| `version_v3_departed_cards_INSERT/UPDATE/DELETE` | 甲：保留；乙：合併；表若刪就跟著刪 | 唯一的寫入點是 K 手動跑的 `scripts/departed-card.mjs:49`，這支腳本本來就輸出 SQL，多一行 `UPDATE v3_activity_versions SET ver=ver+1` 就能取代 3 個觸發器。 |

### version_v3_today_walks_（3 個，`:397-399`）

依賴的表：`v3_today_walks`、`v3_data_versions`。**待確認（依表稽核結果）**，再加上舊流程什麼時候退場。

| 觸發器 | 判定 | 證據與理由 |
|---|---|---|
| `version_v3_today_walks_INSERT/UPDATE/DELETE` | 刪除（和表一起刪） | 現行網頁讀 `v3_walk_pack`（`d1WalkAccept=true`），`/today` 不帶 `source=d1` 的讀法只剩舊網頁。正式庫 `v3_today_walks` 最後一列是 2026-10-24，表示切換當天還有舊網頁在用 `index.js:946-951` 的舊寫入。建議：等這張表連續幾天沒有新列，或 `index.js:900-904` 的「已接管的狗不再允許舊手機覆蓋」涵蓋所有狗之後，再把表、版本號、`today.js` 的讀寫和這 3 個觸發器一起刪。只刪觸發器、不刪表的話，舊網頁會讀到過期的快取。 |

### packs_（39 個，`:416-427`、`:493-520`）

依賴的表：每張觸發表、`v3_pack_versions`、`v3_departure_versions`、`v3_packs`。表本身的去留（例：離所改用狗 ID 記，`v3_departures` 的主鍵從編號改成狗 ID）會讓 `packs_v3_departure_items_*` 的 `d.number=NEW.number` 跟著改。**下面每列都依表稽核結果確認一次**。

在所資料包讀哪些表，是 `packs.test.mjs:327-333` 實際攔截 SQL 得到的，不是推測。我逐一對過 `compact.js:19-61`、`:203-209`、`:322-354`，結論一致：每張表都有程式在讀，**沒有可以直接刪的**。

| 觸發器（表） | 讀的版本號 | 寫入點 | 判定 | 理由 |
|---|---|---|---|---|
| `packs_v3_sheet_main_INSERT/DELETE` | small＋那隻狗的離所年 | `dog-list.js:118,166` | 保留 | 狗進出主清單，在所資料包和離所年的休養（`readRest` 排除在主清單上的狗）都會變。 |
| `packs_v3_sheet_main_UPDATE` | small＋離所年 | `dog-list.js:79,91` | 收窄 | 在所資料包只讀 `MAIN_FIELDS`（`compact.js:12-15`）加上 `dog_id`、`row_index`、第 0 列的 `version`。`walker`（#519 原文）、`covered`（網站顯示的是 `v3_dogs.fixed_care`）、`synced_at` 改了也會讓 small 失效。改成 `UPDATE OF dog_id,number,name,cage,note,walked_date,my_walked,my_walked_date,sex,version`。離所那一段只有 `dog_id`、`number` 改了才會影響離所資料包（`readRest` 的 `NUMBER_OF`），可以拆成另一個 `UPDATE OF dog_id,number` 的觸發器，或加 `WHEN`。拆開之後觸發器數不變。 |
| `packs_v3_sheet_main_walkers_*` | small | `dog-list.js:94-95,122`、`dropMainRow` | 保留（乙可合併） | 在所資料包的 `walkers`。逐列觸發：2 人換 2 人就多 4 列。 |
| `packs_v3_sheet_groups_*` | small | `dog-list.js:199-200`、`compact.js:129-130`（網站狗群頁） | 保留（乙可合併） | 狗群頁、狗卡的同群狗。整欄先刪後寫，5 隻多 10 列。 |
| `packs_v3_sheet_group_labels_*` | small | `dog-list.js:202-204`、`compact.js:132-133` | 保留 | 群名。 |
| `packs_v3_sheet_changes_*` | small | `dog-list.js:215` | 保留（乙優先合併） | 異動紀錄整段換，21 列多 42 列，是放大最多的一組。也可以改程式，只寫有變的列；但列號一動就全部都變，效果有限。 |
| `packs_v3_intros_*` | small（只在主清單上的狗） | `compact.js:235-254`（網站介紹） | 保留；UPDATE 收窄 | 介紹存在 D1 自己這份（#250）。UPDATE 對 OLD、NEW 各加一次；`dog_id` 是主鍵、不會改，第二段加 `WHEN NEW.dog_id<>OLD.dog_id`（`rest`、`stays`、`intake_events`、`dog_numbers` 同）。 |
| `packs_v3_dog_numbers_*` | small＋離所年 | `dog-list.js:80,111,115`、`compact.js:260-286`（網站舊編號） | 保留；UPDATE 收窄 | 在所的 `formerIds`、離所休養的編號（`NUMBER_OF` 取最大編號）。 |
| `packs_v3_departures_*` | 離所年 | `dog-list.js:63,124-125,160,176` | 保留 | 離所名冊。UPDATE 對舊年、新年各加一次，同一年就加 2，影響很小。**待確認**：離所改用狗 ID 記之後，主鍵和查詢條件要一起改。 |
| `packs_v3_departure_items_*` | 離所年 | `dog-list.js:63,163,178-179` | 保留 | 判讀旗標、最後的舊編號、狗群。用 `number` 找離所年，**依離所改用狗 ID 的設計調整**。 |
| `packs_v3_rest_*` | small 或離所年 | `compact.js:229-230`（網站休養） | 保留；UPDATE 收窄 | 在所、離所都顯示休養。`saveRest` 存相同內容也會 UPDATE，進而觸發。 |
| `packs_v3_intake_events_*` | small（只在主清單上的狗） | `compact.js:248-250` | 保留；UPDATE 收窄 | 狗卡的入所紀錄。離所資料包不讀，所以只動 small 是對的（`packs.test.mjs:470-472`）。 |
| `packs_v3_stays_*` | small＋離所年 | `compact.js:290-305`（網站出入所紀錄） | 保留；UPDATE 收窄 | 在所、離所都顯示（`readAllStays`）。 |
| `packs_v3_dogs_INSERT/DELETE` | small（只在主清單上的狗） | `dog-list.js:114` | 保留 | 新狗。INSERT 時 `v3_sheet_main` 還沒有這隻（同一個 batch 晚一步才寫），實際上不會加 1，由主清單的 INSERT 觸發器負責。可以考慮刪，但為了守住「讀到的表都要有三個觸發器」這個測試，留著比較單純。 |
| `packs_v3_dogs_UPDATE` | small | `compact.js:219`（固定照顧） | 保留 | 已經有 `UPDATE OF fixed_care WHEN 有變`（#399），是收窄的範本。 |

**讀取成本**：`packs_v3_{intros,dog_numbers,rest,intake_events,stays,dogs}` 裡的 `EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=…)` 會整張掃主清單（`EXPLAIN QUERY PLAN`：`SCAN v3_sheet_main`），因為 `v3_sheet_main` 只有 `number`、`name` 索引。`compact.js:8` 的 `ON_MAIN` 也是同一個條件。是否加 `v3_sheet_main(dog_id)` 索引要看表稽核：加了之後，每次新增、刪除主清單列都會多寫 1 列。

## 精簡前後比較

| | schema 現況 | 正式庫現況 | 甲（建議） | 乙（另外由 K 決定） |
|---|---|---|---|---|
| 觸發器數 | 75 | 57 | 54（刪 identity 18、today_walks 3；收窄 9 個，數量不變） | 45（再合併活動 6、已出所狗卡 3）；dog-list 那幾張也改的話約 30 |
| 版本號 | 7 | 6（identity 沒在動） | 6（identity 改成程式加 1；today 隨表刪除） | 同甲 |
| 典型連帶寫入（狗清單一隻狗今天溜了） | 9 | 7 | 7 | 2 |
| 典型連帶寫入（異動紀錄整段換） | 42 | 42 | 42 | 1 |
| 一天觸發器多寫（估） | 約 500 | 約 440 | 約 400 | 約 380（dog-list 也改約 150） |
| 維護複雜度 | 新增被資料包讀到的表，要在 schema 加三個觸發器（測試會擋）；identity 只在 schema 有、正式庫沒有，看 schema 會被誤導 | 同左 | schema 和正式庫一致；剩下的觸發器都對應「網站讀得到的資料包」，規則只有一條 | 兩種機制並存：資料包用觸發器，活動用程式加 1。要在 `data-changes.md` 寫清楚哪張表用哪一種，否則比現在更難懂 |
| 風險 | — | 更名、合併在正式庫壞掉 | 刪 today_walks 太早，舊網頁會看到過期的今日溜狗；收窄的欄位清單漏掉一欄，網站就不會更新（要補「改每個欄位都會讓版本號變」的測試） | 寫入點忘了加 1，網站要等下一個寫入才更新；`packs.test.mjs` 的自動檢查也會失效，要改成寫入點的測試 |
| 還原方式 | — | — | 每項都是 `DROP TRIGGER`／`CREATE TRIGGER`，舊 SQL 留在 git，可以單獨還原；要配合 #521「schema 變更套到正式 D1 的路徑」那張前置票 | 還原時要同時改回程式和觸發器，不能只動 SQL |

**建議**：先做甲，順序如下：

1. 修好正式庫更名、合併失敗，並把 identity 改成程式自己加 1（另開票，屬於 bug）。
2. 刪 identity 18 個（schema 這邊；正式庫零變動）。
3. 收窄 `walk_pack_UPDATE`、`packs_v3_sheet_main_UPDATE`，以及 5 個 `*_UPDATE` 重複加 1 的情形。
4. 等舊網頁退場，再把 `v3_today_walks` 這一套整條拿掉。

乙的成本效益不大（一天少寫約 20～250 列），還會讓機制從一種變兩種。除非 K 想順便修訂 ADR 0009，否則建議不做，或只在表稽核決定重做 dog-list 那幾張表時一起做。

## 依賴表稽核的項目（交給 #549 對照）

| 表 | 這邊的哪些建議會跟著變 |
|---|---|
| `v3_today_walks`、`v3_data_versions` | 刪掉的話，`version_v3_today_walks_*` 一起刪 |
| `v3_identity_revision`、身分相關表（`v3_volunteer_codes` 和 `v3_identity_names` 重複；`v3_favorites`、`v3_card_opened` 是 #267 留下的來源表） | identity 這組全部 |
| `v3_departed_cards` | 表若刪，3 個觸發器跟著刪；否則照乙合併 |
| `v3_departures`、`v3_departure_items`（離所改用狗 ID 記） | `packs_v3_departures_*`、`packs_v3_departure_items_*` 的查詢條件，以及 `packs_v3_sheet_main_*` 離所那一段 |
| `v3_sheet_main` 的 `walker`、`covered`、`synced_at`、`version` 欄 | 欄位刪掉的話，收窄清單跟著改；加 `dog_id` 索引的話，觸發器內的 EXISTS 不用再整張掃 |
| 今天的溜狗記三份（`v3_walk_pack`、`v3_today_walks`、主清單＋`v3_walks`） | 若改成主清單不存溜狗欄，`packs_v3_sheet_main_walkers_*` 和收窄清單都要重算 |
| `v3_pack_versions` 的舊欄 `walks`、`live`、`cutoff`（只有正式庫有） | 沒有觸發器在用，表稽核決定要不要清 |
| `v3_sheet_former_numbers` | 在所資料包不讀（`packs.test.mjs:355` 確認過），沒有觸發器是對的；表若刪，不影響觸發器 |

## 方法與限制

- 正式 D1：`wrangler d1 execute bq-shelter-dogs --remote` 只送 SELECT，查了 `sqlite_master` 的觸發器名稱和 SQL、版本號現值、各表列數、`v3_edit_log` 每種編輯的次數、`v3_walk_write_budget`。全部 `rows_written=0`。
- 觸發器的 SQL 用正規化後的字串比對 schema 和正式庫，57 個相同、0 個不同。
- 連帶寫入是本機 SQLite 量的。D1 計費會不會把觸發器的寫入算進去，官方沒寫，只能沿用 2026-10-18 用量研究的對帳結果。每天的筆數是估計值，沒有拿 Cloudflare 帳號分析逐時對帳。
- 沒有評估觸發器對 Worker CPU 的影響（觸發器跑在 D1 那邊，不算 Worker CPU）。
