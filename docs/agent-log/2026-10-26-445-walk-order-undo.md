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
- 兩軸審查（基準 `8d62135`）：Standards 無硬性違反，Spec 指出缺 × 入口與「再試一次」計時測試、連按測試沒真的連點。已補修：捲動改用 walkKey 找卡片（背景重讀換掉 `allDogs` 也找得到）；`restoring` 只由設它的那筆清除（同一隻排兩筆復原不提早跳回）；抽 `walkersOf`；測試補詳細資訊 ×、再試一次 7 秒仍在、狗卡連點兩下只送一次。保留：常遛狗群分頁整群復原不捲動、不跳「正在確認」（那頁沒有溜狗清單，進度看該頁的回饋文字）；試算表寫回只測 `retry`，D1 結果不明只測 503。
- 最終檢查（HEAD `fdaeed7`）：網頁 24 套全過（index 264 項），紀錄 `1792946947691-535fd68a-f70e-471e-b597-1cc9c7a738e0.json`。Node 459／460：唯一失敗是 `scripts/local-check.test.mjs`，這台沒有 `pwsh`（預設用它開子程序）；改指定 `BQ_CHECK_PWSH=powershell` 後，Windows PowerShell 5.1 中文輸出變亂碼對不到 `/未知測試/`。本票沒動該測試與 `check-local.ps1`（`scripts/` 只在 SUITES 加一個套件名），所以 `-Full` 沒有完整綠燈，以 CI（Linux pwsh）為準。
- 待 K 決定：票寫「有『復原』的提示條」拉長，但 D1 模式提示條本來就沒有「復原」按鈕；這次改成所有有按鈕的提示條（＋一起溜的人、再試一次）8 秒，其他 5 秒。
- 未做：#442（再按導覽捲回頂部）、#401／PR #437；未合併、未部署。
- 測試網站（K 2026-10-26 同意）：測試 D1 `bq-shelter-dogs-test` 補套 `0009_dog_edit.sql`；把分支 `c5903c7`（main `da6396e`＋#445）用 `wrangler deploy -c wrangler.test-site.jsonc` 部署到 https://bq-shelter-dogs-test.<子網域>.workers.dev，版本 `89ac89bf-1300-4ad1-98a6-c7016e3a66d2`，供 K 手機實測。#586 合併後要從 main 再部署一次。
- 測試網站設定不了名字（seed-preview-db 10-25 又覆蓋測試庫，開 #589、外觀區分開 #590）：K 同意後備份並清空測試庫 `v3_identity_names` 19 列，`v3_volunteers` 保留；正式庫未動。
- K 2026-10-26 測試網站實測後追加：D1 接受溜了後提示條在「＋一起溜的人」旁加「復原」（取代 K 2026-10-24「復原在狗卡名字旁的 ×」），按了跟「✓ 已溜」一樣立刻恢復、捲到那隻；只送仍是已溜的狗。測試 `walk-order-undo` 第 7 段先紅後綠。
- 2026-10-26 K 在測試網站（版本 `49cf7422`，分支 `803158d`）用手機實機測試，確認 OK。
- 相關 PR：[#586](https://github.com/jiatsenK/bq-shelter-dogs/pull/586)，草稿；未加 preview 標籤（待 K 決定）。
