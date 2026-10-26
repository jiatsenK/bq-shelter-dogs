# 前端整理 R4：詳細資訊拆出 app.js

- 日期：2026-10-26。Agent：Claude（Opus 5.5）；分支 `claude/r4-split-detail`，基準 main `2feead4`。由前端整理主工作階段交辦（#623 第 1 項）。
- 依據：#623 R4；ADR 0017（不換框架、整段重畫加事件委派照舊、同 PR 更新 `public/js/README.md`）。
- 變更：
  - `public/js/app.js` 2317 → 1389 行，只留資料、狗卡、燈箱、頁籤與整頁事件綁定。
  - 新檔：`detail.js`（畫面總控、`DETAIL_CLICKS`、`wireDetail`、`renderDetail`、`showDetail`／`hideDetail`／`closeDetail`）、`detail-rest.js`、`detail-fixed-care.js`、`detail-intro.js`、`detail-stays.js`、`detail-former.js`、`sheet-append.js`（加備註／異動紀錄，含原本 `bindApp` 裡的三個整頁委派）。
  - 各編輯器的取消、逐筆增刪與輸入處理搬進各自檔案（`closeXxxEdit`、`xxxRowClick`、`xxxInput`）；`wireDetail` 只分派，順序照舊（出入所 → 入所逐次紀錄 → 介紹文字 → 舊編號 → 休養）。
  - showDetail／hideDetail 重複的「收掉編輯」合成 `leaveDetailDog`（兩邊原本做的事一樣：清 viewport、勾選、展開、非儲存中的四種編輯、照片暫存）。
  - 舊編號、出入所的 `ymdOf` 改用 ui-kit 既有的 `ymdText`（三處都保證有日期，輸出相同）。
  - 其他模組改從新檔匯入；`imageToLocal`（沒人用，R9 #594 的範圍）留在 app.js 不動。
- 測試：`scripts/frontend-modules.test.mjs` 新增三項 Node 測試（具名匯入對方都有匯出、`public/js` 每支檔列在 README、app.js 不再有詳細資訊函式且收掉編輯只有一份）；`tests/fixtures/module-globals.js` 接上新模組；`tests/index/bootstrap.js` 的 `APP_JS` 改成 app.js 加新檔原始碼，原有原始碼檢查照樣涵蓋。
- README 順帶補上原本漏列的 `photo-images.js`。
- 本機：`check-local.ps1 -Full` 通過；另跑 detail-editing、fixed-care、intake-presentation、keyboard-viewport、departed-cards、es-modules、index。這台沒有 `pwsh`，`local-check.test.mjs` 要設 `$env:BQ_CHECK_PWSH = 'powershell'` 才能跑。
- 未做：手機實際檢查（詳細資訊開關、各編輯器）待 K。
- 相關 PR：[#627](https://github.com/jiatsenK/bq-shelter-dogs/pull/627)，草稿。
