# 誰遛的、常遛狗群：第二步 migration 0007 刪舊表（#559）

- 日期：2026-10-25。Agent：Claude。分支 `claude/559-drop-old-tables`（從 main `9aca5d6`；#578 的 0005 已套上正式庫並部署）。
- 依據：#559、`docs/agents/data-changes.md`「先加後刪」。編號固定 0007（#560 第二步用 0008，疊在本分支上）。

## 改了什麼

- `migrations/0007_drop_walkers_groups_tables.sql`：DROP `v3_sheet_main_walkers`、`v3_sheet_groups`、`v3_sheet_group_labels` 和它們的 `packs_` 觸發器 9 個。`changesData` 判定要先備份。
- 先查過沒人讀寫：Worker、GAS（`apps-script/`）、管理網站、`scripts/`、workflow 都只剩 `dropMainRow` 與 `import-compact-dogs.mjs` 為了外鍵照刪 `v3_sheet_main_walkers`，這次一起拿掉。
- `db/compact-schema.sql`、`scripts/compact-schema.test.mjs` 表清單、`docs/COMPACT_D1.md` 同步。舊的 `pack_v3_…` DROP TRIGGER 行（#315 以前的名字）沒動。

## 測試庫（bq-shelter-dogs-test）

- `node scripts/d1-migrations.mjs apply --target test --backup never` 套上 0007（13 句）。套用前書籤 `0000013d-00000002-0000510f-5beb34dffa90da78b370f5b239fec190`。
- 套用後：表 55 → 52、觸發器 64 → 55，三張表和觸發器沒有殘留；small 1383 不變；主清單 116 列、狗群 11 欄還在。
- 預覽網站 pr-581（本分支程式＋測試庫）：四個 API 都 200，`/api/dogs` 的 walkers、groupColumns 跟新欄／新表一致，狗清單、常遛狗群分頁正常，console 沒有錯誤。

## 本機檢查

- 相關 7 個測試檔通過。
- `check-local.ps1 -Full`：Node 443／447，失敗 4 個是 `scripts/local-check.test.mjs`（乾淨 main 也一樣），Node 失敗後網頁測試沒跑；另用 `-Suite` 跑全部網頁測試 264／264 通過。

## 例外、未完成

- 套用到部署之間（約 1 分鐘），舊程式記離所時 `dropMainRow` 會刪不存在的 `v3_sheet_main_walkers` 而失敗；那批 D1 寫入整批不成，GAS 留待下次補送，不會寫一半。
- 正式庫沒碰。合併後由 K 按「套用 D1 migration」（會先複製到備用庫）。
