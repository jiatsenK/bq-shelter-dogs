# 修改紀錄加「溜了」與來源（志工網站／試算表）：現有架構下怎麼記最好

- 日期：2026-10-27（台灣時間）。Agent：Claude Code 研究代理。
- 問題（K）：管理網站「修改紀錄」要新增類型「溜了」，每筆標來源「志工網站」或「試算表」。初步提了 A（`editor_code` 填固定記號）、B（`v3_edit_log` 加 `source` 欄）；現有架構有沒有更好的做法？
- 範圍：只讀 repo（以 `origin/main` `14b476b` 為準，用 `git show origin/main:<路徑>` 讀）和官方文件。沒有改程式、沒有查正式 D1、沒有部署。
- 標記：每個主張附來源（`檔案:行號` 都是 `origin/main` 的行號）；從程式推得、沒實測的寫【推論】。

## 1. 給 K 的白話結論

- **建議 B（`v3_edit_log` 加一欄 `source`），而且「試算表那筆」要記在「今日溜狗比對」收下人工改表的那一刻，不記在狗清單同步。**
- 為什麼記在比對那裡：比對程式（#458）本來就在分「這是網站寫回去又讀回來的」還是「有人真的改了表」，只有後者才會建新版本。紀錄跟著這一步寫，**讀回不重複記這件事不用另外寫判斷**，直接沿用已上線、有測試的邏輯。狗清單同步分不出來，記在那裡會把網站寫回的值再記一次。
- 為什麼選 B：一欄說清楚來源，讀的時候 `COALESCE(管理者身分表.source, 紀錄.source, 'legacy')` 就好；加欄是 SQLite 直接支援的動作，repo 已經做過（migration 0005），不用重建表、不用備份流程（除非順便把舊的「自動認回所」改歸試算表，那句 UPDATE 會讓套用流程先備份，見 3.2）。
- 沒選的：
  - A（`editor_code` 填記號）：能動，但 `editor_code` 是志工代號欄（ADR 0004、0001「跟著代號存」），塞記號等於一欄兩種意思，來源判斷變成「看身分表→看記號→看類型」三層規則。
  - 改 `v3_dog_edit_actors` 的限制：SQLite 不能改既有 CHECK，要整張重建；這張表是「已驗證的操作者身分」，試算表沒有身分可填；每筆多寫一列＋兩個索引；以後再加來源又要重建一次。
  - 不記、讀的時候從溜狗那幾張表推：表的用途是寫回佇列，不是紀錄；推「哪筆是人工改」的條件很脆弱（還沒派送的網站版本 `dispatch_id` 也是空的）；管理網站的分頁游標是 `v3_edit_log.id`，混兩種來源會壞。
- 代價：每筆溜了紀錄約 2 列寫入（表＋AUTOINCREMENT 的序號表），照現有慣例預留 8 列；一天約 50～150 筆，合計數百列，對每天保留上限 40,000、免費額度 100,000 影響很小。
- **要 K 先確認的事**（第 6 節）：ADR 0004 寫「溜狗打卡不記」，這次要正式改；公開編輯紀錄頁排除溜了後，讀取量會變大，要不要加一個部分索引。

## 2. 現況（跟這次有關的部分）

### 2.1 修改紀錄怎麼存、來源怎麼算

- 表：`v3_edit_log(id AUTOINCREMENT, at, editor_code, editor_name, kind, dog_id, dog_number, before_json, after_json)`（`db/compact-schema.sql:217-227`），沒有任何 `ON v3_edit_log` 的索引（`git grep "ON v3_edit_log" origin/main -- db migrations` 無結果）。
- 來源：`v3_dog_edit_actors(request_id PK, log_id UNIQUE REFERENCES v3_edit_log(id), actor_subject, actor_email, source CHECK(source IN ('access','volunteer')))`（`db/compact-schema.sql:465-471`，由 `migrations/0009_dog_edit.sql` 建）。
- 寫這張身分表的只有狗資料編輯（`worker/src/dog-edit.js:289-290`）、管理站活動（`worker/src/admin/activities.js:13`）、合併狗（`worker/src/dog-merge.js:136`）。
- 讀：管理網站 `COALESCE(a.source,'legacy')`（`worker/src/admin/edits.js:44,60`，白名單 `SOURCES=['access','volunteer','legacy']` 在第 9 行）；公開 `/api/edits` 也一樣（`worker/src/editlog.js:78`）。畫面字：`access→管理網站、volunteer→志工網站`，其他都是「舊紀錄」（`admin/public/js/edit-log.js:31`）；篩選選單在 `admin/public/updates.html:43`。
- **副發現**：沒寫身分表的新紀錄也顯示「舊紀錄」，不只真正的舊資料。例如網站「改溜狗人／撤銷溜了」（`worker/src/walk-accept.js:182-183`）、志工端活動紀錄、備註（`worker/src/index.js:311,610`）、志工更名合併（`worker/src/identity.js:74,137`）、自動認回所（`worker/src/dog-list.js:106,123`）。

