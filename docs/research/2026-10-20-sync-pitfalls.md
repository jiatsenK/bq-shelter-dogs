# 板收志工溜狗表：資料同步還有哪些坑

- 日期：2026-10-20（台灣時間）。Agent：Claude Code 背景研究代理。
- 依據：K 2026-10-20 決定「不管在網站按溜了還是直接改試算表，其他手機 1 分鐘內同步；只有自己這支手機按的狗留原地不重排」（ADR 0007 補充）。
- 範圍：分支 `fix/live-sheet-sync-and-resort`（origin/main＋PR #435）的原始碼與官方文件。沒有操作瀏覽器、沒有改程式、沒有寫正式資料。
- 標示：**已確認**＝讀到程式碼就能推出；**推測**＝邏輯上成立但需要實測確認。
- 行號以本分支 2026-10-20 的檔案為準。

## 先看資料怎麼流

| 誰改 | 寫到哪 | 其他手機從哪看到 | 多久 |
|---|---|---|---|
| 網站按溜了／復原 | Apps Script 寫試算表 → Worker 寫 D1 `v3_today_walks` | `/api/today`（D1）＋`/api/walkers`（gviz 讀試算表） | 手機每 60 秒輪詢（`public/js/app.js:1306`、`:4082`） |
| 直接改試算表 | 試算表；Apps Script「變更時」觸發器通知 Worker 記「有改」 | `/api/walkers`（gviz）；D1 主清單要等同步 | `/walkers` 快取 60 秒（`worker/src/index.js:769`）＋輪詢 60 秒 |
| 同步（GitHub Actions） | 試算表 → D1（`/api/dogs` 的 `walkedDate`、溜狗紀錄） | `/api/dogs` | Cron 每 10 分鐘看一次、一天最多 12 次（`worker/src/sync-plan.js:9`、`wrangler.jsonc` `*/10 * * * *`） |

## 結論（依嚴重度）

| # | 坑 | 嚴重度 | 狀態 |
|---|---|---|---|
| 1 | 在試算表清掉「誰遛的」，已經有今日紀錄的手機不會跟著清 | 高 | 已確認 |
| 2 | 在試算表清掉「遛狗日期」，手機退回 D1 舊日期 | 中高 | 已確認 |
| 3 | 「更新」按鈕叫同步沒有每日上限，網站寫過試算表後幾乎每按必跑 GitHub Actions | 中高 | 已確認 |
| 4 | Worker 記憶體快取在不同機器不共享：「1 分鐘」實際可到 2 分多，Google 讀取也不是「最多每分鐘一次」 | 中 | 已確認＋推測 |
| 5 | 手機時鐘不準時，新舊判斷錯：別人的溜了被忽略、或自己剛按的閃回未溜 | 中 | 已確認（機制）／推測（發生率） |
| 6 | 一天 12 次用完後，手動改試算表的歷史、D1 主清單、撤銷用的「上一次」都停在舊的 | 中 | 已確認 |
| 7 | 6:30 保險同步失敗那天，不會補跑「保險」版本 | 中 | 已確認 |
| 8 | 網站寫入不會讓 Worker 記「有改」，D1 主清單要等 6:30 或有人按更新 | 中 | 已確認 |
| 9 | 沒網路時按溜了，不會自動補送 | 中 | 推測 |
| 10 | gviz 本身可能有快取延遲 | 中 | 推測 |
| 11 | 「只有月日」的日期跨年判錯年 | 低 | 已確認 |
| 12 | 手機時區不是台灣時，今日紀錄整包被丟掉 | 低 | 已確認 |
| 13 | 沒編號的狗靠犬名當 key，同名或改名就對錯狗 | 低 | 已確認 |
| 14 | 免費額度估算 | 低（目前） | 已確認＋推測 |

以下逐條說明。

---

### 1. 在試算表清掉「誰遛的」，有今日紀錄的手機不會清（高，已確認）

