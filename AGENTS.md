# bq-shelter-dogs

`CLAUDE.md` 只有一行 `@AGENTS.md`，Claude Code 和 Codex 讀的是同一份，只改這裡。

「板收志工溜狗表」：放在 Cloudflare Worker（https://bq-shelter-dogs.jiatsen-k.workers.dev ，V8 起）的純前端網站，後端 API 在同一個 Worker 的 `/api`。舊網址 GitHub Pages 只剩轉址（#129）。規格見 `docs/PROJECT_GOALS.md`，視覺見 `docs/DESIGN_GUIDE.md`。

- 與 K 溝通用繁體中文（台灣用語）。
- 寫入 repo 後，在 `docs/agent-log/` 新增一筆紀錄檔（規則見該資料夾 README.md）。
- **動到資料寫入前，先讀對應的 ADR**（K 的決定，以 ADR 為準）：
  - 寫試算表（任何欄位、分頁）→ `docs/adr/0006-sheet-write-scope.md`
  - 存使用者資料（開卡、常溜等）→ `docs/adr/0001-volunteer-data-follows-code.md`
  - 志工身分、更名、合併 → `docs/adr/0005-volunteer-identity.md`、`GLOSSARY.md`
  - 活動紀錄、已出所狗卡 → `docs/adr/0002-activity-records.md`
  - 新增會改資料的功能（編輯紀錄、沒有通關碼）→ `docs/adr/0004-open-editing-and-edit-log.md`
  - 今天溜過要讓其他手機很快看到（今日溜狗紀錄、免費方案額度）→ `docs/adr/0007-today-walks-live.md`
  - 新增 D1 資料表、觸發器、預設列 → 寫進 `db/compact-schema.sql`；同步補建哪些以 `scripts/sync-compact-d1.mjs` 為準：整份送出，只排除 `SYNC_SCHEMA_SKIP` 明列的例外（#293、#321）
  - 改同步、或新增會寫 D1 的功能（每天寫入預算、只寫差異）→ `docs/adr/0008-diff-sync-and-write-budget.md`；PR 要附預演結果（`同步預演` CI 會自動留言「預演：會寫 N 列」，#309）

## 指令

跟 `.github/workflows/tests.yml` 一樣，PR 要全過：

- node 測試：`node scripts/run-node-tests.mjs`（自動找 `scripts/`、`worker/` 底下全部 `*.test.mjs`）
- 網頁測試：`node scripts/run-browser-tests.cjs`（需要 Playwright 的 Chromium）

## Agent skills

`.claude/skills/` 內是 Matt Pocock 的技能（mattpocock/skills v1.3.1 @ 24fe0ef，MIT 授權，見 `.claude/skills/LICENSE-mattpocock-skills`）。Codex 不掃這個資料夾，要用時直接讀對應的 `SKILL.md`。

### impeccable（前端設計檢核）

`.claude/skills/impeccable/` 和 `.claude/agents/impeccable-*.md` 來自 pbakaus/impeccable（commit 778c8a7，技能版本 4.5.0，Apache 2.0，見 `.claude/skills/LICENSE-impeccable`）。用法：`/impeccable audit 找狗頁`、`/impeccable critique 溜狗表`、`/impeccable polish …`。第一次執行會自動下載它的檢查程式到 `~/.impeccable/`。沒有裝上游的自動 hook（每次改檔都會跑），改完介面時照技能指示手動跑一次 `detect`。修正仍要守 `docs/DESIGN_GUIDE.md` 和產品定位（安靜、實用），技能建議跟這兩份衝突時以 repo 文件為準。

### Claude／Codex 分工

把票分給 Claude 和 Codex 前，先讀 `docs/agents/agent-split.md`。

### Issue tracker

Issues live in this repo's GitHub Issues (`gh` CLI, or GitHub MCP tools in cloud sessions). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root, created lazily. See `docs/agents/domain.md`.
