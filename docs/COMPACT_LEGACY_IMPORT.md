# #249：開卡與名字推薦匯入

只讀舊 D1 匯出的 `cardOpened`、`walkerNames`，只合併 `v3_card_opened`、`v3_volunteers`。不改 Worker、同步程式或表結構，不搬 `kv`，不建立狗、不推測志工代號和名字的關係。

## 函式契約

`scripts/import-compact-legacy.mjs` 提供：

- `importCompactLegacy(db, { cardOpened, walkerNames })`：完整驗證及確認編號後，以一個 D1 batch 交易合併。兩個陣列必填，空陣列可以；回傳來源去重後的筆數。
- `readCompactLegacy(db)`：回傳 `{ cardOpened, walkerNames }`，開卡的 `dog_id` 已是永久狗 ID，不是來源的收容所編號。
- `compareCompactLegacy(db, source, baseline?)`：逐筆比對，回傳 `{ equal, differences }`。差異含 `kind`、`key`、`field`、`expected`、`actual`；開卡 key 是「代號|永久狗 ID」，名字推薦 key 是名字，`field: '*'` 表示缺少或多出。
- `renderCompactLegacySql(source)`：產生可重跑的 SQL 字串，不連任何資料庫，不執行 SQL。執行時以編號查目標庫的永久狗 ID，不帶入本機演練 ID。

來源開卡的 `dog_id` 以 `v3_dog_numbers.number` 換永久 ID。同代號、同狗的多編號和多筆開卡取最早 `opened_on`；名字完全相同才合併，`last_seen` 依實際時間取較新，保留原時間字串。日期須為有效的 `YYYY-MM-DD`，時間須帶時區。不清表、不刪既有資料，重跑維持既有志工 ID，不填 `v3_volunteer_codes`。

若目標已經有資料，匯入前先用 `readCompactLegacy(db)` 保存 `baseline`，比對時傳入同一份 baseline，預期值才會包含需保留的既有較早開卡、較新推薦和其他志工。不要用匯入後的資料當 baseline。未傳入 baseline 時，預期值只有來源，適用空庫的第一次演練。

## 本機演練及產生待確認 SQL

在專用 worktree 執行以下 PowerShell；來源和 SQL 保留在原 repo 已忽略的 `.migration-private/`。SQL 只會在演練重跑一致、比對零差異且外鍵檢核通過後產生。既有 SQL 不覆寫，重跑可省略 `--sql` 或選不同輸出檔名。

```powershell
Set-Location 'C:\Users\User\AppData\Local\Temp\bq-shelter-dogs-issue-249'
$sourcePath = 'C:\Users\User\repos\bq-shelter-dogs\.migration-private\219\bq-219-legacy.json'
if (!(Test-Path -LiteralPath $sourcePath)) { throw '找不到指定的舊 D1 匯出' }
node scripts/check-compact-legacy.mjs $sourcePath
```

第一次產生 SQL：

```powershell
Set-Location 'C:\Users\User\AppData\Local\Temp\bq-shelter-dogs-issue-249'
$sourcePath = 'C:\Users\User\repos\bq-shelter-dogs\.migration-private\219\bq-219-legacy.json'
$sqlPath = 'C:\Users\User\repos\bq-shelter-dogs\.migration-private\249\compact-legacy-review.sql'
if (!(Test-Path -LiteralPath $sourcePath)) { throw '找不到指定的舊 D1 匯出' }
if (Test-Path -LiteralPath $sqlPath) { throw 'SQL 已存在，請直接開啟確認，或另選輸出檔名' }
node scripts/check-compact-legacy.mjs $sourcePath --sql $sqlPath
```

演練使用現有 `data/dogs.json` 在記憶體建立編號對照，並不代表正式庫已匯入。來源開卡有狗編號找不到時會停止，不猜配、不產生 SQL；應先確認正式狗／編號匯入完成及補上可靠對照。指定匯出只有 0 筆開卡、20 筆名字推薦，所以實際驗證開卡為零；合併規則另以固定測試驗證，不宣稱已查證正式庫最新狀態。

## 交給 K 確認

產出的 SQL 含志工名字，留在 `.migration-private/`，不可貼入 Issue／PR 或提交。只會 UPSERT 上述兩張表：保留更早開卡與較新的名字推薦。未知編號會受 NOT NULL 約束拒絕；這份 SQL 本身未宣告跨敘述交易，遠端執行中斷時可能只套用前幾筆，可安全重跑。

正式執行前由 K 確認目標 D1、備份、`v3_` 表及狗編號對照已存在，以及來源匯出是否仍適用。本票不執行正式匯入；確認後再安排執行與讀回比對。
