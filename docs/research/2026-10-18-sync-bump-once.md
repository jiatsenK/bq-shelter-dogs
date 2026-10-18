# 同步時版本號「只加一次」：是不是有利無弊

2026-10-18（台灣時間）。接續 [2026-10-18-sync-231-rows.md](2026-10-18-sync-231-rows.md) 第 5 節建議 1。
只讀：沒有改程式、沒有寫 D1。

## 結論（白話）

- **「旗標卡住」的風險幾乎不存在**：整份同步 SQL 是一次匯入，失敗會整份退回；匯入時資料庫不接別的請求，網站寫入插不進來。
- **但不是「有利無弊」**：真正的弊是**算錯版本號**和**多一套要維護的規則**。溜狗紀錄的版本號按月份、按「今天以前／今天」分開記，最後補加一次時要自己算對哪幾個月、哪一邊；算漏一個月，網站就會一直拿舊的那個月。
- **省得很少**：一次大同步少寫約 300 列，一天約 300～500 列，是免費額度 10 萬列的 0.3～0.5%。
- **建議：現在不做**。等哪天寫入真的接近額度（例如一天超過 3 萬列）再做；要做的話只做 `small` 和 `identity` 兩個（只看「有沒有變」，加一次就等價），溜狗紀錄和離所的觸發器維持原樣。

## 1. 整份 SQL 是不是原子（中途失敗會不會整份退回）

