# Worker 保險掃描跟 GAS dogListScan 錯開；walkScan 等 45 秒

- 日期：2026-10-26。Agent：Claude（Opus 5.5）；分支 `claude/scan-time-offset`，基準 origin/main `49106ff`。接續稽核第 4 項的工作階段。
- 依據：研究 `docs/research/2026-10-26-worker-gas-sync-design.md`（結論：兩邊各發起一個保險掃描合理；同時段搶 GAS 鎖可能讓其中一次掃描失敗）。K 2026-10-26 決定：Worker 保險掃描改到台灣 09:23、13:23、23:23，`walkScan` 逾時拉到 45 秒，ADR 0018 第 5 點照實作改寫。
- 變更：
  - `wrangler.jsonc`、`worker/src/index.js`：保險掃描 `53 1,5,15 * * *` 改 `23 1,5,15 * * *`；照片垃圾桶跟著變成每月 1 日 09:23 那次清。
  - `worker/src/sheet-write.js`：`walkScan` 逾時 45 秒，`walkWakeBatch` 90 秒、其他 20 秒不變。
  - `admin/public/js/data-checks.js`：管理網站排程說明的時間。
  - 文件：ADR 0018 第 5、7 點；`docs/ARCHITECTURE_NOW.md` 排程表；`docs/setup/SHEET_WRITE_SETUP.md`；重新產生 `docs/adr/README.md`。
  - GAS 不用動：`dogListScan` 仍是 09:43、13:53、23:53（前後差 15 分鐘）。
- 測試：排程字串相關測試（cron-status、dog-list 垃圾桶、walk-edit-rows）改新時間；`sheet-call.test.mjs` 新增逾時測試。
