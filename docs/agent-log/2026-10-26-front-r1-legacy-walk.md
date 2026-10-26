# 前端結構整理 R1：刪舊的寫回試算表登記路徑

- 日期：2026-10-26。Agent：Claude（Opus 5.5），由前端架構稽核工作階段交辦；分支 `claude/front-r1-legacy-walk`，基準 main `9360e7f`。
- 依據：2026-10-26 前端稽核 A5；K 在對話中選「1 刪」。背景：`SITE.d1WalkAccept` 自 #533 起為 `true`，後端對沒帶 `requestId` 的舊格式回 410（#558），改回 `false` 會讓登記全壞，舊路徑已不能當退路。
- 做了什麼（志工看到的行為不變，只刪 `d1` 為 false 才會走的分支）：
  - `site-config.js` 刪 `d1WalkAccept`；`walk-registration.js` 只留 D1 接受流程（刪本機寫入紀錄、`receiveNames`、舊批次送出、`canUndo`）；`walk-flow.js` 刪本機已溜／試算表寫入紀錄與 `write()`，提示文字只留 D1 會出現的；`walk-ui.js` 刪只記手機、舊提示條與 `sheetWrite`／`queueSheetWrite`；`app.js` 刪 `walkerDates`、名單核對與相關包裝；`cards.js` 刪讀手機試算表寫入紀錄；`api.js` 的 `todayWalks` 固定讀 `/today?source=d1`。
  - 手機資料鍵 `bq-walked-today`、`bq-sheet-writes` 留在 `store.js`（鍵名表不變），只是不再讀寫。
  - `scripts/adr-index.mjs` 在沒有布林開關時寫「目前沒有」，重新產生 `docs/adr/README.md`。
- 測試：
  - 刪 `scripts/walk-registration.test.mjs`、`scripts/walk-state.test.mjs`（全是舊模式規則；D1 對應在 `walk-accept-client.test.mjs`）、`tests/fixtures/legacy-walk-mode.cjs`。`walk-flow.test.mjs` 改寫成 D1 版。
  - 新增 `tests/fixtures/fake-d1-walks.cjs`（網頁套件共用假 D1）與 `tests/index/harness.js` 的 `fakeD1`、`until`。fixed-care、group-cache、group-walks、startup-stability、walker-editing 改用假 D1。
  - index：刪 13 項舊模式專用（#85 本機已溜 3、#35 本機儲存 2、#138 寫試算表 3、10-17 兩項、10-16、ADR 0007 舊 today、#445 排序；D1 版分別由 walk-feedback、walk-order-undo、walk-accept、walker-editing 涵蓋），其餘改成 D1；264 → 251 項全過。
- 發現、未改（行為問題，留給 K）：D1 模式一開頁讀今日紀錄失敗時，溜狗表停在載入畫面，要等下一次每分鐘重讀成功（#456 起的設計）。startup-stability 原本「今日紀錄失敗仍可看狗」的步驟改成只讓休養與個人紀錄失敗，並在測試註明。
- 環境：本機 PowerShell 5.1 下 `check-local.ps1` 遇到第一行 stderr 就中止，失敗日誌只剩一行；診斷期間暫時把 `run-browser-tests.cjs` 的錯誤改印到 stdout，已還原、未提交。
