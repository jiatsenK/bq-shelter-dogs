# 今日溜狗紀錄 module（#746）實作審查：有沒有照定案走、有沒有過度設計（2026-10-29）

2026-10-29（台灣時間）。問題：PR #752（分支 `claude/today-walks-module-746-ae9a87`）把今日溜狗紀錄收成一個 module，決策方向有沒有照 K 在 #746 定案的做法走，有沒有過度設計，又有沒有該深卻做淺的地方。

只讀研究，沒有改程式、沒有 commit。程式以 PR HEAD `5872fdd9` 為準，比較基準是 `git diff main...HEAD`。2026-10-29 架構檢視報告不在 repo，以 #746 票上整理的做法為準。設計用語照 `codebase-design` 技能（`C:\Users\User\.claude\skills\codebase-design\SKILL.md`）：深 module、介面、seam、adapter、刪除測試。

## 結論

1. **大方向照定案走**：單一入口 `todayWalks(env, { sheet, now })`、三條「寫新版本」收成一個轉換 `writeVersion`、保險掃描改用改表通知同一套規則、預算依表自動算並有 `total_changes()` 正式測試、四個舊檔刪除、ADR 0018 補充段都做到了。偏離票的三處（掃描收 pending、三個既有測試改內容、退避用真實時鐘）都記在 agent log，理由站得住。
2. **過度設計不嚴重，集中在兩處**：讀取面的 `currentWalk` 只是 `state || main`，四個呼叫裡兩個傳 `null`，形式上「共用一條規則」但沒有省下任何邏輯。對外 `observe` 的 `source` 選項只有測試從外面用，正式的保險掃描走內部呼叫。
3. **做淺的地方主要在測試**：9 個測試檔直接 import 內部檔，這次還新增了幾處（用 `costOf`、`DISPATCH_COST` 算期望值，讓斷言跟實作同一份算式），也多寫了一份手寫 GAS 協定。票已把這些交給 #748，但 #748 的清理量因此變大。

## 查核方法

- 票：`gh issue view 746／747／748 --repo jiatsenK/bq-shelter-dogs`（含留言，#747 有一則 10/29 09:00 的留言接手 #745 收尾）。
- 實作：`git diff main...HEAD`（47 個檔，+1456／−937），逐檔讀 `worker/src/today-walks/*.js`，對照 main 的 `walk-accept.js`、`walk-reconcile.js`、`walk-retry.js`、`today.js`。
- 測試：讀 `worker/test/today-walks-*.test.mjs` 與被改動的既有測試 diff，用 `grep` 找 import 內部檔的測試。
- 準則：`CODING_STANDARDS.md`（D1 讀寫量、搬動視同新寫）、`AGENTS.md`、`codebase-design` 技能。`docs/agents/domain.md` 沒有跟這次相關的規定。
- 沒有跑測試，CI 狀態取自 `gh pr view 752`。

## module 現況一覽

| 內部檔 | 行數 | 責任 | 被誰 import（module 內） |
|---|---|---|---|
| `index.js` | 56 | 唯一入口，組 `db`、時鐘、`sheet`，功能開關 `background` | 外部 3 個檔、9 個建立點 |
| `version.js` | 70 | 寫新版本的唯一轉換 `writeVersion`、「上一次」規則 `previousOf` | `accept.js`、`observe.js` |
| `accept.js` | 99 | 志工溜了、修改、復原，名單 `membersOf`、`sourceMembers` | `index.js`、`observe.js` |
| `observe.js` | 159 | 收觀測值、比對、衝突紀錄、連改前的值、`listWalkLog` | `index.js`、`scan.js`、`dispatch.js` |
| `scan.js` | 37 | 保險掃描一輪、指紋 | `index.js` |
| `dispatch.js` | 194 | 派送、到期工作、退避、發 target | `index.js` |
| `receipt.js` | 31 | 收回執 | `index.js`、`observe.js`、`dispatch.js` |
| `budget.js` | 63 | `ROW_COST`、`costOf`、協定清單、`reserve`、`transitionBudget` | `version.js`、`observe.js`、`receipt.js`、`dispatch.js` |
| `read.js` | 126 | 今日紀錄、目前溜狗人、停住的寫回、`seedState`、`previousWalk` | `index.js`、`accept.js`、`observe.js` |
| `shared.js` | 33 | 小工具、SQL 片段、`guard`、`WalkError` | 全部 |

