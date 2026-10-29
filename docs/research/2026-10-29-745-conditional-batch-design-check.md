# #745 有條件 batch 設計提案核對：有沒有照建議、有沒有過度設計

日期：2026-10-29（台灣時間）。只做研究，沒有改程式、資料庫或設定。基準：main `bdae3762`。
標記：〔程式〕照程式碼查出來的；〔本機實測〕在本機 `node:sqlite`（SQLite 3.53.0）跑的，不是 D1；〔推論〕沒有直接證據。

## 結論

1. **有沒有照建議**：大方向符合 issue #745 與 #681／ADR 0018 的 guard 寫法（`IS NOT 1`、條件不成立才插列、結果切片、藏起 guard 表）。偏離的兩處（不碰 walk-accept、不搬寫入預算）都是 K 已同意的範圍縮減，但驗收「錯誤分類只剩一份」這次做不到，要在票上註明或另開後續票。「2026-10-29 架構檢視報告第 2 點」在 repo 裡找不到，只能以 issue 內文的轉述為準。
2. **過度設計的地方**：Q7 的 `BatchConflict` 類別，加上 Q3 的具名 CHECK（`CONSTRAINT batch_condition`）。目前 4 個呼叫端都不需要分辨「條件沒過」和「其他約束」，結果都一樣。而且靠訊息裡的約束名來判斷，在正式 D1 上反而多一種會退步的情況。新表＋migration（Q3）這次不是必要的。Q8 不算過度設計。Q4 可以留，但要把變成死碼的那段刪掉。
3. **建議怎麼改**：
   - **Q7**：module 只 export `batchIf` 和 `isConflict(e)`。`isConflict` 用一條 regex 涵蓋 CHECK、FOREIGN KEY、UNIQUE。`batchIf` 遇到 D1 錯誤原樣丟出，不自訂錯誤類別。
   - **Q3**：拿掉約束名，判斷不要依賴它。新表可以不加，改用已經是同樣形狀、而且一直是空的 `v3_walk_guard`，這張 PR 就不用 migration。改名、DROP 四張舊 guard 表等 #746 之後，用一張清理 PR 一起做。如果 K 想要名稱清楚，保留新表也可以，只是要多按一次套用 migration。
   - **Q4**：保留「衝突後再讀一次」，同時刪掉 `results[removeAt].meta.changes` 那段。
   - **補上漏掉的項目**：測試、`standards.test.mjs` 的兩條例外、`identity.test.mjs` 的 race 攔截條件，細節見第 4 節。

## 1. 「建議」的來源

| 來源 | 找到了沒 | 出處 |
|---|---|---|
| issue #745 內文 | 有 | `gh issue view 745`。問題：activities、identity 的 guard 在列不見時放行；做法：收成一個「有條件 batch」module，把 guard 表、NULL／缺列語意、錯誤分類、結果切片藏在裡面，五個呼叫端改用；驗收三條（缺列與 NULL 都擋並有 memoryD1 測試、錯誤分類只剩一份、409 訊息照舊） |
| 2026-10-29 架構檢視報告第 2 點 | **找不到** | 在 worktree 與主 repo（含 `docs/`、`docs/research/`，以及近兩天改過的 `.md`）grep「架構檢視」「improve-codebase-architecture」「有條件 batch」，只找到技能檔 `.claude/skills/improve-codebase-architecture/SKILL.md` 和舊的 agent-log，沒有這份報告。內容不推測 |
| repo 規範 | 有 | `CODING_STANDARDS.md`、`docs/agents/data-changes.md`、ADR 0004／0008／0018、`docs/agent-log/2026-10-27-681-writeback-guard.md`。agent-hub 的 `CODING_STANDARDS.md` 只有「UI／業務／資料分層」一條（`C:/Users/User/repos/agent-hub/CODING_STANDARDS.md:5-11`），跟這題沒有直接關係 |

## 2. 逐條對照

