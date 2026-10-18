# 2026-10-17 研究：新機器第一次 /api/walks 的 CPU（#356）

- Agent：Claude Code（Opus 5.5，子代理）
- 做了什麼：讀 main（e06c468）的 `worker/src/packs.js` 溜狗紀錄讀取流程，在 scratchpad 寫基準測試（不放 repo）量各步驟 CPU，查 Cloudflare、V8 官方文件。結果寫在 `docs/research/2026-10-17-api-walks-first-read-cpu.md`。
- 依據：#356 留言「下一步：查第一次讀 /api/walks 的 CPU 花在哪」。
- 結論：主因是讀整年資料包並整份 JSON.parse（只用兩個月）；合併月份可忽略；跨日那次（重算整年摘要、stringify、逐字元切段）最貴。
- 未完成：沒改程式、沒 commit；建議的改法（按月存、預存回應文字、chunks 快速路徑、摘要增量）要另開票。
