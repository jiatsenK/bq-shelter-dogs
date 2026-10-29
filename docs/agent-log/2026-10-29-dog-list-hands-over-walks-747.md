# 2026-10-29 狗清單同步交出溜狗欄（#747，含 #745 收尾）

- Agent：Claude Code（Opus 5.5），分支 `claude/zealous-austin-77bd66`
- 依據：#747（K 2026-10-29 定案；三張票的第 2 張，接在 #746 之後、#748 之前）、#747 留言（接手 #745 剩下的收尾）

## 做了什麼

- 狗清單同步（`worker/src/dog-list.js` 的 `applyMain`）發現溜狗欄（日期或溜狗人，照代號比）變了，在更新主清單複本之前把表上的值當成改表觀測值交給今日溜狗紀錄 module（`observe`）。沒收下且沒記進待處理就丟錯、這列不 ack；記進待處理（ack）照常更新複本與其他欄。
- `dog-list.js` 不再寫 `v3_walks`、不記溜狗類修改紀錄：`walkDay` 搬進 `today-walks/version.js`；新建進主清單的狗（新狗、回所）與同一次才補編號的狗走 module 的 `listed()`（那天還沒有才寫、不記修改紀錄，敘述放進建狗那一批）；補編號時溜狗紀錄跟著補編號那句走 `numbered()`。
- module 接手人工改到新的一天：`observe.js` 的 `sheetWalks` 照收下的名單重寫那天；改回較早一天刪較新那天、那天照名單寫；清空不刪。收下的值跟目前一樣就不動。`writeVersion` 的溜狗紀錄參數改成 `walks: { rewrite, drop, codes }`，兩天都照實際列數算預算並加條件。
- 拿掉 `listWalkLog`（observe.js、index.js）與 `sheetWalkLog` 的 `when`、compare 裡的主清單條件與互相讓的註解。修改紀錄照拆開的名字比（`sameNames`，#707 同一套），表上只改分隔符號不記。
- #745 收尾：今日溜狗紀錄的 guard 全改成 `batchIf` 的條件（`shared.js` 的 `guard` 換成 `when`），寫入預算 `reserve` 回 `{ conditions, statements }`、新增 `budgetedBatch`；`transitionBudget` 改成回列數的 `transitionCost`；`dispatch.js` 兩處 `/CHECK constraint/` 改用 `isConflict`。
- D1：`migrations/0018_batch_guard.sql` 加 `v3_batch_guard`（有條件 batch 改用它）；`migrations/0019_drop_unused_guards.sql` DROP `v3_activity_guard`、`v3_identity_guard`、`v3_dog_edit_guard`（#751 已在 10/29 09:44 部署，正式環境沒在用）。`db/compact-schema.sql` 同步。`v3_walk_guard` 留著，下一張 PR 刪。
- 測試：新增 `worker/test/dog-list-walks.test.mjs`（狗清單先到、改表通知先到、改回較早一天與清空、網站登記過的狗、同時到被版本擋下不 ack、新建的狗）；`standards.test.mjs` 擋 `dog-list.js` 寫 `v3_walks`、用 `walkDay`／`listWalkLog`、記 `kind: 'walk'`；`walk-accept.test.mjs` 的 #681 測試改成檢查 today-walks 不自己寫 guard 表、不自己判斷 constraint；`walk-log.test.mjs` 同時到那條改成晚的不 ack、補送一樣；預算測試換成 `listed()`、補「人工改到新的一天」。
- 文件：ADR 0018 補充段、ADR 0004 #700 例外標註已拿掉、`ARCHITECTURE_NOW.md`（溜狗紀錄寫入點、人工改溜狗欄的先後）、`ARCHITECTURE.md`（元件圖拿掉「今日溜狗紀錄 → 狗清單同步」、行號、核對日）。

## 例外與要注意的

- **K 合併後要做**：到 Actions 按「套用 D1 migration」（有 DROP，會先複製到備用庫）。沒套之前部署會被擋（新程式要 `v3_batch_guard`）。
- `D1_WALK_NOTIFY` 仍只管 `/rows`，狗清單同步交的觀測值不看它（狗清單已不寫溜狗紀錄，擋了就沒人寫）；正式環境一直是 `1`。寫在 ADR 0018 補充。
- 查詢次數：GAS 先送 `/rows` 再送 `/dog-list`，通常狗清單交來時已一樣，只多 1 次往返；狗清單先到時每隻約 10 次。超過每次呼叫 50 次查詢上限的那幾列會 D1 失敗、不 ack，GAS 補送時前面收過的就一樣。沒有另加每批上限（`DOG_LIST_ROWS_MAX` 改了會讓 GAS 那邊 400）。
- 同一次才補編號又改了溜狗欄的狗，主清單複本還找不到新編號、交不了觀測值，走 `listed()`（那天還沒有才寫、不記修改紀錄），跟 #747 前不完全一樣（以前會照表重寫、改回較早刪較新那天）。很少見，先不另處理。
- `dog-list-walks.test.mjs` 打 `/rows` 要 `D1_WALK_NOTIFY: '1'`，fixture 沒設，測試裡自己加。

## 相關 PR

- https://github.com/jiatsenK/bq-shelter-dogs/pull/763
