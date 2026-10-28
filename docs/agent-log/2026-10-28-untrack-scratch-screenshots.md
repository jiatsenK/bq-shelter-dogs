# 測試截圖移出 git 追蹤

- 日期：2026-10-28。Agent：Claude Code。
- 依據：K 在 #722 收尾時同意另開小 PR 清理（無對應 Issue）。
- 問題：`.scratch/399-evidence`、`418-evidence`、`565-evidence`、`566-evidence` 共 9 張網頁測試截圖被提交過，每次跑測試都會重拍覆蓋，git 一直顯示有改動，容易誤 commit（10/22 #421、10/28 #722 都差點或已經帶進去）。另有 `565-settings-*.png`、`dog-merge-evidence/` 等新截圖每次都變成未追蹤檔案。
- 做了什麼：9 張截圖 `git rm --cached`（本機檔案保留）；`.gitignore` 加 `.scratch/**/*.png`。測試照常拍截圖，只是不進 repo。
- 驗證：`git check-ignore` 確認上述截圖都被忽略；`git status` 乾淨。未改程式，未跑測試。
- 相關 PR：分支 `claude/untrack-scratch-screenshots` 的 PR（正式 PR，不等待 CI、不 merge）
