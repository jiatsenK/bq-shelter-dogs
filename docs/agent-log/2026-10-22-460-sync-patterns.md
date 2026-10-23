# 2026-10-22 #460 同步模式研究

- 日期：2026-10-22（台灣時間）
- Agent：Claude Code（背景研究代理）
- 做了什麼：新增 `docs/research/2026-10-22-460-sync-patterns.md`，整理寄件匣模式、Cloudflare 免費方案（Queues／Workflows／Durable Objects／D1 batch）與 Apps Script 額度、onEdit 觸發器，對應到 #460 的改法選項。
- 依據：#460、`docs/research/2026-10-22-460-cron-cpu-cause.md`
- 例外／未完成：只讀官方文件，沒有改程式、沒有線上測試、沒有 commit。Queue 消費者 CPU 上限官方未寫明。
- 相關 PR：無（分支 `claude/460-d1-unified`）