| 題 | 符合 | 超出或偏離 | 出處 |
|---|---|---|---|
| Q1 只接 4 個呼叫端 | issue 列的 guard 有 activities、identity 兩處、dog-edit、dog-merge 和 walk-accept；Q1 接前四個 | issue 寫「五個呼叫端改用它」，walk-accept 留到 #746 之後（K 已同意）。issue 也說可以從 #746 抽出來；Q1 是另外新寫，#746 合併後會暫時有兩份同樣的 guard 寫法，要開後續票收掉 | issue 內文；`worker/src/walk-accept.js:18-20` |
| Q2 `batchIf`、`IS NOT 1`、結果切片 | 跟 #681 定案的寫法一樣（ADR 0018 補充：「寫法固定是 `WHERE (條件) IS NOT 1`」）。4 個呼叫端的 guard 本來就放在 batch 最前面，「條件先、句子後」的介面對得上 | 沒有偏離。小提醒：`guardedDogBatch` 沒有 `expected` 時直接跑一般 batch（`dog-edit.js:17`），`batchIf` 要允許條件是空陣列 | `docs/adr/0018-today-walks-d1-event-sync.md:43-49`；`activities.js:156,168`；`identity.js:76,137`；`dog-edit.js:19-28`；`dog-merge.js:152,198` |
| Q3 新表＋migration | 符合 data-changes「加表同一張 PR 寫 migration」「先加後刪」的規則 | issue 沒有要求換表，舊研究也只把「三張 guard 併一張」列為「純整理、低優先」。見第 3.1 節 | `docs/agents/data-changes.md:12,20-24`；`docs/research/2026-10-24-521-d1-tables-audit.md:48` |
| Q4 刪除時的 race 維持現狀 | 對應驗收「網站看得到的行為不變」 | 只處理刪除。修改遇到同樣的 race，行為也會變，Q4 沒提到，見第 3.4 節 | `activities.js:166-175`；`admin/activities.js:26-27` |
| Q5 walk-accept 的 regex 留著 | K 已同意 | 驗收「錯誤分類只剩一份」只完成一部分：module 一份，加上 `walk-accept.js:286,309` 兩處 | `walk-accept.js:286,309` |
| Q6 寫入預算不搬 | issue 寫的是「可以當成其中一種條件」，不是必須 | 沒有偏離 | issue 內文 |
| Q7 `BatchConflict`＋`isConstraintError` | 錯誤分類集中到 module，方向符合 | 兩個 export 加上具名 CHECK，超出目前的需要，見第 3.2、3.3 節 | — |
| Q8 `guardedDogBatch` 留作薄包裝 | 不動 `dog-list.js`，diff 最小。dog-merge 的 guard 本來就是 dog-edit 那句 SQL 的複製品，抽出共用條件剛好消掉重複 | 沒有偏離 | `dog-edit.js:22`、`dog-merge.js:130`、`dog-list.js:133,183` |

跟 ADR 的關係：
- **ADR 0004**（管理網站的編輯紀錄跟資料寫在同一批）：`batchIf` 的 statements 照樣包含紀錄句，不受影響（`admin/activities.js:7-11`、`activities.js:157,168`）。
- **ADR 0008**（新的 D1 寫入要估列數）：改成 `IS NOT 1` 後，guard 成功時寫 0 列，每個 batch 省下原本的「插 1＋刪 1」。activities／identity／dog-edit 每批省 2 列，狗合併省 4 列。「插 0 列不算寫入」是 #681 用 Miniflare 量到的〔本機實測，非官方〕（`docs/agent-log/2026-10-27-681-writeback-guard.md:18`；`docs/adr/0008-diff-sync-and-write-budget.md:32`）。

## 3. 過度設計檢查：拿掉會怎樣

### 3.1 新表＋migration（Q3）

- 現有的 `v3_walk_guard` 定義是 `(ok INTEGER NOT NULL CHECK(ok=1))`，跟 Q3 提的新表一模一樣，只差約束名（`db/compact-schema.sql:72`）。#681 之後它一直是空的：條件成立時插 0 列，不成立就整批回復（`walk-accept.js:18-20`；`walk-accept.test.mjs:137`）。所以幾個功能共用這張表，不會互相干擾〔程式〕。
- `walk-accept.test.mjs:139-143` 只檢查 `walk-accept.js` 和 `walk-reconcile.js` 裡出現 `INSERT INTO v3_walk_guard` 的次數，新 module 用這張表不會觸發那個測試〔程式〕。
- 拿掉新表會怎樣：這張 PR 變成純程式改動，不用寫 migration，合併後也不用按「套用 D1 migration」。不按的話，部署會被 `deploy-cloudflare.yml` 紅叉擋住（`data-changes.md:21,23-24`）。代價是表名寫著 walk，要靠註解說明它是共用 guard 表。
- 「下一張 PR 還要 DROP」**不是新表造成的**：只要三張舊表（activity／identity／dog_edit guard）不再使用，不管新表加不加，要清就得寫 DROP migration；不清也不會花錢（舊研究：永遠 0 列，`2026-10-24-521-d1-tables-audit.md:48`）。所以兩個方案真正的差別，只有這張 PR 要不要多一個 migration 步驟。
- 判斷：新表不算錯，它的價值只在名稱清楚。這次不是必要的。如果要乾淨的名字，可以等 #746 之後把「建新表＋四張舊表全部換過去＋DROP」做成一次清理，只動一次 schema。

