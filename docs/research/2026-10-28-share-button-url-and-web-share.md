# 資訊頁「分享給其他志工」：分享網址從哪來、Web Share 的成功與取消怎麼分

日期：2026-10-28。只做研究，沒改程式。
外部資料都以一手來源為準（Cloudflare 官方文件、wrangler 與 Chromium／WebKit 原始碼、W3C 規格、MDN 與其相容性資料、Apple 文件、LINE Developers）；原始碼連結固定在查詢當下的 commit。

## 問題

手機版資訊頁要加「分享給其他志工」按鈕：支援 `navigator.share()` 就叫出系統分享選單，不支援就複製連結。分享文字是「來去板橋動物之家遛狗吧 🐕」加網址。另外每天記兩個次數：「真的分享出去」與「複製連結成功」，取消不算。

卡住的地方：#493 已定案，公開 repo 不能寫出正式網站位置（帳號的 workers.dev 子網域放在 GitHub Secret `WORKERS_SUBDOMAIN`，`scripts/public-repo.test.mjs` 會擋）。可是同一份前端也跑在測試網站與 PR 預覽上，前端直接用 `location.origin` 的話，在那兩個地方按分享會傳出測試網址。

- A. 前端直接用 `location.origin`。
- B. 部署時從 Secret 把正式網址帶給 Worker，前端向 API 拿，或 Worker 回應 HTML 時插進去。

## repo 現況

- 正式網站 `wrangler.jsonc`：`run_worker_first` 只有 `/api/*`、`/api`、`/photos/*`，**網頁本身不經過 Worker**，直接由靜態資產送出；`preview_urls: false`、`keep_vars: false`；`vars` 沒有任何網址。
- 測試網站 `wrangler.test-site.jsonc`：`vars.SITE_ENV = "test"`，而且 `run_worker_first` 加了 `/`、`/index.html` 等頁面，讓 `worker/src/test-site.js` 把網頁換成紫色測試版（`<html data-site="test">`）。
- PR 預覽 `.github/workflows/preview-cloudflare.yml`：上傳到獨立 Worker `bq-shelter-dogs-preview`，`wrangler versions upload --preview-alias "pr-${PR}" --var PREVIEW:1`；網址格式 `https://pr-<PR 編號>-bq-shelter-dogs-preview.<子網域>.workers.dev`。Worker 已經用 `env.PREVIEW` 擋寫入（`worker/src/index.js:846`「預覽版，不能存」）。
- 正式部署 `.github/workflows/deploy-cloudflare.yml`：密碼用 `--secrets-file` 帶上；部署後的 API 檢查網址用 `https://bq-shelter-dogs.${WORKERS_SUBDOMAIN}.workers.dev` 組出來。
- **已經有先例**：管理網站 `.github/workflows/deploy-admin.yml` 把 `SITE_URL`、`TEST_SITE_URL`、`ADMIN_ORIGIN` 從 `WORKERS_SUBDOMAIN` 組出，用 `wrangler deploy --var` 帶上（#493，見 `docs/agent-log/2026-10-26-493-public-subdomain.md`）。
- `public/js/site-config.js` 只放收容所名稱、分區這類設定，沒有網址。

所以 Worker 執行時**已經分得出三個地方**：正式（`SITE_ENV`、`PREVIEW` 都沒設）、測試網站（`SITE_ENV=test`）、PR 預覽（`PREVIEW=1`）。缺的只是「正式網址」這個值。

## 發現

### 1. secret／vars 怎麼在部署時帶上，會不會外流

- **vars 是明文設定**：官方文件說文字與 JSON 的環境變數「不加密」，不要拿來放敏感資料；secret 設定後在 Wrangler 與主控台都看不到值，但在程式裡 secret 跟 vars 用起來一樣（`env.X`）。
  - https://developers.cloudflare.com/workers/configuration/environment-variables/
  - https://developers.cloudflare.com/workers/configuration/secrets/
- **帶上去的方式**：`wrangler deploy` 與 `wrangler versions upload` 都有 `--var key:value`（「注入成程式裡的變數」）與 `--secrets-file`（JSON 或 .env，檔案裡沒有的 secret 保留上一版的值）；`keep_vars` 沒設時，下次部署會蓋掉在主控台改的 vars。
  - https://developers.cloudflare.com/workers/wrangler/commands/workers/
  - https://developers.cloudflare.com/workers/configuration/secrets/
