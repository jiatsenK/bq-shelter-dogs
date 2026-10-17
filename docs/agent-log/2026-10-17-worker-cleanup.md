# 2026-10-17 Worker 整理（#353、#354）

- Agent：Claude Code（Opus 5.5）
- 依據：#353、#354（2026-10-17 triage 後 K 同意的技術債票）

## 做了什麼

#353（行為不變）
- `worker/src/index.js`：putIntro／putStays 讀 JSON 本文的重複段落改成共用 `jsonBody()`，16000 改成常數 `EDIT_BODY_MAX_BYTES`。
- `taiwanYmd`（index.js）和 `taiwanDay`（sync-plan.js）留一個：`worker/src/sync-plan.js` 匯出 `taiwanYmd`，index.js 改匯入。
- `scripts/sync-plan.mjs` 改名 `scripts/sync-compact-plan.mjs`（跟 `worker/src/sync-plan.js` 撞名），更新 `sync-compact-d1.mjs`、`sync-sheet.yml`、`tests.yml` 的引用。

#354
- 拿掉程式裡的 `CREATE TABLE`：sync-plan.js 的 `v3_sync_state`（每次讀寫前都跑一次）、index.js 改群組時的 `v3_sheet_group_labels`。兩張表 10/16 就寫進 `db/compact-schema.sql`，同步每次整份補建；`pack_v3_sheet_group_labels_*` 觸發器也在同一份裡，表不在的話同步會失敗，所以正式 D1 一定已經有。
- `v3_pack_versions` 的 walks／live／cutoff 沒人讀寫（溜狗紀錄 #320 起改用 `v3_walk_versions`），從 CREATE TABLE 拿掉並註明；正式 D1 舊表的欄位不 ALTER，留著無害。
- `v3_dogs`、`v3_sheet_former_numbers`：狗清單、離所、休養都不讀（packs.test 的表清單是實際攔到的 SQL），不需要 pack_ 觸發器；測試加上斷言和註明。
- 測試：sync-plan.test、worker.test 的同步測試改用 `migrateCompactDatabase` 建表。

## 未完成／備註
- `scripts/sync-compact-d1.mjs` 的 `OPTIONAL_TABLES`（群名表還沒建時當成空的）現在應該也能拿掉，沒在本票範圍，沒動。
