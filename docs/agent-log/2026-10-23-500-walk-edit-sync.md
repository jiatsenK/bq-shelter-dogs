# #500 今日溜狗改成有人編輯才同步、只送改動

- 日期：2026-10-23。Agent：Claude（/implement 500）。分支 `docs/498-consolidate`（#498 文件已由 #502 合進 main）。
- 依據：Issue #500、ADR 0018 第 1–5、8 點。
- Worker：新增 `POST /api/walk-writeback/rows`（寫回金鑰、每批最多 50 列），依 GAS 送來的列逐隻 `reconcileWalk`，不讀整張表；非溜狗欄位、已出所、主清單找不到唯一列只 `markChanged` 交給狗清單同步。回應逐列 `ack`：已更新、無差異或已記衝突為 true，D1 失敗為 false。
- 排程：`5-59/10` 只跑寫回重試（沒工作只查 D1、不讀表、不寫）；新增 `43 1 * * *`、`53 5,15 * * *`（台灣 09:43、13:53、23:53）跑指紋保險掃描。`/api/sheet-changed` 不再觸發溜狗掃描；刪除 `scanNotifiedWalks`／`retryNotifiedScan`。
- GAS：`onWalkSheetEdit`（安裝型編輯時）只讀受影響列；`WALK_EDITS_PENDING` 待通知版本（同狗以最後出現為準、每筆遞增 seq），`flushWalkEdits` 在 script lock 內讀當下四欄後送出（避免夾在網站寫回中間），確認只清同一 seq；`installWalkEditTriggers` 建立觸發器。
- 與 ADR 字面差異：保險掃描仍由 Worker 定時向 GAS 要指紋（沿用 `walkScan`），不是 GAS 主動送；效果相同（只比一次指紋）。寫回重試保留 10 分鐘排程（只查 D1）。
- 未做／待授權：`v3_walk_compare` 表已不再使用，未刪 schema；測試試算表實測觸發器、GAS 部署、啟用功能開關都需 K 另行授權；狗清單編輯觸發見 #501。
- 功能開關關閉時，Worker 對溜狗列回 ack:false，GAS 保留待通知，開啟後補送（審查修正）。
- 本機完整測試：458 過；`scripts/local-check.test.mjs` 4 個失敗在乾淨 HEAD 一樣失敗，非本次造成。
- 相關 PR：#504（草稿）。
