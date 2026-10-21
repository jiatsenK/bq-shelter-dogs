# 更新紀錄「不用每次讀」：其他 App 的做法與套到本專案（#421）

2026-10-21（台灣時間）。接續 Issue #421、PR #452（`origin/claude/421-update-cache`）與本機分支 `origin/local/421`。
只讀：沒有改程式、沒有寫 D1。來源以 MDN、web.dev、RFC 9111、Cloudflare 官方文件為主；連結是撰寫時的版本，本次沒有逐頁重新抓取比對內容，引用前請點開確認。

## 結論（白話）

- K 說「其他 App 都不需要每次讀」，通常是兩件事疊在一起：**畫面先顯示上次的內容**（快取在手機上），加上**問伺服器「有沒有變」只花很小的成本**（ETag／304 或「只拿某筆之後的新資料」）。只做第一件，伺服器端的讀取一列都沒省。
- 本專案**不用 localStorage 也能做到「App 重開不必整份重讀」**：把 `/api/edits` 從 `Cache-Control: no-store` 改成 `no-cache` + `ETag`，手機瀏覽器自己的 HTTP 快取會跨重開保存內容，重開時只問一次、沒變就回 304。這不碰 #59「分析程式只讀」測試，也不違背 #419「只用記憶體」的決定（那是頁面程式自己存的資料，HTTP 快取由瀏覽器管）。
- D1 讀取：現在每次打開更新紀錄 `readEdits` 讀 **200 列**；改成 ETag（先查最大 id，約 1 列）後，沒有新編輯時約 **1 列**，有新編輯時 1 + 200 列。網站更新（`website-updates.json`）是靜態檔，**本來就 0 列 D1**，Cloudflare 靜態資源預設已帶 ETag，可回 304。
- **建議**：#421 先合 PR #452 的記憶體做法（同頁切回不重讀），另開一張小票做 `/api/edits` 的 ETag／304。localStorage（`local/421`）不建議，除非 K 決定放寬 #59。是否接受「最多 N 秒看到舊資料」的 Cloudflare 邊緣快取，要 K 決定。

## 1. 一般 App／網站怎麼做到「不用每次讀」

