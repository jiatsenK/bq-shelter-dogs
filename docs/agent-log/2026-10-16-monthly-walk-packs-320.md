# 溜狗歷史按月分段（#320）

- 日期：2026-10-16
- Agent：Claude Code（Opus 5.5）
- 分支：`feat/320-monthly-packs`
- 依據：#320、ADR 0009「溜狗歷史按月分段」做法 B（K 2026-10-16 決定）

## 做了什麼

- `db/compact-schema.sql`：新增 `v3_walk_versions`（total／live／cutoff／months JSON）、`v3_walk_packs`（一年一份、每段最多 1 MB，每段記著月份版本號），觸發器 `walkpack_v3_walks_*` 依 `walk_date` 用 `json_set` 只讓那個月加 1。拿掉 #315 的 `pack_v3_walks_*` 觸發器和 `v3_packs` 裡的 walks 資料包。
- `worker/src/packs.js`：沒變只讀 1 列版本號；改某月只讀那年的大列＋那個月的列；跨日只讀昨天的列＋當年的大列，用版本號（cutoff、total、live）比對移切點，中間有人寫入或別台先移了就重讀版本號。
- `scripts/sync-compact-d1.mjs`：同步補建時一起帶新表、新觸發器和拿掉舊觸發器的句子。
- 狀態頁沒變時讀 2 列版本號（small＋溜狗紀錄，原本 1 列）。

## 未完成／待確認

- 觸發器內部寫入是否算 D1 讀取：假 D1 只算回傳列數，量不到；上線後用 `wrangler d1 insights` 核對。
- 上線後第一次跨日（切點從空的開始）會整份讀一次今天以前的紀錄，之後才是每天只讀昨天。
- 本機沒有 Playwright Chromium，網頁測試交給 CI。
