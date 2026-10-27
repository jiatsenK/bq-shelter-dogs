# 在所資料包（small）太常失效、同時進來的請求各自重算（2026-10-27）

- 對象：D1 讀寫效率稽核（`claude/d1-efficiency-audit` 分支，`docs/research/2026-10-27-d1-efficiency-audit.md`）第 1 項。
- 範圍：只做研究。沒有改程式、ADR 或資料庫，沒有部署，也沒有對正式 D1 下任何查詢。
- 數字都引用自稽核文件。10/24–10/26 是測試人員的流量，10/27 起才是真的使用；只有 10/27 的數字能當基準。

## 結論

1. small 失效最主要的原因：GAS 狗清單每送一次「溜過了」，`v3_sheet_main` 的 `walked_date`／`walker_codes` 就會改到，觸發器讓 `small` 加 1。而且每改一列就加 1，一批 12 隻就加 12。ADR 0018 之後，今天的溜狗正本是 `v3_walk_pack`，網站本來就會用它蓋過 `walkedDate`（`withTodayWalks`），所以這兩欄其實不用讓整包失效。
2. 建議第一步：把 `walkedDate`、`walkers` 從 small 拆成另一個「溜狗日期包」，給它自己的版本號；觸發器拿掉這兩欄，改成讓新版本號加 1。效益最大，改動也集中在一個地方。
3. 同一台機器上的請求合併（記住「正在重算」的 Promise）可以做，但只在同一個 isolate 裡有效，官方也沒保證兩個請求會進同一個 isolate。只能當作順手加的小改善。要跨機器真正合併得用 Durable Object，以目前的流量來說不划算。
4. 「落後 22 版」最可能的原因是無害的：最後一次存檔後又有 22 次觸發（例如一批改 22 列），之後還沒有人讀狗清單。另外還有兩種可能：存檔失敗，或兩台機器存檔的先後順序讓舊版本蓋掉新版本。下面列出確認方法，請 K 決定要不要跑。

## 現況機制

### 版本號怎麼加

- `db/compact-schema.sql:400` `packs_v3_sheet_main_UPDATE`：`AFTER UPDATE OF row_index,dog_id,number,name,cage,note,walked_date,walker_codes ON v3_sheet_main`，內容是 `UPDATE v3_pack_versions SET small=small+1`。
  - 這是 SQLite 的 row-level trigger（一列觸發一次），一句 UPDATE 改 N 列，或一個 batch 裡有 N 句 UPDATE，就會加 N。
  - `walker`（「誰遛的」原文）不在監看清單裡，不會讓 small 失效。
- 其他會讓 small 加 1 的：`v3_sheet_main` 刪除（:401）、`v3_intros`（:402–404）、`v3_dog_numbers`（:405–407）、`v3_rest`（:411–413）、`v3_intake_events`（:414–415）。這些都是「主清單上的狗」才加。
- 寫入來源：`worker/src/dog-list.js:89-92`。GAS 狗清單送來的每一列，`next` 裡有 `walked_date`、`walker_codes`，跟舊值不一樣就 `UPDATE v3_sheet_main SET …`（一隻狗一句）。

### 讀取與重算

- `worker/src/packs.js:278` `versions()` 每次讀 1 列 `v3_pack_versions.small`。
- `worker/src/packs.js:299-310` `readSmall` → `:88-106` `smallPack(db, ver)`：
  1. 記憶體 `mem.small.ver === ver` 就直接用（`:89`）。
  2. 不然讀 `v3_packs` part=`main`（`:90`、`loadPack` `:66-72`）；各段的 `ver` 都要相符才用。
  3. 還是沒有就呼叫 `readDogsPayload`（`worker/src/compact.js:19-63`，主清單 JOIN＋舊編號＋狗群＋註記，再加入所紀錄、住宿紀錄）和 `readRest`，然後 `savePack`（`packs.js:75-85`，DELETE＋INSERT 同一個 batch，失敗只 `console.error('pack', …)`）。
  4. 最後才 `mem.small = { ver, body }`（`:104`）。重算的整段過程沒有記錄「正在算」，所以同一台機器同時進來的 `/api/dogs`、`/api/rest` 都會各自走完第 2、3 步。
- 呼叫路徑：`GET /api/dogs`（`readDogsPacked` `packs.js:373-378`）、`GET /api/rest`（`index.js:752`）、狀態頁（`packStatus` `packs.js:381-387`）。
- 今天的溜狗日期：`worker/src/walk-accept.js:28-48`，`readAcceptedWalks` 讀 `v3_walk_pack` 1 列，`withTodayWalks` 用它蓋過 small 裡的 `walkedDate`。蓋的只有 `walkedDate`，`walkers`（代號）還是用 small 的；今天以前的日期也是。

