# 2026-10-16 原型：Worker 直接同步試算表的額度（#301）

- Agent：Claude Code（Opus 5.5）
- 分支：`prototype/worker-sync`（不合併進 main）
- 依據：#301、ADR 0007、#240

## 做了什麼

- 新增 `scripts/prototype/measure-worker-sync.mjs`：用正式網站 `/api/dogs`、`/api/walks`、`/api/departures` 的資料（只讀），
  在記憶體 D1 裡跑跟 `sync-compact-d1.mjs` 一樣的「刪光重寫」，量讀寫列數與 CPU 時間。不碰任何真的 D1。
- 結果與結論寫在 #301 的留言。

## 未完成

- 沒有部署預覽 Worker、沒有建預覽 D1：本機 wrangler 登入的帳號看不到正式 D1，而且建資源、部署要 K 同意。
- 「D1 一次 batch 算 1 個查詢還是每句各算 1 個」（免費方案每次呼叫上限 50 個查詢）文件沒寫清楚，要在預覽 Worker 實測。
