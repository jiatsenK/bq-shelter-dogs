# 保險掃描整張掃 `v3_walk_outbox`：改寫與清舊資料研究（2026-10-27）

稽核第 7 項的深入研究（稽核文件：`docs/research/2026-10-27-d1-efficiency-audit.md`，在 `claude/d1-efficiency-audit` 分支）。唯讀研究，沒有改程式。

## 結論

1. **`CROSS JOIN` 改寫結果完全相同，查詢計畫穩定變成「先掃 `v3_walk_state`，再用主鍵查 outbox」**。SQLite 官方文件明說 `CROSS JOIN` 只鎖定迴圈順序，不改結果；本機三種資料量比對結果都一樣。
2. **現在會選 `SCAN o` 是因為沒有統計資料**：沒跑過 `ANALYZE` 時，SQLite 把兩張表都當成一樣大，剛好挑了 outbox 當外層。跑過 `ANALYZE` 之後，原本的 `JOIN` 也會自己改成 `SCAN s`。所以有兩條路：改寫成 `CROSS JOIN`（不靠統計，結果固定），或在 D1 跑 `PRAGMA optimize`（D1 官方建議，但會影響所有查詢的計畫，要另外驗）。建議走前者，影響範圍只有這一句。
3. **改寫後每次讀的列數跟「在所狗數」成正比，不再跟 outbox 歷史成正比**，outbox 長大也不會讓這句變慢。這一點解掉第 7 項的主要問題。
4. **outbox 可以清舊資料，但不急**。程式只讀「目前一致基準（frontier）之後」的列、每隻狗最新一筆 `synced`，和 2 分鐘內的最近 6 版；比 frontier 舊、又超過幾天的列沒有任何程式會讀。改寫第 1 點之後，舊資料只占儲存空間，不再影響讀取量；清除本身反而要付寫入（outbox 有 10 個索引，每刪一列會寫很多列，見下面）。建議先只做改寫，等 outbox 列數真的變大再開票清理。

## 1. 現在的查詢

`worker/src/walk-reconcile.js:54`（`scanWalks`）：

```sql
SELECT s.*,o.status FROM v3_walk_state s
JOIN v3_walk_outbox o ON o.dog_key=s.dog_key AND o.version=s.version
```

- `v3_walk_state` 主鍵是 `dog_key`，每隻狗一列（`db/compact-schema.sql:3`）。
- `v3_walk_outbox` 主鍵是 `(dog_key,version)`，每按一次溜了、每次人工改表都新增一列，沒有任何地方刪除（`db/compact-schema.sql:26`；`grep DELETE FROM v3_walk_outbox` 在 `worker/src` 沒有結果）。
- 這句的意思是「每隻狗取目前版本那一筆 outbox 的狀態」；每隻狗最多對到一列。

## 2. 本機 SQLite 驗證

做法：用 Node 24 內建 `node:sqlite`（SQLite 3.53.0）載入 `db/compact-schema.sql`，塞假資料，比對原句與 `CROSS JOIN` 版本的結果（依 `dog_key` 排序後轉 JSON 比較）和 `EXPLAIN QUERY PLAN`。另外放一隻沒有 outbox 列的狗，確認兩句都不會回它。

改寫後：

```sql
SELECT s.*,o.status FROM v3_walk_state s
CROSS JOIN v3_walk_outbox o ON o.dog_key=s.dog_key AND o.version=s.version
```

| 資料 | 結果相同 | 原句計畫（沒統計） | `CROSS JOIN` 計畫 | 原句計畫（`ANALYZE` 後） |
|---|---|---|---|---|
| 空表 | 是（0 列） | `SCAN o; SEARCH s (dog_key=?)` | `SCAN s; SEARCH o (dog_key=? AND version=?)` | `SCAN o; SEARCH s` |
| 40 隻狗、每隻 3 版 | 是（40 列） | `SCAN o; SEARCH s` | `SCAN s; SEARCH o` | `SCAN s; SEARCH o` |
| 40 隻狗、每隻 30 版 | 是（40 列） | `SCAN s; SEARCH o`〔註〕 | `SCAN s; SEARCH o` | `SCAN s; SEARCH o` |

〔註〕第三列跑在前一輪 `ANALYZE` 之後同一條連線上；刪掉 `sqlite_stat1` 不會清掉已載入的統計，所以這格不算「沒統計」的結果。前兩列才是乾淨的對照。

- 驗證腳本放在 session 暫存區（`plan.mjs`），沒有進 repo；要重跑可照上面的做法重寫，約 30 行。

## 3. 官方文件依據

