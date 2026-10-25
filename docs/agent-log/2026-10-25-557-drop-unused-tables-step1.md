# 刪沒人用的 D1 表與欄位：第一步只改程式（#557）

- 日期：2026-10-25。Agent：Claude。分支 `claude/557-drop-unused-tables-940f05`。
- 依據：#557（Part of #521）、資料表稽核 #549 第 2、4.3、7 節（報告在 PR #551）、`docs/agents/data-changes.md`「先加後刪」。
- 這張 PR **不放 migration**。DROP 的 `0003` 等這張合併、部署後另開 PR（內容在 PR 說明）。

## 改了什麼

- `v3_favorites`：`linkIdentityName`、更名不再從舊常溜搬資料（正式庫 0 列）；`v3_card_opened` 那段照舊（待 K 決定）。`scripts/migrate-volunteer-identity.mjs` 不再數它。
- `v3_volunteer_codes`：設名字、更名、合併不再寫；`/walkers`、`seedState`、`previousWalk` 只用 `v3_identity_names` 換名字（正式庫兩邊 19 列完全相同，兩個方向差異 0）。
- `v3_sheet_former_numbers`：不再新增、不再讀；記離所的舊編號改從 `v3_dog_numbers` 推。**刪除照留**：它對 `v3_sheet_main(row_index)`、`v3_dog_numbers(number)` 是 `ON DELETE RESTRICT`，正式庫還有 1 列，不刪會擋記離所、刪舊編號（新測試，拿掉任一句 DELETE 會紅）。
- `v3_photos`：管理網站（#570，稽核之後才合併）原本讀它；改成跟志工網站一樣看 R2 的 `photos/{編號}.jpg`（`r2Versions`，每次載入多 1 次 R2 list、30 秒快取）。`v3_photos` 那份清單 Worker 從沒更新過。匯入腳本不再收照片清單。
- `v3_sheet_main` 7 欄：
  - `covered`、`my_walked`、`my_walked_date`：同步不再算、不再寫；`/api/dogs` 不再回 `myWalked`／`myWalkedDate`（前端 0 處讀）；`MY_NAME` 不再讀（ADR 索引重產少一行）。
  - `sex`：`/api/dogs`、記離所、管理網站改讀 `v3_dogs.sex`（正式庫 116 列 0 筆不同）。管理網站「性別資料不一致」標示拿掉（只剩一份來源）。
  - `intro`：記離所只抄 `v3_intros`。
  - `version`：`/api/dogs` 的 `version` 寫成常數 1。
  - `synced_at`：不再讀（`readSyncedAt` 只看 `v3_sync_state`）。**新列照寫空字串**：這欄 `NOT NULL` 沒預設值，刪欄前不寫會新增失敗。
- `v3_walk_compare`、`v3_sheet_departed`、`v3_pack_versions` 舊欄、`v3_sync_state` 舊鍵：本來就沒有程式讀寫，不用改。
- GAS（`apps-script/sheet-write.gs`）送的只有犬名、編號、籠位、日期、誰遛的、備註，7 欄都是 Worker 自己算的。
- 測試、`scripts/import-compact-dogs.mjs`（測試共用匯入器：舊 dogs.json 的 intro／covered／myWalked 照驗格式但不存）、`docs/COMPACT_D1.md`、`admin/README.md`、`docs/setup/*` 跟著改。

## 預覽庫實測（`bq-shelter-dogs-test`）

在測試庫建 `zz557_` 複本（結構照抄、資料從真表複製），不碰 `v3_` 真表、不寫 `d1_migrations`，做完全部 DROP。收尾查過：`zz557_` 0 個，真表 54 張、觸發器 75 個、`d1_migrations` 仍是 0000、0001。

- 觸發器**內文**用到要刪的欄 → D1 擋：`error in trigger … after drop column: no such column`。
- 欄只出現在觸發器 `UPDATE OF` 清單 → 不擋，但觸發器文字留著已刪的欄名，所以 0003 先換觸發器。
- 一個檔中途失敗 → 整檔回復（前面的 CREATE 也沒留下）。
- 照 0003 草稿順序整檔一次：17 句、讀 11,346 列、寫 1,962 列、62 ms；116 列逐欄跟真表一樣；`small` 保留；重建的版本表觸發器照常加 1；`sheet_sig`、`walks_synced` 刪掉。
- 本機 SQLite 也驗過：空庫 0000→0003 跟草稿 schema 一樣（表 54→48、觸發器 57）；空庫直接 `DROP COLUMN walks` 會失敗（欄只在正式庫），所以 `v3_pack_versions` 用整張重建。

## 例外、未完成

- `worker/src/today.js`、`index.js` 只動了 `v3_volunteer_codes` 那一句；#558 第一步同時在改這兩個檔的舊入口，合併時可能要手動解衝突。
- 本機 `check-local.ps1 -Full`：Node 437／441，失敗 4 個是 `scripts/local-check.test.mjs`（乾淨 origin/main 另開 worktree 也一樣 4 個）。-Full 遇 Node 失敗就停，網頁 21 套另用 `-Suite` 全跑：全過。
- 第二步（0003、`compact-schema.sql`、synced_at／舊編號表的兩句清理、8 個測試檔的 INSERT、`compact-schema.test.mjs` 表清單、cpu-bench）見 PR 說明。
- PR：#575（草稿）。
