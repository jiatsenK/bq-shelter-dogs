# 2026-10-16 回顧後的防呆（Claude）

依據：K 2026-10-16 `/retro` 選的 1–4 項。PR：claude/retro-guardrails。

- **部署後檢查**：新增 `scripts/smoke-api.mjs`（含測試），部署和同步 workflow 跑完都打一次正式站 `dogs`、`walks`、`departures`、`edits`、`rest`，回 `ok:false` 就紅叉。起因：#293 的 `v3_edit_log` 沒建到正式 D1，CI 全過卻沒人發現。
- **紀錄改一筆一檔**：`AGENT_LOG.md` 封存，新紀錄放 `docs/agent-log/`；`scripts/agent-log.test.mjs` 擋住再改 `AGENT_LOG.md`。起因：每張 PR 都改同一個檔尾，一直衝突，衝突時 GitHub 不跑 CI。
- **node 測試自動找檔**：新增 `scripts/run-node-tests.mjs`，找全部 `*.test.mjs`；CI 和 AGENTS.md 都改用它。起因：AGENTS.md 的清單已經漏了 `worker/test/identity.test.mjs`。
- **AGENTS.md 規則搬進 ADR**：試算表寫入、D1 存放、活動紀錄三條規則改成一行指向 `docs/adr/`，內容收進 `docs/adr/0006-data-write-rules.md`。

未處理：`docs/adr/` 有兩份 0005（`0005-intake-date-from-oldest-number.md`、`0005-volunteer-identity.md`），沒改名，留給 K 決定。
