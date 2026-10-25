# 離所改用狗 ID 記第一步（#560）

- 日期：2026-10-25。Agent：Claude。分支 `claude/560-departures-by-dog-id-10fd6d`，疊在 #578（`claude/559-walkers-groups-json-3658c8`，0004→0005）上面。
- 依據：#560（#521-8）；資料表稽核 2.7、4.3、5 節與觸發器稽核（PR #551）；`docs/agents/data-changes.md`「先加後刪」；ADR 0009、0014。
- 改動（只「加」，舊表不 DROP）：
  - `migrations/0006_dog_departures.sql`：新表 `v3_dog_departures`（主鍵狗 ID＋離所時的編號，編號 `''` 是只有名字的已出所狗卡；判讀旗標、舊編號、狗群改成 `flags_json`／`former_json`／`groups_json`），索引 `departed_date`、`number`；觸發器 `packs_v3_dog_departures_*` 只讓那一年加 1；`packs_v3_sheet_main／dog_numbers／rest／stays_*` 12 個改看新表（先 DROP 再建）；從 `v3_departures`＋`v3_departure_items`、`v3_departed_cards` 搬資料（重跑不重複）。
  - 編號原本交辦是 0005，但 #557（PR #577）用了 0004、#559（#578）疊在上面用 0005，所以改 0006。第一版從 main 開，0006 重建的觸發器照 main 的舊定義寫，會蓋掉 0004 收窄、0005 加 `walker_codes` 的 `packs_v3_sheet_main_UPDATE`。改疊到 #578 後，12 個重建的觸發器都從疊好的 `compact-schema.sql` 取最新定義，只把 `FROM v3_departures d` 換成 `FROM v3_dog_departures d`（腳本比對過逐字相同）。`packs_v3_dogs_*` 沒用到離所表，不動。
  - `db/compact-schema.sql` 同步；`v3_departure_versions` 的補建 SQL 改看新表。
  - Worker：`compact.js` `readDepartures` 讀新表（只取有編號的）、新增 `readNameOnlyCards`；`packs.js` 離所資料包多一個 `cards`，舊資料包沒有 `cards` 時當過期重算（套 migration 到部署之間舊程式可能用新版本號存過）；`departed.js` 只有名字的卡改從離所資料包讀，跟離所同一個版本號，不再讀 `v3_departed_cards`；`dog-list.js` 記離所、改原因、回所、認回所、保險掃描都改新表，`last_intro` 照舊抄 `v3_intros`。改原因和旗標合成一句 UPDATE。
  - 腳本：`departed-card.mjs` 建卡寫新表（編號留空）；`import-compact-departures.mjs` 換新表（只換有編號的）。
  - 測試：packs／dog-list／departed-cards／departed-card／compact-schema／standards 跟著改，新增 `scripts/migration-0006-dog-departures.test.mjs`（舊表資料搬過去後名冊與卡片內容不變、重跑不重複、改看新表的觸發器）與「舊資料包沒有 cards 會重算」。
- 預覽庫（`bq-shelter-dogs-test`，第一版）：套用前匯出→用 main 的程式讀 `/departures`、`/departures/index`、`/departures?year=2026`、`/departed-cards`、`/rest`、`/dogs`；`node scripts/d1-migrations.mjs apply --target test --backup never` 套 0006（書籤 `00000135-00000000-0000510f-93c26fa2b5853c1dc39d15bf0590a1b4`）→再匯出用新程式讀。全部相同，只有 2026 年的版本號 40→48（搬 8 筆、依設計各加 1）。新表 8 列，狗 ID 都跟舊表一致。
- 疊到 #578 之後：要先 Time Travel 把測試庫退回 0002 套用前、再依序套 0002→0006，被權限擋下，沒有做。改用第一版套 0006 前的匯出檔（正是測試庫套完 0004、0005 的狀態），本機用 #578 的程式讀當基準，套新 0006 後用本分支讀：結果同上（只有 2026 版本號 40→48）；改 `walker_codes` 仍讓 small 加 1。
- **測試庫目前的狀態要處理**：它記著第一版 0006 已套用，`packs_v3_sheet_main_UPDATE` 是被第一版蓋回的舊定義（還列著 0004 刪掉的欄、沒有 `walker_codes`）。檔案改了不會重套，要跑「準備預覽資料庫」重來，或由 K 決定是否 Time Travel 退回。
- 例外：第一次跑 `apply --target test` 沒加 `--backup never`，腳本照設計想把測試庫複製進 `bq-shelter-dogs-backup`。清空那一步回報 0 筆變更，匯入在第一句就失敗（`table v3_dogs already exists`）。之後查備用庫，54 張表、57 個觸發器、資料都還在（狗 134、溜狗紀錄 1505、離所 8），沒有被改。這表示 `copyDatabase` 對已經有資料的備用庫，清空可能沒生效；正式套用 workflow 遇到會在套用前停下（安全），但會擋住要備份的 migration（例如 #557 的 0004）。已回報，本票不修。
- 讀寫實測（測試庫，D1 meta，測完刪掉測試列）：記一筆離所（1 旗標、1 舊編號、3 同群）寫 20→5、讀 37→2；改原因＋旗標寫 7→2；回所刪除寫 12→2、讀 37→3；重算一年離所資料包的離所部分讀 38→9。
- 未完成：下一張 PR DROP `v3_departures`、`v3_departure_items`、`v3_departed_cards`（連同它們的 9 個觸發器）與 `v3_departures_date／_dog` 索引；沒編號的狗記離所（`applyDeparted` 仍先不記）留給之後。
- PR：#579（草稿）。
