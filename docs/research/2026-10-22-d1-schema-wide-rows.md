# 2026-10-22 D1 表是不是設計過頭？哪些能合成大列省讀取

2026-10-22（台灣時間）。問題（K）：目前 D1 的表是不是過度設計，有哪些欄位／表可以合併，盡量用大列（寬列、JSON 欄位）省「讀取列數」。

只讀研究，沒有改程式、沒有查正式 D1。程式以 `origin/main`（4c80939）為準；目前工作分支 `chore/cleanup` 落後 main，main 已多了 #456 的 `v3_walk_state`／`v3_walk_requests`／`v3_walk_outbox` 等表（`git diff HEAD origin/main -- db/compact-schema.sql`）。
用量數字沿用 [2026-10-18-d1-usage-1018.md](2026-10-18-d1-usage-1018.md)、[2026-10-16-d1-table-audit.md](2026-10-16-d1-table-audit.md)、[2026-10-18-sync-231-rows.md](2026-10-18-sync-231-rows.md)，沒有重量。

## 結論（白話）

- **以「讀取列數」來看，現在不算設計過頭，而且最大的讀取已經是大列了。** 網站讀狗清單、離所、溜狗歷史都走資料包（`v3_packs`、`v3_walk_packs`、`v3_walk_summaries`，一包最多 1 MB 一列），沒變時只讀 1 列版本號（ADR 0009）。D1 照「掃過幾列」計費，跟一列多大無關（下面第 1 節），這正是 ADR 0009 選「按年存成少數大列」的理由。
- **整天用量只有免費額度約 1.6%**（10/18：讀約 8.2 萬／500 萬），而且前兩大來源（`favoriteAliases`、`rememberWalkerNames`）已在 #406、#407 修掉（`worker/src/compact.js:126-147`、`worker/src/index.js:905-906`，origin/main）。再合表能省的列數，絕對值很小。
- **表多，主要是為了「改一列只動一列」和試算表對照**，不是為了讀取：試算表複本（`v3_sheet_*`）照試算表結構拆、差異同步才能只寫有變的列（ADR 0008）；溜狗紀錄一筆一列，觸發器才能只讓那個月失效（ADR 0009）。改成大列，讀省一點，寫和同步複雜度反而變大。
- 真正值得做的是 **2 件小事＋1 件清理**（排名見第 4 節）：同步讀現況改讀「上次同步的快照」一列、開卡子查詢補索引、拿掉沒人讀的表。

## 1. D1 怎麼計讀寫（一手資料）

| 規則 | 來源 |
|---|---|
| 讀取列數＝查詢「掃過」的列數，跟每列大小無關；沒索引的條件會掃全表 | https://developers.cloudflare.com/d1/platform/pricing/ |
| 欄位數、列大小不影響計數（1 KB 和 100 KB 的列都算 1 列） | 同上 |
| 寫入有動到有索引的欄位，每個索引多算 1 列寫入 | 同上 |
| 免費方案：每天讀 500 萬列、寫 10 萬列，台灣時間 08:00（UTC 00:00）歸零 | 同上 |
| 一列（或一個字串／BLOB）最大 2,000,000 bytes；一張表最多 100 欄；一句 SQL 最長 100 KB；一句最多 100 個參數 | https://developers.cloudflare.com/d1/platform/limits/ |
| JSON 函式（`json_set`、`json_each`、`json_group_object`）是 SQLite 內建 JSON1，在單列內處理，不會讓 D1 多掃表列 | https://www.sqlite.org/json1.html（觸發器已在用，`db/compact-schema.sql` 的 `walkpack_v3_walks_*`、`packs_v3_departures_*`） |

推論：大列只在「原本要掃很多列、而且這些列總是一起讀」時才省。只讀幾列、或要邊讀邊挑的資料，合成大列不會省多少，還要整包重寫（寫入時大列算 1 列，但有並發覆蓋風險）。另外 2 MB 上限讓大列必須分段（`v3_packs`、`v3_walk_packs` 已用 `seq` 分段，`db/compact-schema.sql` 的 `v3_packs` 註解）。

## 2. 每張表一覽（origin/main，51 張 `CREATE TABLE`）

列數取自 10/16 審核與 10/18 同步 log（118 隻狗、6 筆離所、11 欄常遛群）；「網站每次讀」是走資料包後的情形。

