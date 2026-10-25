# #568 管理網站 5：清理重複介面

- 日期：2026-10-26。Agent：Claude（Opus 5.5），由 #562 協調工作階段交辦；分支 `claude/568-admin-cleanup`，基準 main `0fadda8`。
- 依據：#568、#562、ADR 0020（草稿 PR #584）。先在 #568 貼清理對照表（10 項：功能、資料來源、入口、權限、刪／留與理由），K 在對話中同意「刪電腦版補資料，其他照表保留」後才動手。
- 做了什麼：刪電腦版溜狗表「補資料」分頁（`desk.js` 補資料程式約 260 行、`app.css` 的 `.desk-fill`／`.df-*`），用途由管理網站狗資料頁＋資料檢查頁取代；原本這個分頁沒看 `editIntro`／`editPhoto` 開關。志工照片、介紹仍在詳細資訊改（依開關）。程式註解與文件的「任何人都能改」「不做管理後台」改成依志工編輯開關、管理站另有 Access。
- 保留：活動紀錄、資料檢查、更新紀錄（含 `edits.html`）交給三項顯示開關；七項志工編輯入口；志工 API、同步、狗群只讀。沒有 migration、沒有新請求或 Cron。
- 避開 #584：ADR、`docs/ARCHITECTURE_NOW.md`、`admin/README.md`、`docs/design/admin.md` 不改。#584 的 PROJECT_GOALS 最新段寫「待做 #568」，兩張合併後要更新。
- 測試：先紅後綠（`tests/index/desk.js` 改成只有全表／最近 30 天、`desk.js` 只呼叫 `BQApi.walks`）。全部 25 個網頁套件通過（index 264 項）。`-Full`：本機沒有 `pwsh`，設 `BQ_CHECK_PWSH` 為 Windows PowerShell 後 Node 462／464，失敗的是 `local-check.test.mjs` 的 5.1 中文輸出亂碼（#567 已記，與本票無關），以及 `scripts/admin-stage4.test.mjs` 檔案層級失敗；後者單獨跑 4／4 通過、前一次 `-Full` 也通過，推測是與其他測試同時產生 `admin/public/shared/` 的偶發競爭，未在本票處理。`-Full` 因 Node 失敗停在網頁前，網頁另以 `-Suite` 全跑。impeccable detect 只剩既有 layout-transition（app.css 1676 行）。
- 未做：合併、部署、正式 D1 查詢或寫入。志工 Worker 合併後由 main 自動部署；管理站本票未改，不需重新部署。
