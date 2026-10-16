# 2026-10-16 /api/today 改看版本號（#314）

- Agent：Claude Code（Opus 5.5）
- 依據：#314、ADR 0009（取代 ADR 0007 的 15 秒快取）
- 做了什麼：
  - `db/compact-schema.sql` 新增 `v3_data_versions`（一列，`today` 欄）和 `v3_today_walks` 的新增／修改／刪除觸發器，同步補建時一起建。
  - `worker/src/today.js`：讀取先讀 1 列版本號，版本號和日期沒變就回記憶體快取；拿掉 15 秒快取與寫入時清快取。
  - `worker/test/fakes.mjs` 的 `fakeD1` 加 `stats.rowsRead`；`worker/test/today.test.mjs` 加讀取量、別台寫入、跨日、讀不到版本號的測試。
- 未完成：網頁測試本機沒有 Playwright Chromium，沒跑（前端沒改，交給 CI）。
- 相關 PR：待開
