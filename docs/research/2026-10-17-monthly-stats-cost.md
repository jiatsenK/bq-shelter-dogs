# 每月統計、累計次數：哪種做法最省 D1 額度（20 年規模）

2026-10-17。問題：溜狗紀錄（`v3_walks`，約 55 列／天，20 年約 40 萬列）要提供
(a) 某月每天次數＋跟上月比、(b) 每位志工／每隻狗累計次數（卡牌 `cards.js` 的 `bqPlayers`）、(c) 一隻狗的完整紀錄。
在免費方案下，用哪種做法讀寫列數和 CPU 最少。

## 限制（官方）

- D1 免費：每天讀 500 萬列、寫 10 萬列，UTC 00:00（台灣 08:00）歸零。https://developers.cloudflare.com/d1/platform/pricing/
- 「rows read」是查詢**掃過**的列數，跟每列大小無關，不是回傳列數。同上頁。
- 索引可以減少讀取列數；但寫入有索引的欄位時，每個索引**多算 1 列寫入**。同上頁。
- Worker 免費：每個請求 CPU 10 ms、一天 10 萬次請求、每次最多 50 個子請求（D1 也算）。https://developers.cloudflare.com/workers/platform/limits/

## repo 裡已經量到的數字

`bq-proto-d1/docs/research/2026-10-16-d1-read-prototype.md`（原型 D1 實測 `meta.rows_read`）：

- `COUNT(*)` 照掃過的列計費，整張 2,442 列就算 2,442；`LIMIT n` 只有在不用排序或排序走索引時才只算 n。
- SQL 裡 `ORDER BY` 沒走索引時，讀取量變 2 倍（正式環境也證實）。
- 讀 1 列資料包（187 KB JSON）只算 1 列。

這和官方「掃幾列算幾列」一致：GROUP BY／COUNT 不會因為回傳少就便宜，要看掃了多少列。

## 四種做法比較

### (1) 寫入時維護彙總表（SQLite 觸發器或程式寫）

SQLite 的 `CREATE TRIGGER ... AFTER INSERT/UPDATE/DELETE` 可以在每次改 `v3_walks` 時同步更新彙總表（例如 `walk_counts_dog(dog_id, n)`、`walk_counts_day(walk_date, n)`）。https://www.sqlite.org/lang_createtrigger.html

- 寫入：每筆溜狗多寫 2～3 列（每張彙總表 1 列，加上彙總表自己的索引）。55 筆／天 → 約 +165 列／天，佔寫入額度 0.2%。
- 讀取：「本月每天」讀 ~31 列；「所有在所狗的累計」讀狗數（約 100～數百列）。
- 缺點：差異同步會大量覆寫／刪除再寫回溜狗紀錄時，觸發器也跟著跑，容易算錯（刪除、改日期、改狗編號都要寫對應的減法）；而且觸發器的寫入算進 rows written。repo 原型已經用觸發器做版本號（同一份研究第二輪），技術上可行。

### (2) 直接用 D1 GROUP BY／COUNT＋索引

- 「某月每天次數」：`WHERE walk_date BETWEEN ... GROUP BY walk_date`，有 `walk_date` 索引時只掃那個月，約 1,700 列（兩個月約 3,400）。若索引同時包含查詢用到的所有欄位（覆蓋索引），SQLite 只讀索引、不回原表，但掃描列數仍是那一個月的列數。https://www.sqlite.org/queryplanner.html（"Covering Indexes" 一節）；可用 `EXPLAIN QUERY PLAN` 確認是否 `USING COVERING INDEX`。https://www.sqlite.org/eqp.html
- 「每隻狗／每位志工累計」：必須掃全表，20 年時**每次約 40 萬列**。一天 12 次就 480 萬，接近 500 萬上限。**不能放在一般請求上。**
- 「一隻狗的完整紀錄」：加 `(dog_id, walk_date)` 索引後只掃那隻狗的列，資深狗約 1,000～2,000 列，可以接受；沒有索引就是整表 40 萬。新增這個索引每筆寫入 +1 列。

