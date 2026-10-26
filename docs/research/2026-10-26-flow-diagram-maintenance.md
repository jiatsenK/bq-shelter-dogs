# 資料流頁的圖會不會過時、能不能自動檢查

日期：2026-10-26（研究筆記，未改程式）
相關：分支 `claude/admin-data-flow`（`c392ca4`）、`admin/public/js/flow-model.js`、`worker/src/admin/flow.js`。行號以這個分支為準。

## 結論先講

1. **說法 1 大致對，但不完整。** 燈號讀的資料是即時的（`flow.js` 每次查 D1）。但判斷燈號的規則寫死了幾個跟排程綁在一起的門檻和文字，例如 `STUCK_MS`、`SCAN_STALE_MS`、`CRON_STALE_MS`、`CRON_LABELS`、「台灣 08:00 換日」。排程一改，這些也要跟著改，現有測試只核對了 `DAILY_BUDGET`。
2. **說法 2 可行，三項都能用純 Node 測試做到、不用連網。** (a)(b) 直接做就有用。(c) 最有價值，但要先在 `flow-model.js` 加一個結構化的「涵蓋清單」欄位，不能只靠比對中文說明。
3. **圖目前有 6 處跟程式不符、8 處說得不精確**（見第 1 節表格）。最嚴重的是**漏了一條路線**：志工「加備註」「新增異動紀錄」不先記進 D1，直接經過 Apps Script 寫進試算表。這跟圖的開場白「網站上的操作先記進 D1」和「只寫兩欄」都衝突。
4. **建議的自動檢查：** C1 排程時間、C2 程式路徑與函式、C3 路線涵蓋（SHEET_ACTIONS、`/walk-writeback/*`、Cloudflare cron、CRON_JOBS、GAS 觸發器）、C4 燈號門檻對排程、C5 說明裡的數字對常數。C3 一開始就會抓到漏掉的備註路線。
5. **測試抓不到的過時來源：** Apps Script 和管理網站都是手動部署，repo 對了不代表線上對了；功能開關（`WALK_RETRY_ENABLED`、`D1_WALK_NOTIFY`、功能設定）不改程式也會改變流程。

---

## 1. 圖的內容跟程式對不對（A）

以程式為準。「不符」是說法錯了；「不精確」是方向對，但省略的部分會讓人誤判。

