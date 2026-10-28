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
| `dates.js` | `BQDates`：日期解析、編號日期（`idDay`）與最早入所日、只有編號的狗排出入所表（`stayRows`，#639）、本地日期鍵、台灣今天 | 無 | index、cards、Node、admin（建置複製） |
| `api.js` | `BQApi`：每個 API 端點一個函式，統一錯誤形狀，接手提前讀狗清單 | api-response | index、cards、edits |
| `api-response.js` | `settle`：純 API 回應／錯誤解析，不讀頁面狀態 | 無 | index、cards、edits、admin（建置複製） |
| `feature-settings.js` | 志工功能設定、載入與 fail-closed UI gate；初始化／手動更新讀取，不輪詢。匯出 `SETTING_KEYS`，與後端、管理網站、D1 初始值的鍵名由 `scripts/feature-setting-keys.test.mjs` 比對 | api | index、edits、Node |
| `store.js` | `BQStore`：手機資料鍵、字串／JSON 讀寫與記憶體備援，可注入儲存空間 | 無 | index、cards、edits |
| `site-config.js` | `SITE`：收容所設定、警示、區域 | 無 | index、cards |
| `page-state.js` | 各頁模組的可變狀態物件；擁有狀態的模組負責初始化，其他模組明確匯入相同實例 | 無 | index、cards、groups |
| `dog-data.js` | `parseDogsData`：將 API 狗清單整理為前端資料，不碰 DOM；Node 匯入的共用接縫 | dates | index、Node |
| `ui-kit.js` | HTML 跳脫、圖示、備註標示、日期文字、搜尋比對；純函式 | 無 | index、Node |
| `dog-status.js` | `walkKey`、警示關鍵字、天數色標（`dogStatus`）、休養判斷（`restFrom`）與溜狗表排序（`sortDue`）；今天的登記狀態與休養設定由呼叫端帶入，app.js 的 `computeStatus`／`dueDogs`／`restOf` 是帶好狀態的包裝 | dates、site-config | index、Node |
| `detail-editor.js` | `BQDetailEditor`：四種編輯器的草稿、儲存中、錯誤與重畫狀態 | 無 | index |
| `detail.js` | 詳細資訊的畫面總控：內容（在所／離所）、同籠與可以一起溜、按鈕分派（`DETAIL_CLICKS`）、`renderDetail`／`showDetail`／`hideDetail`／`closeDetail` 與焦點還原；換狗或關閉時由 `leaveDetailDog` 收掉暫時狀態，儲存中的編輯留著 | app、overlays、各 `detail-*.js`、sheet-append、ui-kit、dog-status、dates、detail-editor、detail-viewport、photo、walk-ui、find、analysis、feature-settings、page-state | index |
| `detail-rest.js` | 休養中說明與休養設定編輯器（開、改、存、結束、取消、輸入） | app、detail、api、dates、ui-kit、walk-ui、feature-settings、page-state | index |
| `detail-fixed-care.js` | 有人固定照顧開關與每隻狗的儲存狀態 | app、detail、api、ui-kit、walk-ui、feature-settings、page-state | index |
| `detail-intro.js` | 出入所紀錄＋介紹那一段：介紹原文照顯示（ADR 0022）、介紹編輯器（一個文字框）、剛存好的介紹 | app、detail、detail-stays、api、ui-kit、walk-ui、feature-settings、page-state | index |
| `detail-stays.js` | 出入所紀錄（#639，ADR 0021）：閱讀時一行一件事（`staysView`，只列出入所表）、編輯表（每列編號可空；補、刪舊編號就是增、刪一列；手填離所原因；檢查、存） | app、detail、api、dates、ui-kit、walk-ui、feature-settings、page-state | index |
| `sheet-append.js` | 加備註（詳細資訊）與新增異動紀錄（電腦版右欄）：預覽、送出與整頁事件委派 | app、detail、api、dates、ui-kit、walk-ui、page-state | index |
| `detail-viewport.js` | 詳細資訊編輯欄位的可見範圍 | 無 | index |
| `keyboard-viewport.js` | 螢幕鍵盤開啟時的欄位與面板定位 | 無 | index |
| `overlays.js` | 返回鍵與焦點圈：覆蓋層（平面圖放大、裁切、燈箱、在哪、詳細資訊）註冊怎麼判斷開著／怎麼關，按返回的關閉順序集中在 `BACK_ORDER`；開一層、關一層、換掉歷史紀錄、頁籤／資訊子頁的歷史紀錄、`trapFocus` | 無 | index、cards、Node |
| `walk-registration.js` | `createWalkRegistration`：D1 接受流程的登記、同行人、復原與今日紀錄核對規則，純 ES module（#558 起沒有寫回試算表的舊路徑） | 無 | index、Node |
| `walk-flow.js` | `BQWalks`：不碰 DOM 的排隊登記、核對、復原、提示及同行人手機紀錄 | store、walk-registration（日期介面由呼叫端注入） | index、Node |
| `identity.js` | 志工身分：`identityRequest`（/identity 請求與錯誤）、`refreshIdentity`（用登記名字換最新的名字與代號；送出前後手機上的名字和代號都沒變才存，不然回 `changed`）。設定名字、常溜同步、圖鑑共用，各頁的讀、存與被改過時的反應由呼叫端帶入 | api | index、cards、Node |
| `tour.js` | `BQTour`：導覽步驟、示範、定位、動態效果及安裝說明 | app、detail、ui-kit、analysis、find、desk、welcome、store、page-state | index |
| `welcome.js` | `BQWelcome`：開頭畫面、我是誰、名字推薦／確認、更名及合併 | app、identity、ui-kit、store、site-config、tour、walk-ui、page-state | index |
| `photo.js` | `BQPhoto`：主照片選檔、壓縮、預覽、裁切、上傳，保留內部狀態 | app、detail、ui-kit、api、walk-ui、photo-images、overlays、page-state | index |
| `photo-images.js` | 裁切結果轉成上傳用的原圖與縮圖 | 無 | index、admin（建置複製） |
| `favorites.js` | `BQFavorites`：常溜實例、舊鍵搬移、逐隻增刪、離線佇列與身分同步；切回網頁 5 分鐘內不重抓 | app、detail、dog-status、api、store、identity、walk-ui、page-state | index |
| `walk-ui.js` | `BQWalkUI`：今日登記／復原的畫面、提示條、同行人、溜狗人編輯 | app、detail、ui-kit、dog-status、dates、walk-flow、welcome、page-state | index |
| `app.js` | 主頁資料、狗卡、燈箱、頁籤、溜狗操作與整頁事件綁定；詳細資訊在 detail.js；返回鍵交給 overlays.js，app.js 只處理都沒開覆蓋層時的頁籤切換 | 共用模組、dog-data、所有主頁功能模組、page-state | index |
| `analysis.js` | 分析、離所名冊與資訊頁 | app、detail、ui-kit、dates、api、site-config、dog-data、activities、overlays、page-state | index |
| `activities.js` | 活動紀錄與已出所狗卡編輯 | app、ui-kit、analysis、dates、api、walk-ui、page-state | index |
| `find.js` | 找狗照片、搜尋與平面圖 | app、detail、ui-kit、dog-status、walk-ui、overlays、page-state | index |
| `group-stage.js` | 可以一起溜的狗群畫面 | app、detail、ui-kit、dog-status、dates、api、walk-ui、page-state | index |
| `desk.js` | 電腦版簡報、全表／最近 30 天與側欄，明確啟動後啟用寬螢幕呈現；補資料由管理網站取代（#568） | app、detail、sheet-append、ui-kit、dog-status、dates、api、site-config、find、walk-ui、page-state | index |
| `cards.js` | 圖鑑、開卡與已出所狗卡，保留卡片專用格式 | dates、api、store、site-config、overlays、identity、page-state | cards |
| `edit-values.js` | `editsValue`：編輯紀錄改前／改後的文字，純函式 | 無 | edits、admin（建置複製） |
| `edits.js` | 編輯紀錄清單 | api、store、edit-values | edits |
| `groups.js` | 舊獨立狗群頁只讀 | api、page-state | 無 |