合計 868 行。入口介面 11 個方法加 1 個純函式（`index.js:16`、`:25-54`）。

## 1. 票上每一條做法的對照

| 票上的做法（#746） | 判定 | 依據 |
|---|---|---|
| module 名稱沿用 GLOSSARY「今日溜狗紀錄」，放 `worker/src/today-walks/` | 照做 | `GLOSSARY.md:159`、`worker/src/today-walks/index.js:1` |
| 外面只能 import `index.js`，standards 測試擋 | 部分照做 | `worker/test/standards.test.mjs:62-75` 只檢查 `worker/src`、`scripts` 的非測試程式。測試檔照樣 import 內部檔（見第 4 節） |
| 對外入口：接受、收觀測值、發 target、收回執、派送（指定或到期）、保險掃描、讀取三種 | 照做，另多 3 個 | `index.js:25-54`。多出 `result`（`/walk/result` 原本在路由裡寫 SQL）、`listWalkLog`（狗清單同步還在用，#747 拿掉）、`withTodayWalks`（純函式，`index.js:16`） |
| 建立方式 `todayWalks(env, { sheet, now })`，`sheet` 預設 `callSheet`、`now` 預設 `Date.now` | 照做 | `index.js:21`。排程傳排程時間 `worker/src/index.js:772` |
| 每個入口只收領域資料 | 大致照做 | 兩個例外：`observe` 收 `{ source }` 選項（`index.js:27`），`listWalkLog` 收 `v3_sheet_main` 的資料列 `old`（`index.js:51`），而且參數名 `sheet` 蓋掉了 adapter 的 `sheet` |
| 一個轉換函式組 batch：version guard、預算、取代未完成工作、插入 outbox、previous_date、溜狗紀錄、修改紀錄 | 照做 | `version.js:35-70`。呼叫點只有 `accept.js:87`、`observe.js:112`，保險掃描經 `observeAll` 走同一條（`scan.js:34`）。舊的三份是 main 的 `walk-accept.js:215`、`:496` 與 `walk-reconcile.js:28-39` |
| 保險掃描用改表通知同一套規則，失敗記 `v3_walk_conflicts`，每輪 10 隻不變 | 照做，另有一項行為改變 | `observe.js:64-159`、`SCAN_LIMIT` 在 `observe.js:144`。新增「掃描也收 pending」見第 2 節 |
| 預算由 module 依要寫的表算保守上界，兩支預覽腳本改正式 `total_changes()` 測試 | 照做 | `budget.js:7-40`、`worker/test/today-walks-budget.test.mjs:71-189`。兩支腳本已刪 |
| 讀取面 `seedState`、`readAcceptedWalks`、`withTodayWalks`、`readWalkersD1` 共用同一條規則 | 形式上照做 | `read.js:9-15`、呼叫點 `read.js:22`、`:35`、`:62`、`:84`。規則本身太薄，見第 3 節 |
| 路由只留解析、驗金鑰、大小限制、回應形狀 | 大致照做 | `/rows` 的功能開關與「哪些列是溜狗列」從舊 `walk-reconcile.js:69-79`（main）搬進路由 `worker/src/index.js:864-872`，方向跟票相反，但量很小 |
| 刪 `walk-retry.js`、`walk-reconcile.js`、`today.js`、`walk-accept.js`，`taiwanYmd` 留著 | 照做 | `git diff main...HEAD --stat` |
| ADR 0018 補一段 | 照做 | `docs/adr/0018-today-walks-d1-event-sync.md:71-79` |
| `ARCHITECTURE.md` 程式架構圖照規則檢查 | 照做 | agent log `docs/agent-log/2026-10-29-today-walks-module-746.md:13` |

## 2. 偏離票的地方，理由站不站得住

