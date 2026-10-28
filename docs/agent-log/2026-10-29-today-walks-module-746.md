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
- 時鐘統一用 `now()`（排程傳排程時間）；只有寫回退避保留 `max(now, 現在)`，叫 Apps Script 花的時間不能讓重試提早到期（審查指出後補回）。

## 審查（Standards／Spec 兩軸，固定基準 main）

- 已補修：`scripts/adr-index.mjs` 只讀 `worker/src` 第一層，搬家後 `docs/adr/README.md` 少了 4 個環境變數 → 改讀子資料夾（不含 admin/）；`/walk/result` 改走 module 的 `result()`；保險掃描比對時重查目前工作的狀態（讀表期間剛被派送的不收）；退避時鐘；`dispatch.js` 改用 `same()`、`read.js` 改用 `keyOf`；預算測試補「清掉衝突」。
- 沒改、留給之後判斷：測試檔仍可 import 內部檔（standards 測試只管 worker/src、scripts 的程式）；`listWalkLog`（狗清單同步）與中斷後恢復派送沒有單獨的 total_changes 測試；`date`＋`walker` 一對、`shared.js` 什麼都放等寫法建議。
- `scripts/diagram-reminder.test.mjs` 在這台 Windows 上 main 原本就失敗（同一份 main 另開 worktree 也一樣），不是這次造成。

## 相關 PR

- （開好後補）
