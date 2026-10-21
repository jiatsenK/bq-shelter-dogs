# 2026-10-21 使用說明從我溜過搬到資訊頁

- Agent：Claude Code。
- 依據：#447（K 2026-10-21 確認方向）：我溜過的「說明」其實是整個網站的使用說明，改名「使用說明」放資訊頁。
- 改動：
  - `public/js/analysis.js`：資訊首頁四類下面加「使用說明」，按了開原本的導覽（`data-open-guide` → `openGuide()`，回溜狗表從第一步看）；文字沿用 #171 的 `TOUR_STEPS`，沒改。不是 `INFO_PAGES` 的子頁，所以「資訊四類」仍是四個 `data-info-page`。
  - `public/js/app.js`：我溜過名字列拿掉「說明」按鈕；名字設定框拿掉「看使用說明」連結（同屬我溜過）。只改註解指向資訊頁。
  - `public/css/app.css`：拿掉只給「看使用說明」用的 `.who-clear.guide-link`。
- 測試：`tests/index.html` 原「我溜過可以再打開說明」改成我溜過沒有使用說明、資訊的使用說明開導覽並離開資訊頁。Node 346/346、網頁 261/261（headless Chromium）。
- 沒改資料、Worker、schema。
