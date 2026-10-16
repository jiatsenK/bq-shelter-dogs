# 2026-10-16 D1 讀取量原型實測

- Agent：Claude Code（Opus 5.5，由 adr/讀取量討論的 session 交辦）
- 分支：`prototype/d1-read-reduction`（從 main 開，丟棄式，不開 PR）
- 做了什麼：寫原型 Worker `worker/prototype/d1-read/entry.js`（`wrangler.d1read.jsonc`，只 `wrangler dev --remote`、不部署），在原型 D1 量現在 API 和「歷史資料包＋今天紀錄＋記憶體快取」的 `meta.rows_read`，模擬一天 1,400 次請求。結果見 `docs/research/2026-10-16-d1-read-prototype.md`。
- 原型 D1 的變更：溜狗紀錄複製一份（2,442 列）、加 `proto_walks_date` 索引、`proto_pack`、`proto_versions` 兩張表、2026-10-17 的 30 筆假紀錄。正式 D1 沒動。
- 未完成：Cloudflare 上記憶體快取的實際存活時間與機器數沒量；請求種類比例是假設。
