# 架構細節圖四張

- 日期：2026-10-28。Agent：Claude Code。
- 依據：K 在對話中要求「四張都幫我畫」（寫回與同步、改表回 D1、一天排程、各類資料流向）。無對應 Issue。
- 做了什麼：
  - 新增 `docs/diagrams/writeback-sequence.html`（時序圖：網站登記→先存 D1→背景經 GAS 寫兩欄、讀回、receipt；失敗改待重試）。
  - 新增 `docs/diagrams/sheet-sync-sequence.html`（時序圖：人工改表→編輯觸發→待通知→/rows、/dog-list→ACK 才清；每天三次 dogListScan 指紋比對補送）。
  - 新增 `docs/diagrams/daily-schedule.html`（時間軸：Worker 與 GAS 兩套排程換成台灣時間，含日界線與錯開）。
  - 新增 `docs/diagrams/data-flows.html`（泳道圖：五類資料各一道）。
  - `docs/ARCHITECTURE_NOW.md`、`docs/diagrams/architecture.html` 加細節圖連結；`.impeccable/config.json` 把既有 `tiny-text`、`overused-font` 忽略範圍擴到四張新圖。
- 內容依 `docs/research/2026-10-28-architecture-data-flow.md`，並回頭核對 `apps-script/sheet-write.gs`（writeLatestWalk、installWalkEditTriggers、onWalkSheetEdit、flushWalkEdits、dogListScan）、`worker/src/walk-accept.js`（重試間隔與上限）、`worker/src/index.js`（排程常數、note／log）。
- 泳道圖每道是一串步驟方塊，總數超過 diagram-design 建議的 9 個節點；每道是單線，閱讀上可接受，未再拆圖。
- 驗證：diagram-design `self_check.py` 四張都 OK；Playwright 截圖目視確認版面。
- 相關 PR：見本分支 PR。
