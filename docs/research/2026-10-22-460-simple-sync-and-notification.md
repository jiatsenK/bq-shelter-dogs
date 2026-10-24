# #460：簡化寫回責任與人工改表通知

日期：2026-10-22（台灣）。研究基準：`claude/460-d1-unified`、HEAD `843dafe97ef772139183809b328c6e603b9442d9`、PR #487；另讀工作目錄的最新交接決定。這是靜態研究與設計建議，未修改程式、執行測試、部署或操作正式服務。`SITE.d1WalkAccept` 關閉，GAS 尚未部署；正式觸發器安裝、授權與成功執行狀態未知。[最新交接](../design/history/460-cron-cpu-handoff.md)

## 結論

建議保留兩種資料責任：D1 接受並提供最新溜狗狀態；GAS 提供可信讀表與受條件保護的寫回。網站登記後背景派送，失敗／未確認才補送；人工通知啟動比對；每日保險掃描只補沒有通知到的改動。共用的是寫回協定與比較規則，不是把掃描、通知、派送綁成每輪必做的一件工作。[K 最新決定](../design/history/460-cron-cpu-handoff.md)、[現行設計](../design/history/460-d1-walk-unified.md)

最小通知方案是「安裝型編輯觸發器＋結構變更觸發器＋GAS 一個持久待通知版本＋有界補送＋Worker 既有 pending」。不需要 Cloudflare Queues、Durable Object、Pub/Sub 或逐次編輯日誌。GAS 完全沒觸發時沒有標記可重送，仍靠既定每日三掃；通知不能承諾零遺失。以下建議未實作。

## 一、現況真正增加複雜度的地方

| 現況與證據 | 實質簡化方式 | 保留的責任 |
|---|---|---|
| `retryWalks` 先 `retryNotifiedScan`／`scanWalks`，再查未決及到期派送；閒置也會讀表。[walk-retry.js](../../worker/src/walk-retry.js) | 拆成「只查到期寫回」「只補收到但未完成的通知」「固定時間保險掃描」；排程可共用喚醒，但各自只做有需要的工作。 | 到期重試不中斷，通知失敗不等三次掃描。 |
| `dispatchWalk`、`dispatchWalks` 各有認領、預算、失敗與釋放流程；單隻另走一套，批次 catch 再逐隻重跑。[walk-accept.js](../../worker/src/walk-accept.js) | 一個接受工作陣列的派送核心，單隻就是長度一；版本競爭只略過失效項，預算不足保留工作，遠端結果不明進恢復流程。刪掉全面退回逐隻的 catch 與兩套收尾。 | 一隻失敗不得拖累其他狗；每隻仍有版本與派送識別。 |
| `v3_walk_delivery` 與 `v3_walk_retry` 都按狗存派送資訊，outbox 另有版本／狀態／next-attempt。[schema](../../db/compact-schema.sql) | 可將兩張輔助表合成一張「每狗派送控制列」，集中 owner、started_at、版本、failures、reserved_day；用同一份快照處理認領及收尾。這是可選第二步，非先上線的必要遷移。 | 活躍派送不能只附屬目前版本：新版本接受時，舊 Google 執行可能仍在跑。不能直接丟掉舊 owner。 |
| 人工值已直接讀到並接受後，`reconcileWalkSnapshot` 先新增 pending outbox，再改 synced，會經過資料包狀態觸發器。[walk-reconcile.js](../../worker/src/walk-reconcile.js)、[schema](../../db/compact-schema.sql) | 讓「接受已確認人工觀測」一次提交最終 synced 狀態，避免先製造待寫回再消除；須同時調整投影維護順序，保證資料包包含最終狀態。 | 原子交易、版本 guard、必要的確認證據與復原前值。不能只改 INSERT 而讓包永遠 pending。 |
| 掃描與派送 target 有不同的比較入口；前者只接受已 synced 的狗，後者包含三方比較與未知結果分類。[walk-reconcile.js](../../worker/src/walk-reconcile.js)、[compareTrustedWalk](../../worker/src/walk-accept.js) | 共用純比較決策及「接受觀測」提交邊界；保留不同可信度／未決分類，不把兩個函式拼成一個大函式。 | 掃描不得將正在寫入的中間值猜成人工修改。 |

先做前兩項即可刪除每輪無條件掃表及派送流程重複，減少無工作時的讀取，也讓測量對應真實責任。資料表整併須另做遷移與協定回歸，不能把「少兩張表」當作省掉併發保護的理由。以上為依現碼提出的工程建議，不是已量得的 CPU 改善。

