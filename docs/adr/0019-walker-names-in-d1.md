# 0019 「誰遛的」原文存進 D1，公開檔案仍只放代號

狀態：K 確認，2026-10-24（#519 實測後對話）。

#141 起名字不進 repo：repo 公開，`dogs.json` 只放名字算出的代號。D1 主清單也跟著只存代號（`v3_sheet_main_walkers`；#559 起改成 `v3_sheet_main.walker_codes` JSON 欄，舊表已由 migration 0007 刪除），`/walkers` 要拿代號回志工名單換名字。2026-10-24 正式實測在試算表填「123」，代號在志工名單找不到，換不回名字。K：D1 現在的安全性比較高，名字直接存進 D1，不用猜。

## 決定

1. `v3_sheet_main.walker` 存試算表「誰遛的」原文；清空存空字串。`/walkers` 直接回原文。
2. 「名字不進 repo」只管公開的檔案與 Git（`dogs.json`、資料包、提交）；D1 可以存名字。資料包（`compact.js`）照舊不帶 `walker`。
3. 代號照舊保留：溜狗紀錄、常溜、志工身分仍用代號與 `volunteer_id` 認人（ADR 0005）。試算表出現的新名字同時記進志工名單。
4. 補填：`walker` 是 NULL 的狗，保險掃描（`dogListScan`）指紋一樣也要送；每天三次會自動補完，K 也可在 Apps Script 手動執行 `dogListScan` 加快。NULL 期間 `/walkers` 用代號換名字。

## 上線順序

正式 D1 要先 `ALTER TABLE v3_sheet_main ADD COLUMN walker TEXT`，再部署 Worker；反過來 `/walkers` 與狗清單編輯都會因找不到欄位失敗。
