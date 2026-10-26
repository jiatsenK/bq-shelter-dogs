# 歷史文件搬到 docs/design/history

- 日期：2026-10-26。Agent：Claude。
- 依據：K 交辦 2026-10-26 Issue／規格稽核報告 P1 第 8 項（P1 第 6、7 項在 PR #584）。
- 做了什麼：
  - 把描述已退役架構或單張票交接的文件搬到現有的 `docs/design/history/`：`COMPACT_D1.md`、`setup/SHEET_SYNC_SETUP.md`、`setup/PHOTO_UPLOAD_SETUP.md`、`FRONTEND_REQUIREMENTS.md`、`267-identity-rollout.md`、`267-identity-dry-run.json`、`273-info-page.md`、`285-intake-events.md`、`390-intake-presentation.md`、`INTRO_REWRITE.md`、`design/mobile-ui-implementation-spec.md`、`design/mobile-ui-tickets-handoff.md`、`design/implementation-tickets/`。內容沒改，只改相對連結。
  - 其他文件（`docs/agent-log/` 和 `AGENT_LOG.md` 除外）指向這些檔案的路徑和連結改成新位置；檢查過搬動後的相對連結都找得到。
  - `ARCHITECTURE_NOW.md`「已退役」一節列出搬過去的檔案。`README.md` 把 `FRONTEND_REQUIREMENTS.md` 標成舊版。
  - `docs/setup/CLOUDFLARE_SETUP.md` 留在原位，只改過時的地方：縮圖改由網站產生（#546）、`r2-thumbs.yml` 只供人工補圖、部署觸發條件（沒有 `workflow_run`）、Worker 不再攔 `/data/dogs.json`、表結構以 `db/compact-schema.sql` 為準。
  - `worker/src/compact.js`、`scripts/import-compact-profiles.mjs` 的註解拿掉 `COMPACT_D1.md`，只指向 `db/compact-schema.sql`。
- 沒做：`docs/agent-log/` 和 `AGENT_LOG.md` 裡的舊路徑不改（紀錄保持原樣）。`docs/design/` 裡其他 10/17 的交接文件（`info-page-interview.md`、`mobile-home-and-groups-decisions.md`、`issue-*/`）不在稽核清單，沒有搬。
- 相關 PR：見本分支 `claude/docs-history-move` 的草稿 PR。