| # | 等級 | 圖上的說法（flow-model.js） | 程式實際行為 |
|---|---|---|---|
| 1 | 不符 | 開場白「網站上的操作先記進 D1，再寫回試算表」（:11）；Apps Script「寫回只改主清單兩欄」（:52）；連線「寫兩欄」（:86）；志工能做的事（:39）沒列備註 | 志工網站的「加備註」「新增一筆異動紀錄」（`public/js/sheet-append.js:57-58`）送 `action: note/log` 到 `/api/walk`，Worker 直接 `callSheet`（`worker/src/index.js:602`），**不先寫 D1**，只另外記編輯紀錄（`index.js:610`）。Apps Script 會追加主清單「備註」欄，或在異動紀錄最後一列下面新增一列（`apps-script/sheet-write.gs:226-253`）。`SHEET_ACTIONS` 也還列著 `note`、`log`（`worker/src/sheet-write.js:6`）。程式寫入不會觸發編輯觸發（Google 的行為，推論），所以這些內容要等狗清單保險掃描才進 D1。 |
| 2 | 不符 | D1「每次寫入都先預留寫入預算；當天超過就停寫，登記回『溜狗寫入預算不足』」（:23） | 只有溜狗相關的寫入會預留預算：`writeBudget` 只在 `walk-accept.js`、`walk-reconcile.js` 用到。管理網站、狗清單同步、照片、活動、排程紀錄都不預留。當天額度不夠時，檢查表 `v3_walk_guard` 的 CHECK 失敗（`db/compact-schema.sql:75`），回的是一般的 503「登記尚未接受，請用原請求再試」（`index.js:592`）。「溜狗寫入預算不足」只在單次成本超過 `SYNC_MAX_ROWS` 時出現（`walk-accept.js:54`）。 |
| 3 | 不符 | 檢查「太頻繁回 429；格式不對回 400。手機會保留識別，可以再送」（:112） | 429 確實保留識別。但 **400、403、404、409 手機會清掉識別**（`public/js/walk-registration.js:134,141-142`），不會「再送同一筆」。只有 429、503、網路錯誤會保留識別、標成可重送。另外還有 413、415（`index.js:560-562`）。 |
| 4 | 不符 | 停寫、留待比對「下一次改表通知**或保險掃描**讀到可信的值，就收下並清掉不一致」（:146）；試算表節點（:60）；燈號文字（:230） | 只有 `reconcileWalk` 會清 `v3_walk_conflicts`（`walk-accept.js:363-372`）。它從 `/rows`（改表通知）、`/observe`、`/target`（寫回重試派送時）進來。保險掃描的 `reconcileWalkSnapshot` 不碰衝突表，而且狀態不是 synced 的狗直接延後（`walk-reconcile.js:21`）。所以應該寫「改表通知或寫回重試」。如果保險掃描在 synced 狀態下直接收下人工的值（`walk-reconcile.js:27-38`），衝突那列會一直留著，燈號一直是橘的。 |
| 5 | 不符 | 連線「狗清單保險掃描 → Apps Script：送指紋」（:94） | `dogListScan` 本身就是 Apps Script 的時間觸發。它是把指紋送給**志工網站 Worker**（`/walk-writeback/dog-list-scan`，再送 `/dog-list`，`sheet-write.gs:475-480`、`index.js:857`），由 Worker 寫進 D1。圖上沒有通往 Worker 或 D1 的連線。它跟「保險掃描 → Apps Script」（Worker 把指紋送給 GAS）方向相反，但畫法一樣。 |
| 6 | 不符 | 寫回重試「隔 1、2、4、8、15 分鐘再試」（:66、:166） | `next_attempt_at` 確實照 `[1,2,4,8,15]` 設（`walk-accept.js:291,295`）。但只有寫回重試排程會撿起來（`walk-retry.js:28-32`），這個排程每 10 分鐘跑一次（第 5、15……55 分，`wrangler.jsonc:40`）。實際間隔是：前四次都是「下一次排程」（10 分鐘內），之後約 15～25 分鐘。 |
| 7 | 不精確 | 拿目標「志工網站等 20 秒沒回應就放棄」（:136） | 20 秒只用在單隻 `walkWake`。合併派送 `walkWakeBatch` 是 90 秒，`walkScan` 是 45 秒（`sheet-write.js:7-12`）。寫回重試一次最多派 10 隻，每批 `floor(500/96)=5` 隻（`walk-accept.js:210`、`walk-retry.js:20-32`），所以重試兩隻以上時是 90 秒。 |
| 8 | 不精確 | 寫前再讀「有人剛改過：停寫，這隻記成不一致」（:142） | Apps Script 停寫後，會用 `observe` 把新值送給網站（`sheet-write.gs:139-142`）。`compareTrustedWalk` 多半會直接把人工的值收成新版本（`walk-accept.js:412-440`），舊的工作變成 superseded。只有判斷不了是誰寫的才記成不一致。這次派送會記成 `writeback-rejected`。 |
| 9 | 不精確 | 照片垃圾桶清理「只刪 D1 記得、而且不是主照片的那幾張」（:34）；R2「D1 沒記這張照片時，清理不會刪它」（:30） | 滿 30 天的**垃圾桶備份一律刪除**（`worker/src/r2.js:206`）。「D1 記得、不是主照片」這個條件只決定要不要連舊原圖一起刪（`r2.js:199-204`）。D1 沒記的話，原圖會留下，但備份照樣刪掉。 |
| 10 | 不精確 | 志工網站「寫回重試、保險掃描兩個排程也在這裡跑」（:47） | 照片垃圾桶清理也在這個 Worker 跑（`index.js:801`）。 |
| 11 | 不精確 | 管理網站「改設定、狗資料、活動、照片」（:15） | 還有合併狗、取消合併（`worker/src/admin/index.js:96-97`），以及照片復原（:91-94）。 |
| 12 | 不精確 | 派送「回應送出後在背景馬上做」（:129） | `ctx.waitUntil(dispatchWalk…)` 在回應組好**之前**就呼叫了（`index.js:586-587`），跟回應同時進行。不影響結論。 |
| 13 | 不精確 | 志工網站燈號「最近登記」（:233） | 讀的是 `MAX(v3_walk_state.updated_at)`（`flow.js:22`）。人工改表被收下時也會更新這個時間（`walk-accept.js:432`、`walk-reconcile.js:32`），所以不一定是「網站登記」。 |
| 14 | 不精確 | 保險掃描「這一輪沒處理完的狗，下一次掃描還會出現」（:72） | 一輪最多收 10 隻、其他延後，這點正確（`walk-reconcile.js:22`）。但只要有一列日期格式解析不了，`reconcileWalkSnapshot` 會讓整批失敗（`walk-reconcile.js:12`），之後每次掃描都卡在同一列。這是推論，沒用測試確認過。 |

