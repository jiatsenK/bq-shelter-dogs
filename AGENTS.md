# bq-shelter-dogs

`CLAUDE.md` 只有一行 `@AGENTS.md`，Claude Code 和 Codex 讀的是同一份，只改這裡。

「板收志工溜狗表」：放在 Cloudflare Worker（https://bq-shelter-dogs.jiatsen-k.workers.dev ，V8 起）的純前端網站，後端 API 在同一個 Worker 的 `/api`。舊網址 GitHub Pages 只剩轉址（#129）。規格見 `docs/PROJECT_GOALS.md`，視覺見 `docs/DESIGN_GUIDE.md`。

- 與 K 溝通用繁體中文（台灣用語）。
- 任何 Agent 寫入 repo 後，都要在 `AGENT_LOG.md` 檔尾追加一筆紀錄。
- **試算表寫入規則（K 2026-10-08）**：網站只能改「主清單」的「遛狗日期」和「誰遛的」兩欄（`apps-script/sheet-write.gs`）。其他欄位（含備註）、其他分頁（含已出所）一律不寫入，新功能也不能加寫入；需要另外記的資料放 repo，不放試算表。
- **開卡紀錄例外（K 2026-10-13）**：圖鑑已開卡的個人代號、狗編號與日期存現有 D1，以便跨裝置保存；不寫試算表，不因開卡新增 Git 提交。

## 指令

跟 `.github/workflows/tests.yml` 一樣，PR 要全過：

- node 測試：`node --test scripts/sync-sheet.test.mjs worker/test/worker.test.mjs worker/test/sheet-write.test.mjs scripts/photo-versions.test.mjs scripts/analytics-beacon.test.mjs worker/test/r2.test.mjs scripts/migrate-photos-r2.test.mjs scripts/r2-bucket.test.mjs scripts/build-db.test.mjs scripts/d1-database.test.mjs scripts/business-schema.test.mjs scripts/migrate-identities.test.mjs scripts/migrate-history.test.mjs scripts/migrate-profiles.test.mjs scripts/compact-schema.test.mjs scripts/import-compact-dogs.test.mjs scripts/import-compact-profiles.test.mjs scripts/sync-compact-d1.test.mjs worker/test/d1-read.test.mjs worker/test/d1-write.test.mjs`（要寫檔名，寫資料夾在 Node 22 會失敗）
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
