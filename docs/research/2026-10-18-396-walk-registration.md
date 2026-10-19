# #396 共用溜狗登記模組：現況與設計建議

日期：2026-10-18（研究筆記，未改程式）  
依據：K 呼叫 research，調查 #396 的一般清單與整群登記；資料來源為 repo 原始碼、測試與已採用 ADR。本文是設計輸入，不是已確認規格。

## 結論

建議方向是：**畫面交出狗名單，模組回逐狗結果與可做的操作**。兩個畫面目前已共用送出佇列與寫入函式，卻各自從本機狀態、布林值與時間戳猜登記結果。先把結果、復原資格與同一筆操作的狀態收在一處，比單純搬函式更能避免兩邊再分叉。依據：[一般登記](../../public/js/app.js#L1014)、[整群登記](../../public/js/group-stage.js#L114)、[共用佇列](../../public/js/app.js#L1520)。

本票建議限於前端共用能力與兩個入口接線；不因這份研究順便改 Worker、Apps Script、D1、同步或正式資料。下文列出的不明結果風險要被正確表達，但可靠讀回與跨重送復原保證是另一層工程，不應默默包進重構。

## 研究版本與限制

- 本機 HEAD：`a15d941659b08140c94ed1d61b8b8d1e61d27584`。
- 本機 `origin/main`：`60c3702733934a914e6da7696ec05465771aebb6`。
- 本機多出 `3373035` 與合併 commit `a15d941`。已用 `git diff --quiet HEAD origin/main -- public/js/app.js public/js/group-stage.js apps-script/sheet-write.gs worker/src/index.js worker/test/sheet-write.test.mjs tests/group-walks.cjs tests/index.html` 核對，退出碼 0；本文關鍵程式與測試在兩個 SHA 相同。
- **本次未 fetch**，`origin/main` 是本機既有的遠端追蹤參照，不能宣稱已核對 GitHub 最新 main，也未核對正式部署版本。
- 只讀取測試定義，未執行測試、未操作瀏覽器、未寫外部系統。引用行號以本機檔案為準。

## 已觀察的責任分配

| 責任 | 一般清單 | 整群頁 | 已共用的部分 |
|---|---|---|---|
| 取得要登記的狗 | 過濾已溜、空值、重複物件；缺名字先引導選名字 | 從狗群對應主清單，排除未選、休養、暫停帶出、無法唯一對應的狗；缺名字在頁面提示 | 尚未統一輸入及結果契約 |
| 等待時顯示 | 立即標成已溜，背景送出 | 保留處理中狀態，等回應才宣告成功 | 同一個送出佇列 |
| 成功判斷 | 回應後檢查本機 `mine`；未符合者退回未溜 | `true` 加每狗回應時間戳變更 | 寫入結果更新 `sheetWrites`、名字、日期、本機今日清單 |
| 部分失敗 | 成功狗保留；找不到狗顯示名字 | 顯示未全部成功，讓志工核對日期後重試 | `sheetWrite` 回布林值，不回完整操作結果 |
| 重試 | 網路／HTTP 錯誤提供失敗狗的再試一次 | 重按會重送全部選取且可登記的狗，包括先前成功狗 | Apps Script 當天已有送來名字時回 `already` |
| 同行人 | 提示條開選人視窗；選好後另送一次追加 | 沒有入口 | 同行人追加也走 `queueSheetWrite` |
| 復原 | 提示條可按，初次寫入未完成就先等 | 已溜按鈕改為復原入口 | `undoSheetWalks` 統一判斷成功、衝突與可重試狗 |

來源：[一般入口與本機備援](../../public/js/app.js#L1001)、[一般結果與重試](../../public/js/app.js#L1026)、[狗群對應與限制](../../public/js/group-stage.js#L14)、[群按鈕狀態](../../public/js/group-stage.js#L73)、[群登記與復原](../../public/js/group-stage.js#L114)、[同行人](../../public/js/app.js#L1409)、[復原](../../public/js/app.js#L1063)、[Apps Script 去重](../../apps-script/sheet-write.gs#L158)。

## 為什麼會耦合、分叉

以下是由程式得到的觀察；分叉原因包含文件佐證與推論，兩者分開列：

1. **寫入函式同時做資料與畫面工作。** `sheetWrite` 送 HTTP、讀寫 localStorage、更新狗日期與名字，還直接 `render`、顯示提示條；呼叫者不能只取得結果自行呈現。[來源](../../public/js/app.js#L1558)
2. **結果散落在共用可變狀態。** 佇列只回 `true/false/null`，細節放在 `sheetWriteFail`、`sheetWriteFailText`、`sheetWrites`、`sheetWrittenAt`；整群頁不得不再讀這些狀態組出結論。[佇列](../../public/js/app.js#L1520)、[錯誤狀態](../../public/js/app.js#L1556)、[群成功判斷](../../public/js/group-stage.js#L120)
3. **一般清單的立即顯示有明確產品決策。** 2026-10-17 因 Apps Script 等待太慢，K 決定先顯示已溜、失敗再退回；不是技術上可以任意取消的差異。[決策紀錄](../agent-log/2026-10-17-optimistic-walk.md#L5)、[程式註解](../../public/js/app.js#L998)
4. **整群頁另包了一層結果確認。** 它呼叫同一佇列，卻自行設定 pending、檢查時戳、呈現結果。推論：共同底層回應不足以直接服務兩種畫面，導致兩個入口各自補規則；不能因此推論應統一兩邊的等待畫面。[來源](../../public/js/group-stage.js#L114)

## 結果、重試與復原的精確限制

### 已有逐狗回應，前端卻壓成布林值

Apps Script 能回 `written`、`already`、`notFound`、`changed`、`restored`；同一批可同時成功及找不到狗。後端測試已明列這個組合。[實作](../../apps-script/sheet-write.gs#L143)、[測試](../../worker/test/sheet-write.test.mjs#L34)

前端對每個收到的結果更新時間戳，包含 `notFound`、`changed`，所以「有新時間戳」只代表收到結果，不等於成功；`sheetWrite` 最後只回有無 `missed`。若成功回應缺漏某狗或 `results` 為空，它沒有檢查完整性，可能回 true。Worker 也會把非陣列結果轉成空陣列後回 `ok:true`。[前端](../../public/js/app.js#L1598)、[布林回傳](../../public/js/app.js#L1638)、[Worker](../../worker/src/index.js#L943)

### 網路錯誤不代表確定沒寫

Worker 對 Apps Script 使用 20 秒逾時，連線例外回 502；前端將網路與錯誤回應視為失敗，文案稱沒寫進試算表。程式沒有在當次操作讀回確認。由此推論：若試算表已寫入、回應途中遺失，前端無法分辨「確定未寫」與「結果不明」。這個限制應由工程處理，無須 K 判斷 HTTP 的意義。[逾時常數](../../worker/src/index.js#L59)、[Worker 錯誤處理](../../worker/src/index.js#L913)、[前端處理](../../public/js/app.js#L1580)

Apps Script 用鎖避免兩個請求同時覆蓋，但寫入是逐格 `setValue`，沒有這批全有或全無的交易保證。因此也不能因整批拋錯就宣稱完全沒寫。[來源](../../apps-script/sheet-write.gs#L39)

### 重送不重複名字，不等於能找回第一次的復原資料

同一天已有名字會回 `already`，只含 `current`，沒有第一次的 `prev/wrote`。如果第一次回應遺失，本機就沒有取得原始快照；重送成功也無法由 `already` 補回。[來源](../../apps-script/sheet-write.gs#L158)、[本機快照保存](../../public/js/app.js#L1607)

因此不建議本票承諾「任何網路重試後都能完整復原」。若要這個保證，需另設計可查詢的操作識別與快照保存，涉及後端範圍，本研究不自行納入。

### 復原已有較完整的共用規則

本機必須持有今天的 `prev/wrote`；Apps Script 再比對日期與完整名字仍等於自己寫的內容，才還原。別人改過回 `changed`，不覆蓋；只有 `restored` 算成功。前端把剩餘可試狗與衝突狗分開，重試只送前者。[資格與結果](../../public/js/app.js#L1063)、[後端核對](../../apps-script/sheet-write.gs#L179)、[測試](../../worker/test/sheet-write.test.mjs#L40)

另有重新整理後讀名字、校正回應遺失之本機紀錄的機制與測試，並非當次操作自動查證，也不能補回遺失的原始快照。[校正](../../public/js/app.js#L1277)、[測試](../../tests/index.html#L3201)

## 建議的模組分工（尚未決策）

**畫面保留：** 狗群選擇、例外勾選、選名字／同行人的視窗、按鈕及提示條、焦點與動畫，以及一般清單先顯示已溜或群頁等待中的呈現差異。

**模組收進：** 固定一次操作的狗名單與名字、排隊送出、逐狗解析、結果完整性檢查、已有／新增／找不到／衝突／不明的分類、套用本機資料、保存復原資料、判斷下一步可重試或復原的狗。畫面不再讀時間戳與錯誤全域變數來猜成功。

建議的簡短介面草案，僅示意責任，不代表一定採用此命名或檔案配置：

```js
const operation = walks.register({ dogs, walker });
// 畫面拿 operation.dogs 呈現等待；完成後只讀結果。
const result = await operation.finished;
// result.dogs: [{ key, status, current, canUndo }]
// status: written | already | notFound | changed | unknown | notSent
// result.retryDogs: 明確可重試的狗；unknown 不假稱未寫。
const undone = await walks.undo(result);
```

測試與畫面應走同一個介面，用假的傳送與儲存替換真實資料存取，不另做只有測試才呼叫的核心。既有 `queueSheetWrite` 的排隊、別名分組、快照規則可收進模組；不先新增通用工作流框架。[既有分組與佇列](../../public/js/app.js#L1520)

同行人能否沿用 `register({ dogs, walker: 同行人名單 })` 要等下方產品決策後定案；它是追加別人名字，不能把「名字是否包含目前志工」誤當作追加操作是否成功。[現行同行人送出](../../public/js/app.js#L1463)、[目前 mine 計算](../../public/js/app.js#L1608)

## 應保留與驗證的既有行為

- 一般清單按下立即顯示已溜；寫入仍排隊；立即復原先等初次寫入完成。[來源](../../public/js/app.js#L1014)
- 群頁排除未選、休養、禁止帶出及無法唯一對應的狗，空群不送；不要為抽模組順便改篩選規則。[來源](../../public/js/group-stage.js#L14)
- 同一天保留既有名字、追加時不重複；同一志工別名處理保留。[後端](../../apps-script/sheet-write.gs#L158)、[前端別名分組](../../public/js/app.js#L1520)
- 復原不覆蓋別人後來的修改，失敗不能假裝成功；保留現有群頁復原入口。[來源](../../public/js/app.js#L1069)、[測試](../../tests/group-walks.cjs#L165)
- 不改試算表寫入範圍、不增加通關碼；固定志工身分與名字對照不重設。[ADR 0006](../adr/0006-sheet-write-scope.md#L7)、[ADR 0004](../adr/0004-open-editing-and-edit-log.md#L11)、[ADR 0005](../adr/0005-volunteer-identity.md#L13)
- 試算表是正本；D1 今日紀錄寫入失敗不推翻登記成功、不提示志工。[ADR 0007](../adr/0007-today-walks-live.md#L11)
- 用語維持「溜了」「復原」。[詞彙表](../../GLOSSARY.md#L135)

既有測試涵蓋群頁部分失敗後重按、復原錯誤與衝突，以及一般網路失敗重試。實作時應經共同介面驗證這些對外行為，再補缺漏逐狗結果及不明回應的情境；不要把目前布林值與時戳的內部做法當成必須保存的契約。[群頁測試](../../tests/group-walks.cjs#L72)、[復原測試](../../tests/group-walks.cjs#L165)、[一般重試測試](../../tests/index.html#L3188)

## 真正需要 K 決策的項目

以下是產品行為，不是請 K 選技術結構。若對話已有新決定，以新決定為準：

1. **整群同行人何時選？** 登記後再追加（接近現行一般清單），或登記前選好、本人與同行人同次送出。兩者影響志工操作步驟，也影響復原是一筆還是兩筆。
2. **部分成功如何呈現與繼續？** 建議明列成功數與未成功狗名，提供只處理尚未成功狗的入口；已成功狗保持已溜。需確認是否接受這個呈現，不需要 K 設計逐狗資料格式。
3. **追加同行人後按復原要取消什麼？** 只取消最後一次加人，或把這次登記連同同行人一併取消。現行快照保存偏向回到初次登記之前，應先說清楚志工期待。

技術上應自行做到：不以網路錯誤宣稱確定未寫、不將缺漏結果當成功、不覆蓋衝突、結果逐狗完整、呼叫者不依賴全域時間戳。**自動讀回、不明結果自動重送、跨重送完整復原**則先標明未承諾；若 K 要求這些能力，再釐清同票範圍及後端設計，不能假借共用模組直接擴張。
