# bq-shelter-dogs

板收志工溜狗表：Cloudflare Worker 提供前端與 `/api`。`CLAUDE.md` 指向本檔。

- 全域規則：先讀 `C:/Users/User/repos/agent-hub/CORE_RULES.md`，已讀且未變更時沿用。
- 前端檔案責任、依賴與載入頁面：`public/js/README.md`。
- 修改前讀 `docs/agent-log/README.md` 與最近紀錄；同一 PR 維護一筆紀錄。
- 使用者明確交辦建立 PR 時先開草稿；明確交辦轉正式且推送與本機檢查完成後才轉正式。需要手機預覽才加 `preview` 標籤。commit 不加 `[skip ci]`。

## 依任務載入

| 情況 | 文件 |
|---|---|
| 資料在哪、誰寫、怎麼同步（先讀，舊設計稿與舊票常過時） | `docs/ARCHITECTURE_NOW.md` |
| 查功能、版本與驗收範圍 | `docs/PROJECT_GOALS.md`，先定位最新相關段落 |
| 改畫面 | `DESIGN.md` 路由到該頁現行規格；工具與 detect 見 `docs/agents/design-tools.md` |
| 拆前端 JS、改載入方式 | `docs/adr/0017-frontend-es-modules.md` |
| 資料寫入、同步、D1 schema／讀取來源變更 | `docs/agents/data-changes.md`，依條件讀 ADR |
| 執行測試（本機統一走 check-local.ps1）、安裝 Playwright、明確交辦等待 CI | `docs/agents/local-checks.md` |
| 分派 Claude／Codex | `docs/agents/agent-split.md` |
| 接票、更新 Issue／狀態標籤 | `docs/agents/issue-tracker.md`、`docs/agents/triage-labels.md` |
| 領域名詞、ADR | `GLOSSARY.md`、`docs/agents/domain.md` |
