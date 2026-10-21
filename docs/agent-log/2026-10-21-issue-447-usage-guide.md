# 2026-10-21 使用說明從我溜過搬到資訊頁

- Agent：Claude Code。
- 依據：#447（K 2026-10-21 確認方向）：我溜過的「說明」其實是整個網站的使用說明，改名「使用說明」放資訊頁。
- 改動：
  - `public/js/analysis.js`：資訊首頁四類下面加「使用說明」，按了開原本的導覽（`data-open-guide` → `openGuide()`，回溜狗表從第一步看）；文字沿用 #171 的 `TOUR_STEPS`，沒改。不是 `INFO_PAGES` 的子頁，所以「資訊四類」仍是四個 `data-info-page`。
  - `public/js/app.js`：我溜過名字列拿掉「說明」按鈕；名字設定框拿掉「看使用說明」連結（同屬我溜過）。只改註解指向資訊頁。
  - `public/css/app.css`：拿掉只給「看使用說明」用的 `.who-clear.guide-link`。
- 測試：`tests/index.html` 原「我溜過可以再打開說明」改成我溜過沒有使用說明、資訊的使用說明開導覽並離開資訊頁。Node 346/346、網頁 261/261（headless Chromium）。
- 沒改資料、Worker、schema。
- 相關 PR：#449。

## 併入本機進度（同 PR）
- K 本機中斷前的 WIP 在 `origin/local/unruffled-chaplygin`（426cae5），比對後只併入 `tests/info-page.cjs` 的實機檢查：我溜過沒有使用說明、資訊頁按使用說明回溜狗表開導覽。其餘是措辭差異；本機版 app.css 留了一行沒有規則的孤兒註解，不採用。沒對 local/ 分支推送。
- 補驗：舊程式跑新測試會失敗（紅），新程式通過。/code-review 兩軸沒有要修的項目。
- info-page、index 套件重跑通過。