**核對過、跟程式一致的：**

- 一輪最多 10 隻（`walk-retry.js:20,27,32`）
- acceptWalk 最多 8 次，失敗回 409「登記競爭中」（`walk-accept.js:138,194`）
- 同一個識別、內容不同回 409（`walk-accept.js:127`）
- 寫前再讀（`sheet-write.gs:137-142`）
- 寫回只寫兩欄（`sheet-write.gs:144-145`）
- 讀回比對（`sheet-write.gs:148-149`）
- 回報要同一個派送識別才算（`walk-accept.js:305-309`）
- 一直重試、不放棄：沒有次數上限
- 垃圾桶 30 天（`r2.js:10,187`）
- 每月 1 日 09:23 清垃圾桶：`trashDue` 看 UTC 1 日 01 時（`index.js:29,801`）
- 保險掃描 09:23／13:23／23:23（`23 1,5,15 * * *`，`wrangler.jsonc:40`、`index.js:28`）
- 狗清單保險掃描 09:43／13:53／23:53（`sheet-write.gs:290`）
- 改表通知每 10 分鐘補送（`sheet-write.gs:287,289`）
- 429 的頻率：每分鐘 30 次、每小時 200 次（`index.js:66-71,558`）
- 寫入預算以 UTC 日計（`walk-accept.js:55`、`flow.js:16`），台灣 08:00 換日的說法正確
- 管理網站要手動部署（`wrangler.admin.jsonc:6`）

### STUCK 15 分鐘門檻合不合理

`flow-model.js:186,217`：到期（`next_attempt_at`）後超過 15 分鐘還沒寫回，就亮橘燈。

- **正常情況下最久會逾期多少：** 寫回重試每 10 分鐘跑一次，所以到期的工作最多等 10 分鐘就被撿起來。中斷的派送要等 `started_at` 滿 60 秒才撿（`walk-retry.js:21`），再加上執行時間（最多 90 秒）。最壞大約 12 分鐘，15 分鐘還有 3～5 分鐘的餘裕。**用來偵測「排程沒在跑」或「積壓超過一輪 10 隻」是合理的。**
- **漏掉一種情況：一直失敗的狗。** 每次失敗都會把 `next_attempt_at` 往後推（`walk-accept.js:295`）。所以一隻連續失敗好幾天的狗（例如 Apps Script 一直逾時，記成 `writeback-unconfirmed`），永遠不會逾期超過 15 分鐘，燈號是綠的「N 隻正在寫回」。建議另外看失敗次數 `v3_walk_retry.failures`，或看工作建立了多久（`operation_date`、最早一版的時間）。
- **文字容易誤解：** 「超過 15 分鐘還沒寫回」的意思其實是「到期後 15 分鐘還沒被派送」，不是「登記後 15 分鐘」。
- **紅燈的分類太寬：** 只要 `error` 開頭是 `writeback-rejected` 就亮紅燈、顯示「被試算表拒絕」（:216-218）。但 Apps Script 回的任何 `ok:false` 都會記成這個前綴（`walk-accept.js:215`、`sheet-write.js:43`），包括拿鎖逾時（`sheet-write.gs:41` 拋錯後由 `doPost` 接住，:19-20）、「寫前觀測到人工修改」、「試算表讀回不符」。這些都是會自己好的暫時狀態，不是真的被拒絕。

