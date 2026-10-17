# 2026-10-17 讀不到版本號不退回整表讀取（#339）

- Agent：Claude Code（Opus 5.5）
- 依據：#339、ADR 0009（讀取量不隨歷史總量成長）；K 在對話中決定「先把退回整表讀取的路徑收掉，ADR 0008 編號一起修正」
- 做了什麼：
  - `worker/src/packs.js`：讀不到 `v3_pack_versions`／`v3_walk_versions`（沒表或沒那一列）就報錯，拿掉直接讀表的退路（`DIRECT`、整表 `SELECT … FROM v3_walks`）。切點比今天新或移三次都移不了時，照現在的切點給（資料包＋live 本來就是完整的一份），不再退回整表。
  - `worker/src/index.js` 狀態頁讀不到就顯示「D1（讀不到資料包版本號）」，不再整表 `COUNT(*)`；`compact.js` 的 `compactStatus` 沒人用了，刪掉。
  - `docs/adr/0008-sync-on-change.md` 改號 `0012-sync-on-change.md`（和 `0008-diff-sync-and-write-budget.md` 撞號），檔頭註明改號和「保險同步做全量」已由 0010 改掉；所有指「有改才同步＋保險同步」的引用改成 0012，指寫入預算的維持 0008。過去的 agent-log 不改。
  - 測試：原本「沒有版本號表照舊直接讀表」改成「報錯」；#125、#126 讀取權限測試改用有建表的假 D1。
- 未完成：網頁測試沒在本機跑，交給 CI。`readWalks`、`readDogsPayload` 等整表讀取仍留在 `compact.js`，給同步程式（GitHub Actions）和資料包重算用。
