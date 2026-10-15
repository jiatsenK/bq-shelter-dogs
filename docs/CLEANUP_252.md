# #252 搬遷最後清除：執行前準備

狀態：**尚不可執行正式清除**。前置程式與刪檔驗證已在分支實作；依 K 後續指示，分支暫時移除 `data/`、`dogs/` 測試，main 未變更。完整失敗清單、六類比對及十筆性別差異與兩筆額外身分見 [刪檔驗證報告](CLEANUP_252_AUDIT.md)。尚待性別補值決策、重新比對與 72 小時觀察驗收，本票未完成。

依 #245／#252，#251 在 2026-10-15 上線後須完整觀察 72 小時且沒有問題，最早 2026-10-18；執行前仍須從正式部署及成功同步紀錄確認實際起算時間，不能只看 Issue 關閉時間或午夜。10/16 的搬遷目標不縮短等待期。由 K 確認／執行清除；不改寫 Git 歷史。

## 已確認決策與阻擋

以下保留原始檢核依據。程式前置已完成：備註 API 回 410、同步改讀 D1 性別／編號、部署停止讀舊 JSON、測試改合成 fixture。正式資料的十筆性別差異仍未修復；不得把程式測試通過視為資料比對一致。

- K 於 2026-10-15 確認「我的備註」退役，可移除功能與 `data/my-notes.json`。前端 #141 已拿掉入口，仍須移除 Worker `/notes`、`/notes/{編號}` 的 GitHub 讀寫及對應測試，舊路徑和 `/api/notes` 都不可再寫入。**保留 `NOTES_PASSCODE`**：休養、介紹、管理仍共用它。試算表的備註欄不受此決策影響。
- 性別已在 `v3_dogs.sex`，但 `scripts/sync-compact-d1.mjs` 的 `buildData` 仍透過 `attachDogCards` 讀 `dogs/*.md`。缺檔回空性別，後續匯入會覆蓋 D1；須先改成從永久狗／編號對照讀取並保留性別，確認新狗、無編號狗、再入所的行為。狗卡還提供 `formerIds`，不能只救性別卻遺失舊編號關係。
- `.github/workflows/deploy-cloudflare.yml` 還跑 `scripts/photo-versions.mjs`，直接讀寫 `data/dogs.json`；預覽部署也須查。刪檔前須解除部署與執行中程式對舊資料的依賴，不能靠重新產生舊資料繞過清除。
- `build-db.test.mjs`、`import-compact-dogs.test.mjs`、`import-compact-departures.test.mjs`、`sync-compact-d1.test.mjs` 等仍讀 repo 真實資料。先換成小型合成 fixture，不把整份正式資料搬到測試目錄。舊搬遷工具可保留，但要明確接受封存來源，不能在部署／同步自動執行。
- 本票內完成上述前置與清除準備，不自行新增前置票。未完成前不建立 `data-final`、不刪檔、不刪表。

## 清除前驗收

1. #247～#251 已完成，正式部署與同步持續正常滿 72 小時；K 確認無需退回。
2. 不讀 `dogs/` 的同步演練仍保留既有性別、永久 ID、編號關係、介紹、休養、開卡、溜狗及離所紀錄，重跑不遺失資料。只在本機假 D1 驗證，正式同步另由 K 確認。
3. 備註 API 退役，網站仍可讀寫介紹、休養；通關碼及試算表原有兩欄寫入契約不變。
4. 清除分支中刪去 `data/`、`dogs/` 後，AGENTS.md 與 CI 的完整 Node 和 headless 網頁測試皆通過；正式與預覽打包不依賴那些目錄。
5. K 確認清除 PR；合併會自動部署正式網站。不要因文件準備完成而關閉 #252 或 #245。

## Git 封存與刪除順序（等待期及前置完成後）

先確認 origin 為 `https://github.com/jiatsenK/bq-shelter-dogs.git`，沒有其他人的未提交變更。刪除以一般 PR 完成，不 force push。

`data-final` 必須指向真正刪除前的 main 提交，不能今天先打在準備文件的提交。清除合併前暫停其他 main 寫入、fetch，記錄 main SHA；若 main 移動，重新確認標籤與清除內容。標籤已存在就停下核對，不強制覆蓋。