- **wrangler 輸出會不會印出值**：部署時 wrangler 會列出「Worker 可以用的綁定」。原始碼裡，設定檔 `vars` 的明文值會印出來（超過 40 字截斷）；`--var` 帶進來的值會被標成 `hidden: true`，印成 `"(hidden)"`；secret 也印成 `"(hidden)"`。
  - `--var` 標成隱藏：https://github.com/cloudflare/workers-sdk/blob/ec6edddadd8395b4991b23c5300ea68b701ce720/packages/deploy-helpers/src/deploy/deploy.ts#L331-L337
  - 印出規則：https://github.com/cloudflare/workers-sdk/blob/ec6edddadd8395b4991b23c5300ea68b701ce720/packages/workers-utils/src/print-bindings.ts#L750-L766
  - 本 repo 實測：管理網站 10/28 16:10 的部署日誌（run 40654893123）裡，`env.SITE_URL`、`env.TEST_SITE_URL`、`env.ADMIN_ORIGIN` 三行都是 `("(hidden)")`；工作流程自己的 env 行裡子網域顯示成 `***`。
  - 注意：`hidden` 在原始碼註解標為已淘汰（「之後敏感變數應該改用 `secret_text`」），未來 wrangler 版本可能改變。本 repo 有釘 `wrangler@4`，但不是固定小版本。
- **GitHub Actions 的遮罩**：Secret 原值出現在日誌會被換成 `***`，但只比對完全相同的字串；轉換過（Base64、URL 編碼）或包在結構化資料裡的值不保證遮得到，由 Secret 組出的新值要另外登記。我們組出的網址裡子網域是原樣，所以會被遮；這也是 #493 已經依賴的機制。
  - https://docs.github.com/en/actions/reference/security/secure-use
  - https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets
- **會不會進 repo**：不會。`--var` 的值只在 workflow 執行時從 Secret 組出，repo 裡只有 `${WORKERS_SUBDOMAIN}`，`public-repo.test.mjs` 允許這種佔位寫法。
- **執行時是公開的**：帶進 Worker 以後，只要 API 回給前端，任何人打開網站都看得到。這不違反 #493（它管的是 repo 與公開紀錄，正式網站本來就要讓志工打開）。

### 2. Worker 執行時能不能知道自己是哪個環境

- **request.url**：Worker 收到的 `Request` 有 `url`（https://developers.cloudflare.com/workers/runtime-apis/request/）。從主機名稱可以看出是哪個 Worker，但要比對主機名稱就得知道子網域，等於又要帶設定，不如直接用現有的 vars。
- **預覽網址格式**：版本網址 `<版本前綴>-<Worker 名稱>.<子網域>.workers.dev`；有別名的是 `<別名>-<Worker 名稱>.<子網域>.workers.dev`（`versions upload --preview-alias`）。預覽網址「沿用該版本既有的設定與資源，不另建環境」；只在 workers.dev 上提供，而且預覽網址的 log 用 `wrangler tail` 看不到。
  - https://developers.cloudflare.com/workers/configuration/previews/
- **版本資訊綁定（version metadata）**：只提供版本 `id`、`tag`、`timestamp`，文件沒說能分辨正式或預覽，也不提供主機名稱。本 repo 預覽上傳時有 `--tag "pr-<編號>"`，理論上可用 tag 判斷，但已經有 `PREVIEW` 了，不需要。
  - https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/
- **結論**：本 repo 已經靠 vars 分得出來（`SITE_ENV=test`、`PREVIEW=1`），不用另外判斷。

### 3. `navigator.share()` 支援度

依 MDN 相容性資料（browser-compat-data，`api.Navigator.share`）：
- Android Chrome 61 起支援；iOS Safari 跟 Safari 一樣 12.1 起支援；桌機 Chrome 128 起全平台（89–127 只有 Windows、ChromeOS）；Firefox 桌機要手動開設定，Firefox Android 79 起。
- **Android WebView：不支援**（`webview_android: false`，Chromium 追蹤票 https://crbug.com/40540400）。iOS 的 WKWebView 跟 Safari 一樣。
  - https://github.com/mdn/browser-compat-data/blob/main/api/Navigator.json
  - https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share
