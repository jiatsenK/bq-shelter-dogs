# 2026-10-27 保險掃描不再整張掃沒有溜狗人的列；/departed-cards 版本號只讀一次（#678）

- Agent：Claude Code（Opus 5.5）
- 分支：`claude/678-walker-null-index-656e18`

## 依據

#678（總票 #687）：D1 讀寫效率稽核 `docs/research/2026-10-27-d1-efficiency-audit.md` 的定案表，細節在 `docs/research/2026-10-27-d1-audit-small-items.md` 第 2、5 項；K 2026-10-27 定案第 5 項做 A（部分索引）、第 2 項順手做，第 1、3 項不做。

## 做了什麼

- `migrations/0011_sheet_main_walker_null_index.sql`：`v3_sheet_main(row_index) WHERE walker IS NULL` 部分索引。正式庫符合條件的是 0 列，索引是空的；保險掃描（`dog-list.js` `scanDogList`）和管理用途 `index.js` `readWalkersD1` 的同條件查詢都改走索引。只加索引，沒有刪資料，套用 workflow 不會先備份。`db/compact-schema.sql` 同步。
- `worker/src/packs.js`：新增 `readDeparted(db)`，一次回 `{ departures, cards }`，只呼叫一次 `departurePacks`（只讀一次 `v3_departure_versions`）。`readSmall` 拿掉沒人用了的 `cards`，`departures` 改走 `readDeparted`。
- `worker/src/departed.js`：`/departed-cards` 改用 `readDeparted`。

## 測試

- `worker/test/dog-list.test.mjs`：兩句 `walker IS NULL` 查詢的查詢計畫走 `v3_sheet_main_walker_null`，不整張掃。
- `worker/test/departed-cards.test.mjs`：一次請求只讀一次 `v3_departure_versions`，回應跟前一次一樣。

## 未做（照票）

- 觸發器重複加版本號（第 1 項）、重試排程 3 句合 1 句（第 3 項）。
- `v3_walks` 沒編號狗名的部分索引是 #683，不在這張。

## 未完成（要 K）

- migration 編號 0011：#676、#679–#681 同時在做，合併前 rebase 到最新 main，撞號就重新編號。
- 合併後按「套用 D1 migration」（接著部署）。