- **`CROSS JOIN` 只鎖順序、不改結果**：SQLite 說明 `CROSS JOIN` 的左表一定在外層，而一般 `JOIN`／`INNER JOIN` 可以被規劃器任意調換；文件把兩種寫法稱為邏輯上等價的寫法。只有外部連接（LEFT/RIGHT/FULL）不能調換，跟這裡無關。來源：<https://www.sqlite.org/optoverview.html> 第 7.1.2 節。
- **沒統計時怎麼猜**：沒跑過 `ANALYZE` 時，規劃器把表的列數猜成固定值、索引每個值平均 10 筆重複，所以兩張表看起來一樣大，挑哪個當外層取決於估算細節。來源：同頁第 6、7、14 節。
- **D1 建議 `PRAGMA optimize`**：D1 文件說建立索引後要跑 `PRAGMA optimize`，它會對每張表跑 `ANALYZE`，讓規劃器選更好的計畫；也建議用 `EXPLAIN QUERY PLAN` 確認是否用到索引。來源：<https://developers.cloudflare.com/d1/best-practices/use-indexes/>。
- **D1 計費按「讀到的列」不是「回傳的列」**：整張掃描回一列也算整張；寫入時每個受影響的索引也多算一列寫入。來源：<https://developers.cloudflare.com/d1/platform/pricing/>、上一個連結。

## 4. outbox 要不要清、留多久

### 哪些程式會讀舊列

| 位置 | 讀什麼 | 需要的範圍 |
|---|---|---|
| `walk-accept.js:334`（`baselineVersion`） | 該狗最新一筆 `status='synced'` | 最新那一筆 |
| `walk-accept.js:338`（`knownIntermediate`） | `superseded` 且讀回過的中間值 | `version > frontier` |
| `walk-accept.js:406–408` | 派送過但沒確認的值 | `version > frontier` |
| `walk-accept.js:347`（`beforeManualEdits`） | 目前版本往回 6 版，只認 2 分鐘內的人工版本，回傳這串之前那一版 | 最近 6 版 |
| `walk-accept.js:15`、`:272`、`:305`、`:452` 等 | 目前版本那一筆 | 目前版本 |
| `walk-retry.js:23`、`:28` | 待派送／中斷的列 | 狀態不是 `synced`／`superseded` |

frontier＝`max(v3_walk_baselines.version, 最新 synced 版本)`（`walk-accept.js:332`）。

### 可以安全刪的範圍（推論，需實作時再用測試確認）

同時符合才刪：

1. `version < frontier`（比一致基準舊）；
2. 不是該狗最新一筆 `synced`（frontier 本身那一筆要留）；
3. 狀態是 `synced` 或 `superseded`（還在派送流程的不碰）；
4. 不在該狗最近 6 版內，或 `operation_date` 已超過一段時間（`beforeManualEdits` 只看 2 分鐘內，保留 2–3 天足夠，也方便人工查問題）。

保留期限建議：**3 天**。理由是程式邏輯只需要分鐘級，多留幾天是給人工追查「昨天那筆為什麼沒寫回」；超過 3 天的派送問題已經會在每日檢查發現。這是建議值，不是量測結果。

### 清除的代價

- outbox 有 10 個索引（`db/compact-schema.sql:39–53`，多數是部分索引），刪一列會依符合條件的索引各多寫一列。
- 依 D1 計費，刪除算寫入；寫入額度（免費版每天 10 萬列）比讀取額度（每天 500 萬列）緊很多。
- 所以第 1 點改寫之後，清舊資料在額度上是「花寫入換儲存」，目前不划算。等 outbox 到幾萬列、或儲存成為問題再做；做的話放在每日一次的排程，一次刪一批。

## 5. 對其他 outbox 查詢的提醒

- `walk-accept.js:15`、`:272`、`:321`、`walk-reconcile.js:28` 也是 `state JOIN outbox`，但都有 `WHERE s.dog_key=?` 或 `o.dog_key=?`，規劃器會直接用主鍵，不受歷史長度影響；不用改。
- `walk-retry.js:23`、`:28` 以 outbox 為外層，但條件命中部分索引 `v3_walk_outbox_due`／`_interrupted`，只掃未完成的列；不用改。
- 稽核提到唯一沒被用到的索引 `v3_walk_outbox_readback`，若之後清理或改 schema 可一併評估移除，能減少每次寫入 outbox 的索引寫入。

## 缺口

- **正式 D1 已確認〔實測 2026-10-27〕**：K 對正式庫（`database_id` 6cd6c304…，即 `wrangler.jsonc` 的正式庫；wrangler 輸出寫「preview database」只是它的字樣）跑原句的 `EXPLAIN QUERY PLAN`，結果是 `SCAN o; SEARCH s USING INDEX sqlite_autoindex_v3_walk_state_1 (dog_key=?)`，跟本機沒統計時一樣，第 1、2 點的結論在正式庫成立。`sqlite_stat1` 沒有另外查；從計畫看應該沒有統計資料，要確認可跑：

  ```bash
  npx.cmd wrangler d1 execute bq-shelter-dogs --remote --command "SELECT * FROM sqlite_stat1"
  ```
- 改寫後實際每次讀幾列（D1 的 `rows_read` 對 `SEARCH` 怎麼算）沒有量；預期約「在所狗數」到兩倍之間，實作後看 `meta.rows_read` 確認。
- 安全刪除範圍是讀程式推論，沒有跑測試；實作時要補「刪掉舊列後，人工改表／未確認派送／中間值判斷結果不變」的測試。