## 2. 燈號是不是真的「即時、不用維護」（B）

**資料是即時的。** `readFlowStatus` 每次請求用一個 batch 讀 D1（`flow.js:17-24`）。表名和欄位由 `admin-flow.test.mjs` 用真正的 schema 建記憶體 D1 來測，schema 改了會被抓到（`worker/test/admin-flow.test.mjs:15-41`）。

**但規則裡寫死了下面這些東西，會跟著程式過時：**

| 寫死的東西 | 位置 | 綁在哪 | 有沒有測試核對 |
|---|---|---|---|
| `DAILY_BUDGET = 40000` | `worker/src/admin/flow.js:8` | `wrangler.jsonc:29` `SYNC_DAILY_BUDGET` | 有（`admin-flow.test.mjs:51-54`） |
| 預算 50%／80% 門檻 | `flow-model.js:226` | 政策，不會跟著程式過時 | 不需要 |
| 「台灣每天 08:00 換日」 | `flow-model.js:225` | `walk-accept.js:55` 和 `flow.js:16` 各自算 UTC 日 | 沒有。兩邊沒有共用函式 |
| `STUCK_MS = 15 分` | `flow-model.js:186` | `RETRY_CRON` 的週期（10 分） | 沒有 |
| `SCAN_STALE_MS = 24 小時` | `flow-model.js:187` | GAS `dogListScan` 的時間（最大間隔 10 小時） | 沒有。跟 `checks.js:6` 的 `STALE_MS` 重複 |
| `CRON_STALE_MS` retry 40 分、scan 13 小時、trash 32 天 | `worker/src/admin/checks.js:60` | 兩個 cron 和 `trashDue` | 沒有 |
| `CRON_LABELS` 的頻率文字 | `admin/public/js/data-checks.js:41-45` | 同上 | 沒有。註解寫要一致（:40） |
| `gapStatus` 裡的「每天 09:43、13:53、23:53」 | `data-checks.js:33` | `sheet-write.gs:290` | 沒有 |
| 節點副標題的「每 10 分鐘」「每天三次」「每月 1 日」 | `flow-model.js:32,62,68,162` | 同上 | 沒有 |
| `OPEN_LABEL` 的四種狀態 | `flow-model.js:185` | schema 的 status CHECK（`compact-schema.sql:32`） | 新增狀態時 `parseFlowStatus` 會丟錯，頁面顯示「讀不到」，至少不會靜靜地錯 |
| `CRON_LABELS` 的工作名 | `data-checks.js:41` | `CRON_JOBS`（`cron-status.js:5`） | 同上，會丟錯但沒測試。新增排程工作會讓整頁讀不到 |
| `'writeback-rejected'` 前綴 | `flow-model.js:216` | `walk-accept.js:215` | 沒有 |

**還有一些燈號根本看不到的東西：**

- Apps Script 的補送佇列（`WALK_EDITS_PENDING`、`DOG_LIST_PENDING`）。說明裡已經承認了（`flow-model.js:54`）。
- `flushWalkEdits` 和 `flushDogList` 有沒有在跑。
- `delivering` 有查（`flow.js:20`），但 `liveStatus` 沒有用到。

## 3. 自動檢查的可行性（C）

repo 裡已經有類似的做法可以照抄：

- `walk-edit-rows.test.mjs:107-109`：用 regex 抓 `"crons"` 陣列，跟字面值比。
- `scripts/admin-table.test.mjs:48`：拿掉整行註解後，用 `JSON.parse` 讀 `wrangler.admin.jsonc`。
- `sheet-call.test.mjs:22`：核對每個 `SHEET_ACTIONS` 都出現在 `.gs` 裡。
- `sheet-write.test.mjs:8-11,39-40`：用 `node:vm` 載入 `.gs`，並換掉 `ScriptApp` 等 Google 物件。
- `standards.test.mjs`：掃 `worker/src/*.js` 原始碼，例外清單附理由。

CI 會自動跑 `scripts/`、`worker/` 底下所有 `*.test.mjs`（`.github/workflows/tests.yml:3,43`），新增測試不用改設定。

### C1 排程時間（主對話的 (a)）：可行，誤報低