### 2.2 「溜了」現在走哪幾條路

| 事件 | 程式 | 現在寫不寫修改紀錄 |
|---|---|---|
| 網站按溜了（action `walk`） | `acceptWalk`，`worker/src/walk-accept.js:119-195` | 不寫；`editor` 只在 `edit`／`undo` 時才有（第 134-135 行），預算 `editor ? 40 : 32`（第 175 行） |
| 網站改溜狗人／撤銷 | 同上 | 寫 `walkedit`／`walkundo`，同一個 batch（第 182-183 行），沒寫身分表 |
| 人工改表，GAS 編輯觸發送來 | GAS `onWalkSheetEdit` → `flushWalkEdits`（`apps-script/sheet-write.gs:292-347`）→ `reconcileEditedRows`（`worker/src/walk-reconcile.js:67-77`）→ `reconcileWalk`／`compareTrustedWalk`（`worker/src/walk-accept.js:357-441`） | 不寫 |
| 網站寫回前同鎖讀表 | `writebackTarget` 先呼叫 `reconcileWalk`（`worker/src/walk-accept.js:444-447`） | 不寫 |
| 今日溜狗保險掃描（一天三次） | `scanWalks` → `reconcileWalkSnapshot`（`worker/src/walk-reconcile.js:8-43,53-62`） | 不寫 |
| 同一次人工改表，狗清單那條 | `applyMain`（`worker/src/dog-list.js:66-126`），寫 `v3_sheet_main`、`v3_walks` | 不寫（只有自動認回所寫 `former`） |

同一次改「遛狗日期／誰遛的」，GAS 會**同時**送兩條：今日溜狗比對（`flushWalkEdits`）和狗清單（`flushDogList`）（`apps-script/sheet-write.gs:300-315`）。

### 2.3 為什麼「試算表那筆」只能記在比對那條

- **比對那條已經會分讀回**：`compareTrustedWalk` 先比「表上值 base」（`walk-accept.js:392-398`，一樣就結束）；表上值等於網站目前值且有派送 → 當成寫回讀回，走 `confirmWalk`（第 400-403 行）；可能是還沒確認的派送結果 → 存衝突、不收（第 405-409 行）；是較早已讀回的中間值 → 不收（第 410-411 行）。剩下的才建新版本、`v3_walk_outbox` 那筆 `dispatch_id` 空白、直接 `synced`（第 419-439 行；註解見第 342 行「人工改表的版本：建立當下就 synced、沒派送過」）。`reconcileWalkSnapshot` 也只在狀態已同步時收（`walk-reconcile.js:19-21`）。
- **狗清單那條分不出來**：網站寫回是程式寫入，不觸發編輯觸發器（`walk-accept.js:72-74` 註解；ADR 0018 補充第 30 行），所以 `v3_sheet_main.walked_date` 不會跟著網站更新，要等狗清單保險掃描（一天三次）送整列；那時 `applyMain` 看到日期變新（`dog-list.js:96`），跟人工改表長得一樣。記在這裡，網站按的每一筆幾小時後會再被記一次「試算表」。【推論，依程式路徑】

## 3. 以前怎麼改既有 D1 表

### 3.1 流程（#553 起）

