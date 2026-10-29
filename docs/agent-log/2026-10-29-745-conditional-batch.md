# #745 樂觀鎖 guard 收成一個有條件 batch

- 日期：2026-10-29（台灣時間）。Agent：Claude Code（由架構檢視 session 分派）。
- 依據：Issue #745；K 2026-10-29 逐題確認做法（Q1–Q8），再依設計檢查 `docs/research/2026-10-29-745-conditional-batch-design-check.md` 縮減 Q3、Q4、Q7。
- 相關 PR：#751（分支 `claude/conditional-batch-745-dd97f0`）。

## 做了什麼

- 新增 `worker/src/conditional-batch.js`：`batchIf(db, [{ sql, args }], statements)` 條件算出 1 才整批寫，0、NULL、資料列不見都擋（`IS NOT 1`，同 walk-accept.js 的 guard，#681）；回傳只有呼叫端那幾句。`isConflict(e, { unique })` 是唯一一份「約束擋下＝衝突」判斷：只認 `CHECK constraint failed`、`FOREIGN KEY constraint failed`，`unique: true` 時加上 `UNIQUE constraint failed`（只有 dog-merge 用，原本就把主鍵撞到當衝突）。
- 暫用 `v3_walk_guard`，不寫 migration（K 選；新表與具名 CHECK 研究認為多餘，D1 也沒保證錯誤訊息帶約束名）。
- 改用的呼叫端：
  - `activities.js`：修改、刪除。讀完後活動被刪，修改一律 409「這場活動剛被別人改過」（以前沒狗的修改會回 200 並多一筆紀錄）；刪除再讀一次，管理網站 404、志工網站照舊回成功。拿掉已成死碼的 `meta.changes` 檢查。
  - `identity.js`：更名、合併改成 `(SELECT revision … WHERE id=1)=?`，版本列不見也擋；route 原本就把錯誤回 409。
  - `dog-edit.js`：`guardedDogBatch` 變成薄包裝，新增 `dogRevisionIs`；dog-list.js 不改（guard 擋下照舊當保留待處理）。
  - `dog-merge.js`：合併、取消合併共用 `dogRevisionIs`。
- 每個 batch 少寫 2 列（不插 guard、不清 guard）。
- 測試：`worker/test/conditional-batch.test.mjs`（成立、不成立、NULL、缺列、結果切片、外鍵算衝突、其他錯誤不算）；activities、identity 各加一個「讀完後資料列不見」的 race 測試（對舊程式會失敗）。`standards.test.mjs` 拿掉兩條已不存在的例外；`dog-merge.test.mjs` 的整張掃檢查略過 guard 的 `SCAN CONSTANT ROW`。
- `db/compact-schema.sql` 只改註解；`docs/operations/dog-editing.md` 跟著改；`docs/ARCHITECTURE.md` 把 conditional-batch.js 列進元件圖的「沒畫」，重對 dog-edit.js、identity.js 的行號，核對日改 10/29。
- 驗證：`check-local.ps1 -Full` 通過（Node＋網頁測試）。第一次跑失敗兩項：架構圖沒列新檔（已補）；`diagram-reminder.test.mjs` 因本機 worktree 的 `docs/ARCHITECTURE.md` 是 CRLF 而對不到標題，檔案重寫成 LF 後通過，跟本次改動無關。

## 例外與未完成

- 驗收「錯誤分類只剩一份」只做到一部分：`walk-accept.js` 的兩個 `CHECK constraint` regex 不能動（#746 正在搬今日溜狗紀錄），等 #746 合併後再收，寫入預算也那時改成條件；接在 #747 做（已在 #747 留言）。
- `v3_activity_guard`、`v3_identity_guard`、`v3_dog_edit_guard` 已不用，連同把 `v3_walk_guard` 改成通用名稱，等 #746 合併後接在 #747 做（先加後刪）。

## 第二次推送（#751 code review）

- 衝突判斷收窄（見上）：以前寫的 `/CHECK|FOREIGN KEY|UNIQUE|constraint/i` 會把 NOT NULL、訊息剛好有 check 的程式錯誤當成 409。activities 回到只認 CHECK、外鍵（UNIQUE、NOT NULL 照舊 500）；dog-merge 保留 UNIQUE，NOT NULL 改回 500（註解寫的本來就只有版本、外鍵、主鍵撞到）。
- 測試：module 測 NOT NULL 不算衝突、UNIQUE 要指定才算；identity 的 race 測試涵蓋更名、合併，各測版本列不見與版本是 NULL（正式表 NOT NULL，測試換成允許 NULL 的表模擬），只在送出有條件的 batch 前插進 race（以前插在第一個 batch，可能在讀取時就出錯而誤判通過）；activities 的 race 改認 `IS NOT 1`，不綁表名。activities 的條件是 `EXISTS(…)`，算不出 NULL，不另外測。
- `check` 改名 `conditionGuard`。
- 判斷題沒改的：activities 的 `batchUnlessChanged` 與 dog-merge 的 `runBatch` 各自轉成不同錯誤與訊息，收進 module 要多一個回呼參數，兩處不值得；`guardedDogBatch` 薄包裝是 K 確認的 Q8（dog-list 不改）；activities 的 audit 仍帶 `unchangedWhen`，跟 guard 重複但無害，改要動管理網站的 audit 介面，超出範圍。
- 驗證：`check-local.ps1 -Full` 597 項只有 `walk-edit-rows.test.mjs` 的「#500 保險掃描…只多記一列跑完時間」失敗（43≠42）；同一個測試在 origin/main（`88ae189`）也失敗，跟本次無關，看起來跟執行時間有關（10/29 17:00 後才出現，上一次 -Full 通過）。
