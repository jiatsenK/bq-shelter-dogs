# 資料變更入口

- **先看 `docs/adr/README.md`**（自動產生）：哪些 ADR 已被新的修訂、資料以誰為準，以及網站開關、Worker 設定、排程的現況。回答「資料在哪、以誰為準、開了沒」也從這裡查，不靠記憶。
- **動到資料寫入前，先讀對應的 ADR**（K 的決定，以 ADR 為準）：
  - 寫試算表（任何欄位、分頁）→ `docs/adr/0006-sheet-write-scope.md`
  - 存使用者資料（開卡、常溜等）→ `docs/adr/0001-volunteer-data-follows-code.md`
  - 入所日、舊編號、補登舊入所日 → `docs/adr/0005-intake-date-from-oldest-number.md`、`docs/adr/0011-intake-date-manual-backfill.md`
  - 志工身分、更名、合併 → `docs/adr/0005-volunteer-identity.md`、`GLOSSARY.md`
  - 活動紀錄、已出所狗卡 → `docs/adr/0002-activity-records.md`
  - 新增會改資料的功能（編輯紀錄、沒有通關碼）→ `docs/adr/0004-open-editing-and-edit-log.md`
  - 今天溜過要讓其他手機很快看到（今日溜狗紀錄、免費方案額度）→ `docs/adr/0018-today-walks-d1-event-sync.md`（取代 0007 的「試算表為正本」）
  - 新增 D1 資料表、觸發器、預設列 → 寫進 `db/compact-schema.sql`。舊同步程式（會整份補建 schema，#293、#321）已隨 #512 刪除，正式 D1 目前沒有自動套 schema 的路徑：PR 要寫明怎麼套到正式庫
  - 狗清單、離所、休養讀到新的表 → 在 `db/compact-schema.sql` 補 `packs_<表>_INSERT／UPDATE／DELETE` 觸發器，不然改了資料網站不會更新；離所按出所年份讓 `v3_departure_versions` 那年加 1（`docs/adr/0009-d1-read-versioned-packs.md`、ADR 0014；`worker/test/packs.test.mjs` 會檢查，#322）
  - 改同步、或新增會寫 D1 的功能（每天寫入預算、只寫差異）→ `docs/adr/0008-diff-sync-and-write-budget.md`；同步預演已隨 #501 退役，改由 `worker/test/dog-list.test.mjs` 等測試驗證「無差異不寫」
