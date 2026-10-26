# 2026-10-26 手機搜尋框跟著捲、拿掉頁首範圍字

- Agent：Claude Code（Opus 5.5）
- 分支：`claude/mobile-search-sticky`（從 origin/main `ced3f38` 開）
- 依據：K 2026-10-26「手機板搜尋欄沒辦法跟著下滑跑動，要修這個 BUG；另外畫面上：天～天描述刪掉」

## 做了什麼

- 手機搜尋框：2026-10-17（K 選 A）搬到表頭下面的 `#pageSearch` 後就在表頭外、跟著捲走。`.page-search` 改成 sticky，黏在收起後的表頭下面（top＝`--app-header-height − --brand-h`），底色 `--bg` 蓋住捲過去的狗卡。導覽開著時表頭整個留著，`html.tour-open .page-search` 改黏在整個表頭下面。
- `--brand-h` 改設在 `<html>`（原本在 header 上），`.page-search` 才讀得到。
- 新增 `stickyTopBottom()`（`js/app.js`）：頁首＋手機搜尋框蓋到哪裡；導覽捲目標、按溜了後把狗卡捲回畫面（`walk-ui.js` revealDog）改用它，不會停在搜尋框底下。
- 拿掉頁首範圍字「畫面上：N 天前 ～ N 天前」：`#rangeLabel`、`dayWord`／`rangeText`／`syncRange`／`queueRange`、相關 CSS、`desk.js` 搬移範圍字的程式。
- 測試：`tests/index/app-layout.js` 範圍字的兩項改成確認 `#rangeLabel` 不存在；頁首收起測試多一項手機 `#pageSearch` 捲動後仍貼在表頭下面。

- K 測試網站看過：搜尋框跟「全部」太遠。`.page-search` 下緣 10px→6px，手機有搜尋框時 `main` 上緣 14px→4px（分析頁不動），間距從 24px 變 10px。

## 檢查

- `check-local.ps1 -Suite index`：252 項通過。
- 本機假資料伺服器 375×812 實測：捲到 800px，搜尋框 top 22px（表頭剩 10px 下緣），`#rangeLabel` 不存在。

## 未完成

- 尚未 commit／開 PR；未跑 `-Full`。