- **情境**：甲在網站按「溜了」→ 發現按錯，管理者直接在試算表把「誰遛的」那格清空（日期也可能一起清）。
- **會看到**：甲的手機和其他已收到 `/today` 的手機，這隻狗一直顯示「甲溜了」，直到下一次同步把 `syncedAt` 往後推、今日紀錄過期為止（若同步次數已用完，可能到隔天 6:30）。新打開網頁的手機也會從 `/today` 再收到「甲溜了」。
- **原因**：
  - Worker 解析名單時，「誰遛的」空白的列直接跳過，不放進 `walkers`（`worker/src/index.js:833` `if (!text) continue;`）。
  - 手機端 `receiveNames`：名單裡沒有這隻狗、而且也沒日期時直接 `continue`（`public/js/walk-registration.js:104`）；只有日期時，名字沿用本機舊值 `item.current.walker`（`:106`）。所以「清空」這個動作永遠傳不到手機。
  - `/today` 的 D1 列只有網站寫入時才會更新（`worker/src/index.js:1003-1008`），手動改試算表不會動它；新手機開網頁時 `receiveToday` 再把舊紀錄套上（`walk-registration.js:76-91`）。順序若是名單先到，`receiveNames` 也不會蓋掉它（同上 `:104`）。
  - ADR 0007「後果」本來就寫「試算表被手動改掉時，最多到下次同步前，網站可能還顯示今天溜過」，但這和 K 10-20「直接改試算表也 1 分鐘內同步」的新決定衝突。
- **建議修法**：Worker 對「有犬名、名字空白」的狗也回 `walkers[key] = ''`（或另回 `cleared` 清單），手機端把「名單有這隻狗但空白」視為清掉。

### 2. 在試算表清掉「遛狗日期」，手機退回 D1 舊日期（中高，已確認）

- **情境**：有人把某隻狗「遛狗日期」格清空或改成讀不懂的字（例如「昨天」「10月20」）。
- **會看到**：網站顯示的是上一次同步時 D1 的日期，不是空白；看起來像「試算表改了網站沒動」。
- **原因**：日期讀不懂或空白時不放進 `dates`（`worker/src/index.js:831-832`、`walkersDate` 只認 `Date(...)`、`YYYY/M/D`、`M/D`，`:803-814`）；手機的 `base` 是 `walkerDates[key] || dog.walkedDate`（`public/js/app.js:1528`），沒有就退回 D1。
- **建議修法**：Worker 對每隻狗都回日期欄位（空字串代表空白），手機端「名單有這隻狗」就以名單為準，不退回 D1。

### 3. 「更新」叫同步沒有每日上限（中高，已確認）

- **情境**：早上 10 個志工各自按了幾隻溜了，之後陸續按「更新」。
- **會看到**：每次按「更新」幾乎都會叫一次 GitHub Actions（約 1 分鐘），不受「一天 12 次」限制。
- **原因**：
  - `/sync` 只做「同一 IP 2 分鐘 1 次」（`worker/src/index.js:62`、`:1424`），而且這個計數存在單一 Worker 機器的記憶體（`:66-68` 註解自己承認是「盡量擋」）。
  - 它用試算表指紋判斷要不要跑（`refreshPlan`，`worker/src/sync-plan.js:69-75`）；網站按溜了會改試算表，所以指紋幾乎每次都不同，`planTick` 的 12 次上限（`sync-plan.js:38-48`）完全沒有管到這條路。
  - repo 是私人的（`gh repo view` → PRIVATE），GitHub Actions 免費每月 2,000 分鐘，每個工作單位無條件進位到整分鐘（https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions）。`tests.yml`、預覽部署也共用這份額度。
  - 額度用完後同步全停（ADR 0010 背景已提到 #329 發生過）。
- **建議修法**：`/sync` 叫 GitHub 前也走 `v3_sync_state` 的每日計數（可另設較高上限，例如 20），超過就回「今天更新次數已滿，名單仍會每分鐘更新」。

### 4. Worker 記憶體快取在不同機器不共享（中，已確認＋推測）

