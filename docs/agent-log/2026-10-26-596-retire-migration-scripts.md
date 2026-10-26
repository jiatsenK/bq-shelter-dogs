# #596 一次性搬遷腳本退役

- 日期：2026-10-26。Agent：Claude（Opus 5.5）；分支 `claude/596-retire-migration-scripts-733e5c`，基準 origin/main `2feead4`。由主工作階段交辦。
- 依據：#596；K 2026-10-26 決定表中六支全刪，`scripts/departed-card.mjs` 也一起刪（K 不再使用）。
- 刪除（7 支腳本、6 支測試）：`scripts/import-compact-dogs.mjs`、`import-compact-profiles.mjs`、`import-compact-departures.mjs`、`migrate-compact-db.mjs`、`migrate-volunteer-identity.mjs`、`import-activities.mjs`、`departed-card.mjs` 與各自的 `*.test.mjs`（`migrate-volunteer-identity` 本來就沒有測試）。Node 測試檔 64 → 58。
- 仍被當測試工具用的部分：
  - `migrate-compact-db.mjs` 的 `splitStatements`、`compactSchemaStatements` 搬到新的 `scripts/compact-schema.mjs`，另加 `createCompactDatabase`（照 `db/compact-schema.sql` 建空庫）取代 `migrateCompactDatabase`。舊函式多做的 ALTER 補欄位，在空庫上本來就不會動（欄位已在 schema 裡）；預覽測試庫補欄位的 CLI 入口 workflow 早已不用（`seed-preview-db.yml` 改用 `copy-prod-d1.mjs`）。
  - `scripts/d1-migrations.mjs` 只改 import 來源一行（`splitStatements`），行為不變。
  - `import-compact-dogs／profiles／departures` 的寫入部分搬到 `worker/test/compact-fixtures.mjs`，只給 worker 測試灌資料；格式驗證、讀回比對一起退役。
  - `worker/test/identity.test.mjs`：原本呼叫 `migrateVolunteerIdentity`，改直接呼叫它包的 `linkIdentityName`，並改查未知代號仍留在 `v3_card_opened`；「取消常溜後重接不復活」「更名與編輯紀錄失敗一起回復」照測。
  - `scripts/compact-schema.test.mjs` 刪兩個只測 ALTER 補欄位的測試（固定照顧、#246 `v3_walks` 兩欄）：那是退役腳本的功能，現在結構變更走 `migrations/`，`d1-migrations.test.mjs` 照樣檢查空庫跑完全部 migration 跟 schema 一致。
- 文件：ADR 0002、ADR 0015 註明已完成、腳本退役、程式見 commit `2feead4`；`docs/design/history/COMPACT_D1.md`、`267-identity-rollout.md` 開頭加同樣註記（內文是歷史，不改）；`db/compact-schema.sql`、`worker/src/dog-list.js` 改掉指向已刪腳本的註解。研究文件、`migrations/0000` 註解不改。
- 審查：code-review 兩軸。Spec 無阻擋項。Standards 無硬性違規；採納「fixtures 檔頭註明測試專用、不搬進 worker/src（#408）」；其餘命名、重複查編號表的建議是原腳本照搬的寫法，測試輔助不另重構。
- 測試：`check-local.ps1 -Full` Node 440 個測試 436 過，4 個失敗都在 `scripts/local-check.test.mjs`（這台 pwsh 執行原則問題，乾淨 main 也一樣，不在本票範圍）；Node 失敗所以全套沒接著跑網頁測試，另用 `-Suite` 跑全部 25 個網頁套件：253 項全過。
- 未做：沒推送、沒開 PR，等 K 交辦。
- 相關 PR：無（尚未開）。
