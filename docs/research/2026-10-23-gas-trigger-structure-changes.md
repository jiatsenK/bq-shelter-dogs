# GAS 觸發器對試算表結構變動的行為

日期：2026-10-23（台灣）。分支 `docs/498-consolidate`。只讀官方文件，未實測、未改程式。目的：決定 GAS 在換籠（改籠位格）與離所（主清單整列移到「已出所」分頁）時要送什麼給 Worker，且只傳改動部分。

來源：
- [事件物件](https://developers.google.com/apps-script/guides/triggers/events)（下稱「事件」）
- [簡易觸發器](https://developers.google.com/apps-script/guides/triggers)（下稱「簡易」）
- [安裝型觸發器](https://developers.google.com/apps-script/guides/triggers/installable)（下稱「安裝型」）
- [配額](https://developers.google.com/apps-script/guides/services/quotas)

本次未在 issuetracker.google.com 找到可引用的條目；下表凡官方沒寫的都標「需實測」。

## 官方明說的事

1. **onEdit**：「使用者修改試算表中的值」時執行。事件欄位有 `authMode`、`range`、`source`、`triggerUid`、`user`、`value`、`oldValue`。`value`／`oldValue` **只在單格編輯時提供**；多格編輯時沒有，要用 `range` 判斷改了哪些格。[事件](https://developers.google.com/apps-script/guides/triggers/events)、[安裝型](https://developers.google.com/apps-script/guides/triggers/installable)
2. **onChange**：只有安裝型。「使用者修改試算表本身的結構」時執行，例如新增工作表、刪欄。欄位只有 `authMode`、`changeType`、`source`、`triggerUid`、`user`，**沒有 `range`／`value`／`oldValue`**。`changeType` 可能值：`EDIT`、`INSERT_ROW`、`INSERT_COLUMN`、`REMOVE_ROW`、`REMOVE_COLUMN`、`INSERT_GRID`、`REMOVE_GRID`、`FORMAT`、`OTHER`。[事件](https://developers.google.com/apps-script/guides/triggers/events)、[安裝型](https://developers.google.com/apps-script/guides/triggers/installable)
3. **腳本與 API 寫入不觸發**：「Script executions and API requests don't cause triggers to run」，例如 `Range.setValue()` 不會觸發 onEdit。[簡易](https://developers.google.com/apps-script/guides/triggers)、[安裝型](https://developers.google.com/apps-script/guides/triggers/installable)
4. **會漏**：簡易 onEdit 最多只排隊 2 個事件，快速連續編輯可能丟失。[簡易](https://developers.google.com/apps-script/guides/triggers)（安裝型是否同限：需實測）
5. **失敗不重跑**：安裝型函式丟例外時畫面不顯示，Apps Script 以 email 寄失敗摘要；文件沒有提到自動重試。[安裝型](https://developers.google.com/apps-script/guides/triggers/installable)
6. **配額**：觸發器每日總執行時間 消費者帳號 90 分鐘／Workspace 6 小時；單次 6 分鐘；每人每腳本 20 個觸發器；UrlFetch 每日 20,000／100,000 次。超過每日執行時間即拋錯，該次事件等於遺失。[配額](https://developers.google.com/apps-script/guides/services/quotas)
7. **分頁**：`e.source` 是 Spreadsheet 物件（整份檔，不是分頁）。onEdit 可用 `e.range.getSheet()` 取得分頁；onChange 沒有 range，官方未說明如何得知哪個分頁。[事件](https://developers.google.com/apps-script/guides/triggers/events)

## 動作 × 觸發器

| 動作 | onEdit 是否觸發 | onChange 是否觸發／changeType | 事件資訊 | 來源／需實測 |
|---|---|---|---|---|
| 改單一儲存格 | 是 | 是否也觸發、是否為 `EDIT`：需實測 | onEdit 有 `range`、`value`、`oldValue`（單格） | onEdit：官方明說；onChange 部分需實測 |
| 多格貼上 | 推定是（值改變） | 需實測（推定 `EDIT`） | onEdit 只有 `range`，無 value／oldValue | 多格無 value 為官方明說；是否單一事件涵蓋全部範圍需實測 |
| 清空多格（Delete） | 需實測 | 需實測 | 若觸發，只有 `range` | 需實測 |
| 整列剪下貼到另一分頁 | 需實測（目的分頁貼上、來源列變空，可能一或兩個事件） | 需實測 | 來源格是否出現在任何事件的 range 中：需實測 | 全部需實測 |
| 刪除整列 | 需實測（推定否） | 推定 `REMOVE_ROW`（官方列出此值，但未對應到具體操作） | onChange 無 range：**不知道刪了哪一列** | changeType 存在為官方；對應關係需實測 |
| 插入列 | 需實測（推定否） | 推定 `INSERT_ROW` | 同上，無位置 | 需實測 |
| 排序範圍 | 需實測 | 需實測（可能 `EDIT` 或 `OTHER`） | 官方未說 | 全部需實測 |
| Ctrl+Z 復原 | 需實測 | 需實測 | 單格復原是否帶 oldValue 需實測 | 全部需實測 |
| 新增／刪除分頁 | 否（非值） | `INSERT_GRID`／`REMOVE_GRID`（推定） | 無分頁名稱 | 需實測 |
| 腳本或 API 寫入 | 否 | 否 | — | 官方明說 |

## 對換籠與離所偵測的建議

1. **不要依賴事件內容推出「哪隻狗變了」**。onChange 沒有 range，onEdit 多格時沒有值，剪下／刪除列的來源位置可能完全拿不到。事件只當「喚醒」。
2. **onEdit**：若 `e.range.getSheet()` 是主清單或「已出所」，且 range 和籠位欄或編號欄有交集，就讀該 range 對應列的「編號＋籠位」兩欄送出（只送受影響列，不讀整張表）。
3. **onChange**：遇 `REMOVE_ROW`、`INSERT_ROW`、`OTHER`、`EDIT`（且無對應 onEdit）時，送**主清單整欄編號＋籠位兩欄**（以及必要時「已出所」的編號欄）。Worker 以編號集合比對 D1：主清單少了、出現在已出所 → 離所；籠位不同 → 換籠。兩欄資料量遠小於整張表，又不需知道列位置，能涵蓋剪下、刪除、排序、復原。
4. **補漏**：觸發器會漏（排隊上限、失敗不重跑、配額用完），保留既有每日保險掃描。送出失敗時在 GAS 存待通知旗標，下次觸發一併補送。
5. **防誤判**：剪下貼上可能分兩個事件，中間狀態「主清單沒有、已出所也還沒有」。Worker 不應立刻把「從主清單消失」當離所確認，應等已出所出現該編號，或延遲後再確認。

## 需實測清單

在測試用複本裝安裝型 onEdit 與 onChange，各自把 `e.changeType`、`e.range?.getA1Notation()`、`e.range?.getSheet().getName()`、`e.value`、`e.oldValue`、時間記進記錄分頁，逐項操作：

1. 改單一格：onChange 是否也觸發、changeType 為何。
2. 多格貼上：onEdit 觸發次數與 range 是否涵蓋全部；onChange changeType。
3. 選取多格按 Delete：兩者是否觸發。
4. 整列 Ctrl+X → 貼到「已出所」：事件次數、順序、各自 range 與分頁；來源列是被清空還是不變。
5. 刪除整列、插入列：onEdit 是否觸發；changeType 是否為 `REMOVE_ROW`／`INSERT_ROW`。
6. 資料 → 排序範圍：onEdit／onChange 是否觸發及 changeType。
7. Ctrl+Z 復原上述各操作：是否觸發、單格是否帶 value／oldValue。
8. 快速連續改 5 格：安裝型 onEdit 是否漏事件。
9. 手機 App 做第 1、4、5 項：行為是否與網頁版一致。
10. onChange 中 `e.source.getActiveSheet()` 是否可靠指向被改的分頁（官方未保證）。
