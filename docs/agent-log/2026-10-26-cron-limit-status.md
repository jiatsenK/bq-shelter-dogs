# 2026-10-26 排程減量與最後跑完時間（稽核第 5 項）

- Agent：Claude Code（Opus 5.5）
- 分支：`claude/cron-limit-status`
- 依據：2026-10-26 架構稽核第 5 項。K 看過 Cloudflare 後台：正式站、測試站各 4 個排程，共 8 個；帳號這個月為了測試暫時升級付費，之後要降回免費（上限 5 個，算整個帳號）。K 同意「正式 2 個＋測試 1 個，管理站顯示各排程最後成功時間」。

## 做了什麼

- `wrangler.jsonc`：`5-59/10 * * * *`、`53 1,5,15 * * *`。保險掃描 09:43 改 09:53；照片垃圾桶不另佔排程，每月 1 日 09:53 那次保險掃描順便清（`worker/src/index.js` 的 `trashDue`）。
- `wrangler.test-site.jsonc`：只留寫回重試。要測保險掃描或垃圾桶時暫時加 `SCAN_CRON` 再部署。
- `worker/src/cron-status.js`：三件排程工作每次跑完記 `okAt`、出錯記 `failAt` 與訊息，存在 `v3_sync_state` 的 `cron_retry`／`cron_scan`／`cron_trash`（JSON，`json_patch` 一次寫入，不蓋掉上次 okAt）。功能沒開（`WALK_RETRY_ENABLED`、PREVIEW）不記。
- `scanTick`、`retryWalks` 改為出錯往外丟、功能沒開回 false，由 `recordRun` 記失敗並 `console.warn`。預算拒絕現在也記成寫回重試失敗。
- 管理網站：`GET /api/manage/cron-status`（`readCronStatus`，只讀），資料檢查頁新增「排程」卡片。過期門檻：寫回重試 40 分鐘、保險掃描 13 小時（正常最多隔 10 小時）、垃圾桶 32 天。
- 文件：`docs/ARCHITECTURE_NOW.md` 排程段、ADR 0018 第 7 點加修訂註記、`docs/setup/SHEET_WRITE_SETUP.md`、`docs/design/admin.md`、重新產生 `docs/adr/README.md`。

## 例外與注意

- 推翻了 #458／#459 設計稿「無差異不寫心跳」：寫回重試沒工作時也寫一列跑完時間，一天約 144 列，保險掃描 3 列。K 同意方案時已說明寫入量。
- 合併部署後，Cloudflare 會用新的排程清單取代舊的 4 個；測試網站要等 `deploy-test-site.yml` 部署才會變成 1 個。
- 預覽 Worker（另一個 session 在做隔離）不應設任何排程，已傳訊息提醒。
- 第一次 `cron_trash` 紀錄要等 2026-11-01 09:53。

## PR

- 草稿 PR：待補
