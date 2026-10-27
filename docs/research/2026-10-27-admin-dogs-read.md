# 管理網站狗表 `readManageDogs` 的讀取量研究

日期：2026-10-27。來源是 D1 讀寫效率稽核（`docs/research/2026-10-27-d1-efficiency-audit.md`，分支 `claude/d1-efficiency-audit`）第 5 項。唯讀研究，沒有改程式。

- 標記：〔實測〕取自稽核文件裡的 Cloudflare 數字；〔程式碼〕看程式確認；〔本機〕用 `db/compact-schema.sql` 建空庫跑 `EXPLAIN QUERY PLAN`；〔推估〕照程式碼推。

## 結論

- **先不做快取，排在 1–4 項之後。** 10/27（第一天真的使用）只跑 3 次、共 3,090 列〔實測〕，約占當天讀取 9%。10/26 的 61 次是測試期間的人在反覆開頁面，不代表平常用量。
- **查詢本身已經都走索引**〔本機〕，改寫 SQL 省不了多少。讀的列數大致等於「全部狗 ＋ 主清單 ＋ 每隻狗各查一次附表」，會隨總狗數慢慢長，不會爆。
- **「跟著 small 版本號快取」不夠正確**〔程式碼〕：small 只在「主清單上的狗」變動時加 1，管理網站狗表還包含已出所和待核對的狗。真的要做，要用另一組版本號（見下面「做法比較」）。
- 前端共用狗表的效果有限：三頁是各自整頁載入，沒辦法在記憶體裡共用（見做法 D）。

## 現況

### 誰在呼叫〔程式碼〕

- `GET /api/manage/dogs`（`worker/src/admin/index.js:108-111`）→ `readManageDogs(env.DB, photos)`。
- 前端三處各自抓一次：
  - 狗表頁 `admin/public/js/main.js:174`：開頁面、按「重新讀取」（`:197`）、合併狗之後（`:31`）。
  - 活動頁 `admin/public/js/activities.js:88`。
  - 資料檢查頁 `admin/public/js/checks.js:126`。
- 一般編輯（介紹、休養、性別等）存完不會重抓整份狗表。

### 查詢在做什麼〔程式碼〕

`worker/src/admin/dogs.js:6-18` 一句 SELECT，以 `v3_dogs` 為主，每隻永久身分一列：

- `current_rows`：`v3_sheet_main` 依 `dog_id` 分組取最小 `row_index`。
- LEFT JOIN `v3_sheet_main`、`v3_intros`、`v3_rest`、`v3_photos`（主照片）。
- 兩個相關子查詢：`v3_dog_numbers` 取最大舊編號、`v3_dog_departures` 取最新一筆離所。
- 照片網址在 Worker 裡用 R2 清單 `photoVersions` 補，不在 SQL 裡。

### 查詢計畫〔本機〕

| 步驟 | 計畫 |
|---|---|
| `current_rows` | `SCAN v3_sheet_main USING COVERING INDEX v3_sheet_main_dog` |
| 主表 | `SCAN d USING INDEX sqlite_autoindex_v3_dogs_1` |
| 主清單、介紹、休養、照片 | 都是 `SEARCH … (dog_id=?)` 或主鍵 |
| 舊編號 | `SEARCH v3_dog_numbers USING INDEX v3_numbers_dog` |
| 離所 | `SEARCH v3_dog_departures USING INDEX sqlite_autoindex_v3_dog_departures_1`（主鍵 `dog_id,number`） |

- 只有兩個 SCAN，而且是必要的：要列出全部狗，就得掃 `v3_dogs`；`current_rows` 掃主清單的覆蓋索引。
- 其他都是每隻狗一次索引查找。D1 依「掃過的列」計費（ADR 0009 背景），所以約 890 列 ≈ 全部狗數 ＋ 主清單列數 ＋ 各附表命中的列〔推估〕。

### 改寫 SQL 的空間〔推估〕

- `current_rows` 先整張分組，再 JOIN 回 `v3_sheet_main`，主清單等於讀兩次。可改成相關子查詢或直接用 `v3_sheet_main_dog` 索引查，約省主清單一份（百來列）。
- 兩個相關子查詢對沒有舊編號、沒有離所紀錄的狗也會查一次索引，只是命中 0 列，計費影響小。
- 合計最多省 1–2 成，換來的是要重新驗證「同一隻狗在主清單出現多列時取最小 `row_index`」這條規則（#621 的重複狗情境）。不划算。

