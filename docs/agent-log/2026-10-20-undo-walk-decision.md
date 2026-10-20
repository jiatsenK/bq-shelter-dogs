# 2026-10-20 撤銷溜了的決策（grilling）

- Agent：Claude Code。
- 依據：K 回報老大溜狗人只有「K」卻沒有 ×、按錯改不回來；經 /ask-matt → grilling 逐題確認。
- 查到原因：× 需要按「溜了」那個瀏覽器存的復原證據（#141、#397 設計），換裝置就沒有，與 K 原意不同。
- 決定：新增 `docs/adr/0016-undo-walk-from-server-history.md`，GLOSSARY「復原」補一句。只寫文件，未改程式、資料。
- 同日 K 改第四題：撤銷只限今天（原為 3 天內），ADR 0016、GLOSSARY 已改。

## 實作（同分支，K 同意 /implement）
- Worker（`worker/src/index.js`、`today.js` 的 `previousWalk`）：`/walk` 的 undo 沒帶 prev 時要有 walker（編輯者）、名單只能一個名字；從 `v3_walks` 找今天以前最後一次帶給小程式，結果回傳 `prev`；找不到這隻狗回 notFound 不送小程式。撤銷都記編輯紀錄 `walkundo`（`editlog.js`、`edits.js` 顯示「撤銷溜了」）。Apps Script 不用改：本來就核對今天且名單相同才寫回。
- 網頁：`walk-registration.js` 加 `canRevert`、`undo(dogs, { revert })`，undo 送出帶 walker；`app.js` 詳細資訊只剩一個名字時任何人都有 ×，沒本機證據就走伺服器撤銷。狗卡與狗群的「已溜」不變。
- 測試（先紅後綠）：`worker/test/undo-revert.test.mjs` 4 項、`scripts/walk-registration.test.mjs` 3 項；`tests/index.html` 原「別人唯一的登記不給 ×」改成 ADR 0016 行為，#138 復原送出加 walker；`walk-state.test.mjs` 形狀加 canRevert。
- 寫入預算：每次撤銷多 1 列編輯紀錄；讀取約 3～25 列。沒改 schema、同步、GAS。
- 驗證：Node 340/340、網頁 261/261（headless Chromium）。
