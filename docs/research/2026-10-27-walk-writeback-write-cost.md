# 按「溜了」的寫回流程寫入成本研究（2026-10-27）

- 對象：分支 `claude/hopeful-visvesvaraya-f4afbc`（基準 main `6a07475`）。這份只做研究：沒有改程式、資料庫或設定，沒有部署，也沒有開 Issue。
- 起因：D1 讀寫效率稽核（`docs/research/2026-10-27-d1-efficiency-audit.md`）第 3 項。
- 寫回協定（#456、#498、ADR 0018）是鎖定約束。下面的替代做法都只是分析，不是定案，要改得等 K 重新開放討論。
- 標記：〔程式〕是照程式碼逐條數出來的；〔推估〕是照 SQLite／D1 規則推出來的列數，沒有在正式庫量過；〔實測〕引用稽核的正式數字。
- 10/24–10/26 是測試人員流量，10/27 起才是真的使用，所以基準只看 10/27。

## 結論摘要

- **問題在哪**：
  - 按一次「溜了」會經過登記、派送、確認三個 batch。每個 batch 都要先插一列 guard、最後再刪掉，預算檢查又多插一列 guard。一次完整流程光 guard 就寫約 10 列。
  - `v3_walk_outbox` 有 11 個部分索引。一筆工作從 pending 走到 synced，狀態每換一次就要進出好幾個索引，約 20 列〔推估〕。
- **目前狀態**：
  - 程式裡看得到的浪費有兩塊：
    - guard 的「插一列再刪掉」。
    - 1 個看起來沒有查詢用到的索引（`readback`），加上 3 個可以合併的 `unknown*` 索引。
  - 兩塊加起來，每次流程約省 15 列（55 → 約 40）〔推估〕，跟稽核估的 35–40 列一致。
  - 10/27 一整天的寫入用量只占免費額度約 1.6%，所以這不急，是改善題。
  - 「85 次 INSERT 對 40 列」最可能的原因有兩個：同一句 SQL 出現在 3 個地方，以及統計時間用 UTC 但 `operation_date` 用台灣日期，兩邊的時間範圍不一樣。程式裡找不到會刪 outbox 或吞掉衝突的寫法。
- **下一步**（給 K 決定）：
  1. 先跑「85 vs 40 假設與驗證方法」那一段的唯讀查詢，確認差異的原因。
  2. 在本機量 `meta.rows_written`，確認 D1 對部分索引和 guard 實際怎麼計數。
  3. K 決定要不要重新開放寫回協定：只改 guard 寫法（語意不變），以及刪／合索引。

## 寫入明細表（1 人溜 1 隻、第一次溜、非修改、寫回一次成功）

說明：
- 「索引」欄的意思：該列寫入時會動到的索引。D1 官方說明，寫入含索引欄位時，每個索引多算 1 列（見來源 1）。
- 部分索引只收符合 WHERE 的列（見來源 5），所以只有狀態跨過條件時才會動到。這是照 SQLite 規則推的，D1 實際計數未確認。
- `v3_walk_guard` 沒有主鍵，是 rowid 表，沒有額外索引。

### A. 登記 `acceptWalk`（`worker/src/walk-accept.js:173-185`）

| # | 語句 | 表 | 列數 | 觸發的索引／觸發器 | 小計〔推估〕 |
|---|---|---|---|---|---|
| 1 | `INSERT INTO v3_walk_guard SELECT CASE…version…` | guard | 1 | 無 | 1 |
| 2 | `writeBudget`：`INSERT INTO v3_walk_guard …reserved…`（`:57`） | guard | 1 | 無 | 1 |
| 3 | `writeBudget`：`INSERT … v3_walk_write_budget … ON CONFLICT DO UPDATE`（`:58`） | write_budget | 1 | 主鍵 `day`（第一次寫入才動，之後更新不改鍵） | 1–2 |
| 4 | `INSERT INTO v3_walk_state … ON CONFLICT DO UPDATE` | walk_state | 1 | 主鍵（新狗才動）；觸發器 `walk_pack_INSERT`／`UPDATE` → `v3_walk_pack` 1 列 | 2–3 |
| 5 | `INSERT INTO v3_walk_requests` | walk_requests | 1 | 主鍵 `request_id` | 2 |
| 6 | `UPDATE v3_walk_outbox SET status='superseded' …` | outbox | 0–1（前一版還沒完成才有） | 離開 `active`；離開 `due` 或 `dispatch`／`interrupted`／`unknown*`；`readback_seen=1` 的話進 `causal`；觸發器 `walk_pack_outbox_UPDATE`（版本不是目前版本，`WHEN` 不成立） | 0（常見）～ 6 |
| 7 | `INSERT INTO v3_walk_outbox(… 'pending' …)` | outbox | 1 | 主鍵＋`due`＋`active` | 4 |
| 8 | `walkDay`：`DELETE FROM v3_walks …`＋`INSERT INTO v3_walks`（`dog-list.js:55-61`） | v3_walks | 0＋1 | 主鍵＋`v3_walks_date`；觸發器 → `v3_walk_versions` 1 列 | 約 4（程式自己的 `HISTORY_ROW_COST=4`） |
| 9 | `DELETE FROM v3_walk_guard` | guard | 2 | 無 | 2 |
| | **登記小計** | | | | **約 17–19**（其中 guard 4） |