- 改結構一律新增 `migrations/NNNN_*.sql`，同時改 `db/compact-schema.sql`；`scripts/d1-migrations.test.mjs` 檢查空庫跑完全部 migration 跟這份一樣；**用 ALTER 補的欄要寫在建表 SQL 最後面**（`docs/agents/data-changes.md:18-19`）。
- 「先加後刪」：加東西跟用它的程式同一張 PR；刪東西或搬資料先部署不用它的程式，下一張 PR 才刪（`docs/agents/data-changes.md:20-22`）。
- 正式庫由 Actions「套用 D1 migration」套用；有刪資料或搬資料的 migration（`changesData` 判斷 DROP TABLE／DELETE／UPDATE／INSERT…SELECT／ALTER…DROP|RENAME，`scripts/d1-migrations.mjs:37`）會先整份複製到 `bq-shelter-dogs-backup`；部署前擋關檢查有沒有沒套的（`docs/agents/data-changes.md:23-24`；`scripts/d1-migrations.mjs:1-6`）。
- AGENTS.md 舊版提到的 `scripts/sync-compact-d1.mjs`／`SYNC_SCHEMA_SKIP` 已隨 #553、#596 退役（`origin/main` 樹裡沒有這支；`docs/agent-log/2026-10-24-553-d1-migrations.md`）。

### 3.2 先例

| 做法 | 先例 | 備註 |
|---|---|---|
| `ALTER TABLE … ADD COLUMN` 加欄＋同一檔搬資料 | `migrations/0005_walkers_groups_json.sql:6-7`（`v3_sheet_main.walker_codes`），commit `16a7ecc`（#578） | 有 UPDATE → 套用時會先備份 |
| `ALTER TABLE … DROP COLUMN` | `migrations/0004_drop_unused_tables.sql:16-22`（#557，`a0e1458`） | 觸發器 `UPDATE OF` 有列到的欄要先換觸發器 |
| 整張重建（`CREATE … AS SELECT` → DROP → 重建 → 搬回） | `migrations/0004_drop_unused_tables.sql:29-33`（`v3_pack_versions`） | 只用在沒有外鍵指向、沒有觸發器掛著的小表 |
| 改既有 CHECK | 沒有先例 | — |

### 3.3 官方限制

- SQLite `ADD COLUMN`：不能 PRIMARY KEY／UNIQUE；`NOT NULL` 要有非 NULL 預設；帶 CHECK 的新欄會對既有列檢查（3.37.0 起）。要「加 CHECK／外鍵／NOT NULL」這類變更要走 12 步重建：建新表、搬資料、刪舊表、改名、重建索引與觸發器、檢查外鍵（<https://www.sqlite.org/lang_altertable.html>）。
- D1 預設強制外鍵，查詢與 migration 裡都不能關；只能 `PRAGMA defer_foreign_keys = on` 延到交易結束（<https://developers.cloudflare.com/d1/sql-api/foreign-keys/>）。`v3_dog_edit_actors.log_id` 參照 `v3_edit_log(id)`，重建身分表本身可行，但這是「沒有現成安全做法」的領域。
- D1 計費：免費方案寫入每天 100,000 列，UTC 00:00 重置；寫入有索引的欄「至少多算 1 列」（<https://developers.cloudflare.com/d1/platform/pricing/>）。

## 4. 方案比較

共同前提（不管哪個方案都一樣）：

- 網站溜了：在 `acceptWalk` 的同一個 batch 加一句 `INSERT INTO v3_edit_log`（kind `walk`），跟 `walkedit`／`walkundo` 同寫法（`walk-accept.js:182-183`），預算照慣例 32→40。batch 是交易，溜了跟紀錄一起成功或一起回復；`requestId` 重送時直接回舊結果（第 130-131 行），不會重複記。
- 試算表：在 `compareTrustedWalk` 收下人工值的 batch（`walk-accept.js:428-439`）和 `reconcileWalkSnapshot` 的 batch（`walk-reconcile.js:27-38`）加一句，預算 +8。條件：收下後日期不是空的（清空不記）、而且跟收下前的日期或名單不同。日期變新、同天換人、改回較早都會進這個條件。
- 狗清單 `applyMain` 不記溜了。

