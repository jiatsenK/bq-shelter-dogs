# 2026-10-29 電腦版我溜過寬版

- 日期：2026-10-29（台灣時間）
- Agent：Claude Code（Opus 5.5），由 critique 主 session 分派，用 `/impeccable adapt` 流程
- 依據：電腦版 critique（2026-10-28，`.impeccable/critique/2026-10-28T16-58-59Z__desktop-volunteer-site.md`，在 `volunteer-desktop-critique` worktree）第 1、2 項與「我溜過」線框圖。K 2026-10-29 決定：解除 `docs/DESIGN_GUIDE.md` 第 21 行「其他分頁暫時 480 單欄」，骨架是「上方頁籤＋主內容撐滿＋右欄 300px，細節用右側抽屜」，不改左側導覽，**絕對不能改到手機版**。
- 做了什麼：
  - 新增 `public/js/desk-mine.js`：`deskOn()` 時 `myWalksHtml` 改畫電腦版（讀取中、讀不到照手機）。名字列變成頁面標題列（名字＋修改）；月曆撐滿主內容，每格寫當天溜的狗名（最多 2 個，其餘「＋N」）；右欄 300px 上面是選中那天的狗（狗名、籠位、你總共溜過牠幾次，點了開右側詳細資訊），下面是月曆那個月的統計（來幾天、上個月幾天、溜幾隻次、溜過幾隻、最常溜）和在所的狗你溜過幾隻。
  - 還沒設定是誰：標題「我溜過」，表單放在主內容、一張白紙、最寬 640px。搜尋：一天一張卡排成好幾欄。
  - `public/css/app.css` 檔尾新開「電腦版我溜過」區塊，全部在 `@media (min-width: 1100px)` 且選擇器帶 `html.desk-on`。月曆空白日只留每列上緣細線（DESIGN_GUIDE「少一點格子」）；有紀錄的格子、右欄的列、換月箭頭都有滑鼠移過樣式。
  - 電腦版拿掉「統計」開關：統計一直在右欄。
  - `public/js/README.md` 加 `desk-mine.js` 一列。
  - 測試：新增 `tests/desk-mine.cjs`（1280／1440 主內容寬過 480、左邊線 24、月曆與右欄並排、右欄 300、格子狗名與「＋N」、點日子換右欄、統計數字、移過換底色、點狗名開右側抽屜、1099px 回手機版、還沒設定名字的表單寬度），登記在 `scripts/run-browser-tests.cjs`。
  - 截圖：`docs/design/desk-mine/`（390 手機、1366 電腦版、點狗名、還沒設定名字），本機假資料、headless Playwright。
- 例外與未完成：
  - 溜狗紀錄（`v3_walks`）只有日期、沒有時間，明細沒寫「時間」，改寫「共 N 次」。
  - `docs/DESIGN_GUIDE.md` 第 21、25 行照指示不動，由收尾統一改；建議文字寫在 PR 說明。
  - 沒有開瀏覽器、沒有連正式站。
- 相關 PR：本筆所在 PR（base `claude/volunteer-critique-p1-p2`）。
