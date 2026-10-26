# #597 舊版網頁直寫試算表入口退場

- 日期：2026-10-26。Agent：Claude（Opus 5.5）；分支 `claude/597-legacy-sheet-write-8da4c6`，基準 origin/main `2feead4`。由主工作階段交辦。
- 依據：[#597](https://github.com/jiatsenK/bq-shelter-dogs/issues/597)；K 2026-10-26 決定「不觀察，直接關」，只做一步，不先加計數或日誌。前置 #592 已由 PR #607 完成。
- 變更：
  - `apps-script/sheet-write.gs`：`handleRequest` 收到 `walk`／`edit`／`undo` 在拿鎖、開試算表之前就回 `{ ok: false, error: '已使用新登記流程，請重新整理網頁' }`，不改表、不問 Worker。`planSheetWrites` 只剩 `note`／`log`（備註、異動紀錄仍在用，不能整支刪），刪掉 walk／edit／undo 分支與只為它存在的 `serializeCell`、`namesIn`、`NAME_SEP`；寫格子不再處理 `date` 格式（只追加只有 `value`）。
  - `worker/src/index.js`：刪 `/walk-writeback/legacy-check` 路徑與處理分支。
  - `worker/src/sheet-write.js`：`SHEET_ACTIONS` 拿掉 `walk`／`edit`／`undo`（`/api/walk` 從 #558 起對這三個動作只走 D1 或回 410，Worker 不會再送給小程式）。
  - 文件：`docs/ARCHITECTURE_NOW.md` 已退役清單加一條；`docs/setup/SHEET_WRITE_SETUP.md` 開頭補現行流程、#141 節標成歷史、新增「#597 舊直寫入口退場」手動步驟。
- 不碰：`walkWake`、`walkWakeBatch`、`walkScan`、編輯觸發（`rows`、`dog-list`）、`dogListScan`、`observe`、`target`、`receipt`。
- 測試：`worker/test/sheet-write.test.mjs` 舊直寫測試改成「三個舊動作有沒有金鑰、有沒有設 `WALK_WORKER_URL` 都回請重新整理，不開表、不寫格子、不連 Worker」；金鑰測試改用 `log`；`worker/test/sheet-call.test.mjs` 改用 `log`，並確認 `callSheet` 拒絕舊動作。
- 本機檢查：`check-local.ps1` 這次因為要帶 `-ExecutionPolicy Bypass` 被權限擋下，改直接 `node --test` 跑相關檔與全部 Node 測試（排除本機已知會失敗的 `scripts/local-check.test.mjs`）；網頁（Playwright）測試沒跑，這次沒改前端。
- 未做（要 K）：GAS 手動貼上新版、重新部署、試算表改一格確認編輯觸發仍送進 D1（步驟在 `SHEET_WRITE_SETUP.md`「#597 舊直寫入口退場」）。沒有推送、沒開 PR。
- 兩軸審查（code-review）：Spec 沒有實質錯誤；處理了過時註解（`worker/src/sheet-read.js` 的 GAS NAME_SEP 比對、`worker/src/index.js` `/walk` 段落開頭）、稽核補充留言要 K 同一次確認舊 `notifyWorker` 觸發器（寫進手動步驟第 3 步）、測試 helper 改名 `runHandle`。留著沒改：`planSheetWrites` 只剩找表頭再轉 `planAppend`（測試靠它驗表頭，名字保留）；舊動作回應不帶 `code`（規格沒要求）。
- 最終 Node 測試：`node --experimental-vm-modules --test --test-concurrency=1` 跑 `scripts/`、`worker/` 全部 `*.test.mjs`（排除 `scripts/local-check.test.mjs`），457 項全過。第一次平行跑時 `scripts/admin-stage4.test.mjs` 因為 Windows EBUSY 鎖檔失敗一次，單獨跑和序列跑都通過。
