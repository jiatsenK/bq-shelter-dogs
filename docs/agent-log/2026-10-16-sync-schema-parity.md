# 2026-10-16 同步補建的 schema 和 compact-schema.sql 一致（#321）

- Agent：Claude Code（Opus 5.5）
- 依據：#321（#315 回顧）
- 做了什麼：
  - `scripts/sync-compact-d1.mjs`：同步不再用正規式挑要送的 schema，改成整份 `db/compact-schema.sql` 都送，只排除 `SYNC_SCHEMA_SKIP` 明列的例外（`identity_` 觸發器、`v3_identity_revision` 那一列，照現況）。
  - `scripts/sync-compact-d1.test.mjs`：同步 SQL 套到空的 fakeD1，`sqlite_master`（type、name）要和 `migrateCompactDatabase` 一樣，schema 的預設列也要有；例外清單和同步共用同一份。已確認：改回舊正規式並在 schema 加一個新觸發器時，這個測試會失敗。
  - `AGENTS.md`：「新增 D1 資料表」那條改成以 `sync-compact-d1.mjs` 為準。
- 實際送出的 SQL 沒變（現有語句全都已在舊正規式內或屬於例外）。
- 未完成：無。