- **情境**：甲在網站按溜了，乙的手機 1 分鐘後輪詢 `/walkers`。
- **會看到**：乙最慢可能超過 2 分鐘才看到名單變化；兩支手機同一時間看到的名單可能不一樣。
- **原因**：
  - `walkersCache` 是模組層變數（`worker/src/index.js:71`），寫入後只清掉**處理寫入那台**的快取（`:1002`）。Cloudflare 同一個 Worker 會在很多台機器、很多個 isolate 同時跑，全域變數不共享、也可能隨時被回收（https://developers.cloudflare.com/workers/reference/how-workers-works/ 、https://developers.cloudflare.com/workers/runtime-apis/ 中關於 global state 的說明）。
  - 最壞情況：快取 60 秒（`:769`）＋手機輪詢 60 秒（`app.js:1306`）＋手機在背景時不抓（`app.js:1332`）＋gviz 自身延遲（見第 10 條）。
  - `/today` 沒有這個問題：它每次先讀 D1 的版本號（`worker/src/today.js` `readTodayWalks`，ADR 0009），任一台機器寫入都看得到。名單本身仍是試算表正本，所以「直接改試算表」的情況就吃到上面的延遲。
  - ADR 0007 補充寫「讀 Google 最多每分鐘一次」，實際上是「每個 isolate 最多每分鐘一次、每次 2 個 gviz 請求」（`index.js:849-851` 讀兩次），機器多時會更多。
- **建議修法**：在 D1 或 Cache API（`caches.default`，同一個資料中心共用）放名單快照與讀取時間，取代模組層變數；寫入後把快照標記過期。

### 5. 手機時鐘不準時，新舊判斷錯（中，已確認機制／推測發生率）

- **情境 A**：乙的手機時間快 3 分鐘。甲在網站按溜了。
- **會看到 A**：乙在 3 分鐘內收到 `/today` 也不套用，直到下次同步。
- **情境 B**：甲的手機時間慢 2 分鐘，按溜了後馬上輪詢 `/walkers`，剛好拿到另一台機器上「按之前」讀的名單。
- **會看到 B**：甲自己剛按的狗閃回「未溜」，下一輪再變回來（或被重排）。
- **原因**：手機用自己的 `Date.now()` 記 `observedAt`（`walk-registration.js:8`、`:52-55`），再拿去跟伺服器時間比：`/today` 的 `at`（`:85` `at < records[...].observedAt` 就略過）、名單的 `readAt`（`:105` `observedAt > sheetAt` 才保留本機）。兩個時鐘不同源。
- **建議修法**：手機記下 Worker 回應的 `Date` 標頭算出時差，`observedAt` 一律換成伺服器時間；或寫入成功時用 Worker 回傳的時間。

### 6. 一天 12 次用完後（中，已確認）

- **情境**：當天有人手動改試算表超過 12 輪（每 10 分鐘算一輪）。
- **會看到**：手機上的「今天誰溜了」照樣 1 分鐘更新（走 `/walkers`）；但 D1 主清單、`/api/dogs` 的 `walkedDate`、電腦版最近 30 天、狗的歷史紀錄都停在第 12 次，到隔天 6:30 才補。
- **原因**：`planTick` 回 `cap` 就不叫同步，「有改」標記留著（`sync-plan.js:44-46`）；隔天第一格才跑。ADR 0016 的「撤銷找上一次」從 D1 `v3_walks` 讀（`worker/src/today.js` `previousWalk`），這段期間撤銷可能寫回比實際更舊的日期。
- **建議修法**：頁首在 `cap` 時顯示「今天同步次數已滿，歷史紀錄明早更新」；撤銷找不到今天以後的同步時，提醒使用者確認日期。

### 7. 6:30 保險同步失敗那天不會補跑保險版（中，已確認）

- **情境**：台灣 6:30（UTC 22:30）那次叫 GitHub 失敗（GitHub 5xx、token 過期、分鐘數用完）。
- **會看到**：當天沒有「逐隻核對最後一次溜狗」；前一天只在網站按、沒觸發同步的溜狗紀錄，可能在當天被新的「遛狗日期」蓋掉而永遠沒進歷史。
- **原因**：保險同步只認 `getUTCHours()===22 && getUTCMinutes()===30` 那一格（`sync-plan.js:25-28`）；失敗時只把「有改」放回去（`worker/src/index.js:548-552`），下一格跑的是一般同步，不帶 `daily`。試算表每隻狗只存最後一次（ADR 0010 背景），歷史靠同步「看到」才有。Cloudflare Cron 是 UTC（https://developers.cloudflare.com/workers/configuration/cron-triggers/）。
- **建議修法**：在 `v3_sync_state` 記「今天保險同步完成日期」，6:30 之後任一格發現今天還沒完成就補叫 `daily`。

### 8. 網站寫入不會記「有改」（中，已確認）

