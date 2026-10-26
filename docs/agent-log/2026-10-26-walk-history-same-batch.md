# 稽核第 4 項：網站按溜了同一批寫進溜狗紀錄

- 日期：2026-10-26。Agent：Claude（Opus 5.5）；分支 `claude/determined-archimedes-03a127`，基準 origin/main `95e533f`。由架構稽核主工作階段交辦（稽核第 4 項：溜狗歷史實際上仍以試算表為正本）。
- 依據：K 2026-10-26 在本工作階段討論後決定「要改」；漏記、刪錯天的風險 K 判斷很低，不另處理。研究 `docs/research/2026-10-26-walk-history-source.md`（背景研究員，方案 B）；這次只做 B 的一部分：寫入點同批寫，狗清單同步不改。
- 變更：
  - `worker/src/walk-accept.js`：`acceptWalk` 在接受的同一個 batch 裡改 `v3_walks`：溜了／改溜狗人照名單重寫今天，復原刪掉今天；預留量加 4×（今天原本人數＋新人數）。新增 `droppedDay`：日期改回較早時刪掉原本較新那天，清空不刪；`compareTrustedWalk`（人工改表 `/rows`）用它。
  - `worker/src/walk-reconcile.js`：保險掃描收下人工值（`reconcileWalkSnapshot`）也用 `droppedDay`。
  - `worker/src/dog-list.js`：`walkDay` 改成 export 共用，行為不變。
  - 不用 migration，前端不改。
  - 文件：ADR 0018 加補充；`docs/ARCHITECTURE_NOW.md` 表格加溜狗紀錄一列。
- 測試：新增 `worker/test/walk-history.test.mjs`（溜了馬上進、第二人重寫、live 版本號跳、復原只刪今天、改溜狗人、寫入失敗整批回復、人工改回較早刪今天、清空不刪）。
- 未做：正式 D1 唯讀查有沒有已經漏記的日子（要 K 同意）；保險掃描時段錯開（K 沒決定）；前端 `cards.js` 的 `bqTodayWrites` 沒動。
- 相關 PR：[#613](https://github.com/jiatsenK/bq-shelter-dogs/pull/613)，草稿。
- 上線後：已經登記但還沒進溜狗紀錄的，下一次狗清單保險掃描會照表補，不用手動。
