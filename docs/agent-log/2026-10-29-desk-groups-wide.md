# 2026-10-29 常溜狗群電腦版寬版

- 日期：2026-10-29（台灣時間）
- Agent：Claude Code（Opus 5.5），由電腦版 critique 的主 session 交辦（`/impeccable adapt`）。
- 依據：K 2026-10-29 解除「其他分頁暫時 480 單欄」；骨架用上方頁籤（64px 頁首不動）＋主內容撐滿＋右欄 300px，不改左側導覽；手機版一律不動。報告：critique 2026-10-28「常溜狗群（從輪播改成所有群並排）」線框。
- 做了什麼：
  - `public/js/group-stage.js`：`deskOn()` 時改畫 `groupDeskHtml`。所有群並排成群卡（群名、隻數、每隻一列 44px：天數色籤｜籠位｜狗名，警示原文接在狗名下），每張卡有「整群溜了」「有狗沒溜」；群多往下排。選中的群＝原本的 `groupColumn`，點群卡（群名、狗、按鈕都算）先選中再照手機的動作做；只有選中的群帶 `#gwWalk`、能「有狗沒溜」。登記、復原、重試、一起溜的人都走原本的 `registerGroupWalk`／`undoGroupWalk`，沒有另寫。
  - 右欄（沿用溜狗表 `.desk-side`／`.ds-panel`）：選中那一群近 30 天有幾天溜過、每隻各幾天（跟溜狗表「最近 30 天」同一份 `deskDayWalk`）、有警示的狗、「要改請到試算表」。`desk.js` 的 `deskLoadWalks` 讀完後在常溜狗群分頁也重畫。
  - `public/css/app.css`：新樣式全在 `@media (min-width: 1100px)`、選擇器加 `html.desk-on`。左邊線 24、上緣 20（原本手機的 `padding 0 4px`、`main padding-top 4px` 讓電腦版變 28／4）；列有滑鼠移過底色。
  - 測試：`tests/desk-layout.cjs` 加第二群，1280／1440 查主內容 > 480、右欄 300、左邊線 24、上緣 20、兩群並排、列高 40～46、沒有橫向捲動；點群卡右欄跟著換、只有一個 `#gwWalk`、滑鼠移過有底色、有狗沒溜在電腦版照樣只登記勾著的狗。`tests/group-walks.cjs` 原本在 1280 用手機版面測換群箭頭、44px 與滑鼠拖曳：1280 改成只查溢出與狗列完整，滑鼠拖曳段改在 1099（還是一次一群）跑。
  - `public/js/README.md`：group-stage 依賴加 desk。
- 審查（Standards／Spec 兩軸，基準 0197195d）後補修：「整群溜了／已溜」判斷抽成 `groupWalkState` 手機與電腦版共用（手機 HTML 不變）、`#gwSource` 抽成 `groupSourceHtml`、選中群的焦點抽成 `focusSelectedGroup`、30 天每隻只算一次、「紀錄從 10/1 開始」寫法同溜狗表頁尾；電腦版警示接在狗名同一行（放不下刪節，全文在右欄），有警示的列也維持 44px。
- 截圖：`docs/design/desk-groups-wide/`（390 前後、1366 前後、1366 有狗沒溜）。
- 手機版：390px 截圖跟改之前逐位元組相同（headless 假資料）。
- 本機 `-Full`：node 段 591 過、1 項 `scripts/diagram-reminder.test.mjs` 失敗，原因是 worktree 用 CRLF（`core.autocrlf=true`），`docs/ARCHITECTURE.md` 以 `\n` 切不到標題；這幾個檔案跟 base 相同，CI（Linux、LF）不受影響。網頁套件另外全部跑過。
- 待 K 確認：右欄「近 30 天」算的是「這群有任何一隻狗溜過的天數」＋每隻各幾天，不是「整群一起溜」的次數（溜狗紀錄沒有記是不是整群一起溜）。
- 未做：`docs/DESIGN_GUIDE.md` 第 21、25 行留給收尾統一改，建議文字寫在 PR 說明。電腦版群卡的鍵盤左右鍵沿用手機的換群（改選中的群）。
- 相關 PR：本筆所在 PR（base `claude/volunteer-critique-p1-p2`）。