- **只能在安全來源（HTTPS）、要在使用者操作（例如點按鈕）裡呼叫**，否則回 `NotAllowedError`；受 `web-share` 權限政策控制，預設只准同源，iframe 要 `allow="web-share"`。
  - https://w3c.github.io/web-share/
  - https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share
- **LINE 內建瀏覽器：查無一手來源。**
  - LINE Developers 只寫到 LIFF 瀏覽器：iOS 用 WKWebView、Android 用 Android WebView，功能「依這兩者的規格」，並列出不支援的項目（theme-color、download 屬性、加到主畫面、Service Worker），沒提到 Web Share 或剪貼簿。https://developers.line.biz/en/docs/liff/overview/ 、https://developers.line.biz/en/docs/liff/differences-between-liff-browser-and-external-browser/
  - 一般聊天室連結開啟的「LINE 內建瀏覽器」，LINE 只說它「算一種外部瀏覽器」，**沒寫底層用什麼引擎**，也沒提 Web Share。https://developers.line.biz/en/docs/liff/differences-between-liff-browser-and-line-in-app-browser/
  - 推論（不是一手資料）：如果 LINE 內建瀏覽器在 Android 也是 Android WebView，依上面的相容性資料會沒有 `navigator.share`，就會走複製連結；iOS 若是 WKWebView 則可能可以分享。要靠實機確認。

### 4. 能不能分辨「真的分享出去」與「取消」

- **規格**：分享資料交給使用者選的分享對象後就算成功並 resolve；規格把它定為「送出就不管」（fire and forget），**不等對象接受或拒絕**，之後的錯誤由對象自己處理。如果確認不了對象有沒有收到，交給作業系統就 resolve。使用者取消或沒有可用的對象 → `AbortError`；沒有使用者操作或被權限政策擋 → `NotAllowedError`；已經有一個分享在進行 → `InvalidStateError`；對象啟動失敗 → `DataError`；資料不合法 → `TypeError`。
  - https://w3c.github.io/web-share/
  - https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share（「Windows 上分享視窗出現就 resolve；Android 上資料交給分享對象就 resolve」）
- **Android Chrome（原始碼）**：使用者在系統選單**選了一個 App** 就回 `OK`（resolve），選單被關掉才回 `CANCELED`（AbortError）。所以選了 LINE 之後在 LINE 裡沒按送出，網頁這邊仍是成功。
  - https://github.com/chromium/chromium/blob/58d786a70944808688eb8571db6c00fa6566e307/components/browser_ui/webshare/android/java/src/org/chromium/components/browser_ui/webshare/ShareServiceImpl.java#L194-L212
- **iOS Safari（原始碼＋Apple 文件）**：WebKit 用 `UIActivityViewController`，把完成回呼的 `completed` 當成分享成功與否。Apple 文件：`completed` 是「服務有執行為 true，沒執行為 false」，使用者沒選服務就關掉也是 false。所以 iOS 比 Android 嚴一點：分享到別的 App 時，要看那個 App 的分享擴充功能是完成還是取消；選單裡的「拷貝」也算執行成功。
  - https://github.com/WebKit/WebKit/blob/a600a306f3d1287edb4b5cd07e58a5a7b4ca4401/Source/WebKit/UIProcess/Cocoa/WKShareSheet.mm#L397-L404
  - https://developer.apple.com/documentation/uikit/uiactivityviewcontroller/completionwithitemshandler-swift.typealias
- **結論**：`AbortError` 可以當成「取消」不計；resolve 只能當成「**選了分享對象**」，Android 上不代表訊息真的送出，iOS 稍接近但也取決於對方 App。網頁端沒有任何方法知道對方有沒有按送出。

### 5. 複製連結的條件

- `navigator.clipboard.writeText()` 只能在安全來源用；不准寫入時回 `NotAllowedError`，成功時在剪貼簿更新後 resolve。
  - https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText
- 使用者操作：Chromium 107 起要在使用者操作裡呼叫，或使用者給過 `clipboard-write` 權限；Firefox、Safari 一律要在使用者操作裡呼叫，而且不支援 `clipboard-write` 權限。
  - https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API （Security considerations）
  - https://github.com/mdn/browser-compat-data/blob/main/api/Clipboard.json
- 實作含意：點按鈕時要**直接**呼叫 `share()`／`writeText()`，不要先 `await fetch` 拿網址再呼叫，否則使用者操作可能已經失效（`share()` 也會消耗掉這次操作）。網址要在頁面載入時先拿好。若在 WebView 裡 `writeText` 也失敗，最後一層退路是把網址顯示出來讓人長按複製。

