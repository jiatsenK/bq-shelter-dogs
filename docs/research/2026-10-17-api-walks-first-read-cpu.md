# 新機器第一次讀 /api/walks，CPU 花在哪、怎麼壓低

日期：2026-10-17（研究筆記，未改程式）
相關：#356、ADR 0009、ADR 0010、ADR 0013、`worker/src/packs.js`（以 main `e06c468` 為準；本機工作分支 `chore/cleanup` 比 main 舊，行號照 main）

## 結論先講

1. **CPU 大部分花在「解析整年資料包」，不是合併月份。** 新機器第一次讀 `/api/walks` 只要上個月和這個月，但程式讀的是整年一份的 `v3_walk_packs`，整份 `JSON.parse` 完才挑兩個月（`packs.js:147-151`、`packs.js:342-347`）。每天 55 筆的情境下，整年解析約 6～11 ms，合併只要約 0.1～0.3 ms。
2. **最貴的其實是「當天第一個請求要跨日」那一次**（`advance`，`packs.js:190`）：要解析整年、重算整年的「我溜過的狗」摘要（`summarize`，`packs.js:159`、`385`）、把整年再 `JSON.stringify` 兩次、再逐字元切段（`chunks`，`packs.js:49`）。每天 55 筆時本機約 52～60 ms，是一般新機器讀的 7 倍。正式環境量到的兩次 10 ms，很可能有一次是這個（推論，要用 `wrangler tail` 對時間點確認：跨日發生在台灣 00:00 後的第一個請求）。
3. **以正式環境現在的資料量（約 1,100 筆／年、年包 69 KB），本機 Node 量到的只有 0.6～3.4 ms**，比正式的 10 ms 低很多。差距要靠 Cloudflare 上的冷啟動（程式還沒被 JIT 最佳化）、機器較慢和量測方式解釋，不能只靠縮小資料（推論）。所以下面的改法要以「工作量跟一年資料多少無關」為目標，而不是只把 JSON 變小一點。
4. **最划算的兩個改法**：(a) 資料包從「一年一份」改成「一月一份」，新機器只解析兩個月；(b) 跨日時不重算整年摘要、不逐字元切段。兩者都不增加 D1 寫入，也不違反版本號資料包的做法（ADR 0009）。

## 1. /api/walks 實際走的路

`index.js:1210` → `readWalksPacked`（`packs.js:342`）：

| 步驟 | 新機器（記憶體 `mem` 是空的） | 同一台第二次 |
|---|---|---|
| 讀版本號 `v3_walk_versions` 1 列 | 有 | 有 |
| 切點比今天舊 → `advance` 跨日 | 當天全世界第一個請求才有 | 沒有 |
| 找出近期月份裡版本號對不上的（`stale`，`packs.js:346`） | 上個月、這個月都對不上 | 都對得上 |
| `freshYear` → `loadYear`：讀那年所有分段、接起來、**整份 `JSON.parse`** | 有（整年） | 沒有 |
| 合併：`flatMap` 兩個月＋今天的 live、`filter` | 有 | 有 |
| `reply` 把整份回應 `JSON.stringify`（`index.js:107`） | 有 | 有 |

記憶體快取是模組層級的 `mem`（`packs.js:11`），只活在同一個 isolate。Cloudflare 說 isolate 不一定活很久、也不保證兩個請求會進同一個 isolate（<https://developers.cloudflare.com/workers/reference/how-workers-works/>），所以「新機器第一次」會常常發生。

## 2. 本機量測

程式在 scratchpad（不放 repo）：`bench.mjs` 跑 main 的 `readWalksPacked`／`readWalksYear`，用假 D1（`worker/test/fakes.mjs`，node:sqlite）；`micro.mjs` 單獨量各步驟。Node 24.16（V8）。
D1 查詢的時間另外扣掉：在 Cloudflare 上等資料庫回應不算 CPU（<https://developers.cloudflare.com/workers/platform/limits/>，「CPU time」一節）。資料：120 隻狗、一年 365 天，每天 3 筆（接近正式現在的 1,100 筆／年）或 55 筆（20 年原型的假設）。

### 整條路（ms，扣掉 D1；「第 1 次」是程式還沒暖的那次）

| 情境 | 每天 3 筆（年包 69 KB） | 每天 55 筆（年包 1.25 MB） |
|---|---|---|
| A 新機器 `/api/walks`，切點已是今天 | 第1次 1.1／中位數 0.6（解析佔 0.5） | 第1次 8.5／中位數 7.3（**解析 6.0**、回應 stringify 0.6、其他 0.7） |
| A2 同一台第二次 | 0.1 | 0.8（幾乎都是回應 stringify） |
| Y 新機器 `?year=2026` | 第1次 2.0／中位數 0.8 | 第1次 14.1／中位數 12.7（解析 6.4、回應 stringify 5.0） |
| B 當天第一次（跨日 `advance`） | 第1次 3.4／中位數 2.4 | 第1次 60.2／中位數 52.0（解析 8.8、stringify 12.9、其他 29.3） |

### 各步驟單獨量（每天 55 筆，中位數；機器忙時數字會跳）

