# 2026-10-17 按溜了立刻顯示已溜

- Agent：Claude Code（Opus 5.5）
- 做了什麼：`public/js/app.js` 的 `walkThenRecord` 改成按了溜了立刻記成已溜、跳提示條（可復原、＋一起溜的人），背景寫試算表；寫好後提示條補「已寫進試算表」，沒寫進去（網路不通、試算表回錯誤、找不到狗）就退回未溜，網路／錯誤時給「再試一次」。更新 `tests/index.html` 兩項測試。
- 依據：K 2026-10-17 回報按溜了很慢（等 Google Apps Script 回應要好幾秒），決定改成先顯示、失敗再退回，取代 2026-10-08 先等回應的做法。
- 未完成：`walkPending`／「登記中」按鈕已不會出現，相關程式碼（app.js、desk.js、app.css `.walk-btn.pending`）還留著，可另外清掉。尚未 commit／開 PR。
- 2026-10-17 補：分支 `feat/optimistic-walk` 從 main 開。main 的復原已改成等試算表改回才算（#383），這裡的復原沿用 `undoSheetWalks`，背景寫入還沒回來時先等寫完再改回。
- 本機測試：`tests/navigation.cjs` 在 main 上本來就失敗（「只顯示當前群」），跟這次無關；跳過它後主測試頁 258 項、node 287 項全過。
