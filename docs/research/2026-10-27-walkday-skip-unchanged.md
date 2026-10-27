# 網站登記過的狗，保險掃描重寫一樣的溜狗紀錄：先比對再寫的做法

- 日期：2026-10-27（台灣時間）。Agent：Claude Code 研究代理。
- 問題：D1 讀寫效率稽核第 2 項（`docs/research/2026-10-27-d1-efficiency-audit.md`，`claude/d1-efficiency-audit` 分支）。網站登記 10 隻狗後，狗清單保險掃描約寫 152 列，`v3_walks` 前後內容一樣。
- 範圍：只讀 repo（基準 `6a07475`）。沒有改程式、沒有查正式 D1、沒有部署。10/24–10/26 是測試流量，不當基準。
- 標記：每個主張附程式行號；從程式推得、沒實測的寫【推論】；官方文件行為沒在本機驗證的寫【待驗證】。

## 1. 給 K 的白話結論

- **建議：在 `walkDay` 裡改成「那天的名單跟現在一樣就不寫」。** 改一個函式，網站按溜了和狗清單同步兩條路一起受益，不用改資料表、不用 migration。
- **不建議**讓網站登記順便改 `v3_sheet_main.walked_date`。那張表是「試算表上次長怎樣」的複本，網站去改它會：每次登記都讓在所資料包失效（跟稽核第 1 項反方向）、讓「改回較早日期」的判斷失準、違反 ADR 0018 補充「只在回應時換，不寫任何表」的分界。
- 修完之後，網站登記後的那次掃描仍會送這隻狗過來（試算表指紋本來就會變），但只會更新 `v3_sheet_main` 那一列和指紋，`v3_walks` 不動，溜狗紀錄的資料包也不會因此失效。
- 預期：每隻網站登記過的狗，掃描時約省 15 列寫入【推論，用稽核的 152 列 ÷ 10 隻】；10/27 實際 34 隻狗，一天約省 500 列上下【推論】。免費額度一天 10 萬列，省的是「資料包少失效」比省列數更有感。

## 2. 現在怎麼跑

1. 網站按溜了：`worker/src/walk-accept.js:169-170` 用 `walkDay` 在同一個 batch 寫 `v3_walks`（ADR 0018 補充「溜狗紀錄跟著今日溜狗一起寫」）。`v3_sheet_main` 不動。
2. 背景寫回試算表。這是程式寫入，不觸發編輯觸發器（`apps-script/sheet-write.gs:274`）。
3. 下一次 `dogListScan`（每天 09:43、13:53、23:53，`sheet-write.gs:290`）：GAS 對每列算 `hash(JSON(row))`（`sheet-write.gs:503`，含日期與溜狗人），跟 D1 存的上次指紋比（`FP_KEY`，`dog-list.js` `readFp`）。日期、溜狗人變了 → 指紋不同 → 這列送進 `applyDogListRows`（`dog-list.js:215`）。
4. `applyMain`（`dog-list.js:66`）：`old.walked_date` 還是試算表上次的日期，所以 `date > old.walked_date` 成立（`dog-list.js:96`），再呼叫一次 `walkDay`。
5. `walkDay`（`dog-list.js:55-61`）一律 `DELETE` 那天、再逐人 `INSERT`，不看內容。

所以重寫是兩件事湊起來：`walked_date` 落後（設計上就是這樣），加上 `walkDay` 不比對。

### 每次重寫的副作用

- 寫入列：每列 `v3_walks` 約 4 列（表、主鍵、日期索引、walkpack 觸發器），DELETE 和 INSERT 各算一次（ADR 0018 補充「寫入量」）。
- 資料包：`walkpack_v3_walks_DELETE`／`_INSERT` 觸發器（`db/compact-schema.sql:343-345`）各把 `v3_walk_versions.live` 加一。`packs.js:265` 看到 `live` 變了就重讀今天的紀錄；`packs.js:227` 移切點時也比 `live`，被打斷就重來。
- 另外 `v3_sheet_main` 那句 UPDATE 會讓 small 失效（`compact-schema.sql:400`）——這是稽核第 1 項的範圍，本項不處理。

## 3. 做法比較

### A. 應用層：先讀再決定（稽核原提案）

- `walkDay` 改成 async，先 `SELECT position,walker_code FROM v3_walks WHERE dog_id=? AND walk_date=? ORDER BY position`，跟要寫的 `codes` 比；一樣回 `[]`。
- 成本：每次多一次查詢，走主鍵 `(dog_id,walk_date,position)`（`compact-schema.sql:138-146`），讀幾列等於那天幾個人。
- 正確性：讀和 batch 之間有空檔。`applyMain` 有 `guardedDogBatch` 的 revision 核對（`dog-edit.js:16`），`walk-accept` 有 `v3_walk_guard` 版本核對（`walk-accept.js:173`），但都只守自己那條路；兩條路同時寫同一隻狗同一天時，可能「讀到一樣 → 跳過」後被另一邊改掉【推論，機率很低，結果是少寫一次會被下次掃描補】。
- 呼叫端要改：`walk-accept.js:170` 與 `dog-list.js:96-97,120` 都要 `await`。

### B. SQL 層：在 batch 裡只改不同的

