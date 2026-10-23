# 預覽測試庫改從正式 D1 複製（#520）

- 日期：2026-10-24。Agent：Claude。分支 `claude/520-preview-db-copy`。
- 問題：#501 退役試算表同步後，「準備預覽資料庫」只建表，測試庫停在舊資料。
- 改法：新增 `scripts/copy-prod-d1.mjs`：正式庫 `wrangler d1 export`（只讀）→ 列出測試庫物件，`dropAllSql` 刪觸發器、檢視、資料表（依 REFERENCES 排序，子表先刪；略過 `sqlite_`、`_cf_`）→ 匯入匯出檔。workflow 改跑這支，再比對兩邊 `v3_dogs`／`v3_sheet_main` 筆數與編號。
- 移除 `scripts/copy-fixed-care.mjs`（整份複製後已包含固定照顧）；`docs/setup/CLOUDFLARE_SETUP.md` 同步改寫。
- 測試：`scripts/copy-prod-d1.test.mjs`。
- 未驗證：沒有實際跑 workflow（需要 Cloudflare token）；`d1 export` 匯出檔裡觸發器的順序、匯入時觸發器是否改寫資料，待 K 手動跑一次確認。測試庫會含正式庫的志工資料，預覽網址的存取範圍同正式。
- 本機檢查：`check-local.ps1 -Full` Node 483 過、4 失敗，都在 `scripts/local-check.test.mjs`（不含本變更時同樣失敗，屬既有環境問題）；瀏覽器測試因 Node 失敗未跑，本變更不碰前端。
- 相關 PR：見本分支草稿 PR。
- 第一次在 PR 分支跑 workflow（run 40007686023）失敗：匯出、清空成功，匯入時 `statement too long: SQLITE_TOOBIG`。原因：Worker 存資料包每段到 1MB（參數綁定），匯出成 SQL 文字後 `v3_walk_packs` 一列 115KB，超過 D1 單句上限。此時測試庫是空的。
- 修正：`splitLongInserts` 把超過 90KB 的 INSERT 中最長字串分段接到暫存表 `_copy_long`，原處換成子查詢讀回，結束後刪暫存表。用本機匯出的正式庫檔（看完即刪）驗證：拆後最長 90000 bytes，拆前拆後各灌一次記憶體 SQLite，54 張表內容相同。匯出檔裡觸發器排在所有 INSERT 之後，匯入時不會觸發。