| | A 記號放 `editor_code` | **B `v3_edit_log` 加 `source`** | C 擴充 `v3_dog_edit_actors` CHECK | D 讀時從溜狗表推 |
|---|---|---|---|---|
| Schema | 不動 | 1 個 migration：`ADD COLUMN source TEXT` | 12 步重建身分表（含外鍵） | 不動 |
| 每筆寫入 | 約 2 列（表＋序號） | 約 2 列 | 約 2 列＋身分表 1 列＋主鍵、UNIQUE 兩個索引（約 5 列） | 0 |
| 讀回不重複記 | 靠共同前提，OK | 同左 | 同左 | 要自己從 outbox 推；`dispatch_id=''` 同時包含「人工改表」和「網站還沒派送」，合併名單的人工版本又會派送（`walk-accept.js:413-420`），條件很脆弱 |
| 撤銷、改回較早 | 撤銷照舊記 `walkundo`；改回較早由比對那條記 | 同左 | 同左 | 要比相鄰兩個版本才知道是不是改回較早 |
| 改動範圍 | 程式 6～8 檔 | 程式 6～8 檔＋migration＋schema | B 的全部＋重建身分表、所有寫身分表的地方要決定填什麼 | 管理網站查詢改成 UNION，游標分頁要重做 |
| 可維護性 | `editor_code` 一欄兩義；來源判斷三層 | 一欄一義；以後新來源只改程式白名單（**新欄不要加 CHECK**，否則下次加來源又要重建） | 身分表要填假的 subject／email；每加一種來源重建一次 | 資料保存靠佇列表沒被清；沒有保證 |
| 套用風險 | 無 | 純加欄不備份；含舊資料改歸類的 UPDATE 會自動先備份 | 有外鍵、要備份、沒有先例 | 無 |

其他想過的：

- **另開一張 `v3_walk_log`**：寫入量跟 B 一樣，但管理網站要合併兩張表、`id` 游標分頁（`worker/src/admin/edits.js:49,60-64`）要改成依時間＋表別，改動比 B 大，好處只有「公開編輯紀錄天生不會看到」。不建議。
- **只靠 kind 分來源**（例如 `walk` 與 `sheetwalk` 兩種 kind）：不用 schema，但「溜了」篩選要對兩個 kind、`KIND_LABELS` 要兩個同名項目，「自動認回所」還是要另外判斷。比 A 好一點，比 B 亂。

## 5. 正確性細節（推薦方案）

- **網站寫回後讀回**：不記。比對看到表上值等於網站目前值且有派送 → `confirmWalk`（`walk-accept.js:400-403`）；看到較早已讀回的中間值 → `knownIntermediate` 不收（第 410-411 行）；結果不明 → 記衝突、不收（第 405-409 行）。這三種都不會跑到建新版本的 batch。
- **清空日期**：比對會收下（版本換成空日期），但條件「日期不是空的」擋掉，不記。跟 K 的需求一致。
- **改回較早一天**：`droppedDay` 已經在同一 batch 刪較新那天（`walk-accept.js:78-81,427-431`；`walk-reconcile.js:26`），紀錄跟著記一筆 before＝原本日期／名單、after＝表上日期／名單。
- **人工連改兩格（先改名再改日期）**：比對每收一次就記一筆，會出現兩筆。`beforeManualEdits` 只修正「上一次」不合併版本（`walk-accept.js:342-354`）。要合併成一筆得另外做，先不建議。【推論】
- **同天合併名單**：表上跟網站同時加人時，比對會把兩邊合起來（`walk-accept.js:413-416`）。紀錄的 after 建議存 D1 收下的名單（target），before 存原本 D1 名單。
- **保險掃描補到的**：`at` 是 D1 收下的時間，不是實際改表時間（最晚約差到下一次掃描，09:23／13:23／23:23，ADR 0018 第 5 點）。
- **公開編輯紀錄不顯示**：`readEdits` 加 `WHERE l.kind<>'walk'`（`editlog.js:78`）。注意它是 `ORDER BY id DESC LIMIT 100`、沒有索引，溜了占多數後每次要多掃過溜了的列才湊滿 100 筆；量大時可加部分索引 `CREATE INDEX … ON v3_edit_log(id) WHERE kind<>'walk'`（溜了那筆不進這個索引，不多算寫入）。【推論，未實測讀取量】
- **網站的撤銷／改溜狗人**：維持 `walkundo`／`walkedit`，來源一起填 `volunteer`（原本顯示成「舊紀錄」是 2.1 的副發現）。要不要把這兩類也歸進「溜了」，請 K 決定。

