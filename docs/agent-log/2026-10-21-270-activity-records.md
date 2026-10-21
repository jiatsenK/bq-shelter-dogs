# 2026-10-21 #270 活動紀錄

- Agent：Claude Code（雲端）。分支 `claude/270-activity-records`，基準 main 2ebe74c。
- 依據：#270、ADR 0002（2026-10-17 更新：入口在資訊 → 活動紀錄，手機與桌機都能編輯）、ADR 0004、#273 規格。

## 做了什麼

- D1：`v3_activities`（日期、類型 kids／adoption、revision）、`v3_activity_dogs`（一列一隻，`dog_id` 是 NULL 表示只有名字）、`v3_activity_guard`（batch 內檢查 revision）。同步不碰；sync 會照 `compact-schema.sql` 補建（全是 IF NOT EXISTS）。不寫試算表、不加 packs 觸發器（狗清單、離所不讀這兩張表）。
- Worker（`worker/src/activities.js`、`index.js`）：`GET /api/activities`；`POST` 新增、`PUT`／`DELETE /api/activities/{id}`。要先選名字（editor）；改、刪帶打開時的 revision，別人先改過回 409。出席的狗送編號（含舊編號）、永久 ID 或只有名字；同一隻只留一次。每次寫入記編輯紀錄 `activity`（改前／改後：日期、類型、狗名），`edits.js` 顯示成一行。
- 網頁：資訊首頁多「活動紀錄」（第 3 個，摘要「共 N 場活動／讀取中／讀取失敗／還沒有」）。`public/js/activities.js`（新檔，analysis.js 維持 #59 的「只讀」檢查）：每場標題是日期＋類型，下面直接列出席的狗；新增、修改就地展開；可搜在所與離所名冊的狗；有同名的狗就不給「只記名字」；刪除要按兩次。狗卡上沒有活動資訊。
- 舊名單匯入：`scripts/import-activities.mjs`，只能手動執行（預演只送 SELECT；加 `--write` 才寫正式 D1）。完全同名且只有一隻才接上，其他存名字並列清單；同一天同類型合一場；D1 已有那場就跳過（重跑不重複）。每場一筆編輯紀錄（預設名字「舊名單匯入」）。
- 文件：`docs/COMPACT_D1.md` 補表。

## 測試

- 新增 `worker/test/activities.test.mjs`（新增／修改／刪除、revision 衝突、驗證、整批回復）、`scripts/import-activities.test.mjs`（含「workflow 不執行匯入」）、`tests/activities.cjs`（320／390／1280px、44px、焦點、衝突、重新整理、狗卡無活動、沒選名字）。
- 改：`tests/info-page.cjs` 五類、`tests/index.html` 五類與 script 順序、`compact-schema.test` 表清單、`sync-compact-d1.test` 同步不寫活動表。
- Node 355／355、網頁 261／261 與全部互動套件通過；impeccable detect 新檔無提示。

## 未完成

- 正式 D1 的新表要等合併後第一次同步（或手動跑 schema）才會建；之前打開活動頁會顯示「活動紀錄讀取失敗」。
- 舊名單還沒匯入：等 K 提供表格（日期、活動類型、狗名），先預演給 K 看對不上的清單。
- 未在真機驗收。
- 截圖：docs/design/issue-270（合成資料，非正式資料）。
