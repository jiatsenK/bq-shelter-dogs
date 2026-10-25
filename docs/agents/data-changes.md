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
  - 新增或改 D1 資料表、欄、索引、觸發器、預設列 → 照下方「D1 結構變更」寫 migration，同時改 `db/compact-schema.sql`
  - 狗清單、離所、休養讀到新的表 → 用 migration（並同步 `db/compact-schema.sql`）補 `packs_<表>_INSERT／UPDATE／DELETE` 觸發器，不然改了資料網站不會更新；離所按出所年份讓 `v3_departure_versions` 那年加 1（`docs/adr/0009-d1-read-versioned-packs.md`、ADR 0014；`worker/test/packs.test.mjs` 會檢查，#322）
  - 改同步、或新增會寫 D1 的功能（每天寫入預算、只寫差異）→ `docs/adr/0008-diff-sync-and-write-budget.md`；同步預演已隨 #501 退役，改由 `worker/test/dog-list.test.mjs` 等測試驗證「無差異不寫」

## D1 結構變更（#553，wrangler migrations）

- **一個變更一個檔**：新增 `migrations/NNNN_小寫名稱.sql`（接著上一號，不改已合併的檔）。D1 的 `d1_migrations` 表記著套過哪些。`0000_compact_schema.sql` 是起點，照抄當時的 `compact-schema.sql`；正式庫沒有執行它，只記為已套用。
- **`db/compact-schema.sql` 同時改**：它是「現在的完整樣子」，給測試和讀結構用，不直接對正式庫執行。`scripts/d1-migrations.test.mjs` 檢查空庫照順序跑完全部 migration，跟這份建出來的表、欄、索引、觸發器、預設列一樣；用 ALTER 補的欄要寫在這份建表 SQL 的最後面。
- **先加後刪**：
  - 加東西（表、欄、索引、觸發器）：同一張 PR 寫 migration 和用它的程式。合併後先套 migration 再部署（套用 workflow 會接著部署）。
  - 刪東西（DROP、搬資料）：先合併並部署不再用它的程式，下一張 PR 才寫刪除的 migration。
- **正式庫套用**：合併後到 Actions 按「套用 D1 migration」→「Run workflow」（`.github/workflows/d1-migrations.yml`）。它依序：有刪資料或搬資料的 migration 時，先把正式庫整份複製到專門的備用庫 `bq-shelter-dogs-backup`（不是預覽用的 `bq-shelter-dogs-test`）→ 記下套用前的 Time Travel 書籤 → `d1 migrations apply --remote` → 摘要印出書籤與還原指令 → 部署。
- **部署擋關**：`deploy-cloudflare.yml` 只送 SELECT 比對 `d1_migrations` 與 `migrations/`，有還沒套的就紅叉、不部署，提示按套用 workflow。合併含 migration 的 PR 會看到這個紅叉，按套用就好。
- **測試庫自動套**：預覽（`preview-cloudflare.yml`）上傳前、測試網站部署（`deploy-test-site.yml`）部署前自動對 `bq-shelter-dogs-test` 跑 `d1 migrations apply`，不用 K 按。測試庫從正式庫複製（「準備預覽資料庫」）時會帶著 `d1_migrations`。注意：PR 還沒合併的 migration 套進測試庫後就記為已套用，之後改了那個檔不會重套；要重來就跑「準備預覽資料庫」。
- **本機演練**：`node scripts/d1-migrations.mjs apply --target test`（加 `--backup always` 連複製一起練），`node scripts/d1-migrations.mjs check --target production` 只讀查正式庫還有沒有沒套的。
- **還原**：平常用 Time Travel 書籤；刪資料、搬資料的看備用庫。還原、DROP 這類覆蓋正式資料的指令交給 K 執行（CORE_RULES §5），寫成 `npx.cmd wrangler d1 time-travel restore bq-shelter-dogs --bookmark=<書籤>`。
