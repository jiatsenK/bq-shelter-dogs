# /walkers 每分鐘重讀查證（2026-10-24）

問題：「手機每分鐘跟著今日溜狗紀錄一起問一次 GET /api/walkers，Worker 每次都把主清單所有狗重讀一次；這是 K 2026-10-20 的要求」是否屬實。以分支 `claude/walk-scan-per-dog`（HEAD `55bccdc`）程式碼為準。

## 1. 手機什麼時候呼叫 `BQApi.walkers()`

- `public/js/api.js:51`：`walkers: () => get('/walkers', { cache: 'no-cache' })`。沒有版本號、沒有 ETag、沒有 `since`，每次都拿整份。`no-cache` 只是叫瀏覽器跟伺服器重新確認，Worker 也不回 304。
- 唯一的呼叫點是 `loadWalkerNames()`（`public/js/app.js:1175-1199`），它在下面這些時候被呼叫：
  - 啟動時：`app.js:3165`
  - 網路恢復（`online` 事件）：`app.js:3219`
  - 按「更新」：`app.js:3238`
  - **每分鐘輪詢**：`refreshTodayWalks()`（`app.js:1213-1220`），由 `setInterval(refreshTodayWalks, TODAY_POLL_MS)`（`app.js:3223`，`TODAY_POLL_MS = 60s`，`app.js:1202`）以及 `visibilitychange`（`app.js:3222`）觸發。畫面隱藏時不抓，距離上次抓不到 30 秒也不抓（`app.js:1214-1215`）。
- 輪詢有條件：`app.js:1219` `if (!SITE.d1WalkAccept) loadWalkerNames();`，註解寫著「#460：D1 模式人工改表由伺服器比對後進 D1 資料包，手機不再每分鐘讀試算表名單」（commit `4ffdd97`，PR #487）。
- 目前 `public/js/site-config.js:6` 是 `d1WalkAccept: false`，所以**現在正式設定下手機確實每分鐘跟 /today 一起問 /walkers**；開關一打開就不再輪詢，只剩啟動、恢復連線、按「更新」這三種時候。

## 2. /today 的機制與 /walkers 的關係

- `/today` 有版本號：`worker/src/today.js:4` 註解寫明依 ADR 0009；`today.js:48-50` 每次只讀 1 列 `v3_data_versions.today`，版本跟日期都沒變就回記憶體快取。這是「有改才讀」，但只省在 Worker 讀 D1 的那一段，手機每次照樣拿到整份回應（`api.js:48`）。
- `/walkers` 沒有版本號。`worker/src/index.js:824` 只看時間：`walkersCache` 超過 `WALKERS_CACHE_MS`（60 秒，`index.js:759`）就呼叫 `readWalkersD1`，內容有沒有變都會重讀。
- `readWalkersD1`（`index.js:765-790`，`55bccdc` / #519 引入）是一個 batch，整張讀三個查詢：`v3_sheet_main` 全部列、`v3_sheet_main_walkers` join 名字、`v3_walk_state` 全部列。所以「快取過期後整份主清單重讀」是對的。
- 兩者只在手機端有關聯：同一個 `refreshTodayWalks` 觸發；`readAt`（`index.js:829-831`）讓手機判斷今日紀錄和名單哪一份比較新。

## 3. 「K 2026-10-20：其他手機 1 分鐘內要看到」的出處

- `git log -S` 找到引入 commit `9648dbc`（2026-10-20，PR #435）「不管在網站按或直接改試算表都同步，只有自己按的狗留原地」。commit 內文第一點：「/walkers 快取改 1 分鐘…手機每分鐘重讀」。
- `docs/agent-log/2026-10-20-live-sheet-sync-and-resort.md` 的「依據」一行：K 回報按「更新」不重排、別人溜的狗沒同步；「K 決定：不管在網站按還是直接改試算表都要同步，1 分鐘內；只有自己按的狗留原地」。
- `docs/adr/0007-today-walks-live.md` 的「2026-10-20 補充（K 決定）」（第 24、28 行附近）：試算表名單跟著每 1 分鐘重讀、快取 5 分鐘改 1 分鐘、費用估約 5.4 萬次／天。
- **原話和詮釋要分開看**：repo 裡沒有 K 的逐字原話，以上全是 agent 轉述。能歸給 K 的需求只有「不管在哪裡改，1 分鐘內要同步」（agent-log 寫的是「K 決定」）。「手機每分鐘輪詢 /walkers」「Worker 快取 1 分鐘、到期整份重讀」都是 agent 選的做法，K 沒有指定要這樣實作。ADR 0007 的段落標題雖然寫「K 決定」，但把實作細節也放在同一段裡。

## 4. ADR 0018 之後還需要嗎？文件有沒有說要改成有改才讀

- ADR 0018（`docs/adr/0018-today-walks-d1-event-sync.md`）第 11 行：試算表改了，由 GAS 只送改動的格子，Worker 不再回頭讀整張表；第 16 行：用版本核對判斷新舊。方向就是事件驅動加版本號。
- 程式端已經照這個方向走一半：#460 / PR #487 讓 D1 模式下手機不再每分鐘讀名單（`app.js:1218-1219`）。只是開關還關著（`site-config.js:6`），所以舊的輪詢路徑還在跑。
- Worker 端的 `/walkers` 還沒有版本號。`docs/agent-log/2026-10-24-519-walkers-d1.md` 明講這是例外：整張讀三句列入 `FULL_SCAN_OK`（約 300 列、1 分鐘快取），「要改成增量需另開票」。到目前沒有找到這張票。
- 結論：開關打開後，手機端每分鐘輪詢就不需要了（程式已經寫好）。Worker 端可以比照 `/today`，加 `v3_data_versions` 的版本號做到「有改才讀」，文件只說過要另開票，還沒有決定。

## 5. 先前說法的對錯

| 說法 | 判定 | 來源 |
|---|---|---|
| 手機每分鐘跟今日紀錄一起問 /walkers | **現在對，但有條件**：只在 `d1WalkAccept=false` 時；#460 已寫好 D1 模式下不輪詢 | `app.js:1219`、`site-config.js:6`、`4ffdd97` |
| Worker 每次都重讀所有狗 | **誇大**：快取 60 秒內回快取，過期才整份重讀；快取是每個 Worker 執行個體各自一份 | `index.js:759, 824` |
| 約 120 隻 | 未查證；#519 紀錄寫約 300 列 | `2026-10-24-519-walkers-d1.md` |
| 這是 K 2026-10-20 的要求 | **部分錯**：K 的要求是「1 分鐘內同步」，每分鐘輪詢和整份重讀是 agent 選的實作 | `9648dbc` / #435、agent-log、ADR 0007 |
| K 認為應該有改才讀 | 符合 ADR 0018 的方向；`/today` 已經這樣做，`/walkers` 還沒有 | `today.js:48-50`、ADR 0018 第 11、16 行 |