| 偏離 | 理由（出處） | 判斷 |
|---|---|---|
| 保險掃描也收 `pending`（網站登記還沒派送的版本），舊程式只收 `synced` | 同日合併只會發生在網站登記還沒寫回的時候，不收 pending 就合併不到（agent log `:19`）。`shared.js:16` 的 `scanCanTake`，ADR 補充段 `:77` 有寫 | **站得住**。這是 K 定案「同一天名單合併」的必要條件，不是另外加的範圍。已交給 GAS 的派送照舊不收 |
| 三個走 `worker.fetch` 的既有測試改了內容（票要求不改） | 預算常數變了（48、96），`walk-reconcile` 的 pending 測試跟新規則衝突（agent log `:17-19`） | **站得住**，但改法可以更好。`walk-log.test.mjs:52`、`walk-retry.test.mjs:168` 改成用 `costOf`、`DISPATCH_COST` 算期望值，等於拿實作的算式驗實作，只剩「有呼叫預算」的意義 |
| 退避用 `Math.max(now, Date.now())`，不全走注入的時鐘 | 排程時間固定，叫 Apps Script 可能花掉幾十秒，重試不能提早到期（`dispatch.js:148-150`，agent log `:23`） | **站得住**。注入的 `now` 是排程時間，本來就不能代表「叫完 GAS 的現在」 |
| `readStoppedWalks` 從 `admin/checks.js` 搬進 module | 讀的是 outbox 與 retry，屬於今日溜狗紀錄（agent log `:9`） | **站得住**，比票寫的「admin 改呼叫新 module」更乾淨 |
| 新保留量比舊常數小（一次派送 96 改 71） | 照結構算，`total_changes()` 測試確認夠（agent log `:20`） | **站得住**。ADR 0008 的規則沒變，只是不再手算 |

## 3. 有沒有過度設計

逐項看票沒要求、#747 與 #748 也用不到的東西。

### 3.1 10 個內部檔是否太碎：不算過度，可小幅合併

- 舊的四個檔共 679 行（541＋79＋36＋23），新 module 868 行，另外吸收了 `readWalkersD1`（約 30 行，原在 `worker/src/index.js`）與 `readStoppedWalks`（約 15 行，原在 `admin/checks.js`）。淨增加主要是註解。
- 票明寫「內部可拆成轉換、派送、收觀測值、預算等檔」，拆法照票。
- 偏小的檔：`receipt.js` 31 行、`scan.js` 37 行、`shared.js` 33 行。`receipt.js` 只有 `confirmWalk`，是派送協定的一段，`dispatch.js` 與 `observe.js` 都 import 它。`membersOf`、`sourceMembers` 放在 `accept.js:8-28`，但 `observe.js:6` 也要用，造成「收觀測值」依賴「志工接受」。
- 判斷：要合併的話，`receipt.js` 併進 `dispatch.js`、名單兩個函式移到 `shared.js`，能少一個檔、少一條奇怪的依賴。不急，優先度最低。

### 3.2 `ROW_COST` 照結構重算的測試：保留

- `today-walks-budget.test.mjs:48-69` 從 `sqlite_master` 讀索引與觸發器，重算每張表一列的成本，跟 `budget.js:7-18` 比。
- `total_changes()` 不算索引寫入（測試檔開頭 `:2-3` 自己也寫了），D1 計費卻算。沒有這條，有人替 outbox 加索引時預算會悄悄低估，`total_changes()` 測試抓不到。
- 觸發器內容用正規表示式拆，偏脆弱，但出錯時是測試失敗（`assert.equal`），不會靜靜放行。值得留。

### 3.3 `stateWalk`／`packWalk`／`mainWalk` 加 `currentWalk`：建議簡化

- `currentWalk(state, main)` 的內容只有 `state || main || { date: '', walker: '' }`（`read.js:13-15`）。
- 四個呼叫裡兩個傳 `null`：`readAcceptedWalks` 是 `currentWalk(packWalk(w), null).date === today`（`read.js:22`），舊版是 `w.walkedDate === today`（main `walk-accept.js:36`）。`seedState` 是 `currentWalk(null, mainWalk(seed, codeNames))`（`read.js:84`）。這兩處的 `currentWalk` 什麼都沒做。
- 真正有內容、以前寫了好幾份的規則只有兩條：「有溜狗狀態就用狀態」（`readWalkers`、`withTodayWalks`）與「主清單原文是 NULL 就用代號換回的名字」（`mainWalk`，`read.js:12`）。
- 用刪除測試看：刪掉 `currentWalk` 與 `stateWalk`、`packWalk`，複雜度沒有回到任何呼叫點，是 pass-through。`mainWalk` 刪掉的話 NULL 規則會回到兩處，值得留。

### 3.4 `budget.js` 的 `CLAIM`／`GRANT`／`CONFIRM`／`READBACK`／`FAILURE`／`RELEASE`：保留

