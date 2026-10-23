# 前端 JavaScript

一般 script 依序載入；新拆出的模組只公開一個全域名稱，最後統一改 ES module（ADR 0017）。下列依賴指其他前端檔案；呼叫 /api 只經過 api.js，DOM 由各頁使用。

- `dates.js`：`BQDates` 共用日期解析、編號與最早入所日、本地日期鍵、台灣今天及日期標記；無檔案依賴；index、cards、edits 載入。
- `api.js`：`BQApi` 後端用戶端，每個 /api 端點一個函式，非 2xx、非 JSON、斷線都回同一形狀 { ok, status, data, error, message }，並接手主頁提前讀的狗清單；網頁測試替換它假裝後端；無檔案依賴；index、cards、edits 在 dates 後載入。
- `store.js`：`BQStore` 集中所有 `bq-*` 手機資料鍵與字串／JSON 讀寫，可注入假儲存空間；無法存取時逐鍵退回記憶體，寫入／移除回傳是否存入持久儲存；無檔案依賴；index、cards、edits 在 api 後載入。
- `site-config.js`：`SITE` 收容所設定；無檔案依賴；index、cards 載入。
- `detail-editor.js`：詳細資訊五種編輯器共用的草稿、儲存中、錯誤與重畫狀態；由主頁注入重畫函式，驗證、API 與焦點由主頁負責；無檔案依賴；index 在 app 前載入。
- `tour.js`：`BQTour` 使用說明導覽的步驟、示範、定位、動態效果及主畫面安裝說明；透過 welcome 的開頭畫面／背景互動封鎖、app 的資料／重畫與儲存、store、analysis、find 及選配 desk 示範實際頁面；index 在 app 前載入，互動於頁面檔案載入後啟動。
- `welcome.js`：`BQWelcome` 開頭畫面、我是誰表單、名字推薦與確認、更名及合併；依賴 api、store、site-config，互動時讀取 app 的手機身分、名字清單及溜狗操作，搭配 tour、walk-ui；index 在 app 前載入。
- `photo.js`：`BQPhoto` 主照片選檔、壓縮、預覽、裁切與上傳，內部管理預覽及裁切狀態；執行時依賴 app 的詳細資訊、共用重畫狀態與照片顯示、api、walk-ui；index 在 app 前載入，desk 共用壓縮。
- `favorites.js`：`BQFavorites` 建立我的常溜實例，管理手機收藏、舊鍵搬移、逐隻增刪、離線佇列與身分同步；執行時依賴 app 的手機資料／身分／重畫、api、store、welcome、walk-ui；index 在 app 前載入。
- `app.js`：主頁資料、狗卡詳細資訊與溜狗操作；依賴 dates、api、store、site-config、detail-editor、detail-viewport、walk-flow、tour、photo、welcome、walk-ui、favorites，搭配後載入的頁面檔案；index 載入。
- `walk-ui.js`：`BQWalkUI` 今日溜狗登記與復原的畫面協調、提示條、同行人選單、溜狗人編輯及按鈕；執行時依賴 app 的資料／重畫、dates、walk-flow、welcome，其他頁面透過此名稱使用提示；index 在 app 前載入。
- `analysis.js`：分析、離所名冊與資訊頁；依賴 dates、api、store、app，搭配 activities；index 在 app 後載入。
- `cards.js`：圖鑑、開卡與已出所狗卡，保留卡片專用顯示格式；依賴 dates、api、store、site-config；cards 載入。
- `activities.js`：活動紀錄及已出所狗卡的編輯；依賴 dates、api、app、analysis、walk-ui；index 載入。
- `find.js`：找狗照片、搜尋與平面圖；依賴 app、analysis、group-stage、walk-ui，透過 app 的常溜實例使用 favorites；index 載入。
- `group-stage.js`：可以一起溜的狗群畫面；依賴 dates、api、app、analysis、walk-ui；index 載入。
- `desk.js`：電腦版簡報、全表與側欄；依賴 dates、api、app、analysis、photo、walk-ui；index 載入。
- `detail-viewport.js`：詳細資訊編輯欄位的可見範圍；無檔案依賴；index 載入，由 app 使用。
- `keyboard-viewport.js`：螢幕鍵盤開啟時的欄位與面板定位；無檔案依賴；index 載入。
- `walk-registration.js`：溜了、同行人、復原與核對規則；無檔案依賴，由 walk-flow 注入資料操作；index 載入。
- `walk-flow.js`：`BQWalks` 不碰 DOM 的寫試算表流程，串接排隊登記、同行人、今日紀錄核對、復原、失敗種類與提示，以及當日手機紀錄；依賴 dates、api、store、walk-registration；index 在 walk-registration 後、app 前載入。
- `edits.js`：資料編輯紀錄清單；依賴 api、store；edits 載入。
- `groups.js`：舊獨立狗群頁的讀取與編輯；依賴 api、store；目前沒有頁面載入，groups.html 已轉址至 index。
