# 前端 JavaScript

一般 script 依序載入；新拆出的模組只公開一個全域名稱，最後統一改 ES module（ADR 0017）。下列依賴指其他前端檔案；呼叫 /api 只經過 api.js，DOM 由各頁使用。

- `dates.js`：`BQDates` 共用日期解析、編號與最早入所日、本地日期鍵、台灣今天及日期標記；無檔案依賴；index、cards、edits 載入。
- `api.js`：`BQApi` 後端用戶端，每個 /api 端點一個函式，非 2xx、非 JSON、斷線都回同一形狀 { ok, status, data, error, message }，並接手主頁提前讀的狗清單；網頁測試替換它假裝後端；無檔案依賴；index、cards、edits 在 dates 後載入。
- `store.js`：`BQStore` 集中所有 `bq-*` 手機資料鍵與字串／JSON 讀寫，可注入假儲存空間；無法存取時逐鍵退回記憶體，寫入／移除回傳是否存入持久儲存；無檔案依賴；index、cards、edits 在 api 後載入。
- `site-config.js`：`SITE` 收容所設定；無檔案依賴；index、cards 載入。
- `app.js`：主頁資料、狗卡詳細資訊、身分與溜狗操作；依賴 dates、api、store、site-config、detail-viewport、walk-registration，搭配後載入的頁面檔案；index 載入。
- `analysis.js`：分析、離所名冊與資訊頁；依賴 dates、api、store、app，搭配 activities；index 在 app 後載入。
- `cards.js`：圖鑑、開卡與已出所狗卡，保留卡片專用顯示格式；依賴 dates、api、store、site-config；cards 載入。
- `activities.js`：活動紀錄及已出所狗卡的編輯；依賴 dates、api、app、analysis；index 載入。
- `find.js`：找狗照片、搜尋與平面圖；依賴 app、analysis、group-stage；index 載入。
- `group-stage.js`：可以一起溜的狗群畫面；依賴 dates、api、app、analysis；index 載入。
- `desk.js`：電腦版簡報、全表與側欄；依賴 dates、api、app、analysis；index 載入。
- `detail-viewport.js`：詳細資訊編輯欄位的可見範圍；無檔案依賴；index 載入，由 app 使用。
- `keyboard-viewport.js`：螢幕鍵盤開啟時的欄位與面板定位；無檔案依賴；index 載入。
- `walk-registration.js`：溜了、同行人、復原與核對規則；無檔案依賴，由 app 注入資料操作；index 載入。
- `edits.js`：資料編輯紀錄清單；依賴 api、store；edits 載入。
- `groups.js`：舊獨立狗群頁的讀取與編輯；依賴 api、store；目前沒有頁面載入，groups.html 已轉址至 index。
