# 2026-10-20 預覽版狀態頁附上讀不到的原因

- Agent：Claude Code。
- 依據：#433 補完測試庫（建表 39 張、匯入 743 列）後，#432 預覽的 `/api/` 仍是「D1（讀不到資料包版本號）」。預覽看不到 Cloudflare 紀錄，本環境也連不到預覽網址，無法得知真正錯誤。
- 改動：`worker/src/index.js` 的 `databaseStatus` 在 PREVIEW 時把錯誤訊息接在後面；正式版不變、不外露。
- 測試（先紅後綠）：`worker/test/d1-read.test.mjs` 狀態頁那項加一句預覽版斷言。Node 341/341。
- 下一步：這張 PR 加 preview 標籤，打開預覽的 `/api/` 看原因，再決定修法（同一張 PR 繼續修）。

## 找到原因並修正（同 PR）
- 預覽狀態頁回 `no such column: c.fixed_care`：測試庫的表是 fixed_care（#399）加入前建的，`CREATE TABLE IF NOT EXISTS` 不會改舊表，正式庫當初另外補過。
- `scripts/migrate-compact-db.mjs`：抽出 `addedColumnsSql`（只產生缺的 ALTER），`migrateCompactDatabase` 改用它；直接執行時只對測試庫補欄位。
- `.github/workflows/seed-preview-db.yml`：建表後加「測試庫補欄位」步驟。
- 測試（先紅後綠）：新增 `scripts/migrate-compact-db.test.mjs`。Node 342/342。
- 合併後要再跑一次「準備預覽資料庫」。