- 用 SQLite UPSERT：`INSERT ... ON CONFLICT(dog_id,walk_date,position) DO UPDATE SET walker_code=excluded.walker_code,... WHERE walker_code IS NOT excluded.walker_code OR ...`，再加一句 `DELETE FROM v3_walks WHERE dog_id=? AND walk_date=? AND position>=?`（人數變少時刪多的）。
- SQLite 規定 DO UPDATE 的 WHERE 不成立時那列不更新（https://www.sqlite.org/lang_upsert.html）；D1 的寫入列數只算實際改到的列（https://developers.cloudflare.com/d1/platform/pricing/）【待驗證：沒在本機確認 no-op UPSERT 的 `rows_written` 是 0】。沒改到就不觸發 UPDATE 觸發器，`live` 不會加。
- 成本：不多一次往返，仍是同步函式，呼叫端不用改；跟其他語句同一個交易，沒有 A 的空檔。
- 注意：walkpack 的 UPDATE 觸發器（`compact-schema.sql:344`）會在名單真的變時觸發，計數方式跟 DELETE＋INSERT 不同但都會讓 `live` 變，資料包照樣失效，結果正確【推論】。

### 建議

**B 優先**：不多查詢、沒有競爭空檔、函式簽名不變。若覺得 UPSERT 太難讀，A 也可以，風險只是極少見的漏寫、會被下一次掃描補。

### C. 網站登記同步改 `v3_sheet_main.walked_date`（不建議）

- 好處：掃描時 `applyMain` 的 `changed` 變空，連 `v3_sheet_main` UPDATE 都省。
- 壞處：
  - 每次網站登記都 UPDATE `v3_sheet_main` → small 失效（`compact-schema.sql:400`），從「一天三次掃描才失效」變成「每次按溜了都失效」，跟稽核第 1 項要的方向相反。
  - `dog-list.js:97` 判斷「改回較早日期」用 `old.walked_date` 當「試算表上次的值」。網站先改了它，人工往回改表時會刪錯那天或刪不到（ADR 0018 補充裡 K 已接受的風險會變大）。
  - ADR 0018 補充「狗清單帶今日溜狗的日期」已決定 `/api/dogs` 回應時才疊今天、不寫表；這個分界要重開討論才能動（鎖定約束）。
  - 寫回失敗或被人工蓋掉時，`v3_sheet_main` 會跟試算表真的不一樣，指紋永遠對不起來【推論】。

## 4. 邊界情況（以 B 為準）

| 情況 | 結果 |
|---|---|
| 同一天再按溜了加人 | 新位置 INSERT，舊位置不動 |
| 改溜狗人、人數變少 | 不同的那幾格 UPDATE，多出的 `position>=n` 刪掉 |
| 名單一樣但順序不同（網站順序 vs 試算表「A、B」） | 位置對不上就改寫；結果正確，只是沒省到。要不要當成集合比，見第 5 節 |
| 復原（`dropDay`，`walk-accept.js:77`） | 不經 `walkDay`，照舊刪 |
| 改回較早日期（`dog-list.js:97`） | 刪新那天照舊；較早那天若內容一樣就不寫 |
| 沒有溜狗人（`codes` 空，寫一列 `null`） | 比對要用 `IS NOT`，`null` 對 `null` 算一樣 |
| 沒設 `WALKER_KEY` | `codes` 空，同上；現況就是這樣 |
| 狗改名、換編號後重寫 | `dog_number`／`dog_name` 也要納入 WHERE；若名單一樣但狗名變了，要不要更新歷史上的狗名見第 5 節（#248 的原意是保留當天的名字） |
| 試算表人工改名單 | 名單不同 → 照常改寫 |
| 日期界線 | 日期字串都是台灣時間 `YYYY-MM-DD`（`sheet-write.gs:506-509`、`walk-accept` 的 `operationDate`），比對不涉時區 |
| 指紋一直不一致（例如同一隻狗在表上兩列） | `walkScanRows` 會排除重複的狗（`sheet-write.gs:494-498`）；其他情況每次掃描都會送，但 B 讓它不再寫 `v3_walks` |
| 併發 | B 在同一 batch（D1 batch 是交易）內判斷，沒有讀寫空檔 |

## 5. 要 K 決定的事

1. 同一份名單、順序不同時，要不要當作「一樣」不寫？（建議：照位置比，簡單；順序不同的情況少）
2. 名單一樣但狗名或編號變了，要不要更新那天紀錄上的狗名？（建議：不更新，符合 #248「我溜過顯示當時的名字」）
3. 實作前先在本機用 `wrangler d1` 確認 no-op UPSERT 的 `rows_written` 是 0；不是的話改走 A。

## 6. 參考

- 程式：`worker/src/dog-list.js:55-61,66-125,215-245`、`worker/src/walk-accept.js:72-77,140-185`、`worker/src/packs.js:221-267`、`db/compact-schema.sql:138-146,343-345,400`、`apps-script/sheet-write.gs:272-290,466-503`、`worker/src/walk-reconcile.js:46-62`。
- 決策：`docs/adr/0018-today-walks-d1-event-sync.md`（第 5 點、兩則 2026-10-26 補充）。
- 前一份研究：`docs/research/2026-10-26-walk-history-source.md`。
- 官方：https://www.sqlite.org/lang_upsert.html 、https://developers.cloudflare.com/d1/platform/pricing/ 。
