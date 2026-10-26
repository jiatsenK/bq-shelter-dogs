# 管理網站（#564）

獨立 Worker／assets，以 Cloudflare Access 驗證管理者。不載入志工 app、不使用瀏覽器 ADMIN_KEY、不新增排程。#564 起唯讀狗表；#565 起有功能設定、#566 狗資料、#567 活動的寫入路徑，全部走既有共用模組與同交易紀錄。志工入口與部署流程維持原有設定。

> 2026-10-26 現況：第 1–5 階段都已上線（#564 唯讀狗表、#565 功能管理、#566 狗資料編輯、#567 活動／資料檢查／更新紀錄、#568 清理重複介面），已部署到正式環境。本文的「資料與成本」「部署與權限驗收」是 #564 第一階段寫的；功能管理、狗資料編輯、活動與紀錄見 `docs/operations/feature-settings.md`、`docs/operations/dog-editing.md`、`docs/operations/admin-records.md`。決策見 ADR 0020。

## 程式入口

| 路徑 | 責任 |
|---|---|
| `worker/src/admin/access.js` | Access JWT 簽章、issuer、audience、期限、人員憑證與來源檢查 |
| `worker/src/admin/index.js` | 先驗證全部請求，再分派管理 API、照片及獨立靜態資產 |
| `worker/src/admin/dogs.js` | 既有狗資料的唯讀投影；不呼叫志工寫入服務 |
| `public/js/api-response.js`、`public/js/dates.js` | 兩站共用的純回應解析與日期工具 |
| `scripts/build-admin-assets.mjs` | 從單一來源產出 `admin/public/shared/`，Wrangler build 與網頁測試會執行 |
| `admin/public/js/api.js` | 同來源管理 API 呼叫；登入跳轉及非 JSON 回應視為錯誤 |
| `admin/public/js/dog-table.js` | 格式驗證、搜尋、篩選、排序、有界分頁及維護標示 |
| `admin/public/js/main.js` | DOM、讀取／重試與事件；不存手機個人資料 |
| `worker/src/admin/activities.js`、`checks.js`、`edits.js` | #567 活動寫入（共用 activities.js＋同交易紀錄）、#518 掃描清單、資料編輯紀錄搜尋 |
| `admin/public/activities.html`、`checks.html`、`updates.html` | #567 三頁；純規則在 `activity-model.js`、`data-checks.js`、`edit-log.js` |

先跑 `node scripts/build-admin-assets.mjs` 可產出共用資產；不要手動改產出檔。Tabler 1.4.0 CSS 固定存於 `public/vendor/`，不載入其 JavaScript 或外部字型。上游：https://cdn.jsdelivr.net/npm/@tabler/core@1.4.0/dist/css/tabler.min.css；MIT 授權與檔頭一併保留。

## 資料與成本

- 顯示所有既有永久狗身分；主清單欄位優先，未列主清單不自動判定離所。重複主清單身分只取最前列，不複製狗。
- 性別只讀 `v3_dogs.sex`（主清單的性別複本 #557 不再讀，正式庫刪欄前比對 0 筆不同），不寫入補正；補正在 #566。
- 每次載入／重新讀取：1 個 SELECT、0 寫入、0 版本觸發器。主清單分組掃描一次，其餘以既有主鍵／索引連接；回傳列數等於狗身分數 N。沒有額外同步、資料包更新或逐列 D1 查詢。
- 搜尋（180 ms 節流）、篩選、排序、換頁：0 次 D1／R2 操作。一次載入完整小型清單，畫面每頁只顯示 25／50／100 隻，不新增背景輪詢。
- #566 新照片以 D1 不可覆寫版本引用為準，舊照片跟志工網站一樣看 R2 的 `photos/{編號}.jpg`：每次載入多 1 次 R2 list（`r2Versions`，同一個 Worker 30 秒內共用；照片超過 1000 張才多翻頁），0004 已刪舊照片清單；本票 0009 重新建立 `v3_photos` 作為共用照片服務的可靠版本引用。可見照片採 lazy loading。每個實際請求 1 次 R2 get；縮圖缺少時最多再取 1 次主照片；0 次 D1、0 次 R2 HEAD。不讀垃圾桶。檔案讀不到另行提示，不能當成已確認缺照片。
- 本機記憶體 SQLite 只計回傳列數，不能代表 Cloudflare 實際 `rows_read`；正式／測試遠端讀取列數需在隔離驗收時從 D1 metrics 記錄。本票未連正式 D1。

