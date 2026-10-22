# 2026-10-18 正式 D1 讀寫用量研究

- Agent：Claude（Claude Code 子代理）。
- 依據：K 要求研究 10/18 正式 D1 的讀寫狀況、晚間尖峰原因，以及與 #402 的關聯。
- 做了什麼：新增 [研究筆記](../research/2026-10-18-d1-usage-1018.md)。資料來自 Cloudflare GraphQL Analytics（`d1AnalyticsAdaptiveGroups`、`d1QueriesAdaptiveGroups`，wrangler OAuth token，未落檔）、`gh run list/view`（sync-sheet.yml）、`gh issue view 402`，並對照程式行號。
- 主要發現：讀量約三分之二來自 `/api/favorites` 的 `favoriteAliases`（不是 narrowSeedSql）；19 時尖峰是 19:01 試算表同步（寫 231 列）加資料包重算；全天約佔免費額度 1.5%。
- 範圍：只新增兩份文件；未改程式、未寫 D1、未部署、未操作瀏覽器、未 commit、未寫 GitHub。
- 未完成：查詢時間 10/18 19:33，20 時後未涵蓋；排行第 9、10 名 SQL 未逐字定位；改善項目只列出，是否開票由 K 決定。
- 相關 PR：無。
