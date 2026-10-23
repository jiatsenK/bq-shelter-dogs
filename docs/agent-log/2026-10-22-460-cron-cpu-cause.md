# 2026-10-22 #460 Cron 一輪 CPU 原因研究

- Agent：Claude Code 背景研究代理
- 做了什麼：讀 `worker/src/walk-*.js`、`worker/cpu-bench/*`、測速設定與工作流程、Cloudflare 官方文件，寫成 `docs/research/2026-10-22-460-cron-cpu-cause.md`。
- 依據：K 懷疑 Cron 一輪 CPU 是架構問題而非資料量（#460）。
- 未完成：沒有部署、沒有線上測試、沒有 commit；結論待本機 DevTools 剖析確認。
- 相關 PR：#460 分支 `claude/460-d1-unified`。

- 補本機剖析：用 wrangler dev 加上 CDP Profiler 跑 11 次只做掃描、4 次完整一輪。CPU 大多花在 D1 綁定，商業邏輯不到 15%。剖析腳本和資料放在 session 的暫存資料夾，沒有進 repo。
