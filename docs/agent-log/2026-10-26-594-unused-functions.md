# #594 刪除沒有呼叫者的函式

- 日期：2026-10-26。Agent：Claude（Opus 5.5）；分支 `claude/594-unused-functions-9e5925`，基準 origin/main `2feead4`。由稽核清理票主工作階段交辦（#591–#597 照順序做）。
- 依據：[#594](https://github.com/jiatsenK/bq-shelter-dogs/issues/594)。
- 刪除前檢查：對每個名字在 `worker`、`public`、`admin`、`scripts`、`tests`、`apps-script` 整字搜尋（含 HTML 內嵌與網頁測試），都只出現在定義與 `export { … }`。
- 變更：
  - `worker/src/compact.js`：刪 `addFormerNumber`（#580 起舊編號改由 `dog-edit.js` 處理）。
  - `public/js/app.js`：刪 `imageToLocal`、`stepTab` 與匯出清單裡的名字。
  - `public/js/group-stage.js`：刪 `groupSummary` 與匯出清單裡的名字。
  - `worker/src/index.js`：刪 `const siteMeta`（票外，主工作階段交辦再確認；只有定義沒有使用），已在票上留言補記。
  - 其他程式不動；`removeFormerNumber`、`dogIdsFor`、`groupDateLabel` 仍有人用，保留。
- 測試：`check-local.ps1 -Full`：Node 467 項 463 過，失敗 4 項都是 `scripts/local-check.test.mjs`（這台 pwsh 執行原則，乾淨 main 也一樣，不在範圍）；Node 失敗後 -Full 不跑網頁，另用 `-Suite` 指定全部 25 套網頁測試：253 項全過（第一次在背景跑卡住 30 分鐘沒有輸出，中止後重跑正常）。
- 審查：code-review 兩軸（Standards／Spec）都沒有硬性問題；Standards 提醒補上本行測試結果。
- 未做：沒推送、沒開 PR，等 K 交辦。
- 相關 PR：尚未開。
