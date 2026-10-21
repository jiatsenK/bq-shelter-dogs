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
- 相關 PR：#451。

## /code-review 後修正（同 PR，依 /implement 流程）
- Spec 審查找到退步：`bqDeal` 開頭清計時，連帶清掉撕包排的「拿掉 tearing」「焦點移到第一張卡」。改成 `bqDeal` 攤開後自己排這兩件事（只限撕卡包來的）；`bqDeal` 回傳進行中的 Promise（`BQ.dealing`），存檔中按跳過會等存好再攤開、聚焦。
- 測試（先紅後綠）：存檔中跳過（PUT 延遲 150ms）、減少動態撕開後焦點與 tearing。網頁 261/261、Node 346/346。
- Standards 審查只有程式碼氣味（重設畫面重複三處、動畫毫秒數與 CSS 各寫一次、`BQ_SAVE_MAX` 與 Worker 50 各寫一次），都是判斷題，這張先不擴大。
- 待 K 確認：一次全開分批存到一半失敗時，前面存好的照樣收進圖鑑（規格沒寫部分成功）。
