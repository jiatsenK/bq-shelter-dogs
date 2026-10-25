# 誰遛的、常遛狗群改存 JSON：第一步 migration 0005（#559）

- 日期：2026-10-25。Agent：Claude。分支 `claude/559-walkers-groups-json-3658c8`，疊在 #557 第二步（PR #577，`claude/557-drop-migration`）上。
- 依據：#559、#549 報告第 2.3、4、5 節（PR #551）、`docs/agents/data-changes.md`「先加後刪」。
- 編號：交辦寫 0004，但 #577 已用 `0004_drop_unused_tables.sql`、也已套進測試庫，所以用 **0005**，並把分支疊在 #577 上（連號測試、`packs_v3_sheet_main_UPDATE` 的觸發欄位都要接在 0004 之後）。#560 順延 0006。

## 改了什麼

- `migrations/0005_walkers_groups_json.sql`（只加不刪）：
  - `v3_sheet_main` 加 `walker_codes TEXT NOT NULL DEFAULT '[]'`，從 `v3_sheet_main_walkers` 照 `position` 組 JSON 陣列。
  - 新表 `v3_sheet_group_columns(column_index 主鍵, label, names JSON)`，從 `v3_sheet_groups`（照 `row_index`）＋`v3_sheet_group_labels` 搬；只有群名沒狗的欄也搬。
  - `packs_v3_sheet_main_UPDATE` 的 `UPDATE OF` 加 `walker_codes`；新表 `packs_v3_sheet_group_columns_*` 3 個。先搬資料再換觸發器，搬的時候 small 不變（資料包內容沒變）。
- 程式改讀寫新的：`compact.js`（在所資料包）、`dog-list.js`（同步主清單代號併進同一句 UPDATE、狗群一欄一列 upsert、離所找同群的狗用 `json_each`）、`index.js`（`/walkers` 代號換名字）、`walk-accept.js`（`seedState`）、`scripts/import-compact-dogs.mjs`。舊表不讀不寫；只有 `dropMainRow`／匯入照刪 `v3_sheet_main_walkers`（外鍵 RESTRICT 擋著）。`/api/groups` 仍 404，狗群只在試算表改（#474）。
- `db/compact-schema.sql`、`docs/COMPACT_D1.md`、`docs/ARCHITECTURE_NOW.md` 同步。
- 測試：`d1-migrations.test.mjs` 加「0005 從舊表組 JSON 逐一對得上、small 不變、之後改了會加 1」；`compact-schema`、`packs`（收窄測試加 `walker_codes`）、`dog-list`、`walkers-d1`、`walk-edit`、`d1-read`、`standards` 改用新欄／新表。

## 預覽庫（bq-shelter-dogs-test）

- `node scripts/d1-migrations.mjs apply --target test --backup never` 套上 0005（10 句）。套用前書籤 `00000134-00000006-0000510f-c6388e40c9c0499245f547cf7a1c4578`。`--backup never` 理由同 #577：`auto` 會把測試庫蓋進正式庫的備用庫。
- 比對（套用前後各讀一次舊表，再跟新欄／新表逐列比）：
  - 代號：主清單 116 列，115 隻有代號、共 162 個，跟舊表 162 列逐列、逐順序相同，不同 0 列。
  - 狗群：11 欄（7 欄有群名），狗名共 62 個，跟舊表 62 列＋群名 7 列逐欄、逐順序相同。
  - small 1887 → 1887（搬資料不讓資料包失效）。
- 寫入列數（測試庫實測 `rows_written`，內容寫回原樣）：
  - 改一群（9 隻）：舊寫法刪 18＋寫 27（＋群名 2）＝45～47 → 新 upsert 2。
  - 改一隻狗的誰遛的（2 人）：舊寫法刪 4＋寫 6＝10 → 新：併進同步本來就有的那句 UPDATE 時 0，只改代號時 2（該列＋small）。
  - 實測寫回的內容跟原本一樣，測試庫 small 因此多加了幾次。
- 之後若改 0005，測試庫不會重套，要跑「準備預覽資料庫」。

## 本機檢查

- 相關 8 個測試檔 96／96。
- `check-local.ps1 -Full`：Node 439／443，失敗 4 個都是 `scripts/local-check.test.mjs`（#577 記錄乾淨 main 也一樣），Node 失敗後網頁測試沒跑；另用 `-Suite` 跑全部網頁測試 264／264 通過。

## 例外、未完成

- 舊表、舊觸發器（`packs_v3_sheet_main_walkers_*`、`packs_v3_sheet_groups_*`、`packs_v3_sheet_group_labels_*`）留到下一張 PR 才 DROP。
- 套用到部署之間（workflow 套完馬上部署，約 1 分鐘）舊程式若剛好同步了誰遛的或狗群，只會寫進舊表；新欄要等那隻狗／那一欄下次有人改才補。
- 正式庫沒碰。#577 合併後本 PR 改指向 main，再由 K 按「套用 D1 migration」。