**已知量測偏差：** `writeBudget` 預設單次 500；`dispatchWalks` 對十隻保留 `96 × 10 = 960`，會在認領前丟錯，被通用 catch 轉成逐隻派送。測速設定只覆寫每日預算，未覆寫單次門檻。因此既有 P99 57.89 ms 不能證明合併派送成功後仍無效，也不能由它拆算掃描／派送 CPU。不要只調高 500 來掩蓋問題；先重算實際協定、觸發器及索引的保留上界，再區分預算拒絕、競爭、遠端錯誤。[writeBudget／dispatchWalks](../../worker/src/walk-accept.js)、[測速設定](../../wrangler.cpu-bench.jsonc)、[回呼設定](../../wrangler.cpu-bench-callback.jsonc)、[ADR 0008](../adr/0008-diff-sync-and-write-budget.md)

## 二、不能刪掉的最小安全邊界

1. D1 接受狀態、請求去重、待寫回與資料包必須原子提交；舊回執以版本及 dispatch ID 核對，不能清除新工作。日期較早不代表版本較舊，人工改早日期仍有效。
2. GAS 在同一 script lock 內讀表、向 Worker 取目前目標、寫前再次重新定位／核對、寫後直接讀回。喚醒請求只帶狗識別，不重放舊整格內容。
3. 逾時只表示結果未知。需要一致基準、已派送目標、可信回執與尚未知的中間值證據；目前 `v3_walk_baselines`、outbox 舊版本及 `readback_seen` 各有用途，不能直接改成每狗只留一筆就刪歷史證據。只有證明舊派送已不可能影響分類後，才能規劃清理。
4. 人工通知是喚醒，不能把事件 payload 或 gviz 當可信值覆蓋 D1。讀表前記下版本，提交時再核對；掃描期間的新登記不能被較早快照撤銷。
5. script lock 只擋其他程式，不擋人工手改。最後核對與寫入之間仍有已接受的方案 A 風險；不要宣稱通知或鎖能還原所有未保存人工值。

