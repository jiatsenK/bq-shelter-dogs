# 2026-10-27 網站登記過的狗，保險掃描不再重寫一樣的溜狗紀錄（#682）

- Agent：Claude Code（Opus 5.5）
- 分支：`claude/682-walkday-skip-unchanged`

## 依據

#682（總票 #687）：研究 `docs/research/2026-10-27-walkday-skip-unchanged.md`，K 2026-10-27 定案用 B（UPSERT）、名單照位置比、不更新當天狗名、不採 C（網站登記不改 `walked_date`）。

## 實作前驗證

- 定案要求先在本機確認「內容一樣的 UPSERT」寫入 0 列。用 `npx wrangler@4`（4.153.0）的 `getPlatformProxy` 開本機 D1，同一張表加主鍵、日期索引和 INSERT／UPDATE／DELETE 觸發器實測：
  - 內容一樣的 UPSERT（含 null 對 null）、`DELETE ... position>=n` 沒刪到：`rows_written=0`、觸發器沒跑。
  - 換一個人：`rows_written=2`（表＋觸發器）。舊做法整天刪掉再寫 2 人：`4 + 8 = 12`。
- 所以走 B，沒改用先讀再比對。

## 做了什麼

- `worker/src/dog-list.js` `walkDay`：從「整天 DELETE、逐人 INSERT」改成「刪掉多出的位置＋逐位置 UPSERT，`walker_code` 不一樣才更新」。網站按溜了（`walk-accept.js`）和狗清單同步共用，函式簽名不變、呼叫端不用改。
  - 新位置的編號和狗名沿用那天第 0 個位置（第一次記的），符合 #248；那天還沒有紀錄才用現在的。
  - 改到的位置一併清掉舊的 `walker_name`，跟原本刪掉重寫的結果一樣。
- `docs/adr/0018-today-walks-d1-event-sync.md`：「溜狗紀錄跟著今日溜狗一起寫」補充加一點，記這次的寫法。
- 沒有 migration、沒有動任何觸發器或 `db/compact-schema.sql`。

## 測試

- `worker/test/dog-list.test.mjs` 兩則：
  - 網站登記後主清單的溜狗日期不變；保險掃描送同一份名單，`v3_walks` 與 `v3_walk_versions` 都不變，主清單日期跟上試算表。
  - 直接呼叫 `walkDay`：同名單寫 0 列；順序不同照位置改寫；人數變少刪多的；沒有溜狗人 null 對 null 寫 0 列；改名換編號不寫，加人沿用那天的編號狗名。
- 兩則在舊程式下都失敗，新程式通過。

## 與其他票

- #679（PR #692）改 `walkpack`／在所資料包觸發器；這張不動觸發器，只改寫入 `v3_walks` 的語句。後合併的那張重跑 `worker/test/packs.test.mjs`、`worker/test/dog-list.test.mjs`。

## 未完成（要 K）

- PR 是草稿；轉正式與合併等 K 同意。