## 部署與權限驗收

### 現況（2026-10-26 唯讀核對）

- 網址 `https://bq-shelter-dogs-admin.jiatsen-k.workers.dev`（workers.dev，`workers_dev: true`）；版本預覽網址關閉。Cloudflare Access application 涵蓋整個 host，沒登入的請求一律轉到 Access 登入頁。
- 正式 D1（`bq-shelter-dogs`）與正式照片空間（`bq-shelter-photos`）直接讀寫；沒有排程、沒有密鑰。
- `wrangler.admin.jsonc` 就是線上設定：三個 vars（`ADMIN_ORIGIN`、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`）都寫在裡面。它們不是密鑰；`keep_vars: false`，部署以檔案為準。換網址或重建 Access application 時三個值一起改，否則全部請求被拒。

### 怎麼部署

- Actions 頁選「部署管理網站」（`.github/workflows/deploy-admin.yml`）→「Run workflow」，分支選 main。main 推送**不會**自動部署（K 2026-10-26），因為管理網站直接寫正式資料。
- 只部署 main（#622）：不能填分支，選別的分支整個略過。合併前要試某張 PR，用測試網站或 PR 預覽。
- workflow 先確認正式庫 migration 都套過，部署時把「main commit」寫進 Cloudflare 部署紀錄的 Message，部署後確認沒登入會被轉到 Access 登入頁。
- 改到兩站共用的程式（`worker/src/` 共用模組、`public/js/api-response.js`、`dates.js`）時，志工網站由 main 推送自動部署，管理網站要另外按一次。
- 本機部署（不建議）也要帶紀錄：`npx.cmd wrangler deploy --config wrangler.admin.jsonc --message "<分支> <commit>"`。
- 2026-10-25～26 的前 5 次部署是本機手動、沒有 Message，看不出是哪個 commit。

### 新環境（重建或換網址）依序

1. 選定獨立管理網址。建立 Access self-hosted application，涵蓋整個 host（所有路徑），Allow policy 只列經確認管理者；不可新增 Bypass／Everyone，第一版只有管理者角色。
2. 改 `wrangler.admin.jsonc`（不覆蓋志工設定）：填入 `ADMIN_ORIGIN`（完整 HTTPS origin、無結尾斜線）、`ACCESS_TEAM_DOMAIN`（團隊 hostname）、`ACCESS_AUD`（此 application 的 AUD）。換成自訂網域時加 custom domain route、`workers_dev` 改 false，並同步改 `scripts/admin-table.test.mjs` 的網址檢查。保留 `run_worker_first: true`、`preview_urls: false`。
3. 隔離驗收先將 D1／R2 bindings 改為已協調可用的隔離資源；不得重置共用測試庫或執行同步。正式上線才經 K 核准共用既有正式 bindings，不建第二套正式庫。此 Worker 沒有 schema 套用路徑；寫入只有設定、狗資料與活動（同來源＋JSON＋Access 身分）。
4. K 核准環境、Access policy 與實際設定後，才跑「部署管理網站」。
5. 未登入／非管理者測 `/`、`/index.html`、`/js/main.js`、`/vendor/tabler.min.css`、`/api/manage/dogs` 與照片：不可取得內容；管理者登入可讀。測 workers.dev／版本預覽不能繞過，替代 host 即使帶有效 token 也拒絕。
6. 測失效／偽造／錯 AUD／錯 issuer token、缺 vars、無法取得金鑰；全部拒絕。只信 `Cf-Access-Jwt-Assertion` 的簽章，不信 email header 或 cookie。Access 金鑰每個 issuer 快取五分鐘；輪替未知 kid 在快取更新前會拒絕，無未驗證退路。
7. 驗收搜尋、複合篩選、排序、分頁、無編號狗、空清單、讀取失敗與登入失效重試；確認狗表本身沒有寫入請求。另驗收志工站免登入、登記／復原／同步不受影響。

官方依據：[Access JWT 驗證](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)、[Static Assets 先執行 Worker](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)、[Access 與 Static Assets 限制](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)。

#566 的逐項儲存、CAS／紀錄、性別差異、照片復原、成本及待核准正式步驟見 `docs/operations/dog-editing.md`。#567 活動、資料檢查、更新紀錄的契約、成本與四場活動核對見 `docs/operations/admin-records.md`。承接 #575 的性別正本核對；0004 schema 已刪舊副本，runtime 不讀停用欄位。
