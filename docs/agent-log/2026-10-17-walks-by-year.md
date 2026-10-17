# 2026-10-17 按年拿溜狗紀錄（#346）

- Agent：Claude Code（Opus 5.5）
- 依據：#346（父票 #343）、ADR 0013

## 做了什麼

- `worker/src/packs.js`：新增 `readWalksYear`（只補那一年的月份，只讀版本號和那一年的資料包）和 `yearVersions`（每年的版本號＝那年各月版本號加總；切點那年起再帶切點和 live）。`/api/walks` 多回 `years`。
- `worker/src/index.js`：`GET /api/walks?year=YYYY&v=版本號`，形狀同 `/api/walks`（多 `year`、`ver`）。`v` 對得上才回 `Cache-Control: public, max-age=31536000, immutable`，不然 `no-store`。
- `public/js/app.js`：我溜過月曆翻到上個月 1 號以前、那一年還沒拿過，才拿 `api/walks?year=` 併進來（近期範圍以內以 `api/walks` 為準）。還有沒拿的年份時，可以翻到那年 1 月。
- 測試：`worker/test/packs.test.mjs`（形狀、版本號、快取標頭、讀取列數）、`tests/index.html`（翻月、跨年、只拿一次）。

## 未完成

- 預設 `/api/walks` 還是回全部（縮小是 #347），所以目前拿年份是重複的資料，結果不變。