修改或復原時另外加 `v3_edit_log` 1 列（含索引）。預算保留量是 `40 + historyCost`，非修改是 `32 + historyCost`（`:175`）。

### B. 派送 `dispatchBatch` 認領（`:227-236`）

| # | 語句 | 表 | 列數 | 觸發的索引／觸發器 | 小計〔推估〕 |
|---|---|---|---|---|---|
| 1 | `writeBudget` guard＋budget upsert | guard＋budget | 2 | budget 主鍵（當日第一次才動） | 2–3 |
| 2 | 每隻狗的 guard（delivery／版本） | guard | 1 | 無 | 1 |
| 3 | `INSERT INTO v3_walk_retry … ON CONFLICT DO UPDATE` | walk_retry | 1 | 主鍵（第一次才動） | 1–2 |
| 4 | `INSERT INTO v3_walk_delivery … ON CONFLICT DO UPDATE` | walk_delivery | 1 | 主鍵＋`v3_walk_delivery_started` | 2–3 |
| 5 | `UPDATE v3_walk_outbox SET status='dispatching',dispatch_id=? …` | outbox | 1 | 離開 `due`；進 `dispatch`、`interrupted`、`unknown`、`unknown_date`、`unknown_walker`；`active` 的 WHERE 引用 status，可能重寫；觸發器 `walk_pack_outbox_UPDATE` → pack 1 列 | 約 8–9 |
| 6 | `DELETE FROM v3_walk_guard` | guard | 2 | 無 | 2 |
| | **派送小計** | | | | **約 16–20**（其中 guard 4） |

### C. 確認 `confirmWalk`（`:320-328`）

派送剛在 `v3_walk_retry` 記了當天的派送識別，所以 `transitionBudget` 認定已預付，不寫預算、不插預算 guard（`:65-70`）。

| # | 語句 | 表 | 列數 | 觸發的索引／觸發器 | 小計〔推估〕 |
|---|---|---|---|---|---|
| 1 | guard（狀態＋outbox 版本與派送識別） | guard | 1 | 無 | 1 |
| 2 | `UPDATE v3_walk_state SET base_date,base_walker` | walk_state | 1 | 沒有索引含這兩欄；`walk_pack_UPDATE` 只看 version 等欄位，不會觸發 | 1 |
| 3 | `INSERT INTO v3_walk_baselines … ON CONFLICT` | baselines | 1 | 主鍵（第一次才動） | 1–2 |
| 4 | `UPDATE v3_walk_outbox SET status='synced',readback_seen=1,error=''` | outbox | 1 | 離開 `active`、`dispatch`、`interrupted`、`unknown`×3；進 `agreed`、`readback`；觸發器 → pack 1 列 | 約 10 |
| 5 | `DELETE FROM v3_walk_delivery` | delivery | 1 | 主鍵＋`started` | 3 |
| 6 | `DELETE FROM v3_walk_guard` | guard | 1 | 無 | 1 |
| | **確認小計** | | | | **約 17–18**（其中 guard 2） |

### D. 合計

| 項目 | 列數〔推估〕 |
|---|---|
| 登記＋派送＋確認 | 約 50–57（稽核本機量到約 55） |
| guard 插入＋刪除 | 10（5 插 5 刪） |
| `v3_walk_outbox` 本身＋索引 | 約 22 |
| 真正的業務資料（state、requests、outbox 本體、v3_walks、pack） | 約 15–20 |

