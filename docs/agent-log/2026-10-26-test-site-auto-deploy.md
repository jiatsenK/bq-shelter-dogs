# 測試網站自動部署

- 日期：2026-10-26。Agent：Claude。分支 `claude/test-site-auto-deploy`（從 main `da6396e` 開）。
- 依據：K 2026-10-26 要用手機實測 PR #586（#445），PR 預覽版擋寫入不能按溜了；測試網站（#498、PR #545）只能手動部署、停在舊版。K 希望測試網站的程式整個跟正式版同步，資料仍讀測試試算表與測試 D1。
- 新增 `.github/workflows/deploy-test-site.yml`「部署到測試網站」：
  - main 推送（改到 `public/`、`worker/src/`、`migrations/`、`wrangler.test-site.jsonc` 等）時跑；也可手動指定分支。
  - 先 `d1 migrations apply bq-shelter-dogs-test --remote --config wrangler.preview-db.jsonc`（跟預覽同一行），再 `wrangler deploy --config wrangler.test-site.jsonc`，最後用 `smoke-api.mjs` 打測試網站讀取 API。
  - 不帶金鑰：測試 Worker 的金鑰由 K 另外設，`wrangler deploy` 會保留。排隊不取消，避免 migration 做到一半被中斷。
- `tests/index/hosting.js` 加擋關檢查與反例：只准部署測試網站設定、只准對測試庫套 migration、不准帶金鑰。
- 更新 `wrangler.test-site.jsonc` 開頭說明、`docs/ARCHITECTURE_NOW.md`（新增「測試網站」段）、`docs/agents/data-changes.md`。
- 未做：沒有觸發部署（交辦明訂不要）。#586 的手動部署由原工作階段處理。
- 注意：手動部署某個分支後，main 再有推送會換回 main 的程式；分支裡還沒合併的 migration 套進測試庫後記為已套用（同預覽）。
- 相關 PR：#588。
