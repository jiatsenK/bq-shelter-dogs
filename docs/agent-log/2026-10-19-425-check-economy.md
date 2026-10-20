# 2026-10-19 #425 本機檢核成本

- Agent：CODEX；依據：K 同意 retrospective 修正，Issue #425。
- 新增單套／多套選擇與清單入口，預設仍跑完整網頁測試；CLI 參數錯誤在啟動瀏覽器前失敗。
- 新增 PowerShell 摘要檢核與安靜 CI 等待，完整輸出留本機；新增精簡操作指標，沿用全域規則，不改 Matt 技能。
- 以實際頁面 HTTP 來源／方法測試取代 fetch 次數斷言。驗證與審查結果待補。
- 未改正式資料、部署或網站功能；PR 待建立。
- 驗證完成：CLI 查詢／錯字／空套件／任意路徑兩項測試通過；指定 read-policy,startup-stability 僅跑兩套並通過；PowerShell 失敗 exit=1、語法、CI 等待成功 exit=0 皆確認。完整入口 Node 329/329、網頁 261/261 與互動套件通過，預設 runner 沒有略過任何既有套件。
- 依 docs/agents/agent-split.md 的腳本／文件／測試風險分級，在本對話分別對照 Standards 與 Spec：均無待修項目；未另開審查代理。只有 app.js 的脆弱 fetch 次數／形狀檢查由 HTTP 行為檢查取代，其他模組原斷言保留。