## A／B 比較

| | A. 前端 `location.origin` | B1. Worker 帶正式網址，前端向 API 拿 | B2. Worker 回應 HTML 時插進去 |
|---|---|---|---|
| 正式網站 | 正確 | 正確 | 正確，但正式網頁目前不經過 Worker，要把頁面加進 `run_worker_first` |
| 測試網站／PR 預覽 | **傳出測試網址**（PR 預覽網址還含 PR 編號、會失效） | 傳出正式網址 | 傳出正式網址 |
| repo 會不會出現子網域 | 不會 | 不會（`--var` 從 Secret 組） | 不會 |
| 日誌 | 無 | `--var` 值印成 `(hidden)`，子網域另有 `***` 遮罩；已在管理網站實測 | 同 B1 |
| 改動範圍 | 只有前端 | 前端＋一個 API 欄位＋測試網站部署、預覽上傳多一個 `--var` | 同 B1，再加正式網站每次開頁都跑 Worker |
| 成本／風險 | 無 | 幾乎沒有：正式網站可以不帶 var，Worker 用 request 的 origin 當預設 | 靜態資產免費且不限量；改成先跑 Worker 後算 Worker 請求，免費方案超過額度時回 429，不會退回靜態檔 |

B2 的成本來源：https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/

## 推薦做法

**B1：Worker 提供分享網址，前端向 API 拿；正式網站不用改部署。**

1. Worker 在既有 API 回應（或一個很小的設定欄位）回傳 `shareUrl = env.SHARE_URL || 請求本身的 origin`。正式網站不設 `SHARE_URL`，自然回正式網址。
2. 測試網站部署（`deploy-test-site.yml`）與 PR 預覽上傳（`preview-cloudflare.yml`）多帶 `--var "SHARE_URL:https://bq-shelter-dogs.${WORKERS_SUBDOMAIN}.workers.dev"`，跟管理網站 `SITE_URL` 同一種做法。
3. 前端頁面載入時就拿好 `shareUrl`；沒拿到（API 失敗）才用 `location.origin` 當退路。按鈕點下時直接呼叫 `navigator.share({ text, url })`，沒有 `navigator.share` 才走 `clipboard.writeText`。
4. 計數：`share()` resolve 記「分享」、`writeText()` resolve 記「複製」；`AbortError` 不記，其他錯誤也不記（可以改走複製）。PR 預覽本來就擋寫入，計數 API 在預覽版應直接略過；測試網站有自己的 D1，記在那裡不影響正式。

理由：
- 測試網站與預覽版不會把測試網址傳給志工，這是 A 做不到的。
- 不碰 #493：repo 只有 `${WORKERS_SUBDOMAIN}`；`--var` 在 wrangler 輸出是 `(hidden)`，而且管理網站已經用同一種方式上線並驗過日誌。
- 不碰正式網站的載入路徑：B2 要讓正式網頁每次都經過 Worker，多吃 Worker 請求額度，超額時整頁回 429，代價跟風險都比 B1 大。
- 正式網站部署不必改，出錯面最小。

## 仍不確定的地方

- **LINE 內建瀏覽器有沒有 `navigator.share`、`clipboard.writeText` 能不能用：查無一手來源**，要用 iOS 與 Android 實機在 LINE 裡打開測。上面「Android 可能沒有」只是由 Android WebView 相容性資料推論。
- 「真的分享出去」的次數只能做到「選了分享對象」：Android 選了 App 就算，不代表在 LINE 裡按了送出；iOS 依對方 App 的分享擴充功能回報。報表或文案應該寫成「按了分享並選了對象」，不要寫成「已送出」。
- iOS 與 Android 的成功定義不同，兩個平台的數字不能直接比較。
- wrangler 對 `--var` 的 `(hidden)` 處理在原始碼裡標為已淘汰；若之後 wrangler 改成印出明文，日誌裡的子網域仍會被 GitHub 遮成 `***`，但只剩這一層保護。之後升 wrangler 大版本時要再看一次部署日誌。
- 使用者操作的有效時間由瀏覽器決定（規格沒定死），所以點擊後不能先等網路請求；本研究沒有實測各平台的時間長短。
- 測試網站上的分享是否也該記次數、要不要分開看，留給實作票決定。
