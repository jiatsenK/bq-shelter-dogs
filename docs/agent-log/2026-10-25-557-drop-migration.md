# 刪沒人用的 D1 表與欄位：第二步 migration 0004（#557）

- 日期：2026-10-25。Agent：Claude。分支 `claude/557-drop-migration`（從 main `226a4b4`，#575 已合併並部署）。
- 依據：#557、第一步 PR #575 說明裡的草稿、`docs/agents/data-changes.md`「先加後刪」。
- 編號：交辦寫 0003，但 main 上已有 `0003_feature_settings.sql`（#576），連號測試要求接著排，所以用 **0004**。之後 #559、#560 順延成 0005、0006。

## 改了什麼

- `migrations/0004_drop_unused_tables.sql`：DROP 6 張表（`v3_walk_compare`、`v3_sheet_departed`、`v3_photos`、`v3_volunteer_codes`、`v3_favorites`、`v3_sheet_former_numbers`）；換 `packs_v3_sheet_main_UPDATE`（`UPDATE OF` 拿掉要刪的欄）後 DROP `v3_sheet_main` 7 欄；`packs_v3_dogs_UPDATE` 加 `sex`（在所資料包的性別改讀 `v3_dogs`）；`v3_pack_versions` 整張重建只留 `id`、`small`（舊欄只在正式庫，空庫不能 DROP COLUMN）；刪 `v3_sync_state` 的 `sheet_sig`、`walks_synced`。`changesData` 判定要先備份。
- `db/compact-schema.sql` 同步（含兩段過時註解）。
- 拿掉第一步留的相容寫法：新主清單列不寫 `synced_at`；`dropMainRow`、`removeFormerNumber`、`import-compact-dogs.mjs` 不再刪舊編號表。
- 測試：8 個檔的 `INSERT INTO v3_sheet_main(… synced_at …)`、`cpu-bench.mjs`、`compact-schema.test.mjs` 表清單、`packs.test.mjs` 觸發器收窄測試（拿掉已刪欄、加「改 `v3_dogs.sex` 讓 small 加 1」）、`dog-list.test.mjs` 舊編號測試。`docs/COMPACT_D1.md` 拿掉已刪的表。
- 不動 `v3_today_walks`、`v3_data_versions`（#558）。

## 預覽庫

- `node scripts/d1-migrations.mjs apply --target test --backup never`：測試庫原本只套到 0001，這次套上 0002、0003、0004 全成功（0004：24 句、52 ms）。套用前書籤 `00000133-00000000-0000510f-8a077524362a1b79ef73e65dd2e609f8`。
  - 用 `--backup never`：預設 `auto` 遇到刪資料的 migration 會把**測試庫**整份複製到正式庫專用的備用庫 `bq-shelter-dogs-backup`，蓋掉它。
  - 之後若改 0004，測試庫不會重套，要跑「準備預覽資料庫」。
- 套用後：表 54→50（刪 6、#576 加 2）、觸發器 58、`v3_sheet_main` 剩 8 欄 116 列、`v3_pack_versions` 剩 `id,small`（small 1886 保留）、`v3_sync_state` 剩 3 鍵；管理網站那句 SELECT 正常。

## 例外、未完成

- 本機 Node：438／442，失敗 4 個是 `scripts/local-check.test.mjs`（乾淨 main 也一樣）。
- 正式庫沒碰。合併後由 K 按「套用 D1 migration」。

- 預覽站（PR #577，`preview` 標籤）：首頁、`/api/dogs`、`/api/walkers`、`/api/today?source=d1` 正常。為了驗新程式在刪欄後重算資料包，在測試庫手動 `UPDATE v3_pack_versions SET small=small+1`（1 列）；重算結果正確。管理網站沒有預覽站，只在測試庫跑過它的 SELECT。
- 網頁套件 21 套全過。
- PR：#577（草稿，`preview` 標籤）。