佐證〔實測〕：10/27 `DELETE FROM v3_walk_guard` 跑 109 次、寫 182 列，平均每次 1.67 列。登記刪 2、派送刪 2、確認刪 1，平均 1.67，跟程式完全對得上。

其他也會寫 guard 的路徑：
- 人工改表比對：`compareTrustedWalk`（`:428-439`）、`walk-reconcile.js:27-39`。
- 寫回接收端授予：`writebackTarget`（`:468-474`）。
- 衝突紀錄（`:364`、`:371`）：只有 `DELETE FROM v3_walk_guard`，搭配預算 guard。

## `v3_walk_outbox` 索引逐一分析表

依據：
- 用 grep 查了 `worker/` 與 `scripts/`。`scripts/` 只有 `compact-schema.test.mjs` 列表名，沒有查詢。
- 測試裡有 `EXPLAIN QUERY PLAN` 斷言的，在「證據」欄註明。

| 索引（`db/compact-schema.sql`） | 欄位／條件 | 用到它的查詢 | 證據 | 判斷 |
|---|---|---|---|---|
| `due`（:39） | `(next_attempt_at,dog_key)` WHERE pending/retry/unconfirmed | `walk-retry.js:28-32` 的到期工作 | `walk-retry.test.mjs:182-183` 斷言用它 | 保留 |
| `active`（:40） | `(dog_key)` WHERE 不是 synced/superseded | 登記與比對的 `UPDATE … SET status='superseded'`（`walk-accept.js:179`、`:435`） | `walk-accept.test.mjs:116-117` 斷言用它 | 保留。主鍵 `(dog_key,version)` 也能用 dog_key 前綴，但會掃這隻狗的所有歷史版本 |
| `readback`（:41） | `(dog_key,target_date,target_walker)` WHERE `readback_seen=1` | **找不到專用查詢**。唯一帶 `readback_seen=1` 的 SELECT 是 `knownIntermediate`（`:338`），條件還多了 `status='superseded'`，`causal` 剛好完全符合 | 沒有測試斷言它 | **可能可刪**。要先用 EXPLAIN 確認 `knownIntermediate` 選的是 `causal`。它在 confirm 時多寫 1 列 |
| `agreed`（:42） | `(dog_key,version)` WHERE synced | `baselineVersion`（`:334`）`ORDER BY version DESC LIMIT 1` | 會被 `walk-reconcile.test.mjs:168-172` 的「outbox SELECT 都要 SEARCH」涵蓋 | 保留。跟主鍵同欄位，但只收 synced，省掉掃非 synced 的版本 |
| `causal`（:43） | `(dog_key,target_date,target_walker,version)` WHERE `readback_seen=1 AND superseded` | `knownIntermediate`（`:338`） | 同上 | 保留 |
| `unknown`（:44） | `(dog_key,target_date,target_walker,version)` WHERE `readback_seen=0 AND dispatch_id<>''` | `:406` | 同上 | 三個可以合併 |
| `unknown_date`（:45） | `(dog_key,target_date,version)` 同條件 | `:407` | 同上 | 前綴 `(dog_key,target_date)` 跟 `unknown` 重疊。`unknown` 可以做等值搜尋再過濾 walker，代價是不能直接用 version 範圍 |
| `unknown_walker`（:46） | `(dog_key,target_walker,version)` 同條件 | `:408` | 同上 | 前綴不重疊（第二欄不同）。如果合成一個 `(dog_key,version)` 或只用 `(dog_key)`，三句都還是 SEARCH，但要逐列過濾 |
| `dispatch`（:52） | `(dog_key,dispatch_id)` WHERE dispatching | `:273` 收尾判斷卡住的工作 | `walk-retry.test.mjs:184-185` 斷言用它 | 保留（主鍵前綴也可以用，但有測試鎖定） |
| `interrupted`（:53） | `(next_attempt_at,dog_key)` WHERE dispatching | `walk-retry.js:23-27` 孤兒工作 | `walk-retry.test.mjs:186-187` 斷言用它 | 保留。欄位跟 `due` 一樣只是條件不同；合成一個條件較寬的索引可以少寫一次，但兩個查詢都要改，又有測試鎖定 |

### 合併 `unknown*` 的考量

