# 資料包在資料一直累積時，D1 讀取量怎麼不跟著長大

日期：2026-10-16（研究筆記，未改程式）
相關：ADR 0009、`worker/src/packs.js`、`db/compact-schema.sql`（分支 `perf/315-d1-read-packs`）

## 結論先講

**推薦：walks 包改成「按月分桶、每桶自己的版本號」，由觸發器依 `walk_date` 的月份只動那一桶；small 包維持一包，但先把 `synced_at` 移出觸發範圍。** KV／R2／Durable Objects 目前不需要。

讀取量怎麼隨時間變化（假設：溜狗紀錄一年約 4 萬列 ≈ 每天 110 列、每月約 3,300 列；一年後歷史約 4 萬列、三年後約 12 萬列；資料包每段 1 列）：

| 事件 | 現況（walks 一整包） | 按月分桶 |
|---|---|---|
| 每天跨日重算 | 讀全部歷史：1 年後約 4 萬列、3 年後約 12 萬列／天 | 只重算「上個月＋這個月」最多 2 桶：約 3,300～6,600 列，**不隨年數長大** |
| 跨日改成「只把昨天附加到最後一桶」 | — | 約 110 列（昨天的列，走 `walk_date` 索引）＋讀最後一桶 1～2 列 |
| 改一筆舊紀錄 | 整包重算（全部歷史） | 只重算那個月：約 3,300 列 |
| Worker 冷啟動讀資料包 | 段數（1 MB 一段）列 | 桶數列：3 年約 36 列（D1 一列不論大小都算 1 列） |
| 每次請求檢查版本 | 1 列 | 1 列（把各桶版本號彙總成一個「總版本號」列，或讀版本表約 36 列，建議前者） |

在免費方案每天 500 萬列讀取的額度下，現況 3 年後光跨日就吃約 12 萬列／天（約 2.4%），還不致命，但會一直長；分桶後固定在數千列。真正會長大的只剩「桶數」，每桶 1 列，可忽略。

## 1. D1 rows_read 怎麼計（一手來源）

- 計的是「掃過的列數」，與列大小無關：「Rows read measure how many rows a query reads (scans), regardless of the size of each row」。100 KB 的一列也只算 1 列，所以**把資料包存成少數大列很划算**。來源：<https://developers.cloudflare.com/d1/platform/pricing/>
- 沒索引的篩選仍會整表掃；有索引就只算索引範圍內的列（同上頁）。
- 寫入含索引欄位時會多算寫入列（同上頁「Indexes will add an additional written row」）。
- batch／交易：官方只說會依內容計讀或寫，沒有細節；**觸發器內的 UPDATE 如何計讀，官方文件沒寫**。實際數字要看每個查詢回傳的 `meta.rows_read`／`meta.rows_written`（同上頁）。建議在原型裡對「插一筆溜狗紀錄觸發 upsert」量一次。
- ORDER BY：SQLite 若能用索引順序就不排序（<https://www.sqlite.org/queryplanner.html> 第 2 節）。ADR 0009 實測 SQL 排序讓讀取量加倍，這和「排序器的列也被計入」吻合（推論，官方沒寫明）。
- COUNT(*)：沒有特別優化說明，會掃表或掃最小的索引，以列數計；ADR 0009 已決定狀態頁不再整表 COUNT。
- 覆蓋索引（covering index）：SQLite 文件說它讓查詢不必回原表找列，省的是「二分搜尋次數」，是常數倍的改善（queryplanner 1.7 節）。**它不會讓「範圍內要經過的列數」變少**，所以就 D1 的 rows_read 而言，預期幫助不大（推論，需用 `meta.rows_read` 驗證）。真正讓列數變少的是「縮小範圍」（索引 + WHERE）和「不要排序」。
- 額度（2026-10-16 讀取）：免費每天讀 500 萬列、寫 10 萬列、儲存 5 GB，每天 00:00 UTC（台灣 08:00）重置；付費每月含讀 250 億列、寫 5,000 萬列，超過讀每百萬列 0.001 美元、寫每百萬列 1 美元。來源同上 pricing 頁。
- 讀取副本（read replication／Sessions API）**不會**減少計費列數：「You incur the exact same D1 usage billing with or without replicas」。它解決的是延遲，不是額度。來源：<https://developers.cloudflare.com/d1/best-practices/read-replication/>

## 2. 按月分桶的增量維護

SQLite 觸發器做得到：

- `WHEN` 子句與觸發內容可讀 `NEW.欄位`／`OLD.欄位`；INSERT 只有 NEW、DELETE 只有 OLD、UPDATE 兩者都有。
- 觸發內容可用 `INSERT … ON CONFLICT … DO UPDATE`（upsert）。
- 限制：不能直接寫 CTE（可放在子查詢裡）、UPDATE/DELETE 不能 ORDER BY/LIMIT、表名不能加資料庫前綴。
- 來源：<https://www.sqlite.org/lang_createtrigger.html>

示意（不是要直接貼的程式）：

```sql
CREATE TABLE v3_walk_buckets (month TEXT PRIMARY KEY, ver INTEGER NOT NULL DEFAULT 0);
CREATE TRIGGER bucket_v3_walks_INSERT AFTER INSERT ON v3_walks BEGIN
  INSERT INTO v3_walk_buckets(month, ver) VALUES (substr(NEW.walk_date,1,7), 1)
  ON CONFLICT(month) DO UPDATE SET ver = ver + 1;
  UPDATE v3_pack_versions SET walks = walks + 1 WHERE id = 1;  -- 總版本號，Worker 每次只讀這 1 列
END;
-- UPDATE 觸發器要同時動 OLD 與 NEW 的月份（改日期跨月時兩桶都失效）；DELETE 動 OLD 的月份。
```