- `GRANT`、`CONFIRM`、`READBACK`、`FAILURE` 各自被 `transitionBudget` 用（`receipt.js:16`、`:24`，`dispatch.js:151`、`:189`），沒預付時單獨保留。`CLAIM`、`RELEASE` 只拿來組 `DISPATCH_ROWS`（`budget.js:38`）。
- 這份清單就是票要的「依這批要寫的表自動算」，取代舊的 96、4 等手算常數（main `walk-accept.js:264` 的 `DEFER_COST`）。協定改了只要改清單，`total_changes()` 測試會驗。不算過度。

### 3.5 對外 `observe` 的 `source` 參數：建議簡化

- `source === 'scan'` 只切換兩件事：每輪 `SCAN_LIMIT` 隻上限，以及把 `item.version` 當成讀表前的預期版本（`observe.js:146-151`）。
- 正式程式只有 `scan.js:34` 傳 `'scan'`，那是 module 內部呼叫。對外入口 `index.js:27` 暴露了這個選項，外面唯一的使用者是測試 `walk-log.test.mjs:107`。
- 票寫「收試算表觀測值（來源分改表通知、保險掃描）」，但保險掃描已經有自己的入口 `scan()`。#747 要從狗清單同步交觀測值，屬於「改表通知那一類」，用預設值就好，不需要知道 `source`。
- 判斷：對外入口不需要這個選項，留在內部即可。

### 3.6 保險掃描的 `version` 預期值：保留

- 讀表前記版本、比對時版本變了就先不收（`observe.js:62-72`、`scan.js:33`），避免讀表期間的新登記被撤銷。舊程式就有（main `walk-reconcile.js:7`、`:29` 的 guard），測試在 `today-walks-scan.test.mjs:121`。
- 第二輪審查補的「重查目前工作狀態」（`observe.js:72` 後半，agent log `:27`）也是同一類防護，是必要的。

### 3.7 其他小項

- `dispatch.js:81` 的 `CLAIM_STATEMENTS = 4` 要跟下面組的敘述數一致，取了名字比原本的魔術數字好，保留。
- `budgetDay` 與 `taiwanDay` 分開（`shared.js:11-13`），因為 D1 額度照 UTC 午夜重置，保留。

## 4. 反方向：該深卻做淺的地方

- **入口大多是轉呼叫**（`index.js:25-54`）：這本身不算淺。用刪除測試看，刪掉 `index.js`，`env.DB`、時鐘、`sheet`、功能開關要回到 9 個建立點（`worker/src/index.js`、`admin/index.js`、`dog-list.js`）。11 個方法的介面背後藏了約 800 行協定，是深的。
- **測試越過介面**：照 `codebase-design`「介面就是測試面」。目前 import 內部檔的測試檔有 `today-walks-budget`（`ROW_COST`、`DISPATCH_COST`、`costOf`）、`walk-log`（`costOf`）、`walk-retry`（`RETRY_LIMIT`、`STOPPED_AT`、`DISPATCH_COST`）、`walk-accept`（`guard`）、`undo-revert`（`previousWalk`）、`walk-reconcile` 與 `walk-writeback`（`walkFingerprint`），還有 `scripts/diagram-facts.test.mjs:100`（`RETRY_LIMIT`）。standards 測試刻意放行測試（`standards.test.mjs:62-63`），#748 驗收條件第 3 條會收。問題是這次新增了 `costOf`、`DISPATCH_COST` 的 import，#748 要多拆幾處。
- **`sheet` seam 目前只有一個 adapter**：正式用 `callSheet`，測試仍換 `globalThis.fetch`（兩個新測試檔共 8 處）。技能說「一個 adapter 是假想的 seam」，但票明寫這張只留參數、#748 才接第二個 adapter，所以符合定案。要注意的是 `today-walks-budget.test.mjs:30-46` 的 `fakeSheet` 又手寫了一份 target、回執流程，正好是 #748 要刪的東西。
- **`D1_WALK_NOTIFY` 開關留在 `/rows` 路由**（`worker/src/index.js:864`）：現在只有一條路由看它，留在路由合理（agent log `:29`）。但 #747 要讓狗清單同步也交觀測值，那條路徑不經過 `/rows`，會繞過這個開關。要在 #747 決定開關是不是要搬進 module。

## 5. 結論清單

### 保留

