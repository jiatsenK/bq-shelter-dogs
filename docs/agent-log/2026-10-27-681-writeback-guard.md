# 2026-10-27 #681 寫回協定：guard 改寫、寫回紀錄索引整理

- 日期：2026-10-27（台灣時間）。Agent：Claude Code（由 #687 分派 session 開出）。
- 依據：Issue #681；K 2026-10-27 為這張票重新開放寫回協定（#456／#498，ADR 0018），研究 `docs/research/2026-10-27-walk-writeback-write-cost.md`。
- 相關 PR：分支 `claude/681-writeback-guard-312733`（草稿）。

## 實作前檢查

- 正式庫只跑唯讀 SELECT／EXPLAIN（`wrangler d1 execute --remote`），Query Insights 用 wrangler OAuth token 查 GraphQL。結果寫在 PR 內文。
- 結論：沒有找到被吞掉的寫入；「INSERT 85 次」是 Query Insights 對 batch 內語句的歸屬不準，加上統計時段不同。`readback` 索引沒有查詢使用（本機與正式庫 EXPLAIN 都選 `causal`）。
- 本機量測用 Miniflare 的 D1（`meta.rows_written`），腳本在 `.scratch/measure-681.mjs`（不提交）。

## 實作

- guard 改成 `guard(db, 條件, ...參數)`（`worker/src/walk-accept.js`）：`INSERT INTO v3_walk_guard SELECT 0 WHERE (條件) IS NOT 1`。溜狗與保險掃描的 7 處 guard 都換掉，拿掉 9 處 `DELETE FROM v3_walk_guard`；派送認領的回傳位置從每隻 5 句改 4 句。
- migration `0012_walk_outbox_indexes.sql`：刪 `readback`、`unknown_date`、`unknown_walker`；`db/compact-schema.sql` 同步。原本取 0011，跟 #678（PR #689，0011）撞號；分派 session 排定 #689 先合併，所以 rebase 後改成 0012。
- ADR 0018 新增「寫回流程少寫的 guard 與索引」補充；`standards.test.mjs` 拿掉兩條已不存在的例外；`walk-accept.test.mjs` 新增 NULL／不成立都擋下的測試。
- 本機量測（Miniflare D1 `rows_written`）：一次完整流程 49 → 36 列，同日加人 51 → 38 列。
- 例外／未完成：
  - `-Full` 第一次跑 `scripts/local-check.test.mjs` 有 4 項失敗，原因是這台機器沒有 pwsh。設 `BQ_CHECK_PWSH=powershell` 重跑後，Node 505 項和網頁測試全部通過。
  - 寫入預算的保留量沒有調（研究說要另外決定）。
  - 合併後要按「套用 D1 migration」。
