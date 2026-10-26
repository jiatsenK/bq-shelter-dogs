# 管理網站部署設定與文件對齊線上（稽核第 2 項）

- 日期：2026-10-26。Agent：Claude。分支 `claude/admin-deploy-config`（從 main `9360e7f` 開）。
- 依據：2026-10-26 架構稽核第 2 項；K 同意三點：vars 寫進 repo、加只能手動的部署 workflow、維持 workers.dev 網址。
- 唯讀核對線上（沒有改 Cloudflare）：
  - `wrangler deployments list`：共 5 次本機手動部署（2026-10-25 08:05～17:22 UTC），Message 都是空的；目前版本 `3c76039f`，早於 #587 合併。
  - `wrangler versions view`：bindings 是正式 D1 `6cd6c304`、R2 `bq-shelter-photos`；三個 vars 有值，`ADMIN_ORIGIN` 是 workers.dev 網址。
  - 沒登入 curl `/`、`/api/manage/dogs`、`/vendor/tabler.min.css` 都 302 到 Access 登入頁；版本預覽網址 404。
- 落差：repo 寫 `workers_dev: false`、vars 空白、`keep_vars: false`，照 repo 部署會關掉 workers.dev 並清空 vars，管理網站全部拒絕存取。
- 改了：
  - `wrangler.admin.jsonc`：填入三個線上 vars、`workers_dev: true`；開頭註解改正（會寫 D1／R2、不是唯讀）。
  - 新增 `.github/workflows/deploy-admin.yml`「部署管理網站」：只能手動、可指定分支；先確認正式庫 migration 都套過，`--message "分支 commit"`，部署後確認沒登入被轉到 Access 登入頁。
  - 測試：`scripts/admin-table.test.mjs` 改檢查 workers.dev 與 vars 格式；`tests/index/hosting.js` 加部署 workflow 擋關檢查與反例。
  - 文件：`admin/README.md` 部署段、`docs/ARCHITECTURE_NOW.md` 管理網站段、`worker/src/index.js` 開頭註解（/api/admin 與管理網站分開說）。
- 未做：沒有部署、沒有跑新 workflow、沒有改 Access 設定。合併後線上仍是 `3c76039f`，要 K 按一次「部署管理網站」才會換成 main 並留下 commit 紀錄。CI 的 Cloudflare token 有沒有管理網站 Worker 的權限，第一次跑才知道。
- 相關 PR：#605（草稿）。
