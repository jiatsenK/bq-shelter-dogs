# 2026-10-21 開卡一次全開、跳過動畫

- Agent：Claude Code。
- 依據：#272（K：圖鑑開卡每次五張慢慢開，希望一次全開或跳過動畫）。
- 改動：
  - `public/js/cards.js`：`bqDeal({ all, instant })`；一次全開時把待開的全部存進 D1，超過後台上限 50 張就分批（`BQ_SAVE_MAX`），中途失敗時前面存好的照樣收進圖鑑、其餘留待開。動畫計時改由 `bqLater`／`bqClearTimers` 管，`bqSkip` 取消計時、直接攤開；還沒開始存的這時才存。扇形張數多時限制旋轉、下沉。
  - `public/cards.html`：卡包畫面加「跳過動畫」「一次全開」兩顆外框鈕。
  - `public/css/cards.css`：`.animating` 才顯示跳過、`.instant` 取消過場。
  - 文件：`docs/PROJECT_GOALS.md` 圖鑑版面段、`docs/design/cards.md` 按鈕與動作。
- 測試（先紅後綠）：`tests/index.html` 圖鑑完整流程加一次全開（7 張）、跳過動畫（存 5 張、卡片在扇形位置、無過場）、55 張分批存（50＋5）。
- 寫入預算：一次全開每 50 張一次 PUT（原本每 5 張一次），總列數不變；沒改 schema、Worker、同步、GAS。
- 未完成：無。全域規則檔 `C:/Users/User/repos/agent-hub/CORE_RULES.md` 雲端環境讀不到，依本 repo 文件進行。
