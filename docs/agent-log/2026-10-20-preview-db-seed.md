# 2026-10-20 預覽測試庫補資料

- Agent：Claude Code。
- 依據：K 回報 PR 預覽網址顯示「狗的資料讀不到」。查到原因：預覽綁的隔離測試 D1（`bq-shelter-dogs-test`，#214）從建立後就沒有資料表與資料，預覽流程只驗證連線、不建表不匯入。K 同意加手動 workflow 補資料。
- 改動：
  - `scripts/sync-compact-d1.mjs` 加 `d1Target`：`SYNC_D1` 預設正式庫，只接受 `bq-shelter-dogs-test` 這個例外（並帶 `wrangler.preview-db.jsonc`），其他名字直接丟錯。正式同步行為不變。
  - 新增 `.github/workflows/seed-preview-db.yml`（只能手動跑）：先用 `db/compact-schema.sql` 在測試庫建表，再以全量模式從試算表同步進測試庫；單次門檻放寬到 5 萬列，每天帳號預算照舊檢查；與正式同步共用 `sync-sheet` 鎖。
  - `docs/setup/CLOUDFLARE_SETUP.md` 改寫測試庫那段說明。
- 測試（先紅後綠）：`scripts/sync-compact-d1.test.mjs` 加 `d1Target` 1 項。
- 未完成：workflow 要合併後由 K 在 Actions 按一次才會真的寫進測試庫；本環境沒有 Cloudflare 金鑰也連不到預覽網址，未實際跑過。第一次全量匯入的列數未知（狗、異動紀錄、溜狗紀錄全部），預估數千列，在每天預算內。
- 限制：預覽的溜狗紀錄只有試算表上那一段；休養、介紹、開卡、照片設定是網站直接寫的，預覽裡沒有。
- 注意：改到 `sync-compact-d1.mjs`，合併到 main 會觸發一次正式同步（差異同步，平常列數），PR 階段 tests.yml 會貼同步預演列數。