### 相關 ADR

- ADR 0009：版本號加資料包，讀不到版本號就報錯，不退回整表讀取。
- ADR 0014：small 只放在所，離所依年份拆開；同步時間另外存，不讓 small 失效。這次的提案是同一套做法再拆一次。
- ADR 0018：今天的溜狗以 D1（`v3_walk_pack`）為準，試算表的遛狗日期只是複本。

## 建議做法（依優先順序）

### 1. 把溜狗日期和代號拆成另一包（建議先做）

做法：

- 新增版本號（例如 `v3_pack_versions.walked`，或另一張一列的表），新增 part `walked`。內容是 `{ 編號或名:狗名 → [walkedDate, walkers] }`，116 隻大約 3–5 KB。
- 觸發器 `packs_v3_sheet_main_UPDATE` 的監看欄位拿掉 `walked_date,walker_codes`，另外加一個 `AFTER UPDATE OF walked_date,walker_codes` 的觸發器，讓 `walked` 加 1。改觸發器要用新 migration：先 DROP 再 CREATE，因為原本寫的是 `IF NOT EXISTS`。
- `readSmall('dogs')` 組回去的時候，把 `walked` 包合進 dogs，複製一份，不改到快取（照 `withTodayWalks` 的寫法）。輸出要跟直接讀表逐字元相同，`packs.test.mjs` 的對照測試才會繼續通過。
- 重算 `walked` 包只需要 `SELECT row_index,number,name,walked_date,walker_codes FROM v3_sheet_main` 一句，約 116 列〔推估〕。現在每次失效約 900–1,600 列（稽核文件，10/27 實測加推估）。

取捨：

- 好處：GAS 送「溜過了」只會讓一個小包失效，small 只在狗名、籠位、介紹、休養這類不常變的資料改動時才失效。
- 壞處：多一個版本號，冷讀多 1 列。狗清單要合兩包，順序和欄位要跟現在一模一樣。ADR 0009／0014 要補一段，`worker/test/packs.test.mjs` 要加測試。
- 另一種做法：small 不放 `walkedDate`／`walkers`，網站另外打 API 拿。這樣前端也要改，範圍比較大，不建議。
- 再另一種做法：只送差量（記錄哪幾隻狗改了）。要多存變更紀錄、處理漏掉的情況，在這個資料量下不值得。

### 2. 同一個 isolate 裡共用正在重算的結果（小改，順手做）

- 做法：`smallPack` 把「正在算的 Promise」放進 `mem`（例如 `mem.smallPending = { ver, promise }`），同一版本號的請求 await 同一個 Promise；失敗時清掉，讓下次重算。
- 依據與限制（官方文件）：
  - Isolate 不一定活很久，官方也沒保證兩個請求會進同一個實例，並建議不要依賴可變的全域狀態。所以這只能減少同一台機器上的重複重算，不能保證只算一次。現在的 `mem` 快取本來就是這樣在用，只是多記一個 Promise。
  - 跨請求不能共用 I/O 物件（串流、Request、Response），會出現 “Cannot perform I/O on behalf of a different request”。文件沒有明講 Promise 算不算 I/O 物件。D1 的查詢在第一個請求的情境裡發出，如果第一個請求先結束，被取消或出錯的風險要用測試確認。比較保守的寫法：只共用已經解析完的純資料；或第二個請求 await 失敗時，自己再算一次。
- 預期效益：只對同一台機器上同時進來的請求有用。10/27 每小時才幾十次〔實測：11 時主清單 JOIN 36 次〕，效益不大，但風險也低。

### 3. 降低一批觸發的次數（看第 1 項做完後的情況再決定）

- 第 1 項做完後，`walked` 一批還是會加 N。版本號加多少不影響正確性，讀的人只比對相等，所以不用處理。
- 如果其他欄位（籠位、名字）也常整批改，可以考慮改成 statement-level：在 `dog-list.js` 的 batch 最後才手動加 1 次。缺點是失去「任何寫入都看得到」的保證（ADR 0009 的前提），不建議。

### 4. 跨機器的單點合併（目前不建議）

- Durable Object 有全球唯一的名字，同一時間只跑一件工作，可以當作「重算只做一次」的單點。代價：多一層呼叫、多一種計費與部署設定。D1 的資料包本身已經是跨機器共用的快取，第 1 項做完後失效次數少很多，不划算。
- Cache API 只存在發出請求的那個資料中心，不會複製到別的資料中心，也不能取代 D1 的資料包。
- D1 read replication／Sessions API：只是把讀取分散到副本，寫入還是到主庫。讀取列數照算，不會減少重算次數。如果要用，副本可能落後，讀版本號和讀資料包要放在同一個 session，才不會讀到舊包。和這一項沒有直接關係。

