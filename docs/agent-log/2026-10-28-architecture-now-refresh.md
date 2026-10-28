# 架構圖與 ARCHITECTURE_NOW 核對更新

- 日期：2026-10-28。Agent：Claude Code。
- 依據：K 在對話中要求畫 bq-shelter-dogs 架構圖、核對資料流向與整個架構，並更新 `docs/ARCHITECTURE_NOW.md`。無對應 Issue。
- 做了什麼：
  - 新增 `docs/research/2026-10-28-architecture-data-flow.md`：以程式碼（main `c2da5f0`）逐項核對架構、各類資料流向、四個 Worker／workflow／排程，附檔案行號。
  - 新增 `docs/diagrams/architecture.html`（系統架構）與 `docs/diagrams/environments.html`（環境與部署），用 diagram-design 外掛產生的單檔 HTML／SVG。
  - `docs/ARCHITECTURE_NOW.md`：最後核對改到 `c2da5f0`；migration 不再寫死正式庫版本，改指向檢查指令；功能開關十項改九項；補上備註／異動紀錄直寫試算表的例外；補上 seed 會覆蓋測試網站資料；加架構圖連結。
  - `.impeccable/config.json`：對兩張圖檔限定範圍忽略 `tiny-text`、`overused-font`（diagram-design 規定的字型與 7–9px 標籤）。
- 未做：研究報告第 5 節另列的 `wrangler.jsonc:14`、`.github/workflows/tests.yml:10` 過期註解，與本機殘留的 `wrangler.deploy.json`／`wrangler.preview.json`，不在本次範圍。
- 驗證：僅文件與靜態圖檔；diagram-design `self_check.py` 兩張圖通過，Playwright 截圖目視確認版面；跑 `check-local.ps1` 結果見 PR。
- 相關 PR：見本分支 PR。
