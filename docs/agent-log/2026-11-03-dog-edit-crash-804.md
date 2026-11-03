# 2026-11-03 改狗資料出錯的訊息與沒人用的 export（#804）

- Agent：Codex（gpt-6.1-sol，K 指定、K 手動交辦）改程式，Claude Code（Opus 5.5）寫規格、驗收測試、收尾、審查，分支 `claude/804-dog-edit-crash`
- 依據：#804，架構檢視順手發現，K 2026-11-02 確認。

## 做了什麼

- 改狗資料遇到非預期錯誤時，500 回「`label`暫時存不進去，請稍後再試」，不再只有 `{"ok":false}`。訊息用各項現有的 `label` 組出來，沒有在 `DOG_EDITS` 加欄位，以後新增項目不會漏。
- 刪掉 `compact.js` 沒有呼叫端的 `saveFixedCare`、`saveRest`、`removeFormerNumber`、`saveStays`。`dog-list` 測試改用 SQL 準備資料，要驗的事不變。

## 例外與要注意的

- 測試要走到這個 500，只能弄壞認狗那一句查詢。整個資料庫都壞的話，請求會在功能開關那關回 503。
- 在 Codex App 手動交辦時，Sol 在自己的 worktree（`~/.codex/worktrees/`，detached HEAD）工作，變更不在交辦時指定的資料夾，收尾要用 `git worktree list` 找。

## 相關 PR

關閉 #804 的那張 PR。
