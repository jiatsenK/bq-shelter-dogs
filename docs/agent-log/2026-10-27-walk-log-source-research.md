# 修改紀錄加「溜了」與來源：研究

- 日期：2026-10-27。Agent：Claude Code 研究代理（由主視窗交辦）。
- 做了什麼：新增 `docs/research/2026-10-27-walk-log-source.md`，比較 A（`editor_code` 記號）、B（`v3_edit_log` 加 `source`）、C（重建 `v3_dog_edit_actors` 改 CHECK）、D（讀時從溜狗表推）與另開表、只靠 kind 兩種做法；整理 repo 改 D1 結構的流程與先例（migration 0004、0005）、相關 ADR 限制。
- 依據：K 對管理網站修改紀錄的需求（溜了、來源志工網站／試算表、讀回不重複、清空不記、公開頁不顯示、自動認回所改歸試算表）。程式以 `origin/main` `14b476b` 為準。
- 結論：推薦 B，加上試算表那筆記在今日溜狗比對收下人工值的 batch（`compareTrustedWalk`、`reconcileWalkSnapshot`），不記在狗清單 `applyMain`。
- 例外或未完成：只寫文件，沒有改程式、沒有 commit、沒有查正式 D1。ADR 0004「溜狗打卡不記」需要 K 確認後修訂。
- 相關 PR：無。