| 群組 | 表 | 用途 | 網站每次讀 | 同步每次讀 | 已是大列？ |
|---|---|---|---|---|---|
| 狗身分 | `v3_dogs`（約 130）、`v3_dog_numbers`（約 130） | 永久狗 ID、編號對照 | 常溜時只查自己那幾隻（`compact.js:126-147`） | 全表（`scripts/sync-compact-d1.mjs:27-28`） | 否，也不需要 |
| 試算表複本 | `v3_sheet_main`（118）、`_main_walkers`（約 150）、`_groups`（約 60）、`_group_labels`（7）、`_changes`、`_former_numbers`（1） | 試算表「主清單」「常遛群」 | 走 small 資料包，沒變 1 列 | 全表（`sync-compact-d1.mjs:29-33,38`） | 讀取端已是（small 包） |
| 溜狗紀錄 | `v3_walks`（每天約 40 筆，三年 4.5 萬起） | 歷史 | 走年包＋版本號（ADR 0009、0013） | 只讀近幾天，走索引（`sync-compact-d1.mjs:67-68`） | 讀取端已是（`v3_walk_packs`、`v3_walk_summaries`） |
| 離所 | `v3_departures`、`v3_departure_items` | 離所名冊 | 按年資料包（ADR 0014） | 只讀近期，走索引（`sync-compact-d1.mjs:124`） | 讀取端已是 |
| 網站編輯 | `v3_intros`、`v3_intake_events`、`v3_rest`、`v3_stays`、`v3_edit_log` | 介紹、出入所、休養、編輯紀錄 | 在資料包內；編輯紀錄讀最新 N 筆 | `v3_intros` 部分（`sync-compact-d1.mjs:37`） | `v3_stays.stays_json` 已是 JSON |
| 志工 | `v3_volunteers`、`v3_identity_names`、`_redirects`、`_operations`、`v3_volunteer_favorites`、`v3_volunteer_cards` | 身分、常溜、開卡（ADR 0001、0005） | 主鍵／索引，每人數列～數十列 | 不讀 | 否 |
| 今日／溜了 | `v3_today_walks`、`v3_walk_state`、`v3_walk_requests`、`v3_walk_outbox` | 今天溜過（ADR 0007）、#456 先存 D1 再寫回 | 主鍵查一隻狗；今天列表 | 不讀 | `members_json`、`result_json` 已是 JSON |
| 版本號 | `v3_data_versions`、`v3_pack_versions`、`v3_walk_versions`、`v3_departure_versions`、`v3_identity_revision`（各 1 列） | 觸發器加 1，Worker 沒變就用快取 | 每次 1 列／種 | 不讀 | 已是單列＋JSON（`months`、`years`） |
| 沒人讀 | `v3_sheet_departed`、`v3_photos`、`v3_volunteer_codes`（只寫）、舊 `v3_favorites`／`v3_card_opened`（只在第一次設名字時搬） | 歷史遺留 | 0 | 0 | — |

## 3. 逐項評估：能不能合、合了省多少

### A. 同步讀「現況」改讀一列快照（省最多）

- 現況：每次同步 `SELECT *` 讀 12 張表（`sync-compact-d1.mjs:26-38`），加上 `v3_intros` 子查詢，10/18 量到一次同步約讀 1 萬列（06、19 時，[2026-10-18-d1-usage-1018.md](2026-10-18-d1-usage-1018.md) 第 5 節），其中試算表複本類全表約 600～700 列，`v3_intros` 那句 1,829 列。
- 做法：同步成功後把「這次寫進 D1 的試算表複本」整份存成 1～2 列 JSON（例如 `v3_packs` 的 `sync:seed` 或 `v3_sync_state`），下次比對直接讀這列。
- 省：每次同步約讀 1 萬 → 幾十列；一天 2～13 次同步 ≈ 每天省 2 萬～13 萬列（現在總讀量的 1/4 以上）。
- 風險：網站會直接改的表（`v3_intros`、`v3_walks` 經 #456）不能只信快照，要保留走索引的直讀；快照和實際表不同步時會寫錯，需要「快照版本號＝`v3_pack_versions`」之類的校驗，不符就退回現行全讀。屬 ADR 0008（只寫差異）範圍內的實作改善，不用重開決策，但 PR 要附預演（AGENTS.md）。

### B. `openedBooks` 子查詢補索引（不是大列，但最便宜）

- `compact.js:153-163`（origin/main）每張卡跑一次 `SELECT m.number FROM v3_sheet_main m WHERE m.dog_id=…`，`v3_sheet_main.dog_id` 沒有索引（`db/compact-schema.sql:14-29` 只有主鍵 `row_index`），10/16 的 `EXPLAIN` 是整表掃（[2026-10-16-d1-table-audit.md](2026-10-16-d1-table-audit.md)）。開卡 50 張的人讀一次約 50×118 ≈ 6,000 列。
- 加 `CREATE INDEX v3_sheet_main_dog ON v3_sheet_main(dog_id)` 後每張卡約 1～2 列。代價：同步改 `dog_id` 時多 1 列寫入（很少改）。
- 也可以把「每人開過的卡」存成一人一列 JSON，但開卡要並發 `json_set`、合併身分（`identity.js:136` 一帶）要改寫，風險比加索引大很多，不建議。

### C. 志工常溜／開卡改「一人一列 JSON」（不建議）

- `v3_volunteer_favorites`、`v3_volunteer_cards` 現在一人一隻狗一列，讀時走主鍵前綴（`compact.js:137-140`），10/18 量到每次約 23 列（[2026-10-18-d1-usage-1018.md](2026-10-18-d1-usage-1018.md) 排行 #4）。改一人一列可降到 1 列，一天省約 3,000 列。
- 代價：兩支手機同時按常溜會互蓋（要改用 `json_set` 在 SQL 內原子更新）；身分合併、改名搬資料（`identity.js:41-42,71-75,136`）全部要重寫；觸發器 `identity_v3_volunteer_*`（`db/compact-schema.sql:220-225`）語意改變。動到 ADR 0001／0005 的資料歸屬，要 K 重開。**省的列數不值得。**