- Cloudflare 在 D1 正式版公告寫明：`wrangler d1 execute --file` 的大型匯入是原子操作，不會讓資料庫停在一半（[blog.cloudflare.com/whats-new-with-d1](https://blog.cloudflare.com/whats-new-with-d1/)）。
- wrangler 執行 `--remote --file` 時印出的說明也寫：執行沒完成時資料庫會回到原本狀態、可安全重試；並警告匯入期間 D1 無法回應其他查詢（同步 log 那句「D1 database will be unavailable」；另見 [workers-sdk#9503](https://github.com/cloudflare/workers-sdk/issues/9503) 的 log 片段）。這是工具輸出，不是文件條款。
- 官方文件頁（[import-export-data](https://developers.cloudflare.com/d1/best-practices/import-export-data/)、[wrangler d1 指令](https://developers.cloudflare.com/workers/wrangler/commands/d1/)）**沒有**另外寫失敗回滾的保證。
- **SQL 裡不能自己寫 `BEGIN`／`COMMIT`**：官方要求匯入前刪掉，否則報「cannot start a transaction within a transaction」（[import-export-data](https://developers.cloudflare.com/d1/best-practices/import-export-data/)），代表整份本來就包在一個交易裡。`SAVEPOINT` 文件沒提，[SQL statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/) 頁也沒列；不建議依賴。

**判斷**：旗標的寫入和刪除放在同一份 SQL，成功就一起生效、失敗就一起消失，外面看不到「旗標存在」的中間狀態。唯一會卡住的情況是**程式自己忘了刪**（產生 SQL 的邏輯寫錯），這要靠測試擋，不是 D1 的問題。

## 2. 匯入期間網站的寫入會不會插進來

- D1 每個資料庫是單一執行緒（Durable Object），匯入期間「無法回應其他查詢」（同上 wrangler 訊息）。網站的寫入只會等或失敗，不會夾在同步 SQL 中間執行。
- 網站自己的寫入路徑：今天溜狗（`v3_today_walks`，觸發器是 `version_*`，不在提議範圍，[db/compact-schema.sql:247-249](../../db/compact-schema.sql#L247)）、志工身分／常溜／開卡（`v3_volunteers`、`v3_volunteer_*`、`v3_identity_*`，[worker/src/identity.js:40-44](../../worker/src/identity.js#L40)、[worker/src/compact.js:147](../../worker/src/compact.js#L147)）。網站**不寫** `v3_walks`（worker/src 搜不到 INSERT/UPDATE/DELETE v3_walks）。
- 所以只要旗標不會留在匯入之外，網站寫入就不會漏加版本號。

## 3. 只加一次是否等價（網站怎麼用這些版本號）

| 計數器 | 網站怎麼用 | 只加一次等價？ |
|---|---|---|
| `v3_pack_versions.small` | 跟存著的資料包 `ver` 比，不同就重做（[worker/src/packs.js:67-70](../../worker/src/packs.js#L67)、[273](../../worker/src/packs.js#L273)） | **是**。只看有沒有變 |
| `v3_identity_revision.revision` | 改名／合併時的樂觀鎖：先讀 revision，寫入時 `CASE WHEN revision=?` 檢查沒被別人改（[identity.js:56](../../worker/src/identity.js#L56)、[69](../../worker/src/identity.js#L69)、[112](../../worker/src/identity.js#L112)、[129](../../worker/src/identity.js#L129)） | **是**。只看相等與否 |
| `v3_walk_versions`（total／live／cutoff／months） | `months` 每月版本號跟資料包的 `vers` 比，決定哪個月重算；`total`、`live` 也拿來做跨日搬移的條件更新 `WHERE cutoff=? AND total=? AND live=?`（[packs.js:193-231](../../worker/src/packs.js#L193)、[274](../../worker/src/packs.js#L274)、[333-334](../../worker/src/packs.js#L333)） | **有條件**。補加時要：今天以前有任何變動 → `total+1`；今天的有變 → `live+1`；**每個動到的月份**各 +1。觸發器現在照 `OLD`／`NEW` 的 `walk_date` 跟當下 `cutoff` 比（[compact-schema.sql:287-289](../../db/compact-schema.sql#L287)）。補加的 SQL 必須在正式 D1 執行時才讀 `cutoff`（同步算 SQL 到執行之間，網站可能已經跨日把 cutoff 往前移），也要記得刪掉的列的舊日期（diff 有 before，可以拿到）。做得到，但寫錯就是「某個月永遠不更新」，而且測試不容易抓到 |
| `v3_departure_versions.years` | 每年版本號跟資料包比（[packs.js:102-107](../../worker/src/packs.js#L102)） | **難**。觸發器要查這隻狗在 `v3_departures` 的出所年份（[compact-schema.sql:343-352](../../db/compact-schema.sql#L343)），補加要重做同樣的查詢。不建議納入（量也少，平常一次同步幾句） |

## 4. WHEN 子查詢會不會多算讀取、D1 計不計觸發器

- SQLite：`WHEN` 條件每一列觸發時都會算一次（[sqlite.org/lang_createtrigger.html](https://www.sqlite.org/lang_createtrigger.html)）。`NOT EXISTS(SELECT 1 FROM v3_sync_state WHERE key='bulk')` 走主鍵，每次約讀 1 列。
- D1 計費：讀取以「查詢掃過幾列」算、寫入以「寫了幾列」算，索引另加寫入（[pricing](https://developers.cloudflare.com/d1/platform/pricing/)）。文件沒寫觸發器怎麼算，但實測 231 句記 654 列（[上一份研究第 4 節](2026-10-18-sync-231-rows.md)），觸發器裡的寫入確實計入，讀取應同理。
- 影響：一次同步多讀約 300 列，對照每天免費讀 500 萬列可忽略；網站平常每筆寫入（例如開卡）也多讀 1 列，同樣可忽略。

## 5. 其他弊端與替代方案

- **測試**：`worker/test/packs.test.mjs:347-364` 檢查每張表都有 `packs_*` 觸發器、拔掉任一個就要失敗；加 `WHEN` 不影響這個檢查，但要新增測試：旗標在時不加、同步最後補加的值正確、跑完沒有旗標。
- **ADR 0009／0014**：約定「改了資料網站就會更新」靠觸發器（[0009](../adr/0009-d1-read-versioned-packs.md)、[0014](../adr/0014-small-pack-split-and-settled-departures.md)）。加旗標等於多一條例外「同步時改由同步自己加」，要補進 ADR。
- **改觸發器要先 DROP**：同步只跑 `CREATE TRIGGER IF NOT EXISTS`，同名舊觸發器不會被換（[compact-schema.sql](../../db/compact-schema.sql) 第 278 行起的註解）。所以要改名或加 DROP，一次性多寫 sqlite_master。
- **同步預演計列**：預演數的是 SQL 句數（[scripts/sync-compact-d1.mjs:109-116](../../scripts/sync-compact-d1.mjs#L109)），不含觸發器，加旗標後數字只多 2～5 句（插旗標、補加、刪旗標），本來就看不出放大量。
- **替代 A：同步開頭 DROP 觸發器、結尾重建**：同樣靠原子匯入，但每次要 DROP＋CREATE 幾十個觸發器，寫 sqlite_master 的量可能抵掉省下的，而且重建漏一個就永久失效。比旗標差。
- **替代 B：在記憶體 D1 算好最後版本號直接寫**：記憶體 D1 的版本號是讀進來時的值，執行前網站可能已經跨日改了 `cutoff`／`total`，直接覆蓋會蓋掉網站的變更。比旗標差。
- **替代 C（最小版）**：只對 `packs_v3_sheet_main_walkers_*`、`packs_v3_sheet_*` 的 `small` 和 `identity_v3_walks_*` 加旗標，結尾 `small+1`、`revision+1` 各一句。兩者只看有沒有變，不會算錯；可省約 230 列（150＋84），`walk_versions` 的 84 列維持原樣。

## 6. 值不值得

- 一次大同步少寫約 300 列（654 → 約 350）；一天通常 1～2 次大同步，約 300～500 列。
- 一天全部寫入約 1,500 列（上一份研究第 5 節），免費額度每天 10 萬列，省下的是額度的 0.3～0.5%。
- 結論：**省得到但不急**。目前沒有額度壓力，不值得為它增加一條觸發器例外與一組補加邏輯；有壓力時先做替代 C。
