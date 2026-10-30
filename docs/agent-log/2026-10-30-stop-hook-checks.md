# Stop hook 強制交付前檢核

- 日期：2026-10-30。Agent：Claude Code。
- 問題：#768 系列子票（#769～#775）要讓子 session 全自動跑完審查、本機檢核、CI 再合併，需要強制機制確保交付前一定跑過 `check-local.ps1 -Full` 與 code-review 兩軸審查。
- 做了什麼：新增 `.claude/hooks/require-checks.mjs` 與 `.claude/settings.json` 的 Stop hook。功能分支有變更時，目前 HEAD 沒有完整且工作樹乾淨的 `.scratch/checks` 通過紀錄，或對話沒呼叫過 code-review 技能，就擋下 Stop；`stop_hook_active` 時放行避免迴圈。`docs/agents/local-checks.md` 改寫原本「不新增 agent hook」的說明。
- 驗證：hook 五種情況先在暫存 clone 測過（main 無變更、stop_hook_active、缺檢核、缺審查、兩者都有）。本機 Git Bash 下 `$CLAUDE_PROJECT_DIR` 為 Windows 路徑，node 可正確解析。
- 相關 PR：見本分支 PR。
