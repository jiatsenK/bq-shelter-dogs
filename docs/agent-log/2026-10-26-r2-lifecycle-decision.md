# R2 Lifecycle 決定：維持 Worker 清理

- 日期：2026-10-26。Agent：Claude。分支 `claude/silly-perlman-ee4659`（從 main `fc87689` 開）。
- 依據：2026-10-26 架構稽核（基準 #587）評估是否以 R2 Lifecycle 取代或補強照片垃圾桶清理；提出 A 完全取代、B1 Lifecycle 主刪、B2 `trash/` 加 90 天安全網、C 維持現況。K 2026-10-26 選 **C 維持現況**。
- 查證：兩個 bucket 的 `wrangler r2 bucket lifecycle list` 都只有預設 multipart 7 天中止規則。
- 改文件：`docs/ARCHITECTURE_NOW.md` 排程表、ADR 0018 第 7 點補註、`docs/setup/CLOUDFLARE_SETUP.md`（記錄規則在 bucket 上、目前沒有刪除規則）。
- 未做：沒有改任何 bucket 設定，也沒有在測試 bucket 實測（選 C 後不需要）。`purgeTrash`／`maintenance` 的修正由另一個 session（照片垃圾桶清理首跑前修正）負責。
- 相關 PR：#604。