### (3) 把彙總放進現有的每年資料包（ADR 0009、`worker/src/packs.js`）

現在的資料包是每年一份（`v3_walk_packs`，按 `seq` 切段），每個月有自己的版本號，只在那個月變了才重算（`advance`／`buildMonth`）。重算一個月本來就要讀那個月的列（約 1,700 列），順手算出 `{每天次數, 每隻狗次數, 每位志工次數}` 放進同一份資料包，**不需要多讀任何列**。

- 讀取：資料包每段算 1 列；20 年 = 20 份，每份幾段，總共約數十列。而且 Worker 記憶體已有快取（`mem`），同一台機器只在版本號變了才重讀。
- CPU：風險在這裡。一年完整明細約 2 萬列 JSON（估 1～2 MB），一次解析 20 年可能超過 10 ms。所以**彙總要另外存一份小的**（例如每年一列「年度摘要」：每月每天次數＋每狗／每志工年度次數，估幾十 KB），累計 = 20 列摘要加總，CPU 很少；明細只有要看某個月或某隻狗時才解析。
- 卡牌的 `monthOut` 只看本月（`bqMonthOut`），本月資料＝資料包當月＋今日 live 紀錄，已經有了。

### (4) HTTP 快取已經過去的月份

- Cache API（`caches.default`）只存在**當地資料中心**，不會複製到其他地方，也不支援 Tiered Cache。https://developers.cloudflare.com/workers/runtime-apis/cache/、https://developers.cloudflare.com/workers/reference/how-the-cache-works/
- 官方寫的是「部署在**自訂網域**的 Worker 可以使用有作用的 `cache` 操作」（同上第一頁），沒有保證 `*.workers.dev` 可用；本站目前在 workers.dev，**不要依賴 Cache API**。（未實測；實測要看 `cache.match` 是否永遠回空。）
- 瀏覽器快取一定有用：過去月份的網址帶月份版本號（例如 `/api/month/2026-09?v=3`），回 `Cache-Control: public, max-age=31536000, immutable`，同一支手機就不會再要。https://developer.mozilla.org/docs/Web/HTTP/Reference/Headers/Cache-Control（MDN，非 Cloudflare，但是標準說明）。補登舊紀錄時版本號會變，網址跟著變，不會讀到舊的。

## 建議

1. **以 (3) 為主**：重算月份時一起產生彙總，另外每年存一列小摘要。不多讀列、不加觸發器、不改寫入流程，符合 ADR 0009 的版本號做法。
2. **一隻狗完整紀錄**：加 `(dog_id, walk_date)` 索引直接查 D1（或從資料包取）；前者每次 1～2 千列，後者 0 列但 CPU 較多，量小時用 D1 即可。
3. **(4) 只做瀏覽器快取**（版本號網址＋`immutable`），不用 Cache API。
4. **不要** 在請求裡對全表做 GROUP BY（20 年時每次 40 萬列）。
5. (1) 觸發器彙總只在以後需要「即時、跨年」的排行榜時再考慮；要處理同步刪改的減法。

## 20 年時每天粗估（假設統計頁＋卡牌一天各 200 次請求，機器常換、快取命中率低）

| 項目 | 讀取列／天 | 寫入列／天 |
| --- | --- | --- |
| 跨日重算當月（1,700）＋存資料包 | ~2,000 | ~10 |
| 統計／卡牌讀摘要（20 列 × 400 次，最壞沒記憶體快取） | ~8,000 | 0 |
| 版本號檢查（1 列 × 400） | ~400 | 0 |
| 一隻狗完整紀錄（1,500 × 50 次） | ~75,000 | 0 |
| `(dog_id, walk_date)` 索引的額外寫入 | 0 | ~55 |
| **合計** | **約 8.5 萬（額度 1.7%）** | **約 70（0.07%）** |

對照：用做法 (2) 直接 GROUP BY 累計，同樣 400 次就是 1.6 億列，是額度的 32 倍。