- 這三個索引只收「已派送、還沒可信讀回」的列。正常情況下每隻狗最多只有 1–2 列。所以改成一個 `(dog_key)` 或 `(dog_key,version)`，讀的成本幾乎不變。
- 每筆工作在派送時進、確認時出，合併後每次流程少寫 4 列〔推估〕。
- 風險：`walk-reconcile.test.mjs:168-172` 要求 outbox 的 SELECT 都是 SEARCH，合併後還是 SEARCH，所以不會壞。但這是協定判斷「未知結果」的路徑（#456 回應遺失、逆序回執），改索引不改語意，仍要跑完整測試。

## batch 交易語意與計費（官方說明）

| 主張 | 官方說法 | 來源 |
|---|---|---|
| batch 是交易 | 「Batched statements are SQL transactions」 | 2 |
| 一句失敗整批回復 | 一句失敗時，回傳該句錯誤，並 aborts or rolls back 整個序列 | 2 |
| 依序執行 | 每句依序、不並行執行 | 2 |
| rows written 怎麼算 | INSERT／UPDATE／DELETE 寫到的列；插 10 列算 10 列 | 1 |
| 索引會增加寫入列數 | 寫入含索引欄位時，每個索引多算 1 列 | 1 |
| 免費額度 | 每天寫 10 萬列、讀 500 萬列，UTC 00:00 重置 | 1 |
| 失敗／回滾的語句算不算 rows written | **官方頁面沒有寫**，未確認 | 1、2 都沒提到 |
| RAISE | 只寫在 trigger program 裡可用；觸發時終止目前語句並回傳 `SQLITE_CONSTRAINT` | 4 |
| 部分索引 | 只收 WHERE 為真的列 | 5 |
| CHECK 違反 | 預設 ABORT：撤回該句，在 batch 中造成整批回復 | 3、2 |

有兩點官方沒有說清楚，列入未確認事項：
- 部分索引「狀態跨過條件」時 D1 怎麼計數。
- 失敗 batch 的計費。

## guard 替代做法與協定影響

### 現在的做法

- `INSERT INTO v3_walk_guard SELECT CASE WHEN 條件 THEN 1 ELSE 0 END`。條件成立就插 `ok=1`，batch 結尾再 `DELETE`。
- 條件不成立就插 `ok=0`，違反 `CHECK(ok=1)`，整批回復。
- 成功的路徑每次都要多寫「插 1＋刪 1」。

### 做法 1：只在條件不成立時才插（不用 RAISE，不改 schema）

```sql
INSERT INTO v3_walk_guard SELECT 0 WHERE (條件) IS NOT 1;
```

- 條件成立：SELECT 沒有結果，插 0 列，不寫入。表一直是空的，batch 結尾的 `DELETE FROM v3_walk_guard` 可以拿掉。
- 條件不成立或為 NULL：插 `0`，違反 CHECK，整批回復，跟現在一樣。
- **一定要用 `IS NOT 1`，不能寫 `WHERE NOT (條件)`**。條件為 NULL 時（例如子查詢沒結果），`NOT NULL` 還是 NULL，guard 會靜靜放行。現在的 `CASE … ELSE 0` 在 NULL 時是擋下，改寫後語意不能變寬。
- 預算 guard（`:57`）也可以同樣改寫。
- 估計省下：每次流程 guard 從 10 列降到 0 列〔推估，前提是 D1 不把「插 0 列」的語句算成寫入〕。
- 對寫回協定的影響：
  - 冪等、重送、確認語意沒變：三個 batch 的語句和順序都一樣，只有 guard 成功時不留痕跡。
  - 錯誤分類：`dispatchBatch` 用 `/CHECK constraint/` 判斷是不是預算擋下（`:247`）。改寫後失敗時還是 CHECK 錯誤，可以沿用。
  - 有一個風險：如果某個 batch 失敗卻沒有回復（D1 說的是 aborts **or** rolls back），現在的做法會留下 guard 列，下一次的 `DELETE` 會清掉。改寫後，失敗時本來就是 ok=0，不會被留下。所以改寫反而少一種殘留的可能。

### 做法 2：RAISE