### 3.2 具名 CHECK 有沒有實際用途

**4 個呼叫端的 batch，除了 guard 表，還會寫到帶 CHECK 的表**〔程式〕：

| 呼叫端 | 會寫到的其他 CHECK | 出處 |
|---|---|---|
| activities | `v3_activities.activity_date CHECK(length=10)`、`kind CHECK IN ('kids','adoption')`；管理網站的紀錄會寫 `v3_dog_edit_actors.source CHECK IN ('access','volunteer')` | `compact-schema.sql:233-234,491`；`admin/activities.js:9-10`；`editlog.js:78` |
| identity | `v3_identity_redirects CHECK(volunteer_id <> target_id)`（合併） | `compact-schema.sql:271`；`identity.js:146` |
| dog-edit（dog-list 的 batch） | `v3_dog_numbers.number CHECK(length>0)`、`v3_dogs.fixed_care`、`v3_dog_departures` 的 `json_valid` | `compact-schema.sql:95,98,200,209-210`；dog-list.js 寫這些表 |
| dog-merge | `v3_walk_state`／`v3_dog_numbers`／`v3_photos` 等表的 CHECK，加上 `v3_dog_edit_actors.source` | `compact-schema.sql:8,11,98,475,491`；`dog-merge.js:26-38,133-134` |

**但分辨出來之後，每個呼叫端的處理都一樣**〔程式〕：

| 呼叫端 | 條件沒過 | 其他 CHECK | 有沒有差別 |
|---|---|---|---|
| activities | 409 | 現在任何 CHECK 都回 409（`activities.js:148`）。其他 CHECK 在寫入前已經驗過（`cleanActivity`，`activities.js:25-40`），實際上碰不到 | 沒有。照 Q7「只認條件＋外鍵」，碰不到的 CHECK 會從 409 變成 500，反而是一點行為改變 |
| identity | route 的 catch-all 一律回 409（`index.js:702-704`） | 一樣 409 | 沒有 |
| dog-edit／dog-list | 錯誤沒有 status，回 `ack:false`、「保留待處理」（`dog-list.js:242-243`） | 一樣 | 沒有 |
| dog-merge | 409（`dog-merge.js:141-144`，任何約束） | 一樣 409 | 沒有 |

結論：目前沒有任何呼叫端用得上約束名。真的需要分辨的是 walk-accept 的「預算擋下 vs 其他」（`walk-accept.js:286,309`），那在 #746 之後，等時候到了再加名稱就好（加名稱本來就要 migration，可以跟清理 PR 一起做）。

**靠約束名判斷的風險**：
- SQLite 官方文件**沒有**定義錯誤訊息的格式。結果碼頁只說細節要看 `sqlite3_errmsg()`（https://www.sqlite.org/rescode.html ，SQLITE_CONSTRAINT 一節）。建表文件允許 `CONSTRAINT name CHECK(...)`，但沒說名稱會不會出現在錯誤訊息裡（https://www.sqlite.org/lang_createtable.html ，3.7 與語法圖）。
- SQLite 論壇有人說明訊息語法「不是 API 的一部分」，不應該在程式裡解析（論壇回覆，不是官方文件：https://sqlite.org/forum/info/f3f2e9af2ef374ee ）。搜尋論壇時也看到「沒取名的 CHECK，舊版只印表名、新版印條件式」的說法，但沒有逐篇核對是哪個版本，不當作依據。
- D1 文件只說錯誤時丟 `Error`，要看 `e.message`，範例訊息帶了 SQLite 的文字（`sql error: near "INSERTZ": syntax error`）。但文件**沒有**保證約束錯誤會原樣保留 `CHECK constraint failed: <名稱>`，也沒有約束錯誤的範例（https://developers.cloudflare.com/d1/observability/debug-d1/ ）。**查不到官方說法。**
- 〔本機實測〕node:sqlite 3.53.0 的訊息：具名的是 `CHECK constraint failed: batch_condition`，沒取名的是 `CHECK constraint failed: ok=1`，外鍵是 `FOREIGN KEY constraint failed`，主鍵重複是 `UNIQUE constraint failed: p.id`。測試用的 memoryD1 就是 node:sqlite（`scripts/memory-d1.mjs:3`），**所以測試全過也證明不了正式 D1 的訊息帶著約束名**。
- 退步路徑〔推論〕：如果正式 D1 的訊息沒帶 `batch_condition`，`BatchConflict` 就認不出來。照 Q7，activities 只認「條件或外鍵」，guard 擋下時會變成 500。現在用的寬鬆 regex（`/CHECK constraint|FOREIGN KEY/`）沒有這個風險。真要保留約束名，合併前要在預覽環境（測試庫）實際打一次衝突確認訊息。

