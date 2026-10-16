# 2026-10-16 GitHub Actions 分鐘數（#305）

- Agent：Claude Code（Opus 5.5）
- 做了什麼：和 K 用 /grill-with-docs 逐項決定 #305；新增 `docs/adr/0008-sync-on-change.md`，`0007` 後果加一行指向 0008；決定清單留言在 #305。
- 查到的事實：縮圖 Action 10 月 32 次全部成功；多出來的 356 次部署來自舊的 `make-thumbs.yml`（#275 已刪，10/15 後停止）。
- 未完成：實作全部未做（部署觸發清理、縮圖不重試＋圖示、測試／預覽跳過文件、同步改造、Apps Script 步驟）；先做 ADR 0007。
- 分支 `docs/305-sync-on-change`。
