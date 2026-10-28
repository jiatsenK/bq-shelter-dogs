# 2026-10-28 修改紀錄保留 14 天

- 日期：2026-10-28（台灣時間）
- Agent：Claude Code
- 分支：`claude/edit-log-cleanup-mechanism-2fbe6e`
- 依據：K 在對話中決定（無票）：編輯紀錄是用來看有沒有人亂改、誰在用網站、測試對照，2 週就夠；合併狗的快照不清，只清操作紀錄。ADR 0004 加「修訂：保留 14 天」。

## 做了什麼

- `worker/src/editlog.js` 新增 `pruneEdits(db, now)`：刪 `at` 超過 14 天、kind 不是 `merge`／`unmerge` 的 `v3_edit_log`，同一批先刪對應的 `v3_dog_edit_actors`（外鍵）。保留天數、哪些不清都只寫在這裡，沿用既有的 `MERGE_KINDS`。
- `worker/src/index.js`：每天第一次保險掃描（UTC 01:23＝台灣 09:23）順便跑，用 `recordRun` 記成 `cron_editlog`；不新增 Cloudflare 排程。`trashDue` 原文不動（`scripts/diagram-facts.test.mjs` 鎖住那行），另加 `firstScanOfDay`。
- 管理網站資料檢查：`cron-status.js` 的 `CRON_JOBS` 加 `editlog`，`admin/checks.js` 過期門檻 26 小時，`admin/public/js/data-checks.js` 加名稱（`parseCronStatus` 不認得的工作會整段報格式錯，所以一定要加），`checks.html` 說明補一句。
- 測試：`worker/test/edit-log-prune.test.mjs`（清理行為、排程時段與資料檢查）；`edit-log-single.test.mjs` 加「只有 editlog.js 一處 `DELETE FROM v3_edit_log`」（暫時在 compact.js 加一行驗證過會擋）。
- 文件：ADR 0004、`db/compact-schema.sql` 註解、`docs/ARCHITECTURE_NOW.md` 排程表、三張架構圖（架構、一天裡的排程、資料流向）。

## 例外與未完成

- 不改資料庫結構，合併後部署就生效，不用套 migration。第一次在正式環境跑會一次清掉 14 天前累積的紀錄。
- 清理一天跑一次，`at` 沒有索引，兩句各掃整張一次；是一天一次的排程，不是每次請求都跑的 API，不加索引（加索引每次寫紀錄都多寫一列）。

## 審查後補修（code-review）

- Spec 審查：功能與規格一致；指出的 agent-log 已補（就是本檔）。
- Standards 審查沒有違反明文規範；修了註解（兩句各掃整張一次，不是一次）、變數名（`expiredWhere`、`deleted`），並註明 `trashDue` 不改用 `firstScanOfDay` 的原因（diagram-facts 測試照原文核對）。
- 沒處理：新增排程工作要同時改 `CRON_JOBS`、`CRON_STALE_MS`、`CRON_LABELS`、說明文字幾處（沿用既有結構）；「14 天」除了 `KEEP_DAYS` 也寫在管理網站說明與文件。
- 上線後第一次 09:23 跑完前，資料檢查的「修改紀錄清理」會顯示「還沒有紀錄」並標紅，跟保險掃描一樣。

## 相關 PR

- https://github.com/jiatsenK/bq-shelter-dogs/pull/733
