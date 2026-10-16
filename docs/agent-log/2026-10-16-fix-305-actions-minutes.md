# 2026-10-16 GitHub Actions 分鐘數（#305）

- Agent：Claude Code（Opus 5.5）
- 分支：`fix/305-actions-minutes`
- 依據：#305 的 /grill-with-docs 決定、`docs/adr/0008-sync-on-change.md`

## 做了什麼

- **同步**：Worker Cron 改每 10 分鐘看一次（`worker/src/sync-plan.js`）。Apps Script 通知 `POST /api/sheet-changed`（專用密碼 `SHEET_NOTIFY_KEY`，header `X-Notify-Key`）後下一格才叫 GitHub，一天最多 30 次；台灣 6:30 那一格保險同步。狀態存 D1 `v3_sync_state`（已加進 `db/compact-schema.sql`）。
- **「更新」**：Worker 先算試算表三個分頁（主清單、常遛狗群、已出所）的 gviz 指紋，跟上次叫同步時一樣就回 `unchanged`，不叫 GitHub；讀不到指紋照樣叫。前端看到 `unchanged` 直接說已是最新。
- `sync-sheet.yml` 拿掉 GitHub 排程；推同步相關程式照樣同步。
- **縮圖**：Cron 不再重叫縮圖 Action（只剩上傳時叫一次）；部署拿掉「縮圖完成後部署」。沒縮圖時網站顯示原圖＋右下角小點（`.thumb-full`）。
- **測試、預覽**：只改 `docs/**`、根目錄 `*.md` 不跑。私人 repo 免費方案設不了必要檢查，不會卡 PR。
- `apps-script/sheet-write.gs` 加 `notifyWorker`；設定步驟寫在 `docs/setup/SHEET_WRITE_SETUP.md` 第 6 節。

## 未完成（K 要做）

- 設 GitHub Secret `SHEET_NOTIFY_KEY`、更新 Apps Script、設指令碼屬性和「變更時」觸發器（SHEET_WRITE_SETUP.md 第 6 節）。沒做之前只靠每天 6:30 和「更新」。
- 「更新」叫同步後若 GitHub 那次同步失敗，指紋已記下，要等試算表再改或隔天 6:30 才會再同步。

## 審查後修正

- Cron 叫 GitHub 失敗時把「有改」放回去，下一格再試（原本會等到隔天 6:30）。
- 審查提到但沒改：`docs/adr/` 有兩份 0008（`0008-diff-sync-and-write-budget.md` 是 #303 留下的），編號衝突不是這張票造成的，留給 K 決定要不要把其中一份改成 0009。每次讀狀態前的 `CREATE TABLE IF NOT EXISTS` 留著，部署後第一次同步前表可能還不存在，只多一次讀取。
