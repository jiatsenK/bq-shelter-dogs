# 2026-10-27 新增沒編號的狗時不再整張掃溜狗紀錄（#683）

- Agent：Claude Code（Opus 5.5）
- 分支：`claude/683-no-full-scan-945adb`

## 依據

#683（總票 #687）：D1 讀寫效率稽核 `docs/research/2026-10-27-d1-efficiency-audit.md` 的定案表，細節在 `docs/research/2026-10-27-d1-audit-small-items.md` 第 4 項；K 2026-10-27 定案低優先、可做。

## 做了什麼

- `migrations/0015_walks_nameonly_index.sql`：`v3_walks(dog_name) WHERE dog_number=''` 部分索引 `v3_walks_nameonly`。主清單新增沒編號的狗時（`dog-list.js` `applyMain`），用名字找以前記過的溜狗紀錄那句原本整張掃 `v3_walks`（`SCAN w`），改走索引（`SEARCH w USING INDEX v3_walks_nameonly`）。索引只收沒編號的溜狗紀錄，很小。只加索引，沒有刪資料，套用 workflow 不會先備份；建索引當下會整張讀一次 `v3_walks`。`db/compact-schema.sql` 同步。
- 沒改程式、沒動觸發器：查詢本來就有 `dog_number=''`，SQLite 自己會選部分索引。

## 測試

- `worker/test/dog-list.test.mjs`：那句查詢的查詢計畫走 `v3_walks_nameonly`、不整張掃（拿掉索引時這個測試會失敗，看到 `SCAN w`）；沒編號的狗主清單列不見後再出現，照樣靠溜狗紀錄的名字認回同一隻，不多出一隻。

## 未完成（要 K）

- migration 編號 0015：原本預定 0016 讓給 #684，但 `scripts/d1-migrations.test.mjs` 要求從 0000 起連號，main 最新是 0014，0016 過不了；#684 的 worktree 當時沒有新增 migration。合併前 rebase 到最新 main，撞號就由後合併的那張改號。
- 合併後按「套用 D1 migration」（接著部署）。
