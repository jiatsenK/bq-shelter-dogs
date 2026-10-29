# 2026-10-29 電腦版資訊寬版

- 日期：2026-10-29（台灣時間）
- Agent：Claude Code（Opus 5.5），由 critique 主 session 分派的平行 session 之一（另有常溜狗群、我溜過、找狗、網址各一張）
- 依據：電腦版 critique（2026-10-29，25/40）：資訊是手機 480 單欄靠左、右邊空 60%。K 決定解除「其他分頁暫時 480 單欄」，資訊做成設定頁式；手機版完全不動；網址／hash 由另一個 session 做。流程照 `/impeccable adapt`。
- 做了什麼：
  - `public/js/analysis.js`：≥1100px 時資訊畫成 `infoDeskHtml`：左邊子頁清單（在所統計、離所紀錄、活動紀錄、資料檢查、更新紀錄、使用說明，選中的 `aria-current`），右邊子頁標題＋內容；剛進資訊直接打開第一個子頁（`infoDeskPage`，不改 `analysisState.infoPage`），不再有分類大卡片和「回資訊」。在所統計寬版：Top 10 改成表格（`topTableHtml`）、看不出入所日期的狗名收進「N 隻…展開」、區塊排成兩欄。
  - 歷史紀錄：電腦版換子頁時上一筆保留原本的子頁（返回回到上一個子頁），新的一筆標 `infoChain`；iPad 橫放換過子頁再轉直，手機的「回資訊」看到 `infoChain` 就直接回分類清單，不往回走過去的子頁。手機原本的流程不帶這個標記，行為不變。換掉這一筆用 `overlays.js` 新增的 `replacePage`（返回鍵集中在 overlays.js 的規則，#623 R6）。
  - 重畫時（離所、活動讀完等）焦點原本在左邊清單就放回同一項（`renderInfoPage`）；更新紀錄 iframe 不重畫的判斷加上「手機／電腦版面沒換」。
  - `public/css/app.css` 檔尾新區塊：清單 208px、一列 40px、滑過淡底、選中白紙；內容最寬 1200px；長條圖 240px 高；資料檢查項目和隻數靠在一起；離所名冊、活動排成多欄；更新紀錄 iframe 高度＝畫面扣頁首與留白，整頁不捲。拿掉用不到的 `.info-subhead`。
  - `public/edits.html`：嵌在電腦版（iframe 寬 700px 以上）時內容靠左，跟子頁標題同一條左邊線；手機的 iframe 不到 480px，不受影響。
  - 文件：`public/js/README.md` analysis.js 一列；`docs/DESIGN_GUIDE.md` 頁首那條的「資訊子頁回資訊」改成現況。第 21、25 行（其他分頁 480 單欄、測試卡 480）照指示不動，建議文字寫在 PR 說明。
  - 測試：新增 `tests/desk-info.cjs`（1280／1440 左邊線 24、清單 200～220 與內容並排、內容寬 > 480、一列約 40px、預設第一頁、Top 10 表格、狗名收起與展開、點狗名開詳細資訊、換子頁焦點與返回、更新紀錄整頁不捲、縮成手機照舊）；`tests/desk-layout.cjs` 資訊子頁段改成清單；`tests/info-page.cjs` 1280 不按回資訊、縮回手機先回資訊。
- 驗證：`check-local.ps1 -Full` 的 node 段只有 `scripts/diagram-reminder.test.mjs`「從 patch 找出 docs/ARCHITECTURE.md 改到哪幾段」失敗（worktree 是 CRLF，base 一樣失敗，跟這張無關），網頁套件因此另用 `-Suite` 全部跑過、全過。手機 390 的資訊首頁與五個子頁截圖跟 base commit（0197195d）逐位元相同。截圖用本機假資料、headless Playwright，沒有開瀏覽器、沒有連正式站；PR 用的截圖在 `docs/design/desk-info/`。
- 例外：網址／hash 不在這張（另一個 session）。資訊頁首搜尋框空位照舊。
- 相關 PR：本筆所在 PR（base `claude/volunteer-critique-p1-p2`）。
