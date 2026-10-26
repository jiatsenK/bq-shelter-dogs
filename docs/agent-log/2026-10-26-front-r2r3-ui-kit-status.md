# 前端結構整理 R2＋R3：抽 ui-kit.js、dog-status.js

- 日期：2026-10-26。Agent：Claude（Opus 5.5），由前端架構稽核工作階段交辦；分支 `claude/front-r2r3-ui-kit-status`，疊在 R1（#607）上。
- 依據：2026-10-26 前端稽核 A1、A2；K 在對話中選定順序 R0 → R2、R3 → R7（R1 先刪）。
- 做了什麼（網站行為不變，函式內容原樣搬移）：
  - 新增 `public/js/ui-kit.js`：`esc`、`icon`、`highlightNote`、`monthDay`、`pad2`、`isoDay`、`ymdText`、`searchKey`、`matchesSearch`。
  - 新增 `public/js/dog-status.js`：`AMBER_DAYS`、`RED_DAYS`、`SPECIAL_KEYWORDS`、`walkKey`、`specialFlag`，以及改成參數帶入狀態的 `restFrom`、`dogStatus`、`sortDue`。`app.js` 的 `computeStatus`、`dueDogs`、`restOf` 保留原簽名，帶入 `walkRegistration.state` 與 `appState.restMap`。
  - 10 個功能模組改成直接從新檔匯入，向 `app.js` 拿的名稱從 130 個減為 93 個；循環引用還在（仍要 `render`、`showDetail` 等），沒有宣稱已拆圈。
  - `app.js` 不再匯入 `SITE`；`tests/index/desk.js` 的設定集中檢查改成要求主頁從 `dog-status.js` 取門檻與警示字。`tests/fixtures/module-globals.js` 加入兩個新模組。
- 測試：新增 `scripts/dog-status.test.mjs`（8 項：色標門檻、休養／固定照顧／自己登記的優先順序、休養日期、排序、walkKey、警示字、跳脫與搜尋）。網頁 25 套全過（index 251 項）；`-Full` 的 Node 只剩既有 `local-check.test.mjs` 5.1 亂碼與 `admin-stage4` 偶發（單獨重跑通過）。
- 草稿 PR #608（目標分支 claude/front-r1-legacy-walk，#607 合併後改回 main）。
