# 管理網站網站連結頁加試算表連結

- 日期：2026-10-27。Agent：Claude。分支 `claude/admin-sheet-links`（從 main `3bf1be4` 開）。
- 依據：K 2026-10-27 對話：「管理網站在網址連結那邊也要幫我放上正式版試算表連結跟測試版試算表連結」。
- 做法（沿用 #649）：
  - 網站連結表多一欄「試算表」，放在志工網站和 Apps Script 中間（`admin/public/links.html`、`js/links.js`）。
  - `GET /api/manage/links` 多回 `sheet`、`testSheet`（`worker/src/admin/links.js`），只收 https 且主機是 `docs.google.com`，沒設回 null、畫面寫「還沒設定」與該設哪個 Secret。
  - repo 公開，試算表網址不寫進檔案：`deploy-admin.yml` 從新 GitHub Secret `SHEET_URL`、`TEST_SHEET_URL` 用 `--var` 帶入，沒設就不帶。`tests/index/hosting.js` 放行這兩個 Secret 名稱（不是金鑰）。
  - 文件：`admin/README.md`、`docs/design/admin.md`。
- 測試：`scripts/check-local.ps1 -NodeTest worker/test/admin.test.mjs -Suite admin-stage4,index` 全過。
- 要 K 處理：在 GitHub 設 Secret `SHEET_URL`（正式試算表網址）、`TEST_SHEET_URL`（測試試算表 BENCH441 網址），合併後跑一次「部署管理網站」。沒設也能部署，兩格顯示還沒設定。
- 沒有部署、沒有動正式或測試資料。