### D. 五張版本號表合成一列（小省、要重開 ADR 0009 的做法）

- 每次 API 讀 1～3 種版本號，各 1 列；合成一列 JSON 可每次少讀 1～2 列。以 10/18 一天約 2,000 次讀查詢估，每天省約 2,000～4,000 列（推估）。
- 代價：所有 `packs_*`、`walkpack_*`、`identity_*`、`version_*` 觸發器都要改寫成 `json_set` 同一列；ADR 0009 明寫「獨立一張表，同步補建只跑 IF NOT EXISTS，不用 ALTER TABLE」（`db/compact-schema.sql` 的 `v3_pack_versions` 註解），而且 `worker/test/packs.test.mjs` 會檢查觸發器（AGENTS.md）。**鎖定決策，要 K 重開；省得少，不建議。**

### E. 試算表複本合成寬列（不建議）

- 把 `v3_sheet_main_walkers`、`v3_sheet_former_numbers`、`v3_sheet_changes` 併成 `v3_sheet_main` 的 JSON 欄，`v3_sheet_groups`＋`_group_labels` 併成一欄一列。
- 讀取：網站已走 small 包，省不到；同步端若做了 A 也省不到。寫入：差異同步要整列比對 JSON，一個人改一格就整欄重寫，反而違背 ADR 0008 的「只寫有變的列」，且 `packs_*` 觸發器要重寫。**沒有好處。**

### F. `v3_departure_items` 併進 `v3_departures` 的 JSON 欄（小）

- 兩張都只在算離所資料包時讀（ADR 0014），一年才數百列。省的量可忽略；不值得動 ADR 0014 已穩定的觸發器（`packs_v3_departure_items_*`）。

### G. `v3_walks` 改大列（不建議）

- 已由 `v3_walk_packs`／`v3_walk_summaries` 做讀取端大列（ADR 0009、0013）。原始表若也改大列，同步每加一筆就要重寫整月，且 `walkpack_v3_walks_*` 觸發器靠「一列一筆、依 `walk_date` 只讓那月失效」運作。保持現狀。

### H. 清理沒人讀的表（0 讀取差異，減少維護）

- `v3_sheet_departed`（`worker/src`、`scripts` 無讀寫）、`v3_photos`（照片在 R2，只剩匯入腳本 `scripts/import-compact-profiles.mjs:133` 寫）、`v3_volunteer_codes`（`identity.js:44,75,136` 只寫不讀）、`v3_pack_versions` 舊的 walks／live／cutoff 欄（`db/compact-schema.sql` 註解說沒人讀寫）。
- 舊 `v3_favorites`／`v3_card_opened` 還在第一次設定名字時搬資料（`identity.js:41-42`），要先確認沒有未搬的舊代號才能刪。
- 刪表是正式 D1 的 DROP，依 CORE_RULES 第 5 節要交給 K 執行；`scripts/compact-schema.test.mjs:14` 的表清單也要一起改。

## 4. 建議排名（省讀取 vs 風險）

| # | 項目 | 估計省讀（每天） | 風險 | 要 K 重開 ADR？ |
|---|---|---:|---|---|
| 1 | A：同步讀一列快照取代 12 張表全讀 | 2 萬～13 萬列 | 中（快照校驗、網站直接改的表要保留直讀） | 否（ADR 0008 範圍內，PR 附預演） |
| 2 | B：`v3_sheet_main(dog_id)` 索引 | 視開卡人數，每次讀開卡約 −數千列 | 低 | 否（照 AGENTS.md 寫進 `db/compact-schema.sql`） |
| 3 | H：清掉沒人讀的表 | 0 | 低（DROP 交 K 執行） | 否，但 DROP 需 K 確認 |
| 4 | D：版本號表合一列 | 約 2,000～4,000 列（推估） | 中高（全部觸發器） | 是（ADR 0009） |
| 5 | C：常溜／開卡一人一列 JSON | 約 3,000 列 | 高（並發、身分合併） | 是（ADR 0001／0005） |
| — | E、F、G | 接近 0 | 中～高 | E、G 牴觸 ADR 0008／0009 |

整體：即使全做，每天讀取也只是從額度 1.6% 降到 1% 左右；額度不是瓶頸（[2026-10-18-d1-usage-1018.md](2026-10-18-d1-usage-1018.md) 第 5 節）。做 1、2 就拿到大部分好處。

## 未確認／待查

- 正式 D1 志工類表、`v3_walk_state` 等新表的實際列數沒有查（本次不碰正式 D1）。
- A 的省量用 10/18 一天兩次同步的樣本外推；平日同步次數要再看 `gh run list --workflow sync-sheet.yml`。
- D 的「每次 API 讀幾種版本號」是從程式推估，沒有逐路徑實測。
- B 的效果要用 `EXPLAIN QUERY PLAN` 在加索引後確認。
