# 部署安全：只准 main、部署排隊不取消（#622）

- 日期：2026-10-26。Agent：Claude。分支 `claude/deploy-main-only`（從 main `2feead4` 開）。
- 依據：#622（2026-10-26 架構稽核）。K 2026-10-26 選「依照推薦」：
  - 擋非 main 用 workflow 的 job `if: github.ref == 'refs/heads/main'`，不建 GitHub environment、不要每次核准。
  - 「部署管理網站」拿掉分支欄位，只部署 main；要先試 PR 用測試網站或預覽。
  - 部署要不要等測試通過：另開票 #629（repo 現在是公開的，其實可以設必要檢查，要另外想清楚只改文件／草稿 PR 怎麼辦）。
- 改了什麼：
  - `deploy-cloudflare.yml`：`cancel-in-progress` 改 `false`（排隊不取消）；job 限定 main（手動、`workflow_call` 都看呼叫端的 ref）。
  - `d1-migrations.yml`：`apply`、`deploy` 兩個 job 都限定 main。
  - `deploy-admin.yml`：拿掉 `inputs.ref`，checkout 用觸發的 ref；job 限定 main。
  - `seed-preview-db.yml`：job 限定 main。
  - `deploy-test-site.yml` 不動，照舊可以填分支。
  - 測試 `tests/index/hosting.js`：`mainOnlyProblem` 檢查四個 workflow 每個 job 都限定 main、不能另外指定分支，附反例；檢查 `deploy-cloudflare` 是 `cancel-in-progress: false`；確認測試網站仍可填分支。
  - 文件：`docs/setup/CLOUDFLARE_SETUP.md`（部署段寫明新規則）、`admin/README.md`、`docs/agents/data-changes.md`。
- 為什麼不把被呼叫的部署分到另一組 concurrency：兩組會同時跑，舊程式可能比新程式晚部署完，反而蓋掉新版。排隊不取消時，還在排隊的那次只會被更新的那次換掉，那次用更新的 main，一樣先確認 migration 再部署；失敗就是 main 推送那次的紅叉。
- 限定 main 只擋手誤，有推送權限的人能連 workflow 一起改；選別的分支按時 job 顯示略過（灰色），不是紅叉。
- 驗證：本機 `check-local.ps1 -Full` 通過（本機沒有 pwsh，設 `BQ_CHECK_PWSH=powershell.exe`），index 256 項全過；把 `cancel-in-progress` 暫時改回 `true` 再跑，`#622 志工站部署排隊不取消` 那項失敗，證明檢查有作用（已改回）。沒有手動觸發任何 workflow 試正式部署。
- 未處理（範圍外）：`r2-thumbs.yml` 也寫正式 R2（由 Worker 觸發或手動），沒有限定 main，#622 沒列。
- 相關 PR：#632（草稿）。等測試另開 #629。