- 單一入口 `todayWalks(env, { sheet, now })` 與 standards 測試（`index.js:21`、`standards.test.mjs:62-75`）。
- `writeVersion` 一個轉換、`historyWrites` 照實際列數算預算再用 guard 鎖住（`version.js:20-28`）。
- 保險掃描收 pending、讀表前版本預期值、重查目前工作狀態。
- `ROW_COST` 結構測試與 `total_changes()` 測試，`budget.js` 的協定清單。
- 退避用真實時鐘的例外。

### 建議簡化

| 優先 | 改法 | 省下什麼 |
|---|---|---|
| 1 | 讀取面拿掉 `currentWalk`、`stateWalk`、`packWalk`，只留帶真規則的 `mainWalk`（主清單原文、NULL 退回代號換名字）。`readAcceptedWalks` 回到直接比 `w.walkedDate`，`withTodayWalks` 直接用資料包的日期，`readWalkers` 寫成 `state ? stateWalk : mainWalk` 一行 | 少 3 個 export 與 2 個傳 `null` 的空呼叫，讀的人不用再追三層轉換才發現規則只是「有狀態用狀態」 |
| 2 | 對外 `observe` 拿掉 `{ source }`：內部 `observeAll` 改成「有 `version` 就當預期版本」，`SCAN_LIMIT` 由 `scan.js` 自己控制。`walk-log.test.mjs:107` 改走 `scan()` | 介面少一個概念，#747 的狗清單同步呼叫 `observe` 時不必知道來源分類 |
| 3 | 測試裡用 `costOf`、`DISPATCH_COST` 算期望值的斷言（`walk-log.test.mjs:52`、`walk-retry.test.mjs:168`、`:177`）改成跟實作無關的檢查，例如保留量 ≥ `total_changes()`，或寫死數字並附註 | 斷言重新有驗證力，測試對內部檔的 import 少 2 個檔，#748 要拆的少一點 |
| 4（可不做） | `receipt.js` 併進 `dispatch.js`，`membersOf`、`sourceMembers` 移到 `shared.js` | 少一個檔，`observe.js` 不再依賴 `accept.js` |
| 4（可不做） | `listWalkLog` 入口的參數 `sheet` 改名（例如 `onSheet`），避免蓋掉 adapter 名稱 | 讀 `index.js:51` 時不會誤會 |

### 留給 #747、#748

- **#747**：拿掉 `listWalkLog` 入口（`index.js:51`）與 `observe.js:14-31` 的 `when` 條件。決定 `D1_WALK_NOTIFY` 要不要搬進 module，否則狗清單同步交的觀測值會繞過開關。`walkDay` 目前由 `version.js:4` 從 `dog-list.js` import，`dog-list.js:14` 又 import module，兩邊互相依賴（main 時就有），#747 接手「新的一天寫進溜狗紀錄」時順手把 `walkDay` 搬進 module。`observe` 入口以「改表通知」的規則收觀測值，這個接縫已經夠用。
- **#748**：`sheet` 參數已就位（`index.js:21`），接上 vm 載入 `sheet-write.gs` 的測試 adapter。刪掉 `today-walks-budget.test.mjs:30-46` 的 `fakeSheet` 與兩個新測試檔的 `globalThis.fetch` 指派。決定哪些內部常數要從入口暴露（例如 `RETRY_LIMIT`），其餘測試改走入口。`ROW_COST` 結構測試與 `guard` 測試屬於內部 seam 的測試，可以考慮列為例外保留。

## 未決問題（要 K 決定）

- 建議簡化 1～3 要在 #752 合併前補，還是併進 #747（第 2 項跟狗清單同步交觀測值直接相關）、#748（第 3 項跟測試只走入口直接相關）。
- `D1_WALK_NOTIFY` 開關要不要搬進 module，讓狗清單同步交的觀測值也受它管（#747）。
- #748 收測試時，`ROW_COST` 結構測試、`guard` 測試這類內部 seam 測試能不能列為例外，繼續 import 內部檔。

## 附：CI 現況

PR #752 HEAD `5872fdd9` 的 CI（run 40798039923，10/29 09:03 觸發）`test` 失敗 1 項：「#500 保險掃描沒有不同的狗只問一次就結束」。agent log `:30` 記錄這條在 UTC 01 點（台灣 09 點）跑會多一列排程紀錄而失敗，跟這次改動無關。本研究沒有重跑。