| 做法 | 做什麼 | 有沒有省伺服器讀取 | 一手來源 |
|---|---|---|---|
| stale-while-revalidate（SWR） | 先給快取裡的舊內容，背景再去拿新的 | **沒有**：背景照樣整份讀；只是使用者不用等 | RFC 5861（`stale-while-revalidate` 指令）；[web.dev: Keeping things fresh with stale-while-revalidate](https://web.dev/articles/stale-while-revalidate)；[MDN Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control) |
| HTTP 快取：`Cache-Control` + `ETag` / `If-None-Match` → `304` | 瀏覽器存著上次回應；`no-cache` 表示「每次用前要先問」，伺服器用 ETag 比對，沒變回 304（沒有內容） | **有**，前提是伺服器能**便宜地**算出 ETag（例如只查最大 id），不必先跑完整查詢 | [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111)（§4.3 驗證、§5.2 指令）；[RFC 9110 §8.8.3 ETag、§13.1.2 If-None-Match、§15.4.5 304](https://www.rfc-editor.org/rfc/rfc9110)；[MDN HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching)；[MDN ETag](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag) |
| `no-store` vs `no-cache` | `no-store`：完全不准存（每次都整份重抓）；`no-cache`：可以存，但用前要驗證 | `no-store` 讓 304 不可能發生 | RFC 9111 §5.2.2.4／§5.2.2.5；MDN Cache-Control |
| Service Worker + Cache API | 網頁自己攔截請求、存在 `caches` 裡，可離線、可自訂 SWR | 跟 SWR 一樣，沒省；要配 ETag 或增量才省 | [MDN Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)、[MDN Cache](https://developer.mozilla.org/en-US/docs/Web/API/Cache)；[web.dev: The offline cookbook](https://web.dev/articles/offline-cookbook) |
| localStorage／IndexedDB | 程式自己把資料存在手機上，重開先畫 | 本身沒省；配合增量讀取才省 | [MDN Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)、[MDN IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)；[web.dev: Storage for the web](https://web.dev/articles/storage-for-the-web)（容量、可能被清掉） |
| 增量讀取（`since=` / cursor） | 手機記得最後一筆 id，只問「這之後的新資料」；聊天、通知、社群動態都這樣做 | **有**，讀取量 ≈ 新增筆數 | 一般 API 設計慣例（無單一標準）；D1 計費依「掃過的列數」，見下 |
| CDN／邊緣快取 | 回應存在 Cloudflare 機房，同一機房的下一個人不用打到 Worker／D1 | **有**，但會有最多 TTL 秒的舊資料；清除只對單一機房有效 | [Cloudflare Workers Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)（`caches.default`，`workers.dev` 網域不生效、只存在單一資料中心）；[How the Cache works](https://developers.cloudflare.com/workers/reference/how-the-cache-works/) |

D1 計費：讀取依查詢掃過的列數算，與一列大小無關（[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)）。靜態資源：Cloudflare Workers 靜態資源會自動加 `ETag` 並處理條件請求（[Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)、[Headers](https://developers.cloudflare.com/workers/static-assets/headers/)）。

重點：**SWR、Service Worker、localStorage 解的是「使用者等不等」；ETag／304、增量、邊緣快取解的是「伺服器讀多少」**。K 要的「不用每次讀」兩邊都有，要分開談。

## 2. 套到本專案

### 2.1 現況（實際程式）

- 更新紀錄頁：`public/js/edits.js:3-4,51` 同時打 `api/edits?limit=200`（`cache: 'no-cache'`）與 `api/dogs`。
- Worker：`worker/src/index.js:1375-1379` → `readEdits`（`worker/src/editlog.js:68-70`）：`SELECT * FROM v3_edit_log ORDER BY id DESC LIMIT ?`。`id` 是 `INTEGER PRIMARY KEY`（`db/compact-schema.sql:170`），SQLite 直接倒著走 rowid，**每次讀 200 列**（表少於 200 列時讀全部）。
- 所有 API 回應都是 `Cache-Control: no-store`（`worker/src/index.js:109-118` 的 `reply`），所以前端的 `cache: 'no-cache'` 沒有作用：瀏覽器不准存，每次整份重抓。
- `api/dogs` 走 ADR 0009 的版本號＋資料包＋Worker 記憶體快取，每次約讀 1 列版本號（資料包有變才多讀）。
- 網站更新：`public/js/analysis.js:595` 讀 `website-updates.json`（`cache: 'no-cache'`）。這是 `public/` 靜態檔，不經 Worker（`wrangler` 的 `run_worker_first` 只含 `/api/*`、`/photos/*`），**D1 0 列**；Cloudflare 預設帶 ETag，重開時大多只是 304。`public/_headers` 也註明網頁與 JSON「照 Cloudflare 預設每次先問有沒有新版」。
- `v3_edit_log` 只增不刪（schema 註解、ADR 0004），寫入點：`editlog.js:58`、`identity.js:77,140`。**沒有**版本號觸發器。

### 2.2 兩個分支

- **PR #452（`claude/421-update-cache`）**：網站更新存在 `analysis.js` 的模組變數，資料編輯存在上層頁 `host.bqEditsCache`（iframe 共用）；30 秒內重開不再檢查，超過才背景檢查；顯示讀取時間。效果：同一次開啟 App 內切回不重讀。App 重開（頁面重新載入）仍整份讀 200 列。與 #419 一致。
- **`local/421`**（WIP）：網站更新存 `localStorage['bq-website-updates']`、資料編輯存 `localStorage['bq-edits-cache']`，重開先畫舊的再背景重抓。效果：使用者不用等，但**D1 每次照讀 200 列**，沒省。且 `analysis.js` 用 localStorage 會打掉 `tests/index.html:1195-1203`「#59 分析程式只讀」（禁止 `localStorage|sessionStorage|indexedDB`）；`edits.js` 雖不在該測試範圍，但與 #419「只用記憶體，不新增 localStorage／sessionStorage」（`docs/agent-log/2026-10-20-419-group-cache.md`）的取捨相反。

### 2.3 選項比較

| 選項 | App 重開要等嗎 | 每次重開 D1 讀取（沒有新編輯時） | 與既有決定 |
|---|---|---|---|
| 現況 | 要等 | 200 列 | — |
| A. PR #452 記憶體 | 同頁切回不等；重開要等 | 200 列（30 秒內切回 0 列） | 符合 #419、#59 |
| B. `local/421` localStorage | 不等（先畫舊的） | 200 列 | 違反 #59 測試；與 #419 方向相反 |
| C. ETag／304（建議） | 要等一個往返，但回應是空的 304 | 約 1 列（`SELECT MAX(id)` 走 rowid） | 不碰 #59／#419；只改 Worker 標頭；需讓 `/api/edits` 不再 `no-store` |
| D. 增量 `since=<id>` | 配 B 才不用等 | ≈ 新筆數（多半 0） | 必須在手機存舊清單 → 同 B 的衝突；表只增不刪才成立（現在成立，但 `volunteer_rename` 不會改舊列，名字顯示另由 `api/dogs`／名單決定） |
| E. Cloudflare 邊緣快取（`caches.default`，TTL 例如 60 秒） | 同機房別人剛讀過就快 | 同機房 TTL 內 0 列 | 新編輯最多 TTL 秒後才看到；`workers.dev` 不生效；清除只限單一機房。與 ADR 0009「改的那台馬上看到」精神需 K 取捨 |

C 的細節：ETag 用 `"<max id>-<limit>"`。流程：先 `SELECT MAX(id)`（1 列）→ 跟 `If-None-Match` 相同回 304 → 不同才跑原本 200 列查詢並帶 `ETag`、`Cache-Control: no-cache`（或 `private, no-cache`）。手機瀏覽器 HTTP 快取跨重開保存（除非被系統清掉），`edits.js` 現有的 `cache: 'no-cache'` 正好會帶 `If-None-Match`。注意：同一份 `edits` 還要 `api/dogs` 補狗名；`api/dogs` 若也想 304，可用 ADR 0009 的版本號當 ETag（另一張票）。

### 2.4 讀取列數估算

假設每人每次打開「資料編輯」一次、表已超過 200 列：

- 現況／A／B：200 列 × 打開次數（A 在同頁 30 秒內重開為 0）。一天 50 次 ≈ 1 萬列，約 D1 免費每日 500 萬列讀取額度的 0.2%（額度見 D1 pricing；數字請以主控台為準）。
- C：沒有新編輯時 1 列；有新編輯 201 列。編輯一天幾筆，50 次打開大約 50 + 少數 × 200 ≈ 1～2 千列，約省 80～90%。
- 以額度來看，**省 D1 不是急迫問題**；#421 的真正痛點是「等」。C 同時改善流量與省讀取，B 只改善等待。

## 3. 建議與取捨

1. #421：合 PR #452（記憶體，符合 #419／#59）。`local/421` 不合。
2. 另開小票：`/api/edits` 改 `no-cache` + `ETag`（MAX(id)），304 時不讀資料；測試需涵蓋「有新編輯回 200」「沒變回 304」「其他 API 仍 `no-store`」。
3. 暫不做邊緣快取與 `since=` 增量：量小，換來舊資料或手機端儲存的爭議。

**需要 K 決定**：

- 「App 重開立刻看到舊內容（不用等任何往返）」是否必要？若是，就得在手機存資料（localStorage／IndexedDB／Service Worker），需正式放寬 #59「分析程式只讀」並修改 `tests/index.html` 該測試，或把快取移到 `analysis.js` 以外的模組；同時要接受 #419 的方向改變。
- 能否接受別人的新編輯最多晚 N 秒出現（邊緣快取 E）。
- 是否把 C 套到 `api/dogs` 等其他 API（會動到 ADR 0009 的讀取路徑，需看 `docs/agents/data-changes.md`）。
