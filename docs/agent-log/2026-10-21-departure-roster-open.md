# 2026-10-21 離所名冊預設展開（#446）

- Agent：Claude Code。
- 依據：#446，K 10/21 triage 確認：離所統計是專屬頁面，名冊不該要再點開。
- 改動：`public/js/analysis.js` 名冊狀態改由 `depRosterDefault()` 產生，預設 `open: true`；收起按鈕與點年份直條行為不變。
- 測試：`tests/index.html` #163 那項先確認預設展開，再測收起時按鈕文字與展開時「收起離所名冊」。
- 驗證：Node 346/346、網頁 261/261（headless Chromium）。