以上是既有規格，不需重新訪談。來源：[固定 ADR 0017](https://github.com/jiatsenK/bq-shelter-dogs/blob/444c33e/docs/adr/0017-today-walks-d1-source.md)、[固定規格](https://github.com/jiatsenK/bq-shelter-dogs/blob/444c33e/docs/design/441-d1-walk-sync-spec.md)、[現行 GAS](../../apps-script/sheet-write.gs)、[現行狀態處理](../../worker/src/walk-accept.js)。兩份固定文件舊 Cron 頻率已由最新交接取代。

## 三、Google 觸發器實際能做什麼

Google 文件將安裝型 edit 用於值變更、change 用於結構改動；事件參考同時明列 changeType 包含 `EDIT`。因此「change 絕不處理值修改」不成立。選 edit 是為了明確取得受影響 range；結構 handler 忽略 `EDIT`，避免與 edit 重複。安裝型觸發器以建立者授權執行，script/API 寫入不觸發。建立者須在 Apps Script 觸發條件選正確函式、試算表及事件，完成授權；其他帳號不一定看得到建立者的觸發器。[安裝型觸發器](https://developers.google.com/apps-script/guides/triggers/installable)、[事件物件](https://developers.google.com/apps-script/guides/triggers/events)

| 操作 | 建議處理 |
|---|---|
| 輸入名字、刪名、改日期、清空 | 安裝型 edit 收到 range 就標記；不可用 `if (!e.value) return`，清空也是有效修改。 |
| 多格貼上／整段清空 | range 可包含多格；`value`／`oldValue` 只供單格，不能逐格還原事件。只通知需重新讀表，不自行拼名單。 |
| 插刪列欄／分頁、排序等 | 安裝型 change 接結構及 `OTHER` 等需保守比對的事件；不假設有 edit range；重新定位狗及欄名，缺欄／識別不唯一停寫。排序實際事件分類列入驗收，不憑名稱猜。 |
| 純格式調整 | 溜狗值不需比對可略過 FORMAT；既有非溜狗同步需求仍需保留。 |
| GAS setValue、Sheets API 寫入 | 不靠上述觸發器。網站寫回已有 D1；其他外部寫表者若要立即反映，必須自己明確呼叫通知，否則由保險掃描補漏。 |

事件欄位依據：[Google Sheets event objects](https://developers.google.com/apps-script/guides/triggers/events)。新 handler 不宜只篩溜狗兩欄而漏掉既有其他資料通知；`sheetChanged` 目前也維護 `v3_sync_state.changed`，供狗清單等同步使用。[sheetChanged](../../worker/src/index.js)

不採只有函式名稱的簡易 `onEdit`：簡易觸發器受未授權服務限制；外連 UrlFetch 需要 external_request 授權。Google 簡易觸發器頁寫到 onEdit 只排兩個事件，但不能未經依據把此數量當成安裝型的確定佇列上限。[簡易觸發器](https://developers.google.com/apps-script/guides/triggers)、[UrlFetch](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app)

官方說明執行失敗可寄失敗摘要，並在 Executions 看失敗原因；本文查閱的官方觸發器契約未提供可依賴的「每次事件必達／失敗必定自動重試」保證。配額超限亦會中止執行。故不能將寄信或一次測試成功當成自動補送能力。[觸發器錯誤](https://developers.google.com/apps-script/guides/triggers/installable#errors_in_triggers)、[配額與例外](https://developers.google.com/apps-script/guides/services/quotas)

## 四、把三種遺失分開

| 失敗位置 | 現有能力／缺口 | 最小補救 |
|---|---|---|
| 事件完全沒觸發，或在保存標記前中止 | GAS、Worker 都不知道有改；任何 GAS 待送標記均無法補救。 | 驗證安裝授權、檢查執行失敗；每日三次可信掃描仍必留。 |
| GAS 已啟動，但設定缺失、網路錯誤、Worker 403／500 或回應遺失 | `notifyWorker` 缺 URL/key 靜默 return；`muteHttpExceptions:true` 未檢查回應；沒有持久補送。 | 先保存一個待通知版本，再送；檢查 HTTP 與業務接受回應；失敗保留標記，有界補送。 |
| Worker 已收到，但還沒持久接受就失敗 | GAS 不可視為成功。 | GAS 保留同一標記重送。 |
| Worker 已持久接受，比對失敗／中斷／差異尚未收完 | `v3_walk_compare` 已有 pending/running/again；只能補抵達 Worker 的通知。 | Worker 快速恢復 pending，與全表保險掃描排程分開。接受回應代表責任已接手，不代表手機已更新。 |

證據：[notifyWorker](../../apps-script/sheet-write.gs)、[sheetChanged](../../worker/src/index.js)、[通知持久狀態](../../worker/src/walk-reconcile.js)。`muteHttpExceptions` 的意義是 HTTP 錯誤回傳 response 而不丟例外，不等於成功。[Google UrlFetch 文件](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app)

**降頻前必要修正：** `reconcileWalkSnapshot` 每輪最多接受十隻，其他差異回 `deferred`。`scanWalks` 現在僅用它決定是否保存指紋，卻沒有把未完成結果回傳；`scanNotifiedWalks` 因而可能將比較標 idle。改為 deferred 仍留 pending，後續小批補完；不能等下一次三掃。掃描遇未決派送也不能丟掉這個補跑責任；可辨識的人工值須依既有三方比較處理，不能把「尚未分類」冒充完成。[walk-reconcile.js](../../worker/src/walk-reconcile.js)

## 五、少數方案比較與推薦

| 方案 | 新增狀態／維護 | 時效與限制 | 判斷 |
|---|---|---|---|
| 只修正觸發器、檢查 HTTP，送失敗等待三掃 | 最少 | 已觸發但送失敗也可能等十小時 | 不符合已確定「通知失敗另行重試」。 |
| 一個待通知版本＋固定補送觸發器＋Worker pending | GAS 一個小狀態物件、一個時間觸發器；沿用現有 HTTP、D1 | 有觸發且保存標記後可補送；無法補完全沒觸發 | **推薦**，不新增服務基礎設施。 |
| 每次事件建完整佇列、逐筆 ack、外加訊息服務 | 每筆事件、去重、保留期、消費者與更多部署 | 仍無法補 trigger 未產生的事件，也無法還原多格事件中沒有的舊值 | 與「只需最新狀態」不相稱，這次不採。 |

推薦的具體責任：

1. **標記：** edit／change 共用標記函式，將一個 Script Property JSON 內的 generation 換成新識別；只存待通知版本及退避資訊，不存格子值或人員名單。同時多次編輯合成「需再讀一次」。Script Properties 為跨執行的共用鍵值儲存。[Properties Service](https://developers.google.com/apps-script/guides/properties)
2. **短鎖：** 以 script lock 保護讀改寫標記；取得待送 generation 後先釋放鎖才呼叫 Worker。成功後重新取短鎖，只在 generation 仍相同時清除。否則新編輯可能被舊成功回應清掉。網路期間絕不能持同一鎖：Worker 同步執行 `walkScan` 會再回 GAS 要鎖，造成互等。[LockService](https://developers.google.com/apps-script/reference/lock/lock-service)、[現行掃描回呼](../../worker/src/walk-reconcile.js)、[GAS 共用鎖](../../apps-script/sheet-write.gs)
3. **送出：** 事件當次嘗試一次，失敗保留；固定時間觸發器檢查標記，每次最多一個 HTTP 請求，例如每分鐘檢查、失敗採 1／2／4／8／15 分鐘退避並以 15 分鐘封頂。這是建議的工程預設，不是 Google 時效保證；不用每次失敗新增一個 trigger，不在同次執行 sleep 連打，無待送時不寫狀態。失敗不永久丟棄；設定／授權錯誤須可從執行紀錄與既有失敗摘要察覺。
4. **交棒：** 成功條件須是 HTTP 成功且回應確認通知已持久接受。現有 `comparison.pending` 若確實已落 D1，可以視為 Worker 已接手；`comparison.deferred`（功能未啟用）不能誤報溜狗通知完成。Worker 若只排記憶體 `waitUntil` 而未先存 pending，也不能當持久接受。GAS 收不到成功回應則保留標記，重複通知由既有合併流程承接。[sheetChanged](../../worker/src/index.js)、[scanNotifiedWalks](../../worker/src/walk-reconcile.js)
5. **Worker 補跑：** 收到且持久接受的通知失敗，由既有快速排程檢查 pending／過期 running，只恢復未完成工作。寫回 due 與通知 pending 分別處理，不再每輪先做全表掃描。若共用一次 Cron 喚醒，要分別設工作上限並驗證合計 CPU；拆責任不等於取得兩份 CPU 配額。

以上使用現有 GAS、Properties、Worker、D1；新增的是 GAS 時間觸發器設定與很小的持久標記，並非「零新增狀態」。若不接受此維護成本，只能接受已觸發但未送達也等三掃，不能同時宣稱通知失敗有即時補送。

## 六、三掃的時間意義與驗收

K 已定每天台灣 **09:43、13:53、23:53**，不重新選時間；間隔分別 4 小時 10 分、10 小時、9 小時 50 分。完全漏通知且沒有其他成功比對時，等待下一掃可能接近 **10 小時**，再加比對、退避、手機輪詢；掃描若失敗則更久，十小時不是交付上限。09:43／13:53 在 10–12、14–16 工作時段前，能降低常見舊資料干擾，但排程避開工作時段本身不能防止舊寫回，仍靠版本與未知結果保護。[已定時間](../design/history/460-cron-cpu-handoff.md)、[版本協定](../../worker/src/walk-accept.js)

正式部署與設定需另取得授權，本研究未執行。降低掃描頻率前必須完成：

- 由實際觸發器建立者核對專案、試算表、handler、事件類型、授權及重複安裝；GAS 網頁應用程式部署更新與安裝型觸發器設定分別核對，不把部署成功當成 trigger 已裝好。
- 用志工帳號實際輸入、批量貼上超過十隻、刪名、清空、改早日期；另驗插刪列／排序，以及其他分頁改動仍能通知既有同步。一路核對 GAS Executions、Worker 接受結果、D1 版本、另一支手機；手動執行 notifyWorker 或 HTTP 200 不算。
- 在授權測試環境驗證缺設定、HTTP 拒絕、回應遺失、Worker 接受後比較中斷及超過十隻的 deferred；確認 GAS 標記與 Worker pending 各自保留及恢復。另驗送出中又有新編輯，舊成功回應不會清掉新 generation。
- 本機 adapter 先驗超過十隻時 pending 不假完成，以及 notify fetch 之前已釋放 script lock、Worker 回呼可重新取得鎖；此測試只驗程式協定，不能代替正式觸發器與實際授權驗收。
- 模擬完全漏 trigger，由每日掃描入口補回；模擬網站新登記與舊掃描／舊派送交錯、跨日未決、人工清空遇 pending，確認不降版、不復活舊名單。script/API 改表不期待 edit trigger。
- 分開量無工作重試、單隻／十隻寫回、無差異掃描、差異超過十隻、人工通知及回呼。先證明測試確實走合併路徑；結果再決定批量與預算，不從既有混合 CPU 數字推論通過。

行為驗收依據：[固定規格驗收表](https://github.com/jiatsenK/bq-shelter-dogs/blob/444c33e/docs/design/441-d1-walk-sync-spec.md)、[最新部署前驗收要求](../design/history/460-cron-cpu-handoff.md)。

## 七、真正尚需決定的取捨

三原則、掃描時間、D1 為最新狀態主來源、保留人工修改與方案 A 都已決定。工程上建議直接採小型 GAS 標記補送；真正需要 K 接受的是新增一個 GAS 時間觸發器及其維護責任，換取「已觸發但送失敗」不用等三掃。這不消除完全漏 trigger 最長接近十小時的正常等待窗口。

資料表整併可延後；先刪排程耦合與重複派送流程，保留既有證據表較容易驗收。是否同次做 schema 遷移是交付範圍取捨，不是需要重新選架構。正式部署、觸發器設定、實際改表與線上 CPU 驗收則仍須 K 另外授權；沒有任何靜態研究能代替這些證據。
