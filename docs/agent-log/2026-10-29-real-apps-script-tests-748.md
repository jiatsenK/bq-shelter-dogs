# 2026-10-29 溜狗測試改跑真的 Apps Script（#748）

- Agent：Claude Code（Opus 5.5），分支 `claude/748-real-apps-script-tests`
- 依據：#748（2026-10-29 架構檢視跟 K 定的三張票的第 3 張，接在 #746、#747 之後）
- 相關 PR：（開 PR 後補上）

## 做了什麼

- 新增共用 fixture `worker/test/apps-script.mjs`：vm 載入真的 `apps-script/sheet-write.gs`，小程式的 `UrlFetchApp` 接到 `worker.fetch`（同一個 D1）。`gas.sheet` 是 `todayWalks(env, { sheet })` 的測試 adapter，`gas.worker` 是接上這份小程式的 Worker（網站登記背景派送、排程都叫它）。
  - GAS 的 `UrlFetchApp` 是同步、`worker.fetch` 是非同步：每次執行先同步跑，碰到還沒拿到回應的 Worker 呼叫就停下、還原表與指令碼屬性，等回應後從頭重跑並照順序重播已拿到的回應（送的內容不同就報錯）。一次只跑一個執行。
  - 故障情境都在 GAS 外面或執行邊界上模擬：`gas.network`（Worker 到小程式的網路：連不上、回應遺失、卡住）、`gas.stopAt`／`gas.stopAfter`（執行在呼叫 Worker 前後被停掉）、`gas.cutOff`（Worker 那次派送被停掉沒收尾）、`gas.sheetError`（試算表 ID 錯、沒權限）、小程式自己的 `WRITE_KEY` 跟 Worker 不同（金鑰錯）。
- 正式程式只加接縫，行為不變：`callSheet(env, body, send = fetch)` 多一個送 HTTP 的參數（逾時、錯誤分類沒動）；`worker/src/index.js` 多 `createWorker({ sheet })`，預設 `callSheet`，`export default createWorker()`。網站登記的背景派送、排程的寫回重試與保險掃描、備註／異動紀錄都用這個 `sheet`。`apps-script/sheet-write.gs` 沒改，不用重新部署。
- 改用 fixture、拿掉 `globalThis.fetch` 與手寫 GAS 協定：`walk-retry`、`walk-reconcile`、`walk-writeback`、`walk-edit-rows`、`walk-accept`、`walk-round-trips`、`today-walks-budget`、`today-walks-scan`、`today`、`cron-status`、`walkers-d1`。
- 不再 import 今日溜狗紀錄內部檔：
  - `today-walks-budget`：不讀 `ROW_COST`，測試自己照 schema 算每列成本，在 module 寫的表掛觸發器數實際寫了幾列，確認保留量 ≥ 實際寫入（比原本的 `total_changes()` 多算索引；把 `budget.js` 的成本改小會失敗，已手動驗過）。`ROW_COST` 結構測試因此拿掉。
  - `walk-retry`：`RETRY_LIMIT`、`STOPPED_AT` 寫成規格值；`#685` 的重試上限改用「一次派送實際保留的量」。
  - `walk-reconcile`、`walk-writeback`：指紋一致改成「Worker 送的指紋，真的小程式比對後不回這隻」。
  - `undo-revert`：`previousWalk` 改走網站登記再復原。
  - `walk-log`：預算等式拿掉（`today-walks-budget` 已涵蓋，第一次溜了改成兩人一起量）。
  - `dog-list`：#682 的 `walkDay` 測試改走 `observe`。
  - `scripts/diagram-facts.test.mjs`：`RETRY_LIMIT` 改從原始碼文字讀。
- `standards.test.mjs`：「today-walks/ 以外只 import index.js」拿掉 `*.test.mjs` 排除，範圍加上 `worker/test/`。

## 例外與要注意的

- `/rows`、`/dog-list` 的格式檢查（送 51 列、`departed` 列、不在表上的狗）仍直接打 Worker 端點：小程式不會這樣送，測的是 Worker 收到壞資料時怎麼回。寫回協定（walkWake → target → 寫格子 → receipt）一律跑真的 `.gs`。
- `walk-reconcile`「掃描回應只有 ok」用 `gas.network` 回 `{ ok: true }`，模擬壞掉或舊版的小程式。
- 非溜狗測試的 `globalThis.fetch`（`activities`、`d1-write`、`dog-list`、`r2`、`sheet-call`、`worker`）照票不碰；`dog-list-walks.test.mjs` 直接送 `/dog-list`、`/rows` 的列，沒有換 fetch、也不是寫回協定，這次沒改。
- fixture 的主清單只有「主清單」分頁（`已出所`、`常遛狗群` 讀不到）；預設表頭沒有籠位欄，人工改表時狗清單同步（`/dog-list`）不會送出，只送 `/rows`。
