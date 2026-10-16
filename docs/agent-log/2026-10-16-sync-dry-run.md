# 2026-10-16 同步預演（#309）

- Agent：Claude Code（Opus 5.5）
- 依據：#309、ADR 0008
- 做了什麼：
  - `scripts/sync-compact-d1.mjs` 加 `--dry-run`：讀正式試算表和正式 D1，算出要寫幾列，不寫入；結果寫進 Job Summary，並寫到 `DRY_RUN_COMMENT` 指定的檔案。超過單次門檻、每天預算或出錯就失敗。
  - 新增 `.github/workflows/sync-dry-run.yml`：PR 改到同步相關檔案時跑預演，把「預演：會寫 N 列」留言在 PR 上。
  - `sync-sheet.yml` 的 push paths 補上 `sync-plan.mjs`、`sync-diff.mjs`（#302 拆出來後漏掉），兩邊路徑保持一致。
  - AGENTS.md：改同步的 PR 要附預演結果。
- 未完成：留言要等第一張改到同步程式的 PR 才看得到（本 PR 本身會觸發）；「故意改回刪光重寫會失敗」靠既有單次門檻 500 列，正式 D1 上千列整份重寫一定超過。
- code review 後修正：拿掉 main() 裡重複的預演區塊、還原換行雜訊；fork PR 不跑；被取消時不留言。
- 待 K 確認：預演用的 `CLOUDFLARE_API_TOKEN` 跟正式同步同一把（有 D1 寫入權限），「不寫入」靠 PR 裡的程式保證。
