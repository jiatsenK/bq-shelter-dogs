# 刪照片搬遷用的 /admin/migrate、/admin/verify（#593）

- 日期：2026-10-26。Agent：Claude。分支 `claude/593-photo-migrate-api`（從 main `9360e7f` 開）。
- 依據：#593（2026-10-26 稽核開立），K 2026-10-26 交辦接著做。
- `worker/src/index.js`：刪 `/admin/migrate`、`/admin/verify` 路由與只給它們用的 `MIGRATE_MAX_ITEMS`、`cleanItems`、`migrate`、`verify`。#130 搬照片到 R2 早就完成，舊檔 `public/photos/` 與搬遷腳本已刪（#275），repo 內沒有呼叫者。打這兩個路徑現在回 404「沒有這個管理功能」。
- 不動：`/admin/thumbs`（人工補縮圖還在用）、`/admin/trash` 與還原（K 2026-10-26 決定保留，照片可還原的方法）。
- 測試：`worker/test/r2.test.mjs` 刪舊搬遷測試、加「兩個路徑回 404」；「預覽版不能寫」改用垃圾桶還原驗證（原本用 migrate）。
- 測試輔助：`worker/test/fakes.mjs` 拿掉只給搬遷用的 `sha` 匯出與假 R2 的 `sha256` 檢查（正式程式已沒有傳 `sha256`）。
- 文件：`docs/setup/CLOUDFLARE_SETUP.md` 管理 API 清單拿掉這兩個。同檔第 63 行 `ADMIN_KEY` 列的「搬照片」沒改，因為草稿 PR #599 也改那一行，等它合併後再順手改，避免衝突。
- 本機檢查：Worker 測試 fail 0；網頁 25 套 264 項全過。完整 Node 時 `scripts/admin-stage4.test.mjs` 又失敗（#591 那次也是），單獨跑會過，與本票無關。`scripts/local-check.test.mjs` 本機 `pwsh` 執行原則問題另計。
- K 2026-10-26 交辦推送並開草稿 PR。
- 相關 PR：#603（草稿）。
