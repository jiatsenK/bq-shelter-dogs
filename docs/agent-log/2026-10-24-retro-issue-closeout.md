# Retro：/implement 做完沒關票

- 日期：2026-10-24。Agent：CLAUDE。
- 依據：本對話 /retro。K 用 `/implement 512` 實作，PR #541 內文寫 `Refs #512`，合併後票沒關、原文驗收清單一格沒勾，K 要自己逐條對才知道做完沒有。K 選第 1 項（implement 收尾）和第 2 項（pr-guard 提醒＋合併後檢查），交辦開一個 PR。
- 原因：`implement` 做到 commit 就結束，沒有對票收尾；`pr` skill 也沒提票。`pr-guard.mjs` 只認 Closes／Fixes／Resolves，寫 Refs 時不提醒。
- `.claude/skills/implement/SKILL.md`：加收尾步驟。票上每格（含下方舊段落）都要列成做完（附證據）或剩下；開 PR 時第一行寫 `Closes #N`，還有剩下的寫 `Part of #N` 並列出剩下的項目，再到票上勾掉 PR 涵蓋的格子。K 這次明確交辦修改 implement，例外於 `docs/agents/local-checks.md`「Matt 原版技能維持原樣」。
- `scripts/pr-guard.mjs`：新增 `refIssues`（Refs／Ref／Part of，可用頓號、逗號列舉）、`uncheckedItems`、`mergedNotes`。開 PR 時多兩種提醒：寫 Refs／Part of 的開著的票（合併後不會關，列出沒勾的格子）、寫 Closes 但票上還有沒勾的格子。`--merged`：Refs 的票還開著、或 Closes 的票關了但還有沒勾的，到票上留言。
- `.github/workflows/pr-guard.yml`：多觸發 `closed`（只在已合併時跑 `--merged`），`issues: write` 才能在票上留言；合併後 checkout 目標分支。
- 驗證：`pr-guard.test.mjs` 先紅後綠（10 項）；用真的 PR 541、540 跑 `--dry-run`，541 列出 #512 原文 5 格沒勾。
- 例外／未完成：合併後的檢查要等這張 PR 合進 main 之後的下一個 PR 合併才會真的跑。追蹤型的票（例如 #538 用 `Part of`）也會被提醒，這是預期的。回顧裡的第 3 項（母票、子票關錯）和第 4 項（票上一層疊一層）這次沒做。#512 還沒關，等 K 決定。
- 相關 PR：#544（草稿）。