## 管理網站要多即時

- ADR 0020：管理網站只有單一管理者角色，用 Cloudflare Access 保護；第一版試算表送入的欄位只讀。
- 〔程式碼〕現在的行為是「開頁面或按重新讀取就是最新」。管理者自己剛改的資料要馬上看到；GAS 同步進來的主清單變動、志工網站改的介紹／休養，也在下一次讀取時出現。
- 沒有看到任何「可以慢幾分鐘」的決策。ADR 0009 的「其他手機最慢 1 分鐘」只針對志工網站。所以快取如果做，**必須是版本號失效，不能用固定秒數**，否則會跟管理者「剛改完按重新讀取」的預期衝突。這點要 K 確認。

## 做法比較

### A. 直接用 small 版本號（稽核原本的建議）——不正確

〔程式碼，`db/compact-schema.sql:399-513`〕small 的觸發器大多帶 `AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=…)`，只有主清單上的狗變動才加 1。管理網站狗表會漏掉：

- 已出所的狗：介紹、休養、照片、編號變動只動 `v3_departure_versions.years`，small 不變。
- 待核對的狗（兩邊都沒有，#621）：改介紹、休養、照片等，**哪個版本號都不動**。
- `v3_dogs.name` 改名：`packs_v3_dogs_UPDATE` 只看 `fixed_care`、`sex`；不在主清單的狗名字就從 `d.name` 來。

另外，稽核第 1 項建議把 `walked_date`、`walker_codes` 從 small 拆出去；管理網站狗表有顯示 `walkedDate`，兩件事會互相牽動。

### B. small ＋ 離所年份版本號一起當快取鍵

- 補上已出所的狗，但待核對的狗和 `v3_dogs.name` 還是漏。
- 待核對的狗正是管理網站要處理的對象，漏掉的代價高。不建議。

### C. 新增一個 `manage` 版本號

- 在 `v3_pack_versions` 加一欄，上面那些表的觸發器不帶 `EXISTS` 條件、一律加 1，再加 `v3_dogs` 改名。
- 正確，但要改十幾個觸發器、加 migration，每次寫入多寫 1 列。以現在一天 3 次、約 3,000 列的量，省下的讀取抵不過改動風險與維護成本。
- 快取放 Worker 記憶體即可；管理 Worker 是獨立部署（ADR 0020），請求少，記憶體快取命中率本來就低，效益更小〔推估〕。

### D. 前端在同一次開頁面內共用狗表（建議，若要做）

- 狗表、活動、資料檢查三頁各抓一次；如果是同一個頁面切換，可以共用第一次的結果，按「重新讀取」或合併後才重抓。
- 不動 D1、不動觸發器，即時性不變（使用者主動重新讀取就是最新）。
- 〔程式碼，2026-10-27 補查〕三頁是各自獨立的 HTML（`admin/public/index.html`、`activities.html`、`checks.html`），切頁就是整頁重新載入，記憶體裡的狗表會跟著消失，所以現在沒辦法共用。三頁是不同階段各自做的（#564、#567），各自抓狗表是當時最簡單的寫法，不是刻意的決定。
- 要跨頁共用，只能存進瀏覽器的 `sessionStorage`。但這樣切頁時看到的可能是舊資料，又回到「多即時」的問題；換來的只是每次切頁省約 890 列。效益小，不建議。

## 建議

1. 現在不開票，等 1–4 項做完、再看幾天真的使用量。
2. 若管理網站狗表讀取占比持續超過 2 成，直接談 C；D 因為三頁各自整頁載入，幫助不大。
3. 不要用 A。稽核文件第 5 項的「跟著 small 的版本號做快取」建議改寫成本文的結論。

## 還不知道

- 正式庫現在有幾隻 `v3_dogs`、幾列 `v3_dog_departures`：要 K 跑 `SELECT COUNT(*)` 才能把 890 列拆成各表各多少。
- 管理網站實際一天開幾次：10/27 只有半天資料。

## 定案（K，2026-10-27）

- 先不做，也不開票。
