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
- 未做：正式環境還沒跑過（等 11/01）；正式 `trash/` 筆數仍未知（wrangler 4 沒有 object list）。測試環境 2026-10-26 已實跑，結果見下。
- 相關 PR：#617（10/26 合併，正式網站、測試網站、管理網站都已部署）；驗收第 1 步改正與測試結果另開小 PR。

## 驗收步驟

前提：本 PR 在 2026-11-01 09:53 前合併並部署到正式版；沒趕上的話，11/01 跑的是舊程式（只有整批成功或整批失敗）。

### 合併後、11/01 前：測試網站跑一次

**管理網站只有正式版**（`wrangler.admin.jsonc` 綁正式 R2＋D1），這一段不要在管理網站做。測試網站（`wrangler.test-site.jsonc`）綁 `bq-shelter-photos-test`＋`bq-shelter-dogs-test`，跟正式完全分開。

1. 打開**測試網站**（溜狗網站），點一隻狗的**詳細資訊**，按相機按鈕「更換照片」，**換兩次**（第二次才會讓一張 32 碼舊原圖進垃圾桶）。
2. 測試網站沒有保險掃描排程，在本機直接呼叫 `maintenance`，綁測試 R2＋D1，時間假裝是 2026-12-01 09:53（剛換掉的備份已超過 30 天）。這樣不會順便跑保險掃描，也不經過 `recordRun`，所以不會寫 `cron_trash`。
   - wrangler 登入要有 D1、R2 權限；只有 `user (read)` 等權限時先跑 `npx.cmd wrangler@4 login`。
   - 在 repo 外的暫存資料夾 `npm install wrangler@4`，放一份只有綁定的設定檔（R2、D1 加 `"remote": true`，名稱、id 照 `wrangler.test-site.jsonc`），再跑：

   ```js
   import { getPlatformProxy } from 'wrangler';
   import worker from 'file:///<repo>/worker/src/index.js';
   const { env, dispose } = await getPlatformProxy({ configPath: './test-bindings.jsonc', remoteBindings: true });
   try { console.log(await worker.testing.maintenance(env, Date.UTC(2026, 11, 1, 1, 53))); } finally { await dispose(); }
   ```

3. 看結果：`trash_purged` 的 `at` 是 `2026-12-01T01:53:00.000Z`、`failed` 是 0；那隻狗在 `v3_photos` 只剩一列 `is_primary=1`；第二次換掉的 32 碼舊原圖與縮圖已刪；固定路徑 `photos/{編號}.jpg` 還在；測試網站那隻狗的照片正常。

#### 2026-10-26 測試結果（全部符合）

K 在測試網站幫編號 2019121309 換兩次照片，Claude 用上面的方法跑一次清理（只連測試 R2＋D1）。

| 項目 | 清理前 | 清理後 |
|---|---|---|
| `trash/` | 2 筆（`1792996365064-27ad` 備份 `photos/2019121309.jpg`；`1792996382892-bc9a` 備份 32 碼 `be049a15…`） | 空 |
| `photos/be049a15….jpg`＋縮圖（換下來的舊原圖） | 在 | 已刪 |
| `photos/48a58d0c….jpg`＋縮圖（主照片） | 在 | 在 |
| `photos/2019121309.jpg`（固定路徑） | 在 | 在 |
| `v3_photos` | 2 列（`be049a15…` `is_primary=0`、`48a58d0c…` `is_primary=1`） | 1 列（`48a58d0c…` `is_primary=1`） |
| `trash_purged` | 沒有 | `{"at":"2026-12-01T01:53:00.000Z","purged":2,"failed":0}` |

測試 D1 的 `trash_purged` 留著假的未來時間；測試網站沒有清理排程，不會被蓋掉，不影響任何東西。

### 2026-11-01 09:53 之後：正式環境

```powershell
npx.cmd wrangler@4 d1 execute bq-shelter-dogs --remote --command "SELECT key,value FROM v3_sync_state WHERE key IN ('trash_purged','cron_trash')"
```

- `trash_purged` 存在，`at` 是 `2026-11-01T01:53:00.000Z`（台灣 09:53）、`failed` 是 0。
- `cron_trash` 的 `okAt` 是同一個時間，沒有比它新的 `failAt`；管理網站「資料檢查」排程卡片的照片垃圾桶不是紅字。
- 有失敗：`trash_purged.errors` 列出備份代號與原因，那幾筆備份還在，下個月 1 日會再試。
