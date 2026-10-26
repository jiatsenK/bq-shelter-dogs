# 管理網站網站連結頁、測試網站換裝

- 日期：2026-10-26。Agent：Claude。分支 `claude/admin-site-links`（從 main `f19c844` 開）。
- 依據：K 2026-10-26 對話：「在管理後台加入正式版網址、測試版網址、正式版 GAS 連結、測試版 GAS 連結；測試版的介面改的不同於正式版，手機 ICON 也是；必須要符合設計規範」。
- 管理網站：
  - 側欄「志工網站」組加「網站連結」（`admin/public/links.html`、`js/links.js`），七頁側欄一致。`GET /api/manage/links`（`worker/src/admin/links.js`）回四個網址，只收 https，GAS 只准 `script.google.com`／`docs.google.com`，沒設回 null、畫面寫「還沒設定」與該設哪個 Secret。900px 以下表格改直排。
  - repo 公開（#493），網址不寫進檔案：`deploy-admin.yml` 用 `--var` 帶 `SITE_URL`、`TEST_SITE_URL`（由 `WORKERS_SUBDOMAIN` 組）及 `GAS_URL`、`TEST_GAS_URL`（新 GitHub Secret，沒設就不帶）。`tests/index/hosting.js` 的帶金鑰檢查放行這兩個 Secret 名稱（理由同 WORKERS_SUBDOMAIN：不是金鑰，只是不公開）。
- 測試網站：
  - `wrangler.test-site.jsonc` 加 `SITE_ENV=test`，`run_worker_first` 列每一頁（`/`、`/index.html`、`/groups`、`/cards`、`/edits` 與 .html）。`worker/src/test-site.js` 在送出 HTML 前加 `data-site="test"`、標題「測試｜」、theme-color、主畫面名稱「板收測試版」、換圖示與 `manifest-test.webmanifest`。正式版設定不變。
  - 樣式：`app.css` 檔尾換 `--shell` 系列成測試紫 `#5A2A5E`、標題旁黃底「測試版」；`cards.css` 頁首右上角同一顆標籤；`edits.html` 頁首換紫。groups.html 會直接轉回溜狗表，不另外改。對比都算過（DESIGN_GUIDE「測試網站」段）。
  - 圖示 `public/icons/icon-test.svg` 與 192／512／180 PNG（Playwright 從 SVG 轉，字型用本機微軟正黑體）。
- 測試：`worker/test/test-site.test.mjs`（換裝、每頁都在 run_worker_first、正式版不經過 Worker）、`worker/test/admin.test.mjs`（連結 API）、`tests/test-site.cjs`（390／1440px 兩版頁首顏色、標籤、圖示、不溢出）、`tests/admin-stage4.cjs`（連結頁）。
- 未做／要 K 處理：
  - 在 GitHub 設 Secret `GAS_URL`、`TEST_GAS_URL`（要放 Apps Script 編輯器網址或部署網址都可以，必須是 script.google.com），然後跑一次「部署管理網站」。沒設也能部署，GAS 兩格顯示還沒設定。
  - 測試網站換裝要等合併後 main 推送自動部署（或手動部署這個分支）才看得到；已加到主畫面的舊圖示要刪掉重加才會換。
  - 沒有部署、沒有動正式或測試資料。
- 相關 PR：#649（草稿）。