- **情境**：整天只有人在網站按溜了，沒人手動改試算表，也沒人按更新。
- **會看到**：手機上即時（`/today`），但 D1 主清單與歷史到隔天 6:30 才更新；當天電腦版「最近 30 天」不含今天在網站按的。
- **原因**：Apps Script 的「變更時」觸發器不會被程式寫入觸發（`apps-script/sheet-write.gs:301-303` 註解；官方：https://developers.google.com/apps-script/guides/triggers/installable ）；Worker `/walk` 成功後也沒有 `markChanged`（`worker/src/index.js:1002-1010`）。這是 ADR 0012 刻意的取捨，列出來是因為跟第 6、7 條疊加時會丟歷史。
- **建議修法**：維持現狀可以，但第 7 條必須修；或 `/walk` 成功時也 `markChanged`（吃 12 次額度）。

### 9. 沒網路時按溜了不會自動補送（中，推測）

- **情境**：在收容所訊號差，按了 5 隻溜了，送出失敗，接著鎖螢幕。
- **會看到**：本機可能顯示失敗提示；回到有網路時不會自己重送，試算表和其他手機都沒有這 5 隻。
- **原因**：送出失敗狀態是 `unknown`／`notSent`，只能靠 `retry(result)` 由畫面觸發（`walk-registration.js:173-174`、`:216-221`）；本機「今天已溜」名單只在確認成功後寫（`:63-75`、`:206-208`），沒有待送佇列存在 localStorage。需實測畫面是否有重試按鈕、關掉網頁後是否還在。
- **建議修法**：把待送的登記存進 localStorage，`online` 事件或下次打開時自動重送（Apps Script 端已有「已經有我就不動」的冪等處理，`sheet-write.gs:162-166`）。

### 10. gviz 本身可能有快取延遲（中，推測）

- **情境**：在試算表改完一格，馬上讓 Worker 讀。
- **會看到**：有時要等一段時間 gviz 才回新值。
- **原因**：Google 沒有公開文件說明 gviz（`/gviz/tq`）的快取時間；社群常見回報有數十秒到數分鐘延遲。同步（`scripts/sync-sheet.mjs`）、指紋（`sync-plan.js:51-60`）、名單（`index.js:844`）全都讀 gviz，若延遲存在，「1 分鐘」目標和「指紋相同就不同步」都會受影響（指紋讀到舊版 → 回 `unchanged`，但其實有改）。
- **建議修法**：實測（改一格後每 10 秒讀一次，記錄幾秒後變），若延遲明顯，名單改用 Apps Script `doGet` 直接讀（`sheet-write.gs:28` 已有 `doGet`）。

### 11. 「只有月日」跨年判錯年（低，已確認）

- **情境**：1 月 1 日 0:00–8:00（台灣）有人在試算表手打「1/1」。
- **會看到**：日期被當成前一年 1/1，網站顯示「很久沒溜」。12/31 晚上打「12/31」則在 UTC 已跨年時同理反過來。
- **原因**：`walkersDate` 補年份用 `now.getFullYear()`（`worker/src/index.js:813`），Worker 時區是 UTC，不是台灣。
- **建議修法**：年份改用 `taiwanYmd(now).slice(0, 4)`，並在「月日比今天晚很多」時退一年。

### 12. 手機時區不是台灣（低，已確認）

- **情境**：志工手機時區設成別的地方，或在午夜前後手機和 Worker 剛好跨不同天。
- **會看到**：今日紀錄整包不套用、localStorage 的「今天已溜」被當成昨天的清掉。
- **原因**：手機「今天」用 `localDateKey(new Date())`（手機本地時區，`app.js:947-949`、`:1523`）；Worker 用 `taiwanYmd`（`sync-plan.js:15`）；`receiveToday` 要求兩邊日期一樣（`walk-registration.js:78`）。台灣手機正常情況沒問題。另外午夜跨日時，畫面開著的手機要等下次輪詢才換日。
- **建議修法**：手機端「今天」也用 `Asia/Taipei` 計算（`Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' })`）。

### 13. 沒編號的狗靠犬名當 key（低，已確認）

