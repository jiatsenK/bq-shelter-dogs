# 2026-10-26 wait-pr-checks.ps1 在 5.1 的中文與退出碼

- Agent：Claude Code（接續 #612 同一工作階段，K 交辦）
- 依據：#612 的 agent 紀錄「未完成」一項：5.1 下中文摘要亂碼，check 失敗時退出碼仍是 0。

## 做了什麼

- `scripts/wait-pr-checks.ps1`
  - 加 UTF-8 BOM，執行期間主控台輸出改 UTF-8、結束還原：`checks exit=…；完整輸出：…` 不再亂碼。
  - gh 輸出改成跟 `check-local.ps1` 一樣逐行寫無 BOM UTF-8 日誌，避免 5.1 把 stderr 當終止錯誤。
  - 退出碼：查證後，已完成的失敗 gh 本來就回 1；回 0 的是**被取消**的 check（gh 畫面印 `fail`，退出碼卻是 0，#612 轉正式時兩次 CI 互相取消就碰到）。watch 結束後再用 `gh pr checks --json name,bucket` 讀一次，有 `fail`／`cancel`／`pending` 就回 1。
- `docs/agents/local-checks.md`：補一句被取消也不是 0。

## 驗證

- 5.1 跑腳本：PR #577（preview 失敗）exit=1；PR #527（test 被取消，gh 本身回 0）exit=1；PR #612（全過）exit=0。中文摘要正常。
- 本機沒有 pwsh，這支腳本也沒有 CI 測試；pwsh 7 用到的寫法與 #612 的 `check-local.ps1` 相同。

## 未完成／例外

- 無。
