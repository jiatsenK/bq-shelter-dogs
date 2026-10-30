# GAS 送狗清單時附上整張表的 key：成本、過去的問題與正確性

日期：2026-10-30（台灣）。worktree `frontend-issue-discussion-eb42e1`，基準 main `33bc03e5`。只讀程式、repo 文件、GitHub Issue 與官方文件，沒有改程式、沒有寫入 D1 或試算表、沒有實測 Apps Script。行號以本次讀到的檔案為準。

要查證的說法（討論中對 K 說的）：「GAS 每次送狗清單時都會讀整張表（`apps-script/sheet-write.gs:469` 的 `dogListUnits(dogListSheets(), ...)`），只送改到的那幾列。修法是 GAS 每次送出時順便附上整張表目前有哪些狗（主清單約 120 個單位 key），反正已經讀過整張表，幾乎不多花成本。」

來源：
- Apps Script：[配額](https://developers.google.com/apps-script/guides/services/quotas)、[簡易觸發器](https://developers.google.com/apps-script/guides/triggers)、[Lock](https://developers.google.com/apps-script/reference/lock/lock)、[SpreadsheetApp](https://developers.google.com/apps-script/reference/spreadsheet/spreadsheet-app)
- Cloudflare：[D1 限制](https://developers.cloudflare.com/d1/platform/limits/)、[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)
- 同日另一份研究：`docs/research/2026-10-30-new-dog-identity.md`（方案戊就是「每批附上主清單全部 key」，第 84 行）

## 1. 結論

1. **「每次送狗清單都讀整張表」對。** `flushDogList` 每一輪都在 script lock 內呼叫 `dogListSheets()`，三個分頁各讀 `getDataRange().getValues()`，再把全部單位算出來（含每個單位的 MD5），最後只挑這批 10 個送出（`apps-script/sheet-write.gs:459-473`、`:447-451`、`:544-601`）。保險掃描也一樣（`:503`）。所以 GAS 端產生 key 清單確實只是 `Object.keys(units)`，幾乎不花成本。
2. **「只送改到的那幾列」要修正成「只送受影響的單位，而且是送出那一刻表上的值」。** 單位是主清單一整隻狗（含整格備註）、常遛狗群一整欄、異動紀錄整段（最多 400 列），不是改到的格子（`apps-script/sheet-write.gs:436-440`、`:561-571`、`:597`）。
3. **「每次送出時順便附上」不夠精確：有幾種情況根本不會送。** 改到的範圍算不出單位（例如刪掉最後一列，那一列變空白）就不排待送、不呼叫 `flushDogList`（`:328-329`、`:342`、`:615-619`）。待送的單位全都已不在表上時，不呼叫 Worker、直接 ack（`:470-475`）。記號被換掉或等鎖逾時也不送（`:464`、`:476-478`）。要讓 Worker 知道消失，這幾條路徑也要改。
4. **整張表的 key 其實已經在送，一天三次。** `dogListScan` 送的指紋表就是全部單位 key（`:504-506`），Worker 已經拿它跟上次的指紋比，算出「D1 有、表沒有」（`worker/src/dog-list.js:263-278`）。缺的不是資訊，而是決定：ADR 0018 第 4 點「只看出現、不追消失」（`docs/adr/0018-today-walks-d1-event-sync.md:13`），以及「D1 有、表沒有」只列出不刪（`worker/src/dog-list.js:6`、`docs/ARCHITECTURE_NOW.md:57`）。每次送出都附上，是把這個比對從一天三次改成即時。
5. **成本面幾乎不多花是對的，風險在正確性。** 主清單約 117–118 個 key，約 2.1 KB，Worker 本來每次都整張讀主清單複本，比對不用多查 D1（第 4 節）。但附上的清單是讀表那一刻的樣子，會碰到「打字中途的暫時狀態」與「保險掃描指紋在鎖外送出」兩種誤判，現有 `SHEET_EDIT_MARK` 只保護順序，保護不了暫時狀態（第 5 節）。過去實際出過的 GAS 問題是舊讀值蓋掉新值（#694）與鎖外送出（#701），都跟這件事直接相關。repo 與 Issue 裡沒有找到配額用完或單次執行逾時的實際紀錄。

## 2. 現在 GAS 讀表與送出的實際流程

### 2.1 有人改表：`onWalkSheetEdit`（`apps-script/sheet-write.gs:317-343`）

| 步驟 | 讀什麼 | 行號 |
|---|---|---|
| 換表上變動記號 `SHEET_EDIT_MARK`，同時記成這次執行的 `runMark` | 指令碼屬性 | `:323`、`:289-292` |
| `values` 來源：被改的那個分頁的 `sheet.getDataRange().getValues()`，整個分頁、全部欄 | 只讀被改的分頁 | `:320`、`:325` |
| 用 `values` 算受影響的單位 key（改後的值），排進 `DOG_LIST_PENDING`（使用者鎖，等 10 秒） | 不再讀表 | `:328-333`、`:485-493`、`:604-621` |
| 主清單或已出所有改到列：排今日溜狗待送，呼叫 `flushWalkEdits` | `readWalkSnapshot` 讀主清單表頭前 20 列，加編號、犬名、日期、誰遛的四欄整欄 | `:334-340`、`:357-381`、`:95-112` |
| 有狗清單單位就呼叫 `flushDogList` | 見 2.2 | `:342` |

所以一次改主清單，同一次執行會讀主清單三次（整分頁、四欄、整分頁），已出所與常遛狗群各一次。

### 2.2 送狗清單：`flushDogList`（`apps-script/sheet-write.gs:457-483`）

每一輪（最多 `DOG_LIST_ROUNDS` = 10 輪，`:443`）：

1. 拿 script lock，等 15 秒，等不到就 catch 後結束、待送留著（`:461-463`、`:476-478`）。
2. 核對記號，被換掉就不送（`:464`）。定時觸發的執行這時才第一次記下 `runMark`（`:299-303`）。
3. 拿到鎖才讀待送，取前 10 個（`:465-468`，`DOG_LIST_BATCH` 跟 Worker 的 `DOG_LIST_ROWS_MAX` 一樣，`:442`、`worker/src/dog-list.js:19`）。
4. **`dogListSheets()` 讀三個分頁整張 `getDataRange().getValues()`**（`:447-451`），`dogListUnits` 算全部單位（`:469`、`:544-601`）。
5. 待送的單位已不在表上就當成 ack，不送（`:470-475`）。有東西才 POST `/api/walk-writeback/dog-list`（`:473`）。
6. 放鎖，用使用者鎖清掉已確認、版本沒變的待送（`:479-480`、`:414-421`）。有沒 ack 的就停（`:481`）。

**每一輪都呼叫讀整張表，對。** 但同一次執行重讀拿不拿得到新內容，是另一回事（2.4）。

### 2.3 保險掃描：`dogListScan`（`apps-script/sheet-write.gs:498-523`）

- 拿鎖、記下記號、讀三個分頁算全部單位，放鎖（`:502-503`）。`waitLock` 在 try 外面，等不到會整次丟錯（`:502`，[Lock](https://developers.google.com/apps-script/reference/lock/lock)：`waitLock` 逾時會丟例外）。
- **在鎖外、不核對記號**就送全部單位的指紋給 `/dog-list-scan`（`:504-506`）。
- Worker 回要哪些，每批 10 個：拿鎖、核對記號、送出、放鎖，不重讀表（`:509-520`、`:496-497`）。

### 2.4 同一次執行重讀會不會拿到舊內容

- repo 的認定：「同一次執行裡，Apps Script 會沿用第一次讀到的表內容，之後別人改的讀不到」（`apps-script/sheet-write.gs:282-285`、`docs/ARCHITECTURE_NOW.md:39`）。這是 2026-10-27 在測試試算表重現 #694 後推得的（`docs/agent-log/2026-10-27-694-stale-sheet-edit.md:8-12`），測試用「每個 vm context 讀過的範圍照第一次內容回」模擬（`worker/test/sheet-edit-stale.test.mjs:1-2`）。
- 官方文件沒有寫讀取會快取。`SpreadsheetApp.flush()` 只寫「Applies all pending Spreadsheet changes」，並說明試算表操作有時會合併處理以改善效能（[SpreadsheetApp](https://developers.google.com/apps-script/reference/spreadsheet/spreadsheet-app)），講的是寫入何時套用。所以「重讀拿到第一次內容」是 repo 的實測推論，不是官方保證（第 6 節）。
- 現有保護：讀表前記下記號，送出前在同一把 script lock 內核對，被換掉就不送、交給較新的執行（`:282-303`、`:464`、`:514`）。網站寫回改了格子也換記號（`:147`）。這保證「送出的內容不早於最後一次記號更換」，也就是較舊的執行不會在較新的執行之後送出舊值。
- 第 2 到 10 輪的 `dogListSheets()`：如果 repo 的推論對，拿到的是第一輪（或 `:325`）的內容，記號沒變就代表那份內容仍是最新已知。如果推論不對，每輪都真的重讀三個分頁，只是多花執行時間，正確性一樣靠記號。

## 3. 過去出過的問題

| 問題 | 發生什麼 | 原因 | 怎麼修 | 跟「每次附上整張表 key」的關係 |
|---|---|---|---|---|
| 連改兩格晚送舊值（[#694](https://github.com/jiatsenK/bq-shelter-dogs/issues/694)） | 2026-10-27 測試試算表，莫莫連改日期、誰遛的，D1 收到 v1 新、v2 新、v3 舊，狗清單複本與溜狗紀錄也記成舊名單（`docs/agent-log/2026-10-27-694-stale-sheet-edit.md:8`） | 執行 A 等鎖時執行 B 先送新值，A 拿到鎖後送出自己一開始讀到的舊內容，A 的狗清單同步也送舊名單並清掉待送（同檔 `:12`） | 加 `SHEET_EDIT_MARK`，送出前在鎖內核對（同檔 `:16`），PR #695 | **直接相關。** 附上的 key 清單跟列一樣是那次執行讀到的內容。記號機制讓舊清單不會晚於新清單送到，這點可沿用 |
| 保險掃描鎖外核對與送出（[#701](https://github.com/jiatsenK/bq-shelter-dogs/issues/701)） | 審查發現 `dogListScan` 讀完就放鎖，核對與送出在鎖外，網站寫回插進來時會送出舊名單（`docs/agent-log/2026-10-27-701-scan-lock.md:9`） | #694 修正沒做完 | 每批拿鎖、核對、送出、放鎖，PR #703（同檔 `:14`）。**指紋比對那一步仍在鎖外**（同檔 `:19`） | **直接相關。** 指紋表就是整張表的 key，現在在鎖外、不核對記號就送（第 5.3 節） |
| 栗子、MINI 被誤記離所（#501 切換後） | 2026-10-24 以前出所又回來的狗，已出所留著舊列，掃描時已出所單位蓋過主清單（`docs/agent-log/2026-10-24-501-dog-list-edit.md:17`） | 用「整張表出現在哪」判斷時，兩個分頁都有同一隻 | 主清單有的狗不送已出所單位（`apps-script/sheet-write.gs:582-583`） | 相關。整張表 key 要照同一套規則產生（已出所跳過主清單上的狗），否則同樣誤判 |
| 先打名字後補編號多一隻狗 | 2026-10-24 驗收時新增狗先打名字、後補編號，D1 多一隻沒編號的（`docs/agent-log/2026-10-24-501-dog-list-edit.md:18`） | key 從 `main:名:X` 變成 `main:編號`，Worker 當成新狗 | Worker 找同名沒編號的那隻補上編號（`worker/src/dog-list.js:80-89`） | **相關。** 這就是打字中途的暫時狀態，`main:名:X` 會從清單上消失，Worker 若立刻當成刪列處理就錯（第 5.2 節） |
| 改編號、改名多一隻狗（[#621](https://github.com/jiatsenK/bq-shelter-dogs/issues/621)，未關） | D1 新增一隻，舊的留著 | GAS 只送表上有的單位，不在表上的直接 ack，Worker 只把多出來的列進 `dog_list_extra`（#621 內文） | 待 K 決定，同日研究提出方案甲到戊（`docs/research/2026-10-30-new-dog-identity.md:80-84`） | **這就是要解的問題。** |
| 舊指紋一直警告 D1 有、表沒有（[#528](https://github.com/jiatsenK/bq-shelter-dogs/issues/528)） | 回所的狗與已清測試狗每次掃描都被列出（`docs/agent-log/2026-10-24-528-stale-fingerprint.md:4`） | 指紋表是早期建的，規則改了沒清 | 掃描時清掉這類舊指紋（同檔 `:5`、`worker/src/dog-list.js:262-277`） | 相關。「D1 有、表沒有」的判斷有誤報歷史，自動處理前要先確認誤報已清乾淨 |
| 常遛狗群插入、刪除整欄（[#550](https://github.com/jiatsenK/bq-shelter-dogs/issues/550)，未關） | 還沒實測，可能認錯群或留殘影 | 狗群用欄號當身分 | 待實測 | 間接相關。如果清單也包含 `groups:欄`，欄位位移時「消失」的欄號不代表群被刪 |
| 保險掃描搶鎖（推論，未見實際發生） | 研究推論整群登記佔鎖時，掃描等 15 秒拿不到會整次失敗（`docs/research/2026-10-26-worker-gas-sync-design.md:97-99`） | 兩邊同時段搶同一把 script lock | Worker 掃描改到 09:23 等時段、`walkScan` 等 45 秒（`docs/agent-log/2026-10-26-scan-time-offset.md:4-7`） | 不相關。附上清單不增加持鎖時間（清單是同一次讀表算出的） |
| GAS 配額與單次執行時間（推論，未見實際發生） | 研究估觸發器一天約 4～20 分，佔 90 分鐘的 5～22%，UrlFetch 約 300～800 次（`docs/research/2026-10-26-worker-gas-sync-design.md:111-121`） | 執行秒數沒實測（同檔 `:111`） | 無 | 幾乎不相關。附上清單不多 UrlFetch 次數，除非改成「待送都不在表上也要送」（第 4 節） |
| Worker 讀整張表逐狗比對 CPU 超標（#460、#301） | Cron 一輪 P99 57.89 ms，超過免費方案 10 ms（`docs/design/history/460-cron-cpu-handoff.md:48`）。Worker 直接同步要 64–152 ms（`docs/adr/0012-sync-on-change.md:27`） | CPU 大多花在 D1 每次往返（`docs/design/history/460-cron-cpu-handoff.md:21`） | 改成有人編輯才送、只送改動（`docs/adr/0018-today-walks-d1-event-sync.md:5`） | 要注意但不同。在記憶體比對 120 個 key 不多 D1 往返，跟當年逐狗查 D1 不一樣。若每個消失的 key 都要查或寫 D1，就會回到那個問題 |
| D1 寫入額度用完（[#302](https://github.com/jiatsenK/bq-shelter-dogs/issues/302)） | 2026-10-16 同步整份刪光重寫，一次約 4,500 列，一天 34 次（`docs/adr/0008-diff-sync-and-write-budget.md:9`） | 整份重寫 | 只寫差異（ADR 0008） | 間接相關。處理消失只能寫有變的列，不能每次附上清單就重寫 |
| GitHub Actions 分鐘數用太多（[#305](https://github.com/jiatsenK/bq-shelter-dogs/issues/305)、[#329](https://github.com/jiatsenK/bq-shelter-dogs/issues/329)） | 10 月前半同步跑 621 次 | 每 30 分鐘叫 Actions 讀整張表 | 已退役（#501、[#512](https://github.com/jiatsenK/bq-shelter-dogs/issues/512)） | 不相關，Actions 已不參與 |

漏事件：官方寫簡易 onEdit「only queues up to 2 trigger events」（[簡易觸發器](https://developers.google.com/apps-script/guides/triggers)），安裝型是否一樣沒實測（`docs/research/2026-10-23-gas-trigger-structure-changes.md:18`）。排序不觸發編輯（同檔 `:74`）。repo 沒有實際漏事件的紀錄。這跟附上清單的關係是：漏掉的那次本來就送不出清單，要靠下一次編輯或保險掃描補。

## 4. 成本估算

### 4.1 請求大小

| 項目 | 估算 | 依據 |
|---|---|---|
| 主清單一個 key | `"main:2023040701",` 約 18 位元組。沒編號的 `"main:名:暖暖",` 也約 18 位元組（中文 UTF-8 每字 3 位元組） | key 格式 `apps-script/sheet-write.gs:541` |
| 主清單全部 key | 117–118 個 × 18 ≈ **2.1 KB** | 主清單 117 列（`docs/research/2026-10-30-new-dog-identity.md:116`）、118 隻（`docs/research/2026-10-18-sync-231-rows.md:18`） |
| 加上已出所 key | 每列約 21 位元組 × 已出所列數。**已出所分頁有幾列 repo 沒有紀錄**，要實測 | `:579-587` 已出所每列都算單位 |
| 現有指紋請求（已經在送） | 每個單位約 37 位元組（key 加 16 碼指紋），主清單約 4.3 KB 加已出所 | `:504-506`、`:452-455` |
| Worker 收件上限 | `/dog-list` 與 `/dog-list-scan` 都是 512×1024，比的是 `raw.length`（字元數，不是位元組） | `worker/src/index.js:31`、`:846` |
| Workers 平台上限 | 免費方案請求本文 100 MB | [Workers 限制](https://developers.cloudflare.com/workers/platform/limits/) |
| GAS UrlFetch 上限 | 一般帳號 POST 50 MB／次、每天 20,000 次 | [配額](https://developers.google.com/apps-script/guides/services/quotas) |

結論：多 2 KB 左右，離所有上限都很遠。

### 4.2 GAS 端

- 產生清單：`units` 已經算好，只多 `Object.keys`。不多讀表、不多 UrlFetch（`apps-script/sheet-write.gs:469`）。
- 例外：如果要讓「待送都已不在表上」或「改到的範圍算不出單位」時也送清單（第 1 節第 3 點），這些情況會多一次 UrlFetch。量很小，但不是零。
- 不要把清單存進指令碼屬性：官方每個值 9 KB、整個專案 500 KB、每天讀寫 50,000 次（[配額](https://developers.google.com/apps-script/guides/services/quotas)）。現在待送只存 key 和版本（`:329-333`）。
- 觸發器總執行時間一般帳號 90 分鐘／天、單次 6 分鐘（[配額](https://developers.google.com/apps-script/guides/services/quotas)），附上清單不改變讀表次數，所以不影響。

### 4.3 Worker 端

| 項目 | 現況 | 附上清單後 |
|---|---|---|
| `DOG_LIST_ROWS_MAX` | 每批 10 列（`worker/src/dog-list.js:19`、`worker/src/index.js:850`） | 不變，清單另放一個欄位，不算列數 |
| 每次呼叫讀 D1 | 指紋 1 次、整張主清單複本 1 次（`worker/src/dog-list.js:225`、`:228`），每列再 3–4 次往返（`:17`），最後狀態 batch 1 次（`:252`） | **比對主清單不用多查**：`list` 已經在記憶體 |
| 比對已出所 key | 沒有 | 要另讀 `v3_dog_departures`，多 1 次查詢。若用 `IN (?,?,…)` 帶全部 key，官方每句最多 100 個參數，超過會失敗（[D1 限制](https://developers.cloudflare.com/d1/platform/limits/)）。現有 `scanDogList` 只帶「消失的」key（`worker/src/dog-list.js:270`） |
| 每次呼叫查詢上限 | 免費方案 50 次，`db.batch()` 整批算 1 次（[D1 限制](https://developers.cloudflare.com/d1/platform/limits/)）。10 列已接近上限（`worker/src/dog-list.js:17-18`） | 只比對不寫：0 次。每處理一隻消失的狗至少 1 個 batch，要設每次上限 |
| CPU | 免費方案每次 10 ms（[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)） | 120 個 key 用 Set 比對，可忽略。CPU 主要花在 D1 往返（`docs/design/history/460-cron-cpu-handoff.md:21`） |

## 5. 正確性風險與現有保護

### 5.1 附上的清單是哪一刻讀的

- 編輯觸發的執行：主清單是 `:325` 讀的（換記號之後），已出所、常遛狗群是 `:469` 第一次讀的。照 repo 的推論，`:469` 重讀主清單拿到的仍是 `:325` 的內容（2.4 節）。
- 定時觸發的執行：在鎖內先記下記號、再讀表（`:463-469`、`:299-303`）。
- 列和清單來自同一次 `dogListUnits`，彼此一致。

### 5.2 讀表後、送出前有人改表

人工改表不受 script lock 限制（`apps-script/sheet-write.gs:137`）。

| 情況 | 會怎樣 | 現有保護擋得住嗎 |
|---|---|---|
| 讀表後有人新增一列 | 清單沒有這列。D1 也還沒有這列，所以不會被當成消失。新增那次編輯的執行會再送 | 不需要保護 |
| 讀表後有人刪列或改名 | 清單仍有舊 key，Worker 以為還在。那次編輯的執行換了記號，較舊的執行在鎖內核對會停住（`:464`），較新的會送出新清單 | 擋得住順序。舊清單不會晚於新清單送到 |
| 較新的執行沒跑成（漏事件、配額、等鎖逾時） | 舊清單是最後一份，消失的狗暫時當成還在 | 擋不住，要等下一次編輯或保險掃描 |
| **打字中途的暫時狀態**：先清空犬名或籠位再打、先打名字後補編號、刪列再插回 | 讀表那一刻這列不算單位（沒犬名或沒籠位就跳過，`:559`），或 key 從 `名:X` 換成編號。清單少了這隻，**這份清單本身就是最新的**，記號沒變 | **擋不住。** 記號只保證「不是舊的」，不保證「不是改到一半」。Worker 若收到就刪，會刪錯，下一次編輯又建回來（有編號時靠 `v3_dog_numbers` 認回，`worker/src/dog-list.js:107`，沒編號時可能變新狗） |

所以 Worker 收到清單後不能立刻把消失的狗移掉。至少要「連續兩份清單都不在、而且隔一段時間」才算，或只標成候選、交給保險掃描確認。同日研究的方案甲用「連續兩次掃描都在 `dog_list_extra`」也是這個道理（`docs/research/2026-10-30-new-dog-identity.md:148`）。

### 5.3 `dogListScan` 鎖外送指紋（`:501-506`）

會有同樣問題，而且更明顯：

- 掃描讀表、放鎖後，有人新增一列，編輯觸發先拿到鎖把新列送到 Worker，指紋表就有了這個 key。接著掃描的舊指紋送到，裡面沒有它，Worker 會把剛新增的列列成「D1 有、表沒有」（`worker/src/dog-list.js:263`、`:278`）。同日研究也點出這點（`docs/research/2026-10-30-new-dog-identity.md:148`）。
- 反方向：讀表後有人刪列，舊指紋仍有那個 key，Worker 當成還在，下一次掃描才更正。
- 現在不出事是因為只列出來不刪。#701 當時判斷「只問 Worker 要哪些，不寫資料」（`docs/agent-log/2026-10-27-701-scan-lock.md:19`），但 `scanDogList` 其實會寫 `dog_list_extra`，也會刪舊指紋（`worker/src/dog-list.js:274-284`），只是不動狗的資料。
- 要讓 Worker 依消失做事，送指紋那一步也要在鎖內核對記號後才送，或 Worker 只在連續兩次掃描都消失時才處理。

### 5.4 `flushDogList` 遇到單位不在表上直接 ack（`:470-475`）

- 這裡是 GAS **唯一看得出「某個 key 已經不在表上」的地方**，但它不告訴 Worker。
- 不過這條路徑抓不到最常見的情況：待送的 key 是用**改後**的值算的（`:328`、`:617-618`），改名、改編號時舊 key 從來不會進待送。這裡會碰到的是「排進待送後、送出前又改掉」的 key。所以只把這裡 ack 的 key 回報給 Worker 不夠，要嘛附上整張清單，要嘛像方案丁送 `e.oldValue`（`docs/research/2026-10-30-new-dog-identity.md:83`）。
- 這幾個 key 都不在表上時 `live` 是空的，根本不呼叫 Worker（`:473`）。附上清單的做法要改成這時也送。

### 5.5 刪列時事件送的是哪一列

實測刪除整列會觸發編輯（`docs/research/2026-10-23-gas-trigger-structure-changes.md:73`），但 `e.range` 指到哪一列沒記錄。從程式推，刪掉中間一列後，那個位置變成下一隻狗，待送排的是下一隻（`:615-619`），被刪的那隻不會進待送【推論】。附上整張清單時這不影響，只要有送出就行。刪掉最後一隻狗、那一列變成「備註」或空白時，可能只送 `notes` 或什麼都不送（第 1 節第 3 點）。

## 6. 還沒查證、需要實測的點

1. **同一次執行重讀是不是真的拿到第一次的內容**，`openById` 拿到的分頁物件跟 `e.range.getSheet()` 是否共用。決定 `flushDogList` 第 2 到 10 輪是白讀（快）還是真的重讀（慢），官方文件沒寫。
2. **刪列、插列、剪下貼上在主清單內移動時，`e.range` 指到哪幾列**，待送排了哪些 key。
3. **已出所分頁實際列數與全部單位數**，用 `dogListScan` 執行紀錄或在 Apps Script 印 `Object.keys(units).length` 與請求的 JSON 長度。
4. **`onWalkSheetEdit`、`flushDogList`、`dogListScan` 的實際執行秒數與每天觸發器總時數**（Apps Script「執行項目」頁）。目前只有推論（`docs/research/2026-10-26-worker-gas-sync-design.md:111`）。
5. **安裝型編輯觸發器會不會漏事件**（快速連改 5 格），`docs/research/2026-10-23-gas-trigger-structure-changes.md:57` 列為需實測，實測表沒有這項。
6. **暫時狀態多常發生**：管理者改名、改籠位時是直接覆蓋還是先清空再打，影響第 5.2 節的確認門檻要設多嚴。
7. **Worker 每次 `/dog-list` 實際用了幾次 D1 查詢**，10 列時離 50 次多近（`worker/src/dog-list.js:17-18` 是估計）。