以下只供 K 在前置完成後執行，會建立遠端封存標籤：

```powershell
Set-Location C:\Users\User\repos\bq-shelter-dogs
if (!(Test-Path -LiteralPath .\wrangler.jsonc)) { throw '工作目錄錯誤' }
git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'fetch 失敗' }
$cleanupBase = git rev-parse origin/main
git tag -a data-final $cleanupBase -m 'Archive data before issue #252 cleanup'
if ($LASTEXITCODE -ne 0) { throw '建立標籤失敗，停止' }
git push origin refs/tags/data-final
if ($LASTEXITCODE -ne 0) { throw '推送標籤失敗，停止' }
git ls-remote origin refs/tags/data-final 'refs/tags/data-final^{}'
```

清除 PR 從這個 main 提交刪除 `data/`（已包含 `data/history/` 和 `data/my-notes.json`）、`dogs/`；根目錄若有 `my-notes.json` 也列入，實際現用路徑是 `data/my-notes.json`。先檢視 `git ls-tree -r --name-only origin/main data dogs my-notes.json`，再由 K 確認最終 diff。封存標籤和 Git 歷史保留舊資料，不是抹除歷史。合併前後都核對標籤解析的 SHA、main 資料路徑、測試與部署結果。

## 舊 D1：盤點及備份（K 執行）

