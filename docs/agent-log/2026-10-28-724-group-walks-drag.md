# group-walks 偶發卡住：第三次拖曳按到讀取中的狗卡大照片

- 日期：2026-10-28。Agent：Claude Code（`/diagnosing-bugs`）。
- 依據：#724（來源 #713）。K 同意在 CI 上連跑診斷。
- 重現：本機在 CPU 滿載下連跑 30 次都沒卡住。CI 第一輪（run 40639866163）278 次卡住 6 次，`DEBUG=pw:api` 顯示 6 次都卡在第三次拖曳（上下移動不換群）的 `mouse.move`。第二輪（run 40641580006）加 `pw:protocol`，360 次卡住 3 次：頁面回報 `dragstart`、沒被取消，Chromium 卻沒送 `Input.dragIntercepted`，Playwright 1.56.1 `crDragDrop.js` 等這個事件沒有時限，所以一直等。
- 原因：第二次拖曳拖回起點放開，等於點那隻狗，打開狗卡。第三次拖曳按到狗卡大照片 `<img>`（`photoThumb` 沒有 `draggable="false"`）。CI 上照片還在讀，按住移動變成原生拖曳；照片接著 404，`onerror` 把圖藏起來，拖曳被丟掉。本機 404 回得快，按下前圖就藏了，所以本機不會發生。這也表示「上下移動不換群」原本按的是狗卡，不是狗群。
- 修正（只改測試）：第二次拖曳後確認狗卡打開、按 Esc 關掉，第三次拖曳才拖到狗群。回歸測試：拖曳期間照片先不回應（穩定重現「還在讀」），記下並取消所有 `dragstart`，結束時要是空的。修正前本機穩定失敗並指出是狗卡大照片；修正後通過。
- 驗證：修正後 CI 連跑 360 次（run 40643495233）全過、最慢 8 秒（修正前 638 次卡 9 次）；本機 `check-local.ps1 -Full` 通過。
- 沒做：產品端的 `photoThumb` 圖片沒加 `draggable="false"`，狗卡大照片在桌機仍可原生拖曳（對使用者無害），不在本票範圍。
- 診斷分支 `diag/724-group-walks-loop`、`diag/724-verify` 只放 `[DEBUG-724]` workflow 與紀錄，不合併，結束後刪除。
- 相關 PR：見本分支 PR。
