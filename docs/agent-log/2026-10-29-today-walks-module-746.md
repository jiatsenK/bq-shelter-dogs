# 2026-10-29 今日溜狗紀錄收成一個 module（#746）

- Agent：Claude Code（Opus 5.5），分支 `claude/today-walks-module-746-ae9a87`
- 依據：#746（K 2026-10-29 三輪討論定案；三張票的第 1 張，之後 #747、#748）

## 做了什麼

- 新增 `worker/src/today-walks/`：`index.js`（唯一入口 `todayWalks(env, { sheet, now })`）、`version.js`（寫新版本的唯一轉換）、`accept.js`、`observe.js`、`receipt.js`、`dispatch.js`、`scan.js`、`read.js`、`budget.js`、`shared.js`。
- 刪 `walk-accept.js`、`walk-reconcile.js`、`walk-retry.js`、`today.js`；`index.js` 的溜狗路由、六條 `/walk-writeback/*`、排程、`admin/index.js` 改呼叫新 module。`admin/checks.js` 的 `readStoppedWalks` 搬進 module（`stopped()`）。
- 保險掃描改用改表通知的規則（行為改變，ADR 0018 補充）。掃描仍不碰已交給 GAS 的派送（派送中、結果不明、等重試），讀表前後版本變了也先不收。
- 寫入預算依要寫的表自動算（`budget.js` 的 `ROW_COST`／`costOf`）；`walk-cost-preview.mjs`、`walk-reconcile-cost-preview.mjs` 改成正式測試 `today-walks-budget.test.mjs`。新測試 `today-walks-scan.test.mjs`。
- `standards.test.mjs`：讀 `worker/src` 子資料夾；新增「today-walks/ 以外只 import index.js」（範圍是 worker/src、scripts 的程式，測試可直接測內部檔）。
- 文件：ADR 0018 補充段、ADR 0004／0008 路徑、`ARCHITECTURE_NOW.md` 路徑、`ARCHITECTURE.md` 引用行號與元件圖（今日溜狗紀錄搬進共用框，管理入口 → 今日溜狗紀錄）。

## 例外與要注意的

- 三個走 `worker.fetch` 的既有測試改了內容（票上要求不改，但跟其他驗收條件衝突）：
  - `walk-log.test.mjs`「每日寫入預算算進修改紀錄」、`walk-retry.test.mjs`「#685 重試用量…」寫死了舊的手算保留量（48、96），改成用 `costOf`／`DISPATCH_COST` 算。
  - `walk-reconcile.test.mjs`「還有差異沒收完」原本測「pending 不收」，跟新規則（同日合併要收 pending）衝突；改成測「派送結果不明不收」。
- 新的保留量比舊常數小（例如一次派送 96 → 71、一次溜了 32＋8＋4n → 約 27＋2＋6n）；每列成本照結構算，SQLite `total_changes()` 測試確認都夠。
- `apps-script/sheet-write.gs:531` 註解仍寫 `walk-reconcile.js`，為了不動 GAS 檔沒改（只是註解）。
- 時鐘統一用 `now()`：排程傳排程時間；寫回退避原本是 `max(排程時間, 現在)`，改成排程時間。

## 相關 PR

- （開好後補）
