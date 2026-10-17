# 2026-10-17 perf/chunks-length-shortcut

- Agent：Claude Code（Opus 5.5）
- 做了什麼：`worker/src/packs.js` 的 `chunks()` 先看總長度，不可能超過一段上限就直接整段回傳，不逐字算位元組。D1 讀寫不變。
- 依據：#356 研究（`docs/research/2026-10-17-api-walks-first-read-cpu.md`，尚未 commit，在 `chore/cleanup` 工作目錄）建議第 1 項；K 2026-10-17 同意。
- 未完成：建議第 2 項（一月一列、存成可直接回應的文字）、第 3 項（摘要只加昨天）待 K 決定。
- 相關 PR：見本分支的 PR。
