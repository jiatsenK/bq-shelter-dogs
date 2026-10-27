# D1 稽核第 9 項：5 個小問題逐項確認

日期：2026-10-27。來源：`docs/research/2026-10-27-d1-efficiency-audit.md` 第 9 項（在 `claude/d1-efficiency-audit` 分支）。
做法：只讀程式碼（main `6a07475`），沒有改程式、沒有查正式庫。列數用「大約多少列」描述，沒有新的實測。

## 結論先講

| # | 問題 | 值不值得做 | 理由 |
|---|---|---|---|
| 1 | 編輯狗資料，版本號被加 2–3 次 | **不做**（最多寫進文件） | 只多寫幾列，對正確性沒影響；改觸發器風險比省下的多 |
| 2 | `/departed-cards` 重複讀版本號 | 順手做 | 少讀 1 列、改 1 行，零風險，但效益幾乎看不到 |
| 3 | 重試排程 3 句 SELECT 合成 1 句 | **不做** | 讀的列數不變，只省 2 次往返；合併後 SQL 變難讀 |
| 4 | 新增沒編號的狗整張掃 `v3_walks` | 低優先，可做 | 很少發生，但每次整張掃且 `v3_walks` 會一直長大 |
| 5 | 保險掃描每次掃 `walker IS NULL` | **值得做（最划算）** | 每天 3 次固定整張掃主清單，加一個空的部分索引就變 0 列 |

## 1. 編輯一次狗資料，版本號被加 2–3 次

**事實**

- `dog-edit.js:180-182` 編輯時自己先做 `UPDATE v3_dog_edit_state SET revision=revision+1,token=? … AND revision=?`（樂觀鎖，CAS）。
- 同一批接著寫 `v3_intros`、`v3_intake_events`、`v3_stays` 等表（`dog-edit.js:183` 以下）。這些表各有 `dog_edit_*` 觸發器，會再做一次 `revision=revision+1`（`db/compact-schema.sql:472-499`）。
- `v3_dog_edit_state` 每次 `revision` 變動都觸發 `packs_v3_dog_edit_state_UPDATE`（`compact-schema.sql:506-509`）：`v3_pack_versions.small+1`，若是離所狗還會重算 `v3_departure_versions.years`（用 `json_each`，只碰一列）。
- 所以編輯一個欄位：revision +2（改一張表）或 +3（如 stays 同時改編號表），small 版本也跟著 +2～+3。

**影響**

- 正確性：沒影響。CAS 只比「打開時的 revision 等不等於現在」，跳號不會讓衝突判斷出錯；網站拿到的是編輯後重讀的 revision。
- 成本：每次編輯多 1–2 次對 `v3_dog_edit_state`、`v3_pack_versions`（以及離所狗的 `v3_departure_versions`）的單列更新。編輯是管理者手動操作，次數很少。
- small 多加幾次不會多重算：資料包是在下一次讀取時才依版本號重算一次（`packs.js` `smallPack`），中間跳幾號都只重算一次。

**修法選項**

- A. `dog-edit.js` 不自己加 revision，只寫 token（`SET token=? WHERE revision=?`），讓觸發器負責加。但「什麼都沒改到」的欄位不會觸發，CAS 就失效，要另外處理。
- B. `dog_edit_*` 觸發器加條件「這一批的 token 已變就不再加」。觸發器裡沒有「同一批」的概念，做不乾淨。

**風險**：觸發器是 ADR 0009 系統的一部分，同步（`dog-list.js`）也靠它讓編輯中的網頁收到衝突。改錯會造成「別人改了卻沒擋下」，代價遠大於省下的幾列寫入。

**建議**：不做。若要留紀錄，在 `docs/ARCHITECTURE_NOW.md` 註明「revision 只保證會變、不保證每次 +1」。

## 2. `/departed-cards` 重複讀版本號

**事實**

- `departed.js:29` `readSmall(db,'departures')` 和 `:31` `readSmall(db,'cards')` 都走 `departurePacks(db)`（`packs.js:301-302`）。
- `departurePacks` 每次開頭都讀 `SELECT years FROM v3_departure_versions WHERE id=1`（`packs.js:110`）。資料包本身有記憶體快取（`mem.deps`），第二次不會重讀 `v3_packs`，只多讀這 1 列版本號。

**影響**：每次開離所卡片頁多讀 1 列、多 1 次往返。量很小。

**修法**：在 `departed.js` 呼叫一次 `departurePacks`（或讓 `packs.js` 多匯出一個一次回 `{ departures, cards }` 的函式），兩邊共用。