## 6. ADR 限制

- **ADR 0004（`docs/adr/0004-open-editing-and-edit-log.md:19,51`）**：「溜狗打卡不記（量大，試算表本身就有）」「`v3_edit_log` 只增不刪，量不大（不記溜狗）」。這次需求直接改這條，要新 ADR 或在 0004 加修訂行；只增不刪不變，一年約 2～5 萬列【推論，依每天 50～150 筆】。
- **ADR 0020（`docs/adr/0020-independent-admin-site.md`）**：管理者身分只在後台看得到、志工自選名字不假稱已驗證。B 不碰身分表，符合；C 要填假身分，跟這條精神衝突。
- **ADR 0008（後續 #591 段落）＋ 0018**：寫 D1 前要算進每天預算（`writeBudget`，`walk-accept.js:50-60`；`SYNC_DAILY_BUDGET` 40000、`D1_WALK_NOTIFY` 1，`wrangler.jsonc:29,31`）。共同前提的「+8」照 `editor ? 40 : 32` 慣例。`worker/test/walk-cost-preview.mjs`、`walk-reconcile-cost-preview.mjs` 可能要跟著更新數字。
- **ADR 0006**：試算表寫入範圍不變，這次不寫試算表。
- **ADR 0007**：已由 0018 修訂；「今日紀錄只是暫時消息」不再適用，不影響本案。
- **ADR 0009**：`v3_edit_log` 不在任何資料包，不用補 `packs_*` 觸發器。
- **ADR 0012**：已退役，只剩歷史。

## 7. 推薦方案要改的檔案

1. `migrations/0010_edit_log_source.sql`（新）：`ALTER TABLE v3_edit_log ADD COLUMN source TEXT;`（不加 CHECK、可 NULL，舊列都是 NULL）。要把舊「試算表（自動認回所）」改歸試算表就加 `UPDATE v3_edit_log SET source='sheet' WHERE kind='former' AND editor_name='試算表（自動認回所）' AND source IS NULL;`（會觸發套用前備份）；不想備份就改在讀取時判斷這種舊列。
2. `db/compact-schema.sql`：`v3_edit_log` 建表最後補 `source TEXT`（可選：部分索引）。
3. `worker/src/editlog.js`：`KIND_LABELS` 加 `walk: '溜了'`；`readEdits` 排除 `walk`、來源改 `COALESCE(a.source,l.source,'legacy')`；`logEdit` 可帶 `source`。
4. `worker/src/walk-accept.js`：`acceptWalk` 的 `walk` 記一筆（source `volunteer`，`walkedit`／`walkundo` 也補 source）；`compareTrustedWalk` 收下人工值時記一筆（source `sheet`），預算 +8。
5. `worker/src/walk-reconcile.js`：`reconcileWalkSnapshot` 同上。
6. `worker/src/dog-list.js:123`：自動認回所寫 source `sheet`。
7. `worker/src/admin/edits.js`：`SOURCES` 加 `sheet`，第 44、60 行改 `COALESCE(a.source,l.source,'legacy')`。
8. `admin/public/updates.html:43`：來源選單加「試算表」；`admin/public/js/edit-log.js:31`：`sheet → 試算表`；`admin/public/js/updates.js`／`edit-values.js`：溜了的改前→改後顯示。
9. 測試：`worker/test/walk-accept.test.mjs`、`walk-reconcile.test.mjs`、`walk-writeback.test.mjs`（讀回不記）、`walk-edit-rows.test.mjs`、`admin-stage4.test.mjs`、`dog-list.test.mjs`、兩支 cost-preview；`scripts/d1-migrations.test.mjs`、`scripts/compact-schema.test.mjs` 會自動比對 schema。
10. 文件：ADR 0004 修訂（或新 ADR）、`docs/operations/admin-records.md`、`GLOSSARY.md`（如果「來源」要定義）。

可選（範圍外，K 決定）：其他志工網站來的紀錄（活動、備註、更名合併、撤銷／改溜狗人）往後也填 `volunteer`，不再顯示「舊紀錄」。
