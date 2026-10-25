# P1 文件整理：發布 ADR 0020、ADR 修訂行、現行入口更新

- 日期：2026-10-26。Agent：Claude。
- 依據：K 交辦 2026-10-26 Issue／規格稽核報告的 P1（一張文件 PR）。稽核基準 main `811a9b5`。
- 做了什麼：
  - 發布原本只在本機的 ADR 0020（管理網站）、`docs/design/admin-site-plan.md` 和 Codex 的規劃紀錄 `2026-10-24-admin-site-planning.md`（紀錄原樣帶入，沒有改）。ADR 0020 狀態改成第 1–3 階段已上線；計畫開頭註明它是開票時的版本，現況看 `admin/README.md` 和 operations。
  - ADR 開頭加修訂說明：0004（由 0020 修訂）、0008、0010（由 0018 修訂，整批同步已退役；寫入預算還用在寫回）、0006（#474 起網站不寫常遛狗群）、0014（#560 離所改用狗 ID）、0005（#282 已上線）、0019（`walker_codes` JSON 欄）。重新產生 `docs/adr/README.md`。
  - `docs/ARCHITECTURE_NOW.md`：更新核對基準；補離所、功能開關、狗資料編輯三列；#518 改指 #567；新增管理網站一節（手動部署）；記下「試算表刪列 D1 不跟著刪」（K 2026-10-26：再發生再處理）。
  - `admin/README.md`、`docs/design/admin.md`、`docs/operations/*.md`：補現況（已部署、K 登入後驗收還沒做）。
  - `GLOSSARY.md`：休養改成存 D1；補 Codex 規劃時寫在本機、沒提交的「管理網站」「功能顯示」「志工可編輯」三個名詞。
  - `docs/PROJECT_GOALS.md`：加「2026-10 改版」段落，只寫範圍、連到票與 ADR。
- 沒做：稽核報告 P1 第 8 項（歷史文件搬到 history）留給下一張 PR；ADR 0006、0014 的修訂來源是票不是 ADR，索引仍顯示「現行」。
- 相關 PR：見本分支 `claude/p1-docs-cleanup` 的草稿 PR。
