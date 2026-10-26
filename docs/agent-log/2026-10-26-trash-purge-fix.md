# 照片垃圾桶清理：首跑前修正（稽核第 6 項）

- 日期：2026-10-26。Agent：Claude。分支 `claude/trash-purge-fix`（從 main `e9e8f23` 開）。
- 依據：2026-10-26 架構稽核第 6 項；K 2026-10-26 選「修好自動清理」（B），不改成手動清。正式環境第一次清理是 2026-11-01 09:53（#601 之後跟保險掃描同一個排程）。
- 確認：網站沒有「刪照片」，只有「換照片」；溜狗網站、管理網站換照片都先把舊照片備份到 `trash/`，備份失敗就不換。#566（10/25）以前換照片會蓋掉 `photos/{編號}.jpg`，所以 K 以前手動刪過垃圾桶不會留下多餘的舊原圖，只是那些舊照片不能復原。
- 改了什麼：
  - `worker/src/r2.js` `purgeTrash`：逐筆 try/catch，回傳 `{ purged, failed, errors }`（最多 5 筆錯誤）；32 碼舊原圖只在 D1 `v3_photos` 有這列且 `is_primary=0` 時刪，並刪那列；先刪原圖、刪列，最後才刪備份；只剩 `thumb.jpg` 的備份照代號開頭的時間清。
  - `worker/src/index.js` `maintenance`：`trash_purged` 記 `{ at, purged, failed, errors? }`，寫不進去改 `console.error`；有失敗時丟錯，讓 `cron_trash` 記 `failAt`。
  - `worker/src/dog-photo.js`、`worker/src/admin/index.js`：管理網站垃圾桶列表、預覽、復原也認 #566 以前用編號（含舊編號）記的備份；列表回 `days`。
  - `admin/public/js/dog-editor.js`：每筆顯示台灣時間的換掉時間與哪一天清理會刪掉（`trashLabel`）。
  - 測試：`worker/test/r2.test.mjs`（部分失敗、只剩縮圖、D1 記得／是主照片／沒記的、刪列失敗下月補完、舊編號備份）、`scripts/admin-table.test.mjs`（`trashLabel`）。
  - 文件：`docs/ARCHITECTURE_NOW.md` 排程表、`docs/design/admin.md`。
- 刪 D1 列會觸發 `v3_dog_edit_state.revision` 與清單版本 +1；清理在 09:53，剛好有人在編輯同一隻狗會被要求重新讀取，可接受。
- 「上次清理」沒有另做畫面：管理網站「資料檢查」的排程卡片（#601）已顯示 `cron_trash`，有失敗時錯誤訊息含筆數與代號。
- 未做：沒有在正式或測試環境實跑；正式 `trash/` 筆數仍未知（wrangler 4 沒有 object list）。驗收步驟見下。
- 相關 PR：（開草稿後補）

## 驗收步驟

前提：本 PR 在 2026-11-01 09:53 前合併並部署到正式版；沒趕上的話，11/01 跑的是舊程式（只有整批成功或整批失敗）。

### 合併後、11/01 前：測試網站跑一次

測試網站沒有保險掃描排程，要在本機手動觸發一次（會同時對測試環境跑一次保險掃描）。

1. 測試網站管理頁挑一隻狗，**換照片兩次**（第二次才會讓一張 32 碼舊原圖進垃圾桶）。
2. 在 repo 根目錄開兩個終端機。第一個：

   ```powershell
   npx.cmd wrangler@4 dev --remote --config wrangler.test-site.jsonc --test-scheduled
   ```

3. 第二個，假裝現在是 2026-12-01 09:53（這樣剛換掉的備份已超過 30 天）：

   ```powershell
   curl.exe "http://localhost:8787/cdn-cgi/handler/scheduled?cron=53+1,5,15+*+*+*&time=1796089980"
   ```

4. 查結果：

   ```powershell
   npx.cmd wrangler@4 d1 execute bq-shelter-dogs-test --remote --config wrangler.test-site.jsonc --command "SELECT key,value FROM v3_sync_state WHERE key IN ('trash_purged','cron_trash'); SELECT object_key,is_primary FROM v3_photos"
   ```

   - `trash_purged`：`at` 是 `2026-12-01T01:53:00.000Z`、`failed` 是 0、`purged` 至少 2。
   - `v3_photos`：那隻狗只剩一列 `is_primary=1`。
   - 管理網站那隻狗的垃圾桶：已清掉的不再出現；狗卡照片正常。

### 2026-11-01 09:53 之後：正式環境

```powershell
npx.cmd wrangler@4 d1 execute bq-shelter-dogs --remote --command "SELECT key,value FROM v3_sync_state WHERE key IN ('trash_purged','cron_trash')"
```

- `trash_purged` 存在，`at` 是 `2026-11-01T01:53:00.000Z`（台灣 09:53）、`failed` 是 0。
- `cron_trash` 的 `okAt` 是同一個時間，沒有比它新的 `failAt`；管理網站「資料檢查」排程卡片的照片垃圾桶不是紅字。
- 有失敗：`trash_purged.errors` 列出備份代號與原因，那幾筆備份還在，下個月 1 日會再試。
