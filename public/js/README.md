# 前端 JavaScript

所有前端程式使用原生 ES module，以具名 `import`／`export` 表達依賴，不需要打包工具，也不在 `window` 公開模組名稱（ADR 0017、#489）。HTML 只載入自己的 `type="module"` 入口。呼叫 `/api` 仍只經過 `api.js`。

## 頁面入口與初始化

- `index.html` → `main.js`：匯入整個主頁模組圖；模組定義與狀態初始化完成後，依原本順序呼叫 app、analysis、group-stage、find、activities 的事件綁定，再啟動 desk 與 app。循環引用只在互動時使用，事件綁定不靠 import 評估順序。頁首提前抓狗清單的內嵌程式保留，`api.js` 接手該請求。
- `cards.html` → `cards-entry.js`：載入 `cards.js` 與共用模組，再啟動圖鑑。
- `edits.html` → `edits.js`：載入共用模組，再讀取編輯紀錄。
- `groups.html` 仍轉址至主頁；保留的 `groups.js` 也改為 ES module，沒有頁面載入。

## 模組責任與依賴

下列依賴是直接匯入的前端檔案；同名 `BQ*` 介面現在是具名匯出，使用方式不變。

| 檔案 | 責任／介面 | 依賴 | 使用頁面 |
| --- | --- | --- | --- |
| `dates.js` | `BQDates`：日期解析、編號與最早入所日、本地日期鍵、台灣今天 | 無 | index、cards、Node、admin（建置複製） |
| `api.js` | `BQApi`：每個 API 端點一個函式，統一錯誤形狀，接手提前讀狗清單 | api-response | index、cards、edits |
| `api-response.js` | `settle`：純 API 回應／錯誤解析，不讀頁面狀態 | 無 | index、cards、edits、admin（建置複製） |
| `store.js` | `BQStore`：手機資料鍵、字串／JSON 讀寫與記憶體備援，可注入儲存空間 | 無 | index、cards、edits |
| `site-config.js` | `SITE`：收容所設定、警示、區域、功能開關 | 無 | index、cards |
| `page-state.js` | 各頁模組的可變狀態物件；擁有狀態的模組負責初始化，其他模組明確匯入相同實例 | 無 | index、cards、groups |
| `dog-data.js` | `parseDogsData`：將 API 狗清單整理為前端資料，不碰 DOM；Node 匯入的共用接縫 | dates | index、Node |
| `detail-editor.js` | `BQDetailEditor`：五種編輯器的草稿、儲存中、錯誤與重畫狀態 | 無 | index |
| `detail-viewport.js` | 詳細資訊編輯欄位的可見範圍 | 無 | index |
| `keyboard-viewport.js` | 螢幕鍵盤開啟時的欄位與面板定位 | 無 | index |
| `walk-registration.js` | `createWalkRegistration`：登記、同行人、復原與核對規則，純 ES module | 無 | index、Node |
| `walk-flow.js` | `BQWalks`：不碰 DOM 的排隊登記、核對、復原、提示及當日手機紀錄 | store、walk-registration（日期介面由呼叫端注入） | index、Node |
| `tour.js` | `BQTour`：導覽步驟、示範、定位、動態效果及安裝說明 | app、analysis、find、desk、welcome、store、page-state | index |
| `welcome.js` | `BQWelcome`：開頭畫面、我是誰、名字推薦／確認、更名及合併 | app、api、store、site-config、tour、walk-ui、page-state | index |
| `photo.js` | `BQPhoto`：主照片選檔、壓縮、預覽、裁切、上傳，保留內部狀態 | app、api、walk-ui、page-state | index |
| `favorites.js` | `BQFavorites`：常溜實例、舊鍵搬移、逐隻增刪、離線佇列與身分同步 | app、api、store、welcome、walk-ui、page-state | index |
| `walk-ui.js` | `BQWalkUI`：今日登記／復原的畫面、提示條、同行人、溜狗人編輯 | app、dates、walk-flow、welcome、page-state | index |
| `app.js` | 主頁資料、狗卡詳細資訊、溜狗操作與事件綁定 | 共用模組、dog-data、所有主頁功能模組、page-state | index |
| `analysis.js` | 分析、離所名冊與資訊頁 | app、dates、api、store、site-config、dog-data、activities、page-state | index |
| `activities.js` | 活動紀錄與已出所狗卡編輯 | app、analysis、dates、api、walk-ui、page-state | index |
| `find.js` | 找狗照片、搜尋與平面圖 | app、walk-ui、page-state | index |
| `group-stage.js` | 可以一起溜的狗群畫面 | app、dates、api、walk-ui、page-state | index |
| `desk.js` | 電腦版簡報、全表與側欄，明確啟動後啟用寬螢幕呈現 | app、dates、api、site-config、find、photo、walk-ui、page-state | index |
| `cards.js` | 圖鑑、開卡與已出所狗卡，保留卡片專用格式 | dates、api、store、site-config、page-state | cards |
| `edits.js` | 編輯紀錄清單 | api、store | edits |
| `groups.js` | 舊獨立狗群頁只讀 | api、page-state | 無 |

## 測試與 Node 消費者

- 網頁測試直接載入真實模組。`tests/fixtures/module-globals.js` 只在測試環境，將既有斷言需要的名稱接到模組匯出／狀態；正式頁面不載入它。`es-modules` 套件另外驗證沒有橋接時，三個正式入口與主頁互動能正常執行，且不產生舊全域名稱。
- 日期、溜狗規則與狗清單解析可直接由 Node `import`；需要隔離網路、儲存空間與時鐘的 API／store／walk-flow 測試，由 `scripts/frontend-module-test-helper.mjs` 用原生 `vm.SourceTextModule` 載入真實模組圖。Node 測試入口帶入 `--experimental-vm-modules`。
- 匯入腳本不需執行整個網頁；原先拼接主頁原始碼的同步資料測試改直接匯入 `dog-data.js`。分析信標測試以模組入口的 HTML 驗證插入位置。試算表同步排程依 #517 已退役。
- 本機測試仍統一從 `scripts/check-local.ps1` 執行，完整輸出與內容指紋留在 `.scratch/checks/`。repo 沒有 TypeScript／型別檢查入口；變更的 JS 另外做語法檢查。
