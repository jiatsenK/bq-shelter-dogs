# #445 按溜了直接往下排；復原立刻顯示並停在那一條、提示條久一點

- 日期：2026-10-26。Agent：Claude（Opus 5.5）；分支 `claude/445-walk-order-undo`，基準 origin/main `8d62135`。由主工作階段交辦，避開 #547（`worker/src/index.js` 舊 `upload()`、cpu-bench）與 #567（`admin/`、`worker/src/admin/`）。
- 依據：#445（K 2026-10-21 決定、2026-10-24 補充 D1 為準）、ADR 0018。
- 變更：
  - 排序：拿掉 `walkPinned`／`pinWalkOrder`／`resetWalkOrder`／`sortWalkList`，溜狗表直接用 `dueDogs`。溜狗表、★ 我的常溜、常遛狗群整群登記一致。
  - 復原（D1 模式）：`walk-registration.js` 記下這支手機登記前看到的上次溜狗（沒有就用狗清單還不是今天的日期），復原送出後先顯示那個樣子；D1 一有回應（含失敗）就改以 D1 為準。`walk-ui.js` 單狗入口（狗卡「已溜」、溜狗人旁的 ×）先跳「已取消 X 今天溜了，正在確認」、捲到那隻；失敗改回已溜、捲過去、給「再試一次」（沿用原登記識別）。連按同一隻只送一次，按不同隻各自送出（取代整個復原期間全擋的 `sheetUndoBusy`）。沒有登記前資料時照舊「取消中」。
  - 提示條：有按鈕的 8 秒，其他維持 5 秒。
  - 文件：ADR 0018 加補充；`docs/DESIGN_GUIDE.md` 改寫「留在原地」；`docs/PROJECT_GOALS.md` 舊紀錄加註。ADR 0007 開頭已指向 0018，未改。
- 測試：新增網頁套件 `walk-order-undo`（排序三入口、復原立刻顯示與捲動、5／8 秒提示條、D1 失敗改回與再試一次、連按、D1 接受但試算表寫回 `retry`）。逐片先紅後綠；另以突變確認捲動斷言會在關掉捲動時失敗。更新 `walk-feedback`（#498 復原改為立即恢復）、`startup-stability`、`index`（walks／rest／app-layout／desk）裡「留在原位」與 `resetWalkOrder` 的斷言。
- 設計 detect：`walk-ui.js` 無發現；沒有改 CSS。
- 未做：#442（再按導覽捲回頂部）、#401／PR #437；未合併、未部署。
- 相關 PR：（開草稿後補）