- SQLite 的 `RAISE()` 只能在觸發器裡用（來源 4）。要用就得建一個 VIEW 加 `INSTEAD OF INSERT` 觸發器，在觸發器裡 `SELECT RAISE(ABORT,…) WHERE …`。
- 優點：可以給明確的錯誤訊息。
- 缺點：要新增 schema 和 migration（ADR 0008 預演流程），而且錯誤從 CHECK 變成自訂訊息，`:247` 的判斷要跟著改。省下的寫入跟做法 1 一樣。
- 結論：做法 1 改動較小。

### 做法 3：靠會失敗的條件式 UPDATE／主鍵衝突

- 例如把「版本相符」的判斷放進 `UPDATE v3_walk_state … WHERE version=?`。問題是 UPDATE 沒有命中時不算錯，不會讓 batch 失敗，達不到「整批回復」。
- 不適用。

### 共同風險

- 寫回協定是鎖定約束（#456 的驗收：「任一步失敗不回已成功，也不留下半份狀態」）。改 guard 寫法時，要用既有的競爭、重送、逆序回執測試，證明行為完全一樣。
- 預算計量（`writeBudget` 的保守上界 32／40／96／16／24）是照現在的寫法算的。改了以後可以調低，但調低要另外決定，不能跟 guard 改寫混在一起。

## 85 vs 40 假設與驗證方法

稽核〔實測〕：10/27 Query Insights 記到 `INSERT INTO v3_walk_outbox` 執行 85 次，正式庫 10/27 的工作有 40 列。

| 假設 | 程式證據 | 可能性 |
|---|---|---|
| H1：同一句 SQL 出現在 3 個地方，Insights 按 SQL 文字合併計算 | 一字不差的 `INSERT INTO v3_walk_outbox(dog_key,version,operation_date,target_date,target_walker,status,next_attempt_at) VALUES(?,?,?,?,?,'pending',?)` 出現在：登記 `walk-accept.js:180`、人工改表比對 `:436`、保險掃描 `walk-reconcile.js:34`。但三個地方成功時都會留列，所以只靠 H1 解釋不了差額，要搭配 H2 | 高（搭配 H2） |
| H2：日期範圍對不上 | Insights 用 UTC 小時統計。登記的 `operation_date` 是台灣日期（`dayOf`，`:17`）；保險掃描用 `at.slice(0,10)`，是 UTC 日期（`walk-reconcile.js:25,35`）；比對用 `dayOf(Date.now())`。用 `operation_date='2026-10-27'` 數列數，跟「10/27 那段的執行次數」範圍不同 | 高 |
| H3：batch 失敗回復，INSERT 有記錄但沒留列 | 登記最多重試 8 次（`:138`）。guard 是第一句，失敗時後面的語句不一定會執行。稽核也提醒 batch 內的語句不一定每句都記到 Insights | 中，要查 |
| H4：`INSERT OR IGNORE`／`ON CONFLICT` 衝突時不寫列 | outbox 的 INSERT 都沒有 OR IGNORE 或 ON CONFLICT。主鍵衝突會報錯並讓整批回復（等於 H3） | 排除 |
| H5：重送 | 同一個 requestId 重送在 batch 之前就 `replay` 回傳（`:130-131`），不會執行 INSERT | 排除 |
| H6：清除（DELETE） | `worker/`、`scripts/` 都沒有 `DELETE FROM v3_walk_outbox` | 排除（除非有人手動刪過） |
| H7：測試網站流量 | 測試網站和預覽用另一個資料庫 `bq-shelter-dogs-test`（`wrangler.test-site.jsonc:26-27`）。除非 Insights 查的是那個庫，否則不會混入 | 低 |

### 唯讀驗證查詢（K 在 PowerShell 跑）

