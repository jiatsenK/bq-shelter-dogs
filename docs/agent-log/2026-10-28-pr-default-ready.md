# 規則對齊：預設開正式 PR，等 CI 要明說

- 日期：2026-10-28。Agent：Claude Code。
- 依據：#718；agent-hub [PR #41](https://github.com/jiatsenK/agent-hub/pull/41) 經 K 逐項確認，共用規則 `docs/rules/workflow.md` 改成 push 與開正式 PR 直接做、等待或重跑 CI 要使用者明說、merge 由使用者做、開 PR 後回報連結／SHA／CI 當下狀態就離開。背景整理見該 PR 的 `docs/research/workflow-pr-ci-scope.md`。這是有意推翻 10/24 [2026-10-24-retro-delivery-scope.md](2026-10-24-retro-delivery-scope.md)（#531）的「PR 依交辦、先開草稿」；當時要擋的「代理自己轉正式、一直等 CI」改由「等 CI 要明說」守住。
- 本 repo：`AGENTS.md` 的草稿／轉正式條件式改成預設推送並開正式 PR；`docs/agents/local-checks.md` 的交付範圍說法與 CI 等待段落對齊。搜尋其他「草稿」「轉正式」「wait-pr-checks」「等待 CI」，其餘出現都在舊紀錄或產品功能（活動草稿等），不需改。
- 代價：`.github/workflows/tests.yml` 對草稿 PR 不跑測試；改成預設正式 PR 後每個 PR、每次推送都會跑 CI。本次不改 workflow。
- 驗證：僅文件變更，檢查 diff 與殘留文字；未執行程式測試，未等待 CI。
- 相關 PR：本分支 `docs/pr-default-ready` 的 PR。