### 3.3 `BatchConflict`＋`isConstraintError` 是不是兩個都要

- 依照 3.2 節，每個呼叫端最後要的都是同一個問題：「這是不是可以回 409 的資料衝突？」所以 module 只要 export 一個 `isConflict(e)` 就夠了。regex 照 dog-merge 現在的寬度（`/CHECK|FOREIGN KEY|UNIQUE|constraint/i`，`dog-merge.js:143`）。
- 改成這樣後各呼叫端的行為：
  - **activities**：從「CHECK 或外鍵」放寬成也包含 UNIQUE。activities 的 UNIQUE 只有 `v3_activity_dogs(activity_id, position)` 和隨機 UUID 主鍵，guard 擋住並行修改後碰不到（`compact-schema.sql:239-245`；`activities.js:117,125`）〔推論〕。另外，`activities.test.mjs:108-117` 用 `RAISE(ABORT,'test failure')` 驗證 500，那句訊息不含 constraint，照樣是 500。
  - **dog-merge**：完全不變。
  - **identity、dog-list**：不需要呼叫 `isConflict`，維持原樣。
- 這樣做的效果：分類規則只有一份（module 裡），不用自訂錯誤類別、不用約束名、不用新增 schema。`batchIf` 遇到錯誤原樣丟出，dog-list 拿到的就是現在的錯誤物件（沒有 status），「保留待處理」的行為自然不變。

### 3.4 Q4「再讀一次」有沒有必要

- 現在的寫法：guard 是 `INSERT … SELECT CASE … FROM v3_activities WHERE activity_id=?`（`activities.js:142`）。活動被刪掉時 SELECT 沒有結果，插 0 列，guard 放行；接著 `DELETE` 刪到 0 列，於是 `results[removeAt].meta.changes` 是 0。管理網站因此回 404，志工網站回成功（`activities.js:169-173`）。志工網站成功後，`index.js` 還會再記一筆刪除紀錄（`index.js:313-314`），這是既有的怪行為，這次不用改。
- 換成新 guard 後，列不見會讓條件變成 NULL，整批擋下。只要 batch 跑得完，guard 就保證那一列在同一個交易裡還存在，`DELETE` 一定刪到 1 列。**`removeAt` 和 `meta.changes` 那段會變成死碼，要一起刪掉**〔程式推論〕。
- 「再讀一次」的成本：只在衝突時多跑一次 `readActivity`（一個 batch、兩句，`activities.js:104-110`），平常的路徑不會跑。拿掉它的話，刪除遇到 race 會從「成功／404」變成「409 剛被別人改過」。發生的窗口只有幾毫秒，409 的訊息也說得通。K 選了維持現狀，那就保留，但它不是必要的。
- **Q4 沒有提到的修改 race**：現在修改時活動被刪掉，如果出席名單不是空的，插 `v3_activity_dogs` 會被外鍵擋下，回 409。如果名單是空的，會「成功」：志工網站回 200（`after` 是 null），管理網站因為 `!after` 回 404（`admin/activities.js:27`）。換成新 guard 後，兩種情況都變成 409。這也是一種行為改變（而且算修掉一個小 bug），建議在 PR 寫明，不另外處理。另外，`admin/activities.js:27` 不會變成死碼，因為 batch 之後、讀取之前活動仍然可能被刪掉。

### 3.5 Q8 有沒有必要

