# 2026-10-16 #329 Actions 分鐘數短期減量

- Agent：Claude Code（Opus 5.5）
- 依據：#329（私人 repo 免費方案一個月 2,000 分鐘，10/1～10/16 帳號已用約 2,893 分鐘，本 repo 2,569）
- 做了什麼：
  - `worker/src/sync-plan.js` 的 `SYNC_DAILY_MAX` 30 → 12；ADR 0008、`sync-sheet.yml` 註解同步改數字。
  - `tests.yml`：推到 main 不再跑（PR 已跑過），加 `workflow_dispatch` 可手動重跑；PR 只改 `.claude/` 也不跑。
  - `deploy-cloudflare.yml`：push 改成只看會放上網站的檔案（`public/`、`worker/src/`、`wrangler.jsonc`、部署用到的四支 scripts、本 workflow）。
  - `preview-cloudflare.yml`：只有改到 `public/`、`worker/src/`、`wrangler.jsonc` 的 PR 才做預覽。
  - `release-please.yml`：每次推 main 改成每週一台灣 9:00 一次＋手動。
- 估算方式：GitHub API 列 10/1～10/16 每次執行（開始到結束時間無條件進位成分鐘），用 10/8～10/16 的開發速度換算 30 天；近 9 天合併 97 張 PR，其中 37 張動到部署路徑、35 張動到預覽路徑。數字寫在 PR 內文。
- 未完成／注意：
  - 照這週的開發速度，本 repo 改完約每月 1,700 分鐘，再加其他 repo（每月約 600）帳號仍會超過 2,000；開發速度回到一天 4 張 PR 左右約 850 分鐘。
  - 長期把同步搬到 Worker 是 #301，不在這張票。
  - 只改 workflow 和常數，網頁測試沒有在本機跑。

## 後續：改開發流程（K 同意研究報告的建議，見 docs/research/2026-10-16-actions-dev-flow-minutes.md）

- `tests.yml`：草稿 PR 不跑，轉正式（`ready_for_review`）才跑；同步預演併進來當步驟，改到同步程式才跑，刪掉 `sync-dry-run.yml`。
- `preview-cloudflare.yml`：要有 `preview` 標籤才做預覽（已用 `gh label create` 建好標籤）。
- `AGENTS.md`：新增「開 PR」段落：先開草稿、推完 `gh pr ready`、要預覽才加標籤、不加 `[skip ci]`。
- 推估本 repo 約 950 分鐘／月、帳號合計約 1,550（研究報告推估，一個月後要到帳單頁核對）。
