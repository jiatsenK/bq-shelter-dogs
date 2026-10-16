# 2026-10-16 D1 寫入額度爆掉：差異同步與寫入預算（#302）

- Agent：Claude Code（Opus 5.5）
- 分支：`fix/302-diff-sync`（worktree `../bq-shelter-dogs-302`）
- 依據：#302、#301 原型、ADR 0008（K 在追問中的決定）

## 做了什麼

- `GLOSSARY.md`：「溜了」補上口語「登記」；新增「差異同步」「寫入預算」。
- `scripts/sync-diff.mjs`（新）：照主鍵比對（從 #301 原型 `worker/src/sheet-sync.js` 搬來的 `diffTables`）、寫入預算檢查、用 Cloudflare GraphQL 查帳號今天的 D1 寫入量。
- `scripts/sync-plan.mjs`：從原型分支帶過來（`planSync`、`readPrevious`、`applySource` 拆出來）。
- `scripts/sync-compact-d1.mjs`：改成差異同步；新增 `buildSyncPlan`（回傳 SQL 和要寫幾列）；寫之前先檢查預算，異常就丟錯不寫，原因寫進 Job Summary；同步前也讀群名表（還沒建表時當成空的）。
- `.github/workflows/sync-sheet.yml`：說明改成差異同步，帶入 `SYNC_MAX_ROWS`、`SYNC_DAILY_BUDGET`（Actions Variables）。
- `docs/adr/0008-diff-sync-and-write-budget.md`（新），AGENTS.md 加上連結。
- 測試：試算表沒變寫 0 列、一隻狗被溜只寫幾列、差異寫完跟整份重建一樣、預算判斷、查用量、群名表缺表。

## 驗證

- node 測試 214 個全部通過。
- 網頁測試本機跑不了（新 worktree 沒有 Playwright 的 Chromium）；這次沒改網頁，交給 CI。

## 未完成／要 K 做的

- 第一次正式同步：主清單第 0 列以外的同步時間不再更新，跟現況的差異可能比平常大；超過 500 列被擋下時，看摘要確認合理後暫時調高 `SYNC_MAX_ROWS` 再跑。
- `CLOUDFLARE_API_TOKEN` 要加 Account Analytics 讀取權限，每天預算檢查才會生效；沒加只會顯示警告。
- 手機 GitHub App 開 Actions 失敗推播。
- ADR 0007 今日溜狗紀錄上線後，溜了也會寫 D1，要算進寫入預算。