**風險**：幾乎沒有；兩次讀取之間版本號被改的情況，合併後反而更一致（同一份資料包）。

**建議**：可以順手做，不必單獨開票；併入其他碰到 `packs.js` 的票。

## 3. 重試排程 3 句 SELECT 可合併

**事實**

- `walk-retry.js:18-32` 依序查：中斷的派送（`v3_walk_delivery`）、舊版遺留的 `dispatching`、到期的 `pending/retry/unconfirmed`，三句都 `LIMIT`，總共最多 10 筆，且後一句的 LIMIT 依前一句結果計算。
- 三句都靠索引或很小的表（outbox／delivery 平常幾乎是空的），讀的列數本來就少。

**影響**：每次排程省 2 次往返；讀列數幾乎不變（D1 計費看列數，不看句數）。

**修法**：用 `UNION ALL` 加一個優先順序欄位、外層 `ORDER BY 優先順序,時間 LIMIT 10`。

**風險**：三種情況的 JOIN 條件、回傳欄位不同（只有第一種有 `dispatch_id`），合併後要補 NULL 欄位，順序與上限的語意要重新驗證；這是寫回重試的核心路徑（#498），出錯會讓溜狗紀錄寫不回試算表。

**建議**：不做。效益是往返次數，不是費用。

## 4. 新增沒編號的狗時整張掃 `v3_walks`

**事實**

- `dog-list.js:100`：主清單出現新的一行、且沒有編號時，用 `SELECT w.dog_id … FROM v3_walks w … WHERE dog_number='' AND dog_name=? LIMIT 1` 找以前有沒有用名字記過的同一隻。
- `v3_walks` 只有 `v3_walks_date(walk_date)` 索引（`compact-schema.sql:327`），這句是整張掃（稽核的查詢計畫：`SCAN w`）。找到就提早停（`LIMIT 1`），找不到就掃完整張。
- 會走到這裡的情況：試算表新增一隻還沒編號的狗。平常很少見，但真的發生時多半是「新狗、找不到」，等於每次都掃完整張。

**影響**：發生頻率低；單次成本 = `v3_walks` 全部列數，而且這張表只增不減，會越來越貴。

**修法**：加部分索引 `CREATE INDEX v3_walks_nameonly ON v3_walks(dog_name) WHERE dog_number=''`（稽核已驗證查詢計畫會變成 `SEARCH`）。沒編號的溜狗紀錄很少，索引很小，平常寫入 `v3_walks` 只有沒編號那幾筆要多維護索引。

**風險**：低。要走一次 migration（依 `docs/agents/data-changes.md`）；建索引當下會整張讀一次。

**建議**：低優先。可以併到下一次有 D1 migration 的票，不單獨開。

## 5. 保險掃描每次都掃 `walker IS NULL`

**事實**

- `dog-list.js:251`：每次保險掃描（`scanTick`，每天 3 次，`walk-retry.js:9-12` 註解）都跑 `SELECT number,name FROM v3_sheet_main WHERE walker IS NULL`。這是 #519 補填「誰遛的」原文用的。
- `v3_sheet_main` 沒有 `walker` 的索引（`compact-schema.sql:119-122` 只有 number、name、dog_id），所以每次整張掃主清單。稽核已確認正式庫符合條件的是 0 列，補填早就完成。
- `index.js:471` 另有一句同條件的查詢（管理用途），也會整張掃。

**影響**：每天固定 3 × 主清單列數（數百列）的讀取，換到的結果永遠是空的。五項裡唯一「每天固定發生」的。

**修法選項**

- A. 加部分索引 `CREATE INDEX v3_sheet_main_walker_null ON v3_sheet_main(row_index) WHERE walker IS NULL`。目前 0 列，索引幾乎不佔空間；兩處查詢都變成讀 0 列。保留 #519 的自動補填行為。
- B. 直接拿掉 #519 補填邏輯。但新寫入的路徑若還可能留 `walker=NULL`，就會失去安全網，需要先確認所有寫入都會填值。

**風險**：A 很低（一次 migration）；B 要多查寫入路徑。

**建議**：做 A，最划算。可和第 4 項同一個 migration。

## 建議的處理方式

- 若要開票：一張「D1 小索引」票，包含第 5 項（A）與第 4 項的兩個部分索引，一次 migration。
- 第 2 項併入其他會改 `packs.js` 的票。
- 第 1、3 項不做。

## 定案（K，2026-10-27）

- 照建議：第 5、2 項做（#678），第 4 項低優先（#683），第 1、3 項不做。