目標是正式 `bq-shelter-dogs`，設定 ID `6cd6c304-0fed-4ddb-b9ec-799e60a4adb4`；**不能刪整個資料庫**，同庫的 `v3_*` 是現行資料。以下沿用 repo 的 `npx --yes wrangler@4`，語法依 [Cloudflare D1 指令文件](https://developers.cloudflare.com/d1/wrangler-commands/)。沒有在本次連線或匯出正式 D1；實際表清單仍待執行日唯讀盤點。

先確認登入帳號、資料庫 ID、既有表與外鍵；若有下列清單以外的業務表／外鍵，停止並補盤點，不猜刪除範圍。備份含私密資料，只存已忽略的 `.migration-private/252/`，不可提交或貼到 Issue。

```powershell
Set-Location C:\Users\User\repos\bq-shelter-dogs
if (!(Test-Path -LiteralPath .\wrangler.jsonc)) { throw '工作目錄錯誤' }
npx --yes wrangler@4 whoami
npx --yes wrangler@4 d1 info bq-shelter-dogs --json
npx --yes wrangler@4 d1 execute bq-shelter-dogs --remote --config wrangler.jsonc --command "SELECT name,sql FROM sqlite_schema WHERE type='table' ORDER BY name" --json
New-Item -ItemType Directory -Force -Path .migration-private/252 | Out-Null
$cleanupStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$cleanupBackup = ".migration-private/252/before-cleanup-$cleanupStamp.sql"
npx --yes wrangler@4 d1 export bq-shelter-dogs --remote --config wrangler.jsonc --output $cleanupBackup
if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $cleanupBackup)) { throw '備份失敗，禁止刪表' }
Get-Item -LiteralPath $cleanupBackup | Select-Object Name,Length
Get-FileHash -LiteralPath $cleanupBackup -Algorithm SHA256
```

備份要先在隔離本機資料庫驗證可讀，核對新表筆數、開卡和名字推薦搬遷結果。`data-final` 不包含 D1，不能取代這份備份。刪除前再次確認 Worker、同步、部署沒有使用舊表；刪除後不能再跑舊建表／搬遷工具重建舊表。

## 舊 D1 刪表候選指令（K 執行，現在不可執行）

後果：下面會永久移除舊表的結構與資料、相關索引；不會移除 `v3_*`、D1 系統表或 R2。舊資料若未正確搬遷，刪後只能靠備份處理；不要把全庫備份直接覆蓋回正式庫，會蓋掉清除後的新紀錄。先在隔離環境驗證還原，再規劃必要的舊表還原。

以下是依 `db/schema.sql`、`db/migrations/0001`～`0003` 推導的候選順序（子表先刪）。**必須與執行日實際 schema 核對後，K 才能使用**；不關閉外鍵檢查，也不以名稱前綴動態產生 DROP。遇到錯誤立即停止，不繼續下一批。

```powershell
Set-Location C:\Users\User\repos\bq-shelter-dogs
if (!(Test-Path -LiteralPath .\wrangler.jsonc)) { throw '工作目錄錯誤' }
$cleanupSql = @'
DROP TABLE IF EXISTS v2_profile_sources;
DROP TABLE IF EXISTS v2_history_sources;
DROP TABLE IF EXISTS v2_changes;
DROP TABLE IF EXISTS v2_sheet_observations;
DROP TABLE IF EXISTS v2_source_bindings;
DROP TABLE IF EXISTS v2_walk_group_members;
DROP TABLE IF EXISTS v2_walk_participants;
DROP TABLE IF EXISTS v2_card_opened;
DROP TABLE IF EXISTS v2_rest_settings;
DROP TABLE IF EXISTS v2_dog_photos;
DROP TABLE IF EXISTS v2_walker_codes;
DROP TABLE IF EXISTS v2_operations;
DROP TABLE IF EXISTS v2_daily_walks;
DROP TABLE IF EXISTS v2_admission_numbers;
DROP TABLE IF EXISTS v2_admissions;
DROP TABLE IF EXISTS v2_walk_groups;
DROP TABLE IF EXISTS v2_sync_runs;
DROP TABLE IF EXISTS v2_walkers;
DROP TABLE IF EXISTS v2_dogs;
DROP TABLE IF EXISTS card_opened;
DROP TABLE IF EXISTS walker_names;
DROP TABLE IF EXISTS changes;
DROP TABLE IF EXISTS walks;
DROP TABLE IF EXISTS dogs;
DROP TABLE IF EXISTS kv;
'@
npx --yes wrangler@4 d1 execute bq-shelter-dogs --remote --config wrangler.jsonc --command $cleanupSql
if ($LASTEXITCODE -ne 0) { throw '刪表未完成，停止並唯讀盤點，不直接重跑或還原全庫' }
npx --yes wrangler@4 d1 execute bq-shelter-dogs --remote --config wrangler.jsonc --command "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name; PRAGMA foreign_key_check;" --json
```

執行後核對所有 `v3_*` 筆數及關鍵資料與刪除前一致，API 的狗清單、介紹、休養、溜狗、離所、開卡及名字推薦正常。真實寫入驗收只由 K 確認後進行；不拿正式資料做破壞性測試。把實際時間、封存 SHA、PR、部署／同步與驗收結果記在 #252，再決定關閉本票與 #245。

## 另外兩個 D1 資料庫（K 執行，正式庫刪表並驗收後）

2026-10-15 盤點：帳號內除正式 `bq-shelter-dogs`（約 0.2 MB）外，還有兩個本專案資料庫，各約 6.4 MB，都是精簡前的 `v2_*` 舊表：

- `bq-shelter-dogs-test`（`9e23a65c-…`）：預覽環境仍綁定（`wrangler.jsonc` 的 `preview_database_id`、`wrangler.preview*.json`、`wrangler.preview-db.jsonc`），**不能刪整個資料庫**。用上面同一份 `$cleanupSql`，把目標換成 `bq-shelter-dogs-test --remote --config wrangler.preview-db.jsonc` 刪舊表；刪前同樣先 `d1 export` 到 `.migration-private/252/`。刪後確認預覽網站仍正常。
- `bq-shelter-dogs-restore-219`（`ea73d67a-…`）：#219 處理時還原出的備份，沒有任何設定檔使用。正式庫已另做 #252 刪表前備份並驗證可讀後，才可整庫刪除；刪除無法復原：

```powershell
Set-Location C:\Users\User\repos\bq-shelter-dogs
if (!(Test-Path -LiteralPath .\wrangler.jsonc)) { throw '工作目錄錯誤' }
$env:CLOUDFLARE_ACCOUNT_ID = "a0f88d34c34ad0d34f923b9f43799622"
npx --yes wrangler@4 d1 list
npx --yes wrangler@4 d1 delete bq-shelter-dogs-restore-219
```

同帳號的 `shared-trip-planner`、`event-accounting-v2` 屬其他專案，不在本票範圍。
