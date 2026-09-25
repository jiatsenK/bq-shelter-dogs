# bq-shelter-dogs

「板收志工溜狗表」：GitHub Pages 上的純前端唯讀網站。規格見 `docs/PROJECT_GOALS.md`，視覺見 `docs/DESIGN_GUIDE.md`。

- 與 K 溝通用繁體中文（台灣用語）。
- 任何 Agent 寫入 repo 後，都要在 `AGENT_LOG.md` 檔尾追加一筆紀錄。

## Agent skills

`.claude/skills/` 內是 Matt Pocock 的技能（mattpocock/skills，MIT 授權，見 `.claude/skills/LICENSE-mattpocock-skills`）。

### Issue tracker

Issues live in this repo's GitHub Issues (`gh` CLI, or GitHub MCP tools in cloud sessions). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root, created lazily. See `docs/agents/domain.md`.