## 測試與 Node 消費者

- 網頁測試直接載入真實模組。`tests/fixtures/module-globals.js` 只在測試環境，將既有斷言需要的名稱接到模組匯出／狀態；正式頁面不載入它。`es-modules` 套件另外驗證沒有橋接時，三個正式入口與主頁互動能正常執行，且不產生舊全域名稱。
- 日期、溜狗規則、天數色標與排序（`dog-status.js`、`scripts/dog-status.test.mjs`）、小工具（`ui-kit.js`）與狗清單解析可直接由 Node `import`；需要隔離網路、儲存空間與時鐘的 API／store／walk-flow 測試，由 `scripts/frontend-module-test-helper.mjs` 用原生 `vm.SourceTextModule` 載入真實模組圖。Node 測試入口帶入 `--experimental-vm-modules`。
- 主頁有循環引用（app.js 與多個功能模組互相匯入），其他模組會先於 app.js 執行。頂層呼叫 app.js 的函式宣告沒問題（已提升），讀 app.js 的 `const`／`let` 會在載入時丟錯；`es-modules` 套件載入正式入口時會攔下，失敗訊息第一行印出頁面錯誤。
- `scripts/frontend-modules.test.mjs` 只讀原始碼：每個 `import { … } from './x.js'` 的名稱都要在 x.js 匯出、`public/js` 每支檔都要列在本表；拆檔搬函式時漏改的匯入在 Node 就擋下。詳細資訊拆檔（#623 R4）後，`tests/index/bootstrap.js` 的 `APP_JS` 是 app.js 加上 detail*.js、sheet-append.js 的原始碼，原有原始碼檢查照樣涵蓋搬走的程式。
- `scripts/overlays.test.mjs` 用假的 history 驗返回鍵關閉順序、開關一層與焦點圈（#623 R6）；`frontend-modules.test.mjs` 另外擋 overlays.js 以外的模組直接改歷史紀錄、自己接返回鍵或自己寫焦點圈。
- `scripts/identity.test.mjs` 用假的 fetch 驗志工身分更新：沒被改過才存、中途被改過回 changed、錯誤訊息（#623 R8）。
- 匯入腳本不需執行整個網頁；原先拼接主頁原始碼的同步資料測試改直接匯入 `dog-data.js`。分析信標測試以模組入口的 HTML 驗證插入位置。試算表同步排程依 #517 已退役。
- 本機測試仍統一從 `scripts/check-local.ps1` 執行，完整輸出與內容指紋留在 `.scratch/checks/`。repo 沒有 TypeScript／型別檢查入口；變更的 JS 另外做語法檢查。