```powershell
# 1. 按 operation_date 與狀態數工作列（看 40 是怎麼來的，H2）
npx.cmd wrangler d1 execute bq-shelter-dogs --remote --command "SELECT operation_date,status,dispatch_id='' AS manual,COUNT(*) n FROM v3_walk_outbox GROUP BY 1,2,3 ORDER BY 1"

# 2. 照 UTC 建立時間數（next_attempt_at 在 INSERT 時等於建立時間；之後重試會改，所以只能當參考）
npx.cmd wrangler d1 execute bq-shelter-dogs --remote --command "SELECT substr(next_attempt_at,1,13) utc_hour,COUNT(*) n FROM v3_walk_outbox WHERE next_attempt_at>='2026-10-26T16:00' GROUP BY 1 ORDER BY 1"

# 3. 分辨三個來源（H1）：dispatch_id='' 且 synced 是人工改表或保險掃描；有 dispatch_id 是網站登記
npx.cmd wrangler d1 execute bq-shelter-dogs --remote --command "SELECT CASE WHEN dispatch_id='' AND status='synced' THEN 'manual' ELSE 'site' END src,COUNT(*) n FROM v3_walk_outbox WHERE operation_date>='2026-10-26' GROUP BY 1"

# 4. 版本有沒有跳號（有跳號表示有 INSERT 被回復，或版本來自其他路徑；H3）
npx.cmd wrangler d1 execute bq-shelter-dogs --remote --command "SELECT s.dog_key,s.version,COUNT(o.version) jobs,MIN(o.version) minv FROM v3_walk_state s LEFT JOIN v3_walk_outbox o ON o.dog_key=s.dog_key GROUP BY 1,2 HAVING jobs<>s.version-minv+1"

# 5. 請求數和工作數比一比（每筆成功登記都有 1 列 request）
npx.cmd wrangler d1 execute bq-shelter-dogs --remote --command "SELECT operation_date,COUNT(*) n FROM v3_walk_requests GROUP BY 1 ORDER BY 1"
```

- 驗證 H3：用稽核的 GraphQL 方式查 `d1QueriesAdaptiveGroups`，條件是同一小時、`query` 等於上面那句 INSERT，拿執行次數跟 `rowsWritten` 總和比。如果 `rowsWritten` 約等於 40×4（本體＋主鍵＋2 個索引），代表多出來的次數沒有寫列，支持 H3（或 Insights 重複記錄）。
- 驗證 H2：把查詢 2 的 UTC 小時換成台灣時間，跟 Insights 的時間範圍對齊後再比一次。

## 未確認事項

1. 失敗或回復的 batch 裡的語句，D1 算不算 rows written、算不算 Insights 的執行次數。官方頁面沒寫。
2. 部分索引在狀態跨過條件時（離開一個、進另一個），D1 的 rows written 是不是照 SQLite 實際動到的索引數計算。上面的 outbox 列數是照這個假設推的。
3. 「插 0 列的 INSERT … SELECT」在 D1 算不算寫入（應該是 0，沒量過）。
4. `readback` 索引是不是真的沒被選用：要在本機對 `knownIntermediate` 跑 `EXPLAIN QUERY PLAN` 確認。
5. 85 vs 40 的實際原因：要跑上面的查詢。
6. 規格原文 `docs/design/441-d1-walk-sync-spec.md` 不在本分支（Issue 引用的是 `444c33e` 的版本），這次沒有讀。guard 的設計理由取自 schema 註解（「比較版本失敗必須整筆回復，不能留下去重結果或工作」）、#456 驗收條件和 ADR 0018 第 31 行。

本機量測方法（建議）：
- 用 `worker/test` 既有的 Miniflare D1，跑一次登記、派送、確認，把每個 `db.batch()` 回傳的 `meta.rows_written` 加總。
- 再改用做法 1 的 guard、刪掉 `readback`、合併 `unknown*`，各量一次，就能把〔推估〕換成〔本機〕。
- 本機 SQLite 的計數不一定等於 Cloudflare 的計費，但可以拿來比相對差異。

## 來源清單

1. Cloudflare D1 Pricing — https://developers.cloudflare.com/d1/platform/pricing/（rows written 定義、索引多算 1 列、免費額度）
2. Cloudflare D1 Worker API：D1Database `batch()` — https://developers.cloudflare.com/d1/worker-api/d1-database/（batch 是交易、一句失敗整批 abort／rollback、依序執行）
3. SQLite ON CONFLICT 子句 — https://www.sqlite.org/lang_conflict.html（CHECK 違反預設 ABORT）
4. SQLite CREATE TRIGGER（RAISE）— https://www.sqlite.org/lang_createtrigger.html
5. SQLite Partial Indexes — https://www.sqlite.org/partialindex.html
6. 本 repo：`worker/src/walk-accept.js`、`worker/src/walk-reconcile.js`、`worker/src/walk-retry.js`、`worker/src/dog-list.js:55-61`、`db/compact-schema.sql:1-90`、`docs/adr/0018-today-walks-d1-event-sync.md:31`、Issue #456、#498（`gh issue view`）、`docs/research/2026-10-27-d1-efficiency-audit.md` 第 3 項。
