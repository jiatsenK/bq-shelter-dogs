# 今日溜狗兩個 Worker 開關改成 wrangler.jsonc vars

- 日期：2026-10-24。Agent：Claude。分支 `claude/walk-switch-vars`。
- 依據：K 2026-10-24 對話：`D1_WALK_NOTIFY`、`WALK_RETRY_ENABLED` 改成 vars 讓 repo 看得到。起因：兩者原是 Cloudflare 密鑰，`docs/adr/README.md` 顯示「repo 沒設定」，#533 打開 `d1WalkAccept` 時漏開（見 `2026-10-24-revamp-docs-cleanup.md`）。
- 改動：`wrangler.jsonc` vars 加 `D1_WALK_NOTIFY: "1"`、`WALK_RETRY_ENABLED: "true"`；`docs/adr/README.md` 重新產生。
- 切換順序（K 同意）：開 PR → K 說好後 `wrangler secret delete` 兩個密鑰 → 立刻合併，正式部署帶上 vars → K 手動改表驗證。同名密鑰與 vars 不能並存，所以要先刪。空窗期間人工改表由 GAS 待送清單補送，網站登記先存 D1、寫回等重試。
- 預覽版：同名密鑰還在時，預覽上傳可能失敗，刪密鑰後重跑；預覽有 `PREVIEW`，重試與掃描不跑。
