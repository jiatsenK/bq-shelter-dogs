# 2026-10-17 同步只讀、只寫最近一段溜狗紀錄（#331）

- Agent：Claude Code
- 依據：#331、ADR 0010

## 做了什麼

- `scripts/sync-compact-d1.mjs`：先讀 `v3_sync_state` 的 `walks_synced`（上一次成功同步的台灣日期），`v3_walks` 只讀那天前一天以後的列；沒記過就整張讀。這次的日期跟資料寫在同一份 SQL，寫成功才更新。
- 6:30 保險同步（`SYNC_MODE=daily`）：再用（狗＋日期）核對試算表上每隻狗最後一次溜狗，有編號的照 `v3_dog_numbers`、沒編號的照上一次主清單犬名找狗，D1 缺了才補。
- `scripts/sync-plan.mjs`：起點以前的新紀錄不寫（舊日期被改不理）；「我最後一次遛」沿用上一次主清單算好的，取比較新的。
- `sync-sheet.yml` 加手動選項「全量核對」（`full`）和 Worker 用的 `daily`；Worker 6:30 叫同步時帶 `daily`。

## 未完成／注意

- 正式 D1 還沒有 `walks_synced`，合併後第一次同步會整張讀一次，之後才開始只讀最近一段。
