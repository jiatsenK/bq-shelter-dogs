# 網頁測試

所有網頁套件由 `scripts/run-browser-tests.cjs` 執行；本機統一經過
`scripts/check-local.ps1`，用法見 [本機檢核](../docs/agents/local-checks.md)。
CI 的執行入口不變。

`tests/index.html` 保留測試用 DOM，依序載入 `tests/index/` 的一般 script。
這些檔案共用同一個測試頁與網站狀態，不能各自並行執行。
`bootstrap.js` 最後載入，保留原本的測試呼叫順序（包含最後才載入電腦版）。
新增測試請放進對應檔案的既有測試函式；新增函式時也要在 bootstrap 串接。

| 檔案 | 負責範圍 |
| --- | --- |
| `index/harness.js` | 斷言、結果呈現、假手機儲存空間、假 BQApi、導覽操作工具與共用原始碼變數 |
| `index/bootstrap.js` | 讀取網站原始碼與假資料、依原順序載入網站程式、執行全部測試及顯示結果 |
| `index/app-core.js` | 主頁資料解析、日期與警示、搜尋、狗卡及詳細資訊基本行為 |
| `index/app-layout.js` | 主頁版面、詳細資訊事件、名詞、頁首與範圍標示 |
| `index/startup.js` | 載入資料、失敗提示、首次畫面及開啟加速 |
| `index/photo.js` | 主照片選檔、燈箱、裁切、上傳、縮圖及照片版本 |
| `index/analysis.js` | 分析、歷史統計、資訊頁與離所名冊 |
| `index/walks.js` | 我溜過、今天已溜、排序、寫試算表及同行人 |
| `index/welcome.js` | 開頭畫面、名字確認，以及既有 V9 與 #141 溜狗回歸測試 |
| `index/tour.js` | 實際手機頁面的導覽定位及加入主畫面教學 |
| `index/rest.js` | 暫住與休養中的讀取、顯示及編輯 |
| `index/find.js` | 找狗、平面圖、同籠、搜尋及更新資料按鈕 |
| `index/favorites.js` | 我的常溜、收藏篩選與身分同步 |
| `index/cards.js` | 圖鑑、開卡與卡包 |
| `index/desk.js` | 電腦版簡報、全表及多隻登記 |
| `index/hosting.js` | Cloudflare、R2、PR 預覽及舊網址轉址契約 |

拆檔（#488）前後 `index` 套件均為 266 項通過；既有斷言、假資料、
執行順序及相對網址均保留。測試共用同一頁，因此相對網址仍以
`tests/index.html` 為基準，不能改成相對於 JS 檔案。