| 步驟 | ms | 誰會做 |
|---|---:|---|
| `JSON.parse` 整年（1.26 MB） | 10.7 | 新機器 `/api/walks`、`?year=`、跨日 |
| `JSON.parse` 只有兩個月 | 1.5 | 改成按月存之後的新機器 |
| 合併兩個月（`flatMap`＋`filter`） | 0.08 | 每次 |
| 合併整年（`?year=`） | 0.3 | `?year=` |
| `JSON.stringify` 整年回應 | 8.6 | `?year=` |
| `summarize` 整年摘要 | 18.2 | 跨日（`saveYear`） |
| `JSON.stringify` 年包 | 5.4 | 跨日 |
| `chunks()` 逐字元算 UTF-8 長度 | 7.7 | 跨日（年包和摘要各一次） |
| 用 `TextEncoder` 算長度 | 3.1 | （替代 `chunks` 的參考） |
| 存好的回應文字直接接字串 | 0.00 | 預存回應的做法 |

**結論：懷疑的兩件事裡，解析是主因（佔新機器 CPU 的 80% 左右），合併幾乎可忽略。** 解析多的原因是「讀整年、只用兩個月」，以 9 月來說要多解析 7 倍的資料。

## 3. 平台事實（一手來源）

- 免費方案每次 HTTP 請求 CPU 10 ms；CPU 時間只算執行程式，等 fetch、KV、資料庫不算；全域程式另有 1 秒啟動上限。<https://developers.cloudflare.com/workers/platform/limits/>
- 同一個 isolate 可以處理多個請求，但不保證路由到同一個，isolate 也不一定長壽、可能被回收；官方不建議依賴全域可變狀態。<https://developers.cloudflare.com/workers/reference/how-workers-works/>
- Cache API 的內容只留在當地資料中心，不會複製出去；文件寫「自訂網域」的 Worker 才有可用的 `cache` 操作，網站現在在 `workers.dev`，能不能用文件沒寫清楚。<https://developers.cloudflare.com/workers/runtime-apis/cache/>
- V8：JSON 語法比 JS 簡單，`JSON.parse` 比物件字面量快，但仍和字串長度成正比；10 KB 以上才值得考慮這類技巧。<https://v8.dev/blog/cost-of-javascript-2019>。所以要省的是「少解析」，不是換解析方式。

## 4. 怎麼壓低（估計值以每天 55 筆的本機數字算）

| # | 做法 | 新機器 `/api/walks` | 跨日 | 代價／和 ADR 的關係 |
|---|---|---|---|---|
| 1 | **資料包改成一月一列**（`v3_walk_packs` 主鍵改 `(month, seq)`；新機器只 `SELECT … WHERE month IN (上月, 本月)`） | 解析 6～11 → 約 1～1.5 ms | 只讀、只寫動到的月份，`chunks` 和 stringify 也只做一個月 | 讀取列數：新機器 1 列 → 2 列，`?year=` 1 列 → 12 列，都很小（ADR 0009 只在乎不隨歷史長大）。寫入：跨日只寫 1～2 個月，比現在整年少。要改表結構和遷移，`db/compact-schema.sql` 和同步預演要跟著改（AGENTS.md）。 |
| 2 | **跨日不重算整年摘要**：摘要也按月存，或只把昨天的列加進去 | — | 省 `summarize` 約 18 ms＋摘要的 stringify／chunks | 摘要要能「加」，`multi` 規則（同一天多個代號只算一天）以日為單位，按月拆不影響正確性（推論，要寫測試對照 `bqMyDogs`）。 |
| 3 | **`chunks()` 先看總長度**：`text.length * 3 <= chunkBytes` 時直接整段，不逐字元算 | — | 每次省數 ms | 純程式改法，不動資料；1 MB 內的年包幾乎都走快速路徑。 |
| 4 | **預存回應文字**：資料包裡存的就是「已經是回應那一段的 JSON 文字」，Worker 只接字串、不 parse 也不 stringify | 解析＋stringify → 接近 0（只剩 live 那段） | 跨日要多存一份，或改成按月存的文字直接接 | 回應要和現在逐字元相同（測試 `assertSame` 會抓）；`filter(w => w.date >= from)` 要在存的時候處理好。`?year=` 收益最大（現在 12.7 ms，回應 stringify 佔 5 ms）。跟 #1 搭配最自然：每月存的就是那個月 `walks` 陣列的文字，回應用 `[` + 月文字.join(',') + `]` 拼。 |
| 5 | 延遲載入／只解析需要的月份（不改表，在一份年包裡用位移索引切出兩個月再 parse） | 約同 #1 | 無改善 | 不用改表，但年包仍要整份從 D1 傳過來（I/O，不算 CPU），程式較繞。#1 比較乾淨。 |
| 6 | Cache API 存整份回應 | 命中時 0 | — | 每個資料中心各自一份、`workers.dev` 能不能用不確定；版本號一變就要換鍵。現在不建議。 |

建議順序：**#3（最小、零風險）→ #1＋#4 一起做（新機器和 `?year=` 都降到 2 ms 內，且不隨每年筆數長大）→ #2**。#1、#2 要動資料寫入，開票時照 AGENTS.md 先讀 ADR 0008、0009，PR 附同步預演。

## 5. 還沒確認的

- 本機正式資料量只量到 0.6～3.4 ms，正式卻有 10 ms：要在 `wrangler tail` 把每次請求的 CPU 和時間點、是否剛跨日對起來，分出「跨日」和「純冷啟動」各是多少（#356 下一步）。
- 本機是 Node 的 V8，Cloudflare 是 workerd 的 V8，版本和機器不同，數字只看比例。
- 假 D1 回傳的是 JS 物件；真的 D1 回應要從網路資料轉成物件，這段算不算 CPU、多少，官方文件沒寫。
