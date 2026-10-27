# 身分查詢走索引、合併查詢，切回網頁節流 5 分鐘（#680）

- 日期：2026-10-27。Agent：Claude。分支 `claude/680-identity-index-f87200`（從 main `ff8501a` 開，rebase 到 main `0eab86b`；0011～0013 已被 #689、#693、#692 用掉，改成 0014）。
- 依據：#680；研究 `docs/research/2026-10-27-identity-query-and-favs-sync.md` 與 K 的定案（節流 5 分鐘、先加索引再合併查詢）。總票 #687。
- 做法：
  - migration `0014_identity_names_volunteer.sql`：`v3_identity_names(volunteer_id, code)` 索引；`db/compact-schema.sql` 同步。
  - `worker/src/identity.js`：代號→志工→轉址→名字原本 4 句，合成 1 句（`identitySql`，代號或志工 ID 起頭）；錯誤碼照舊（查不到代號 409、轉址後找不到志工 404）。`identitiesForCodes` 多個代號用 `db.batch` 一次送出；`linkIdentityName` 代號已存在時也只跑 1 句。
  - `public/js/favorites.js` 新增 `syncFavsOnReturn`：上次同步成功不到 5 分鐘、身分沒換、沒有待送常溜就不重抓；時間只放記憶體。`app.js` 的 `visibilitychange` 改呼叫它；同步鈕、恢復連線、自己改常溜仍直接 `syncFavs`。
- 測試：`worker/test/identity.test.mjs` 新增查詢計畫（依志工直接找、合併後一句沒有整張掃名字表）與「新舊查法回應相同」對照（含合併轉址、更名多名字、404、409、batch）；`tests/index/favorites.js` 新增節流測試（把間隔暫改 0 確認測試會失敗）。
- 未做：沒有對正式 D1 跑 `EXPLAIN QUERY PLAN`（研究缺口，合併後可用 `npx.cmd wrangler d1 execute bq-shelter-dogs --remote --command "EXPLAIN QUERY PLAN SELECT code,name FROM v3_identity_names WHERE volunteer_id='x' ORDER BY code"` 看）。合併後要按「套用 D1 migration」。
- 合併前更新：#692 合併後 rebase 到 `0eab86b`，沒有衝突；`check-local.ps1 -Full`（`BQ_CHECK_PWSH=powershell`）Node、網頁全過。