- **讀哪些檔：** `wrangler.jsonc`（拿掉整行 `//` 註解後 `JSON.parse`；目前沒有行尾註解或結尾逗號）、`wrangler.test-site.jsonc`、`worker/src/index.js` 的 `RETRY_CRON`／`SCAN_CRON`。後者目前沒 export，可以改成 export，或用 regex 抓 `const RETRY_CRON = '…'`。
- **GAS 的時間：** 用 vm 執行 `installWalkEditTriggers`，換一個假的 `ScriptApp`，把 `newTrigger(fn)` 後面串的 `.onEdit()`、`.everyMinutes(n)`、`.atHour(h).nearMinute(m).everyDays(1)` 都記下來。`sheet-write.gs:290` 的時間寫在陣列裡再 `forEach`，用 regex 抓不穩，vm 比較可靠。
- **對到圖上：** 中文說明是自由文字，不要硬抓。建議給節點加結構化欄位，例如 `schedule: { cron: '23 1,5,15 * * *' }` 或 `schedule: { gas: 'dogListScan' }`。測試把 cron 換成台灣時間的 HH:MM 清單，核對 `detail.trigger` 裡有這些時間。更好的做法是讓文字直接由這個欄位產生。
- **同一個測試順便核對：** `CRON_LABELS.every`、`gapStatus` 的時間字串，以及每個 cron 都有 `index.js` `scheduled` 裡的分支（目前垃圾桶是靠 `trashDue` 搭在 SCAN_CRON 上）。
- **誤報：** 只在排程真的改了、文字沒改時才會失敗，這正是要抓的。

### C2 「程式」欄的檔案與函式還在（主對話的 (b)）：可行，但只證明「還在」

- **解析方式：** `code` 用「、」分開。每段是「路徑」或「路徑 的 函式名」（例如 `worker/src/walk-accept.js 的 acceptWalk`）。路徑用 `existsSync` 檢查（目錄也算，例如 `worker/src/admin/`）。函式名用 `/\b(function|const|let|var)\s+NAME\b|export\s+(async\s+)?function\s+NAME\b/` 去原始碼裡找。
- **例外：** 試算表節點的 `code` 是「主清單、已出所、常遛狗群三個分頁」（:61），不是路徑。可以給它一個例外，或改成核對 `.gs` 裡的分頁名常數（`SHEET_NAME`、`GROUP_SHEET_NAME`、`DEPARTED_SHEET_NAME`）。比較乾淨的做法是把 `code` 改成結構化的 `[{ file, fn }]`。
- **限制：** 只抓得到改名或刪除，抓不到行為變了但名字沒變。第 1 節的 14 處問題，C2 一處都抓不到。

### C3 程式多了路線、圖上沒有（主對話的 (c)）：可行，要先定義「路線」

建議在節點或連線上加 `covers: [...]`。測試從原始碼收集「實際存在的路線」，**雙向**核對：程式有的圖上一定要有，圖上寫的程式裡一定要還在。路線的來源如下：

| 路線類型 | 從哪裡收集 | 目前的值 |
|---|---|---|
| Cloudflare cron | `wrangler.jsonc` triggers.crons | `5-59/10 * * * *`、`23 1,5,15 * * *` |
| 排程工作 | `CRON_JOBS`（`cron-status.js:5`），可以直接 import | retry、scan、trash。每個都要有 `live: 'cron:<job>'` 的節點，並且等於 `CRON_LABELS` 的 key |
| Worker 送給 GAS 的動作 | `SHEET_ACTIONS`（`sheet-write.js:6`），可以直接 import | note、log、walkWake、walkWakeBatch、walkScan。**note、log 現在圖上沒有，這項一開始就會失敗，正好是第 1 節第 1 點** |
| GAS 送給 Worker 的路徑 | `index.js:857` 的 `/walk-writeback/*` 陣列，用 regex 抓；再對 `.gs` 裡的 `walkWorker(props, '<x>'` 呼叫 | target、receipt、observe、rows、dog-list、dog-list-scan |
| GAS 觸發器 | vm 執行 `installWalkEditTriggers` 收集 `newTrigger` 的函式名，或用 regex 抓 `ScriptApp\.newTrigger\('(\w+)'\)` | onWalkSheetEdit、flushWalkEdits、flushDogList、dogListScan。flush 兩個現在只出現在說明文字裡 |
| 會改資料的 API | 選做：`SITE_ROUTES`、`DOG_EDITS`（index.js）、管理網站 `/api/manage/*` 的寫入方法 | 數量多、跟圖的層次不同，建議先不放 |