## 「落後 22 版」的可能原因與確認方式

可能原因：

1. **最後一次存檔後沒人讀（無害）**：一批 GAS 寫入改了 22 列（或幾批合計 22 列），觸發器加了 22；之後還沒有 `/api/dogs`、`/api/rest` 請求，就不會重算。如果 SELECT 的時間點剛好在中午高峰過後的空檔，這個可能性最大。
2. **存檔失敗**：`savePack` 失敗只寫 log（`packs.js:82-84`）。稽核記到 10/27 Query Insights 裡 `INSERT INTO v3_packs` 是 0 次、08 時有 16 次 DELETE；但稽核也提到 Query Insights 對 batch 裡的語句只記一部分，不能單靠它判斷。
3. **競態，舊版本蓋掉新版本**：機器 A 用 ver=1417 開始重算，機器 B 之後用 ver=1439 重算並先存；A 比較晚完成，DELETE＋INSERT 把 1439 換回 1417。程式碼沒有防這種情況（`savePack` 沒有比對版本大小）。結果不會錯（版本號不對就重算），只是多算一次。
4. 「批次寫入每列觸發一次」本身不會造成落後，只是讓數字跳得比較快。

確認方式（只列出，沒有執行；正式環境要不要跑由 K 決定）：

- 唯讀 SQL（`npx.cmd wrangler d1 execute <DB 名稱> --remote --command "<SQL>"`；資料庫名稱看 `wrangler.toml`）：
  - `SELECT small FROM v3_pack_versions WHERE id=1;`
  - `SELECT part, seq, ver, length(body) FROM v3_packs WHERE part='main' ORDER BY seq;`
  - 隔幾分鐘、中間打一次 `/api/dogs` 再跑一次：如果 `ver` 追上 `small`，就是原因 1。
  - `SELECT walked_date, COUNT(*) FROM v3_sheet_main GROUP BY walked_date ORDER BY walked_date DESC LIMIT 5;`：看今天被改的列數和 22 對不對得上。
- Log：`npx.cmd wrangler tail <worker 名稱> --format pretty`，或在 Workers Logs 搜 `pack` 開頭的 `console.error`。有就是原因 2。
- 如果要量化原因 3：在 `smallPack` 存檔前後加 log（ver、isolate 啟動時間），這需要改程式，另開票。

## 風險

- 拆包之後輸出要跟現在逐字元相同（欄位順序、`walkers` 是陣列）。不一樣的話，前端比對和 `packs.test.mjs` 會抓到，但要先寫好測試。
- 換觸發器的 migration 和部署之間，舊程式還在跑：舊程式只看 `small`，新觸發器不再讓 `small` 因溜狗加 1，舊程式就會給出舊的溜狗日期。今天的日期有 `withTodayWalks` 蓋過，影響主要是「今天以前的日期」和 `walkers`。要排順序：先部署會讀 `walked` 包的程式，再套 migration；或同一次一起做。
- 共用 Promise 的取消／錯誤行為官方沒有寫清楚，要測試。

## 未定問題（需要 K 決定）

1. 拆包要不要在同一票順便處理 `withTodayWalks` 只蓋 `walkedDate`、不蓋 `walkers` 的不一致？
2. 「落後 22 版」要不要現在用上面的唯讀查詢確認，還是等第 1 項做完再看？
3. 共用 Promise 要不要跟第 1 項一起做，還是只做第 1 項？

## 來源

- 稽核文件：`claude/d1-efficiency-audit:docs/research/2026-10-27-d1-efficiency-audit.md` 第 1 項
- 程式碼：`db/compact-schema.sql:400-415`、`worker/src/packs.js:66-106,278,299-310,373-387`、`worker/src/compact.js:19-63`、`worker/src/dog-list.js:89-97`、`worker/src/walk-accept.js:28-48`
- ADR：`docs/adr/0009-d1-read-versioned-packs.md`、`docs/adr/0014-small-pack-split-and-settled-departures.md`、`docs/adr/0018-today-walks-d1-event-sync.md`
- Cloudflare 官方文件（2026-10-27 讀取）：
  - How Workers works（isolate、全域狀態）：https://developers.cloudflare.com/workers/reference/how-workers-works/
  - Errors（跨請求 I/O 物件）：https://developers.cloudflare.com/workers/observability/errors/
  - Request（請求情境）：https://developers.cloudflare.com/workers/runtime-apis/request/
  - Cache API（不會複製到其他資料中心）：https://developers.cloudflare.com/workers/runtime-apis/cache/
  - Durable Objects：https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/
  - D1 read replication／Sessions API：https://developers.cloudflare.com/d1/best-practices/read-replication/
