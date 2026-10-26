# 前端結構整理 R0：保護網測試

- 日期：2026-10-26。Agent：Claude（Opus 5.5），由前端架構稽核工作階段交辦；分支 `claude/front-r0-guards`，基準 main `9360e7f`。
- 依據：2026-10-26 前端稽核（A3、A10），K 在對話中選定順序 R0 → R1 → R2、R3 → R7，每項一張草稿 PR。
- 做了什麼：
  - 新增 `scripts/feature-setting-keys.test.mjs`：功能開關鍵名逐份比對後端 `SETTING_KEYS`、志工網站、管理網站設定頁、migration 0003 與 `db/compact-schema.sql` 的初始值。志工網站 `feature-settings.js` 的清單改成具名匯出 `SETTING_KEYS`，內容不變。
  - `tests/es-modules.cjs` 失敗時把頁面錯誤放在第一行。
- 稽核原本建議的「循環圈頂層呼叫靜態檢查」沒做：實驗在 `find.js` 頂層加 `esc('x')` 時 es-modules 套件通過（函式宣告已提升，不會出錯）；改成讀 `const AMBER_DAYS` 時套件失敗，但只顯示等不到狗卡逾時。既有套件已能攔下會出錯的情況，所以只改善失敗訊息（現在印出 `Cannot access 'AMBER_DAYS' before initialization`），不另寫靜態分析。
- 稽核的 desk 縮圖回歸測試不用做：#598 已刪電腦版補資料。
- 不改網站行為、不碰 D1。
