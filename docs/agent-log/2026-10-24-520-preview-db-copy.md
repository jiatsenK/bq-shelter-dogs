# 預覽測試庫改從正式 D1 複製（#520）

- 日期：2026-10-24。Agent：Claude。分支 `claude/528-stale-fingerprint`（接在 #528 後）。
- 問題：#501 退役試算表同步後，「準備預覽資料庫」只建表，測試庫停在舊資料。
- 改法：新增 `scripts/copy-prod-d1.mjs`：正式庫 `wrangler d1 export`（只讀）→ 列出測試庫物件，`dropAllSql` 刪觸發器、檢視、資料表（依 REFERENCES 排序，子表先刪；略過 `sqlite_`、`_cf_`）→ 匯入匯出檔。workflow 改跑這支，再比對兩邊 `v3_dogs`／`v3_sheet_main` 筆數與編號。
- 移除 `scripts/copy-fixed-care.mjs`（整份複製後已包含固定照顧）；`docs/setup/CLOUDFLARE_SETUP.md` 同步改寫。
- 測試：`scripts/copy-prod-d1.test.mjs`。
- 未驗證：沒有實際跑 workflow（需要 Cloudflare token）；`d1 export` 匯出檔裡觸發器的順序、匯入時觸發器是否改寫資料，待 K 手動跑一次確認。測試庫會含正式庫的志工資料，預覽網址的存取範圍同正式。
- 本機檢查：`check-local.ps1 -Full` Node 483 過、4 失敗，都在 `scripts/local-check.test.mjs`（不含本變更時同樣失敗，屬既有環境問題）；瀏覽器測試因 Node 失敗未跑，本變更不碰前端。
- 相關 PR：尚未開；與 #528 同分支，開 PR 時決定是否拆開。