- **情境**：新來的狗還沒編號，後來補上編號；或有人改了犬名。
- **會看到**：補編號那天，用「名:犬名」記的今日紀錄、localStorage、`v3_today_walks` 都對不到新 key，這隻狗當天顯示未溜。
- **原因**：key 規則「有編號用編號，沒有用 `名:犬名`」（`app.js:972-975`、`today.js` `keyOf`、`index.js:832-834`）；Apps Script 找列時有編號就只比編號（`sheet-write.gs:123-133`）。K 說不會有同名狗，所以同名風險低，但「當天補編號」會發生。
- **建議修法**：可接受；若要處理，名單回傳時附「犬名 → 編號」對照，手機遇到舊 key 時改掛新 key。

### 14. 免費額度估算（低，已確認＋推測）

前提：30 支手機、7–22 點網頁一直開在螢幕上（最壞）。

| 項目 | 估算 | 免費上限 | 出處 |
|---|---|---|---|
| Workers 請求 | `/today`＋`/walkers` 各 900 次 × 30 ＝ 5.4 萬／天；加上開網頁的 `/api/dogs`、照片（`/photos/*` 也先進 Worker，`wrangler.jsonc` `run_worker_first`，但瀏覽器快取 30 天，`public/_headers`） | 10 萬次／天 | https://developers.cloudflare.com/workers/platform/limits/ |
| Workers CPU | 每次 `/walkers` 快取過期要解析 2 份 gviz JSON（約 120–240 列）；**推測**接近免費方案每次 10 ms CPU 上限，需看 Cloudflare 儀表板的 CPU 時間 | 10 ms／次 | 同上 |
| D1 讀 | `/today` 每次至少讀 1 列版本號，版本變時再讀今天約 100 列 → 數萬列／天 | 500 萬列／天 | https://developers.cloudflare.com/d1/platform/limits/ |
| D1 寫 | 網站按溜了每次幾列；`v3_volunteers` 名單沒變時 30 分鐘才寫（ADR 0007 補充）；同步只寫有變的列（ADR 0008） | 10 萬列／天 | 同上 |
| Google gviz | 每個 isolate 每分鐘最多 2 次；Cron 每次同步 3 次；Google 沒公開上限，**推測**大量時可能被限流（回 429） | 未公開 | — |
| Apps Script | 每次網站按溜了 1 次 `doPost`；觸發器 `notifyWorker` 每次手動改 1 次 UrlFetch | UrlFetch 2 萬次／天（一般帳號） | https://developers.google.com/apps-script/guides/services/quotas |
| GitHub Actions | Cron 同步最多 12＋1 次／天 ≈ 390 分鐘／月；「更新」無上限（第 3 條）；加上 PR 測試 | 2,000 分鐘／月（私人 repo） | https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions |

結論：Cloudflare 目前夠用但只剩約一半空間，人數翻倍或手機在背景也輪詢就會碰到上限（超過時是請求失敗，不扣款，ADR 0007「費用」）。GitHub Actions 是最可能先用完的，主因是第 3 條。

---

## 已檢查、目前沒問題的

- **兩支手機同時按同一隻狗**：Apps Script 用 `LockService` 排隊（`sheet-write.gs:39`），第二個人變成「甲、乙」接在後面（`:162-166`），不會互蓋。
- **復原與別人改過的競態**：復原前比對「現在名字＝我寫的」，不同就回 `changed` 不動（`sheet-write.gs:180-181`）。
- **`/api/dogs`、`/today`、`/walkers` 被瀏覽器或 CDN 快取**：Worker 一律回 `Cache-Control: no-store`（`worker/src/index.js:114`），手機請求也帶 `cache: 'no-cache'`（`app.js:1282`、`:1316`）。
- **localStorage 跨日殘留**：「今天已溜」存 `{ date, ids }`，日期不是今天就當作沒有（`app.js:951-958`）。
- **同步同時跑兩次**：workflow 有 `concurrency: sync-sheet`（`.github/workflows/sync-sheet.yml`）。
- **舊 `/today` 回應晚到蓋掉新的**：有 `readSequence`／`acceptedToday` 擋（`walk-registration.js:78-79`）。

## 建議先做

1. 第 1、2 條一起修（Worker 回「有這隻狗但空白」，手機以名單為準），這是 K 10-20 決定的直接缺口。
2. 第 3 條加每日上限，保住 GitHub Actions 分鐘數。
3. 第 7 條補跑保險同步，避免丟歷史。
4. 第 4、5、10 條先實測（多支手機、改時鐘、gviz 延遲）再決定要不要改架構。