- 拿掉薄包裝的話，要改 `dog-list.js` 的兩個呼叫點（`dog-list.js:133,183`，那是壓縮過的長行），還要處理 `expected` 是空值時的分支。留著包裝，`dog-list.js` 完全不用動。
- export「這隻狗還是這個版本」的條件，可以消掉 `dog-merge.js:130` 對 `dog-edit.js:22` 的複製。
- 這兩個 guard 用的是 `EXISTS(…)`，列不見時是 0，不是 NULL，**本來就不會放行**（`dog-edit.js:22`）。所以這部分的收益是去掉重複、每批少寫 2 到 4 列，不是修 bug。
- 判斷：必要性中等，成本很低，不算過度設計。

## 4. 提案漏掉、但驗收或 CI 會要的項目

- **驗收 1 的測試（memoryD1）**：Q1–Q8 沒有列出測試。至少要有：
  - module 本身：成立時寫 0 列；條件是 0、NULL、子查詢沒結果都整批回復；回傳的結果只含呼叫端的句子；條件是空陣列時等同一般 batch。可以照 `walk-accept.test.mjs:123-144` 的寫法。
  - activities：在讀完、送出 batch 之前刪掉活動，確認刪除與修改都被擋下，而且 Q4 的回應跟現在一樣。race 的攔法可以照 `identity.test.mjs:136-145`。
  - identity：刪掉 `v3_identity_revision` 那一列（或讓 revision 變 NULL），確認更名與合併都被擋下。這一列平常一定存在（`compact-schema.sql:293-294`），所以這是驗收要求的理論情況。
- **驗收 3「409 訊息照舊」**：現有測試大多只檢查 status（`activities.test.mjs:66,78`、`identity.test.mjs:46,71,81`、`dog-merge.test.mjs:103,114`），要補上訊息文字的斷言。
- **`worker/test/standards.test.mjs:15,23`**：`DELETE FROM v3_activity_guard`、`DELETE FROM v3_identity_guard` 這兩條例外拿掉後，L41-42 的「例外已經不在程式裡」檢查會失敗，要一起刪掉。
- **`worker/test/identity.test.mjs:140`**：race 是用 `/v3_identity_guard SELECT/` 認出 guard 那句的。SQL 換了之後要改成認新的句子，不然 L145 的斷言會失敗。
- **`worker/test/activities.test.mjs:116`**：檢查 `v3_activity_guard` 是 0 列，換表之後會恆真、沒有意義，要改查實際用的那張表。
- **agent-log**：同一張 PR 要寫一筆紀錄（`AGENTS.md`）。
- **後續票**：walk-accept 的 guard 與兩個 regex、writeBudget、DROP（或改名）舊 guard 表，等 #746 合併後處理。#745 的「錯誤分類只剩一份」要在票上註明「部分完成，剩下的見後續票」。
- **如果保留新表**：migration 編號接 `0018`（目前最新是 `migrations/0017_share_counts.sql`），同時改 `db/compact-schema.sql`，合併後 K 要按「套用 D1 migration」（`data-changes.md:18-24`）。

## 來源

- issue #745 內文（`gh issue view 745 --json body`，2026-10-29 讀取）
- Cloudflare D1 Database API：batch 是 SQL 交易、依序執行、一句失敗整批 abort 或 rollback；沒有寫錯誤訊息格式。https://developers.cloudflare.com/d1/worker-api/d1-database/
- Cloudflare D1 Debug：錯誤看 `e.message`、`D1_ERROR` 等前綴；沒有約束錯誤的範例，也沒說會保留 SQLite 的訊息文字。https://developers.cloudflare.com/d1/observability/debug-d1/
- SQLite CREATE TABLE：CHECK 運算結果是 NULL 不算違反；CHECK 一律 ABORT；語法允許 `CONSTRAINT name`；沒寫錯誤訊息內容。https://www.sqlite.org/lang_createtable.html
- SQLite 結果碼：`SQLITE_CONSTRAINT_CHECK (275)`、`FOREIGNKEY (787)`、`UNIQUE (2067)`；細節要看 errmsg，沒定義格式。https://www.sqlite.org/rescode.html
- SQLite 論壇（非官方文件）：錯誤訊息語法不是 API，不應解析。https://sqlite.org/forum/info/f3f2e9af2ef374ee
- repo 內：`docs/research/2026-10-27-walk-writeback-write-cost.md:117-164`（guard 替代做法、RAISE 要動 schema）、`docs/research/2026-10-24-521-d1-tables-audit.md:48`
