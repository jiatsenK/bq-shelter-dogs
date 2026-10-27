# 2026-10-27 #681 寫回協定：guard 改寫、寫回紀錄索引整理

- 日期：2026-10-27（台灣時間）。Agent：Claude Code（由 #687 分派 session 開出）。
- 依據：Issue #681；K 2026-10-27 為這張票重新開放寫回協定（#456／#498，ADR 0018），研究 `docs/research/2026-10-27-walk-writeback-write-cost.md`。
- 相關 PR：分支 `claude/681-writeback-guard-312733`（草稿）。

## 實作前檢查

- 正式庫只跑唯讀 SELECT／EXPLAIN（`wrangler d1 execute --remote`），Query Insights 用 wrangler OAuth token 查 GraphQL。結果寫在 PR 內文。
- 結論：沒有找到被吞掉的寫入；「INSERT 85 次」是 Query Insights 對 batch 內語句的歸屬不準，加上統計時段不同。`readback` 索引沒有查詢使用（本機與正式庫 EXPLAIN 都選 `causal`）。
- 本機量測用 Miniflare 的 D1（`meta.rows_written`），腳本在 `.scratch/measure-681.mjs`（不提交）。
