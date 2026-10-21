# 2026-10-21 #421 更新紀錄快取研究

- Agent：Claude；依據：Issue #421，K 問「其他 App 都不需要每次讀」。
- 做了什麼：只讀研究，比對 PR #452（`origin/claude/421-update-cache`，記憶體）與 `origin/local/421`（localStorage），整理 SWR／ETag／Service Worker／localStorage／增量／邊緣快取的一手來源，估 `readEdits` D1 讀取列數。結果在 `docs/research/2026-10-21-421-updates-cache-prior-art.md`。
- 主要發現：`/api/edits` 每次讀 200 列且回 `no-store`；網站更新是靜態檔、D1 0 列。localStorage 版會違反 #59「分析程式只讀」測試，也與 #419 相反。建議合記憶體版，另開票做 `/api/edits` ETag／304（沒變約 1 列）。
- 未完成／待 K 決定：是否需要「重開不等就顯示」（需放寬 #59）、是否接受邊緣快取的延遲。
- 無程式變更、無 D1 寫入、未 commit／push；無相關 PR（研究筆記）。
