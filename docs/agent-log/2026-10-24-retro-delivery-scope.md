# Retro：實作交付範圍與 CI 等待

- 日期：2026-10-24。Agent：CODEX。
- 依據：本對話 /retro；K 同意移除會讓代理自行開 PR、轉正式與等待 CI 的誤導指令。預設完成實作、本機驗證、審查與 commit 後回報，由 K 查看 PR／CI。
- 共用規則：更新 agent-hub 的 docs/rules/workflow.md，修正「提交、push、CI」、小修仍須確認最新 CI、一般檢核優先等待 CI 等說法；PR、轉正式、持續等待與重跑 CI 各依當次明確交辦。收斂成交付時更新最終進度，提交前核對本任務工作目錄、分支與檔案。
- 共用範例：tool-output.md 把等待指令移到明確交辦情境，補上既有本機檢核必要的 Reason。
- 本 repo：AGENTS.md 的草稿／轉正式規格改為條件式；local-checks.md 把 CI 等待從一般檢查範例移到專用段落。Matt 原版 implement／retro 技能均未修改。
- 驗證：僅文件變更，檢查 diff 與殘留衝突文字；未執行程式測試或 CI。
- 例外／未完成：CI 等待腳本退出碼不一致只記錄為後續工具候選，本次未修改腳本；未動其他工作的程式、設定、暫存或已暫存檔案。
- 相關 PR：K 後續明確交辦「開 PR」，故在兩個規則庫各自的獨立 worktree 提交並建立草稿。共用規則：[agent-hub #40](https://github.com/jiatsenK/agent-hub/pull/40)；本 repo 為此分支的對應草稿 PR。保留草稿，不轉正式、不等待 CI。
