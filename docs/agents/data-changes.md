# 資料變更入口

- **動到資料寫入前，先讀對應的 ADR**（K 的決定，以 ADR 為準）：
  - 寫試算表（任何欄位、分頁）→ `docs/adr/0006-sheet-write-scope.md`
  - 存使用者資料（開卡、常溜等）→ `docs/adr/0001-volunteer-data-follows-code.md`
  - 入所日、舊編號、補登舊入所日 → `docs/adr/0005-intake-date-from-oldest-number.md`、`docs/adr/0011-intake-date-manual-backfill.md`
  - 志工身分、更名、合併 → `docs/adr/0005-volunteer-identity.md`、`GLOSSARY.md`
  - 活動紀錄、已出所狗卡 → `docs/adr/0002-activity-records.md`
  - 新增會改資料的功能（編輯紀錄、沒有通關碼）→ `docs/adr/0004-open-editing-and-edit-log.md`
  - 今天溜過要讓其他手機很快看到（今日溜狗紀錄、免費方案額度）→ `docs/adr/0007-today-walks-live.md`
  - 新增 D1 資料表、觸發器、預設列 → 寫進 `db/compact-schema.sql`；同步補建哪些以 `scripts/sync-compact-d1.mjs` 為準：整份送出，只排除 `SYNC_SCHEMA_SKIP` 明列的例外（#293、#321）
  - 狗清單、離所、休養讀到新的表 → 在 `db/compact-schema.sql` 補 `packs_<表>_INSERT／UPDATE／DELETE` 觸發器，不然改了資料網站不會更新；離所按出所年份讓 `v3_departure_versions` 那年加 1（`docs/adr/0009-d1-read-versioned-packs.md`、ADR 0014；`worker/test/packs.test.mjs` 會檢查，#322）
  - 改同步、或新增會寫 D1 的功能（每天寫入預算、只寫差異）→ `docs/adr/0008-diff-sync-and-write-budget.md`；PR 要附預演結果（`測試` CI 的同步預演步驟會自動留言「預演：會寫 N 列」，#309、#329）