- 沒網路、沒 D1 也能跑：import 純常數，或用 regex 讀原始碼。
- **誤報：** 新增路線卻沒更新圖時會失敗，這是設計目的。代價是每多一條路線，要多寫一個 `covers` 項目。

### C4 燈號門檻跟排程的關係（主對話沒提，建議加）

- `CRON_STALE_MS[job]` 要大於這個工作相鄰兩次執行的最大間隔：retry 10 分、scan 10 小時、trash 31 天。也要大於台灣日曆上的換月間隔。
- `STUCK_MS` 要大於 RETRY_CRON 的週期，再加 60 秒的中斷門檻。
- `SCAN_STALE_MS`、`checks.js` 的 `STALE_MS` 要大於 GAS `dogListScan` 的最大間隔。這兩個最好合併成一個常數。
- cron 週期用一個小函式從字串算出來，只要支援 `a-b/n`、逗號、`*` 就夠用。

### C5 說明裡的數字對常數（選做）

說明裡的 10 隻、8 次、20 秒、30 天、1/2/4/8/15 分，在程式裡大多是字面值，不是常數：retry 的 `LIMIT 10`、`attempt < 8`、`[1,2,4,8,15]`。可以先 export 成常數（`TRASH_DAYS` 已經是了，`r2.js:10`），測試再核對說明字串裡有 `${常數}`。改動比較多，CP 值不如 C3。

**建議順序：** C3（會立刻抓到現有的漏洞），然後 C1 加 C4（同一個測試檔），最後 C2。C5 等常數整理好再做。

## 4. 其他會讓圖過時、但上面沒想到的來源（D）

1. **線上部署跟 repo 不同步。** Apps Script 是手動貼上去部署的（`sheet-write.gs:1-2`），觸發器要手動執行 `installWalkEditTriggers` 才會建立。管理網站也是手動部署（`wrangler.admin.jsonc:6`）。所以 repo 的測試全過，線上的 GAS 或資料流頁可能還是舊版。測試沒辦法處理這個，只能在部署流程或說明裡提醒。
2. **功能開關與環境變數。** `WALK_RETRY_ENABLED`、`D1_WALK_NOTIFY`（`wrangler.jsonc:31-33`；關掉時 `walk-retry.js:4` 和 `walk-reconcile.js:68-72` 會停）、`PREVIEW`，以及管理網站的功能設定（例如今日溜狗開關）。這些不改程式也會改變流程，圖上沒畫。關掉時燈號會變成「還沒有紀錄」或過期，不會說是被開關關掉的。
3. **其他 Worker 和手動 Action。** 測試網站 Worker 自己也有寫回重試（`wrangler.test-site.jsonc:37-38`）。`r2-thumbs.yml`（縮圖寫進 R2）、`d1-migrations.yml`（改 D1）是手動觸發的寫入路線，圖上沒有。燈號只看正式 D1。
4. **同一件事寫在好幾個地方。** 排程時間至少出現在 `wrangler.jsonc` 的註解（:35-38）、`index.js:24-26`、`data-checks.js:33,43-44`、`flow-model.js`、`docs/ARCHITECTURE_NOW.md`。C1 只能顧到程式裡的字串，Markdown 文件要另外處理或不管。
5. **Google 端的行為假設。** 例如程式寫入和刪列不會觸發 onEdit（跟 memory 裡「試算表刪列 D1 不跟著刪」同一件事），`nearMinute` 是前後 15 分鐘。這些是 Google 的行為，Node 測試驗不到。
6. **錯誤字串前綴。** 燈號靠 `'writeback-rejected'` 字串判斷（`flow-model.js:216`），改了 `walk-accept.js:215` 的前綴，紅燈會默默失效。可以 export 前綴常數，兩邊共用。