要注意的地方：

- **今天的列**：現在已由觸發器依日期分成 walks／live；分桶後一樣，今天的列不進桶。觸發器裡的「今天」要用台灣時間（`date('now','+8 hours')`），和現行做法一致即可。
- **跨日**：昨天從 live 變歷史，只需「把昨天的列（走 `v3_walks_date` 索引，約 110 列）附加到當月桶」，或直接重算當月（≤ 3,300 列）。重算整月比較簡單、也不怕漏，建議先這樣做；附加是之後的優化。
- **輸出逐字元相同**：只要前端看到的排序是「先依日期」，各桶依月份順序串接就等於整份排序。若排序鍵不是日期優先（例如先依狗再依日期），就得在 Worker 合併後再排一次——仍不需多讀 D1。實作前要用現有的逐字元比對測試確認。
- **1 MB 分段**：每月約 3,300 列，遠小於 1 MB，一桶通常一段；保留分段機制即可。
- **寫入成本**：每寫一筆溜狗紀錄多寫 1～2 列（桶版本、總版本），一天約 110～220 列，免費寫入額度 10 萬列／天，影響小。

## 3. 觸發器直接維護彙總／物化結果

SQLite 沒有 materialized view，但可以用觸發器 upsert 維護彙總表（例如每隻狗最後溜狗日、每月次數），上面引用的觸發器文件允許這樣做。評估：

- 可行，但每種統計都要寫 INSERT／UPDATE／DELETE 三種觸發器，且 DELETE／改日期時「最後一次」這類 MAX 型統計無法增量算回（要回頭查），容易出錯。
- ADR 0009 已決定「統計在後端先算好」先不做（省的是前端，不是 D1 讀取，且要改 API 格式）。**資料包本身就是 API 的原樣輸出，不適合拆成觸發器逐列維護 JSON。** 結論：不建議；觸發器只負責「標記哪一桶髒了」，重算交給 Worker。

## 4. 其他 Cloudflare 選項

| 選項 | 計費／額度（2026-10-16） | 一致性 | 適合放資料包嗎 |
|---|---|---|---|
| D1 分段表（現行） | 每讀一段 1 列；免費 500 萬列／天 | 強一致（主庫） | **適合**，配合分桶即可 |
| Workers KV | 免費讀 10 萬次／天、**寫 1,000 次／天**；付費寫每百萬 5 美元 | 最終一致，其他地點可能 60 秒以上才看到 | 讀便宜，但每次同步、改紀錄都要寫，免費寫入額度太小；跨地延遲和「其他手機最慢 1 分鐘」的承諾貼邊 |
| Cache API | 不計費 | **只存在單一資料中心**，不會複製；官方只保證自訂網域可用，workers.dev 沒寫明 | 只能當版本號後面的第二層快取，不能當唯一來源；本站在 workers.dev，需先驗證 |
| R2 | 這次沒查到一手數字（未驗證，不列） | 強一致 | 放大檔可以，但這裡資料包每段才數百 KB，沒有必要 |
| Durable Objects（SQLite 型） | 與 D1 同樣以列計：免費讀 500 萬列／天、寫 10 萬列／天；KV 式 get/put 也以列計 | 單一物件內強一致 | 可把資料包放在物件記憶體裡，命中時 0 列；但要改架構、多一個元件，現在的量不值得 |
| D1 讀取副本 | 計費與沒副本相同 | Sessions API 保證順序一致 | 不省額度，只省延遲 |

來源：KV <https://developers.cloudflare.com/kv/platform/pricing/>、<https://developers.cloudflare.com/kv/concepts/how-kv-works/>；Cache <https://developers.cloudflare.com/workers/runtime-apis/cache/>；DO <https://developers.cloudflare.com/durable-objects/platform/pricing/>；讀取副本見上。

## 5. small 包依表細分

- small 重算約 700 列。細分成狗清單／離所／休養三份、各自版本號，改休養只重算休養那份。
- 但 API 輸出可能跨表組合（例如狗清單帶休養、離所狀態），細分後要確認組合結果逐字元相同，複雜度上升。
- **最大的浪費其實是 `synced_at`**：每次同步都寫，讓 small 每次失效（ADR 0009 已記）。把 `synced_at` 移到不觸發 small 的表（或觸發器加 `WHEN` 排除只改 `synced_at` 的 UPDATE，例如 `WHEN NEW.其他欄位 IS NOT OLD.其他欄位`），就能消掉大部分重算。
- 離所狗會一直累積，但一年新增有限（數百列等級），small 一包幾年內仍在千列內。
- 結論：**先處理 `synced_at`，細分先不做**；等離所累積到 small 重算明顯變大（例如超過 5,000 列）再把「離所」單獨拆出來，它也可以用同樣的按月（離所日）分桶。

## 待驗證

1. 觸發器內 upsert 的 `meta.rows_read`／`rows_written` 實際數字（官方未寫）。
2. 覆蓋索引對 `rows_read` 的影響（預期無，需量）。
3. 前端看到的溜狗紀錄排序是否日期優先（決定桶能否直接串接）。
4. workers.dev 上 Cache API 是否可用（若要用第二層快取）。
