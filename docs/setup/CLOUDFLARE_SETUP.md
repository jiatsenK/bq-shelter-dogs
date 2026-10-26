# 網站搬到 Cloudflare 設定說明（V8，#125）

網站和照片上傳服務合在一起，放在 Cloudflare 的同一個 Worker（名稱 `bq-shelter-dogs`）：

```
GitHub repo（程式、狗卡、資料、照片）──main 有變動──▶ GitHub Action「部署到 Cloudflare」──▶ Cloudflare Worker
                                                                                         ├─ 網頁、photos/
                                                                                         └─ /api（上傳、備註、代號）
```

- 程式和資料一樣放 GitHub，Cloudflare 只負責「放網站、跑後端」。
- 以後改了 Worker 程式**不用再手動貼**，合併後 Action 會自動部署。
- 密碼（管理金鑰、代號密鑰、試算表寫入金鑰）**全部設在 GitHub 的 Secrets**，部署時自動帶到 Cloudflare。
- 費用 NT$0（Cloudflare Workers 免費方案）。
- 舊網址 https://jiatsenk.github.io/bq-shelter-dogs/ 從 #129 起一打開就轉到新網址同一頁（舊的書籤、主畫面捷徑都還能用）。舊的單獨照片上傳 Worker（`bq-shelter-photos`）2026-10 K 決定刪除，程式裡給它和舊網址的判斷也拿掉了。

> Cloudflare 和 GitHub 的網頁偶爾會改版，按鈕名稱可能跟這裡寫的略有不同，找意思相近的就可以。

還沒做完這些步驟前，「部署到 Cloudflare」這個 Action 會自動跳過（灰色或綠勾勾，不會是紅叉叉），網站其他功能照常。

---

## 步驟 1：記下 Cloudflare 的 Account ID

1. 登入 https://dash.cloudflare.com ，左邊選單點 **Workers & Pages**（可能在 **Compute** 底下）。
2. 右邊欄位有 **Account ID**（一串 32 個英數字），按旁邊的複製圖示**複製起來**。

## 步驟 2：在 Cloudflare 建立部署用的 API token

1. 右上角頭像 → **My Profile** → 左邊 **API Tokens** → **Create Token**。
2. 找到 **Edit Cloudflare Workers** 這個範本，按右邊的 **Use template**。
3. 照下面設：
   - **Account Resources**：`Include` → 選你的帳號
   - **Zone Resources**：`Include` → `All zones`（範本預設，這個專案沒有網域，不影響）
   - 其他不用動
4. 拉到最下面按 **Continue to summary** → **Create Token**。
5. 把出現的 token **複製起來**。這串只會顯示一次。

⚠️ 這串 token 可以部署你帳號裡的 Worker，只貼到步驟 4 的 GitHub 欄位，不要貼到聊天或其他地方。

## 步驟 3：建立 Worker 要用的 GitHub token（已不需要）

> #547（2026-10-26）起 Worker 不再呼叫 GitHub：照片存 R2、縮圖由網站產生，部署也不再帶 `WORKER_GITHUB_TOKEN`。這一步不用做，下面是當時的紀錄。

新 Worker 要一把可以改 repo 的 GitHub token。舊 Worker 那把的字串看不到了，所以另外建一把（舊的不要刪，舊網址還在用）。

1. GitHub 右上角頭像 → **Settings** → 左邊最下面 **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**。
2. 照下面填：
   - **Token name**：`板收 Cloudflare 網站`
   - **Expiration**：選最長的期限（到期後上傳、備註、更新會失敗，要照「token 到期時」重做）
   - **Repository access**：**Only select repositories** → 選 `jiatsenK/bq-shelter-dogs`
   - **Permissions** → **Repository permissions**：**Contents** 改 **Read and write**、**Actions** 改 **Read and write**
3. 按 **Generate token**，把 `github_pat_` 開頭的那串**複製起來**。

## 步驟 4：把密碼設成 GitHub Secrets

打開 https://github.com/jiatsenK/bq-shelter-dogs/settings/secrets/actions ，每一個都按 **New repository secret**，**Name** 照下面填（大小寫要一樣），**Secret** 貼上對應的內容，按 **Add secret**：

| Name | 內容 |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | 步驟 1 複製的 Account ID |
| `CLOUDFLARE_API_TOKEN` | 步驟 2 複製的 Cloudflare token |
| `ADMIN_KEY` | 管理 API（縮圖、搬照片、Trash）用的金鑰，只給 GitHub Action，自己想一組英數字。還沒設時沿用舊的 `NOTES_PASSCODE` Secret（ADR 0004） |

`WALKER_KEY`（誰遛的代號密鑰）本來就在這裡，不用動，部署時會自動一起帶過去，代號不會變。

## 步驟 5：第一次部署

1. 打開 https://github.com/jiatsenK/bq-shelter-dogs/actions/workflows/deploy-cloudflare.yml 。
2. 按右邊 **Run workflow** → 綠色 **Run workflow**。
3. 等一兩分鐘出現綠勾勾。點進去 → **deploy** → **部署**，最下面會有新網址，像這樣：
   ```
   https://bq-shelter-dogs.<你的帳號名>.workers.dev
   ```
   之後 main 有變動（合併 PR、同步試算表、網站上傳照片）都會自動部署，不用再按。

## 步驟 6：刪掉舊 Worker 的鬧鐘

> #512 起已沒有「叫同步」：狗清單由 Apps Script 編輯觸發送 Worker。下面這句是當時的紀錄。

新 Worker 已經會自己叫同步（ADR 0012：有改才同步＋每天 6:30 保險一次），舊的也叫的話會多叫（不會壞，只是浪費 GitHub Actions 分鐘數）。

Cloudflare → **Workers & Pages** → `bq-shelter-photos` → **Settings** → **Trigger Events**（舊版畫面叫 **Triggers**）→ 找到 `0,30 23,0-14 * * *` 那一筆 → 刪除。

舊 Worker 本身不要刪，舊網址還在用它上傳照片和存備註。

## 步驟 7：用手機驗收新網址

用手機打開步驟 5 的新網址，確認：

1. 狗卡、照片都有出現。
2. 打開 `新網址/api/`，看到 `"adminKey":"已設定"`、`"walkerKey":"已設定"`。
3. 選一隻狗換一張照片，等一兩分鐘重新整理看得到。
4. 存一則「我的備註」成功。
5. 按頁首「更新」圓箭頭，沒有出現錯誤。
6. 「我溜過」重新輸入自己的名字（新網址是新網站，手機上記的東西要重設一次），看得到自己溜過的狗。

都沒問題就跟 Claude 說，接著做其他項目；舊網址要等你說「切換」才會導過來（#129）。

---

## PR 預覽網址（#126）

之後每開一個 PR，GitHub 會自動部署一份預覽版，並在 PR 頁面留一則「📱 預覽網址」留言，網址固定是：

```
https://pr-<PR 編號>-bq-shelter-dogs-preview.jiatsen-k.workers.dev
```

- 用手機點開就能看到這個 PR 改完的樣子，不用等合併。同一個 PR 再改，網址不變，重新整理就是最新的。
- 預覽版可以看、可以讀，但**上傳照片、存備註都不會存**，會顯示「這是預覽版，不能存」，正式資料不受影響。
- 「我溜過」等手機上記的東西，預覽網址也要重新輸入一次（每個預覽網址都算不同網站）。
- 稽核第 3 項（2026-10-26）起，預覽上傳到**獨立的預覽 Worker `bq-shelter-dogs-preview`**，不是正式 Worker 的版本：照片讀測試空間 `bq-shelter-photos-test`、資料讀測試 D1，Worker 上**只有 `WALKER_KEY`**（算志工代號，不能寫任何東西；K 2026-10-26 決定跟正式同一把，代號才對得上測試庫），沒有正式試算表的密鑰、沒有 `ADMIN_KEY`，預覽也不跑排程。所以 PR 的程式就算有漏洞，也碰不到正式照片和正式試算表。測試照片空間是 2026-10-24 從正式複製的，之後正式新換的照片在預覽看不到。
- 正式 Worker 關掉預覽網址（`wrangler.jsonc` 的 `"preview_urls": false`），舊的 `pr-<編號>-bq-shelter-dogs` 網址在下次正式部署後失效。
- 每次上傳前 `node scripts/d1-database.mjs --config wrangler.jsonc --preview` 會檢查：Worker 名稱、照片空間、資料庫都不是正式的，預覽 Worker 除了 `WALKER_KEY` 沒有別的密鑰；任何一項不符就停止、不上傳。**不要在預覽 Worker 上設其他密鑰**，設了預覽就會停。
- **第一次要先建預覽 Worker（只做一次）**：在 repo 根目錄跑下面三行。第二行只在 Worker 還不存在時部署一次（預覽設定、沒有密鑰、沒有排程），已經存在就停；第三行貼上跟正式版同一把 `WALKER_KEY`。

  ```
  npx.cmd wrangler login
  node scripts/d1-database.mjs --config wrangler.jsonc --preview --create-preview-worker
  npx.cmd wrangler secret put WALKER_KEY --name bq-shelter-dogs-preview
  ```

## 瀏覽統計（#128）

看每天有幾個人用、用什麼手機。Cloudflare 免費，不放 cookie、不記個人資料。只要設一次：

1. 打開 https://dash.cloudflare.com ，左邊選單找 **Web Analytics**（可能在 **Analytics & Logs** 底下）。
2. 按 **Add a site**。
3. **Hostname** 填 `bq-shelter-dogs.jiatsen-k.workers.dev` → 按 **Done**。
4. 畫面會出現一段程式碼，裡面有 `"token": "一串 32 個英數字"`。**只複製引號裡那串英數字**（如果畫面跳掉了，在 Web Analytics 清單點這個網址 → **Manage site** 就看得到）。
5. 打開 https://github.com/jiatsenK/bq-shelter-dogs/settings/secrets/actions → **New repository secret**，**Name** 填 `CF_ANALYTICS_TOKEN`，**Secret** 貼上那串 → **Add secret**。
6. 照步驟 5 手動部署一次（或等下一次同步，會自動部署）。

用手機開新網址逛一下，過幾分鐘回 Cloudflare **Web Analytics** 點這個網址，就看得到今天的瀏覽數。這串 token 本來就會出現在網頁裡，不是密碼，放 Secret 只是方便跟其他設定放一起。

## 刪掉舊的照片上傳服務（#129 之後）

舊網址轉到新網址以後，舊的單獨照片上傳 Worker 就沒人用了（2026-10 K 決定刪）：

1. Cloudflare → **Workers & Pages** → 點 `bq-shelter-photos`。
2. **Settings** 拉到最下面 → **Delete** → 輸入名稱確認。

⚠️ **R2** 裡也有一個叫 `bq-shelter-photos` 的 bucket，那是現在放所有照片的地方，**不能刪**。要刪的是 **Workers & Pages** 底下的那個。

## 照片放 R2（#130）

照片（主照片、縮圖）從 GitHub 搬到 Cloudflare 的檔案空間 **R2**。搬好以後：

- 換照片**馬上生效**，不再產生 GitHub 提交、不用等部署。（相簿 2026-10-09 拿掉。）
- 換掉、刪掉的照片會先放進 **Trash（回收區）30 天**，誤刪可以復原（跟 Claude 說哪隻狗、大概什麼時候刪的）；30 天後自動清掉。
- 網址不變，志工不用做任何事。費用 NT$0（R2 免費 10 GB，照片目前約 27 MB）。
- repo 裡的舊照片 2026-10-04 搬進 R2、逐張核對後，2026-10-05 K 決定刪掉（git 歷史還留著）。從此照片只在 R2：R2 沒接上時（`/api/` 顯示 `"photos":"GitHub"`）網站會沒有照片，照「步驟 2」檢查。

### 步驟 1：開通 R2、建立照片空間

1. 登入 https://dash.cloudflare.com ，左邊選單找 **R2 Object Storage**（可能在 **Storage & Databases** 底下）。
2. 第一次用會請你開通（**Purchase R2** 或 **Add R2 subscription to my account**）。Cloudflare 規定要填信用卡或 PayPal，但 **10 GB 以內免費、不會扣款**。
3. 開通後按 **Create bucket**：
   - **Bucket name**：`bq-shelter-photos`（一字不差）
   - **Location**：`Automatic`
   - 其他不用動，按 **Create bucket**。

> #214 起，部署只確認既有 bucket；不存在或查證失敗就停止，不建立、不拿掉綁定或改寫 GitHub。已部署的舊版本繼續運作。

### 步驟 2：部署一次，確認接上了

1. 打開 https://github.com/jiatsenK/bq-shelter-dogs/actions/workflows/deploy-cloudflare.yml → **Run workflow** → 綠色 **Run workflow**，等綠勾勾。
2. 手機打開 https://bq-shelter-dogs.jiatsen-k.workers.dev/api/ ，看到 `"photos":"R2"` 就是接上了。
3. 如果看到 `"photos":"GitHub"`：點進剛剛那次部署，**Summary** 會寫原因。通常是 Cloudflare token 沒有 R2 權限：
   右上角頭像 → **My Profile** → **API Tokens** → 找到部署用的那把 → **Edit** → **Permissions** 加一行
   `Account`｜`Workers R2 Storage`｜`Edit` → **Continue to summary** → **Update token**，再回到第 1 步部署一次（token 字串不會變，GitHub 不用改）。

### 步驟 3：把舊照片搬進 R2（已完成）

2026-10-04 已用「照片搬到 R2」Action 搬完並逐張核對；這個 Action 和 `scripts/migrate-photos-r2.mjs` 已在 #275 移除，需要時見 Git 歷史。

### 步驟 4：用手機驗收

1. 溜狗表、詳細資訊、放大照片、找狗、分析頁的照片都正常。
2. 選一隻狗換主照片：換完重新整理還是新照片；另一支手機（或無痕視窗）也馬上看得到。
3. 清單上的小圖也換成新的（#546 起縮圖由網站換照片時自己產生；沒有縮圖的照片先顯示原圖，要補就手動跑「產生照片縮圖（R2）」Action）。
4. GitHub 的提交紀錄（https://github.com/jiatsenK/bq-shelter-dogs/commits/main ）**沒有**多出照片的提交。

（2026-10-04 K 驗收通過；舊照片 2026-10-05 已從 repo 刪除。）

### 刪掉相簿照片（2026-10-09 相簿拿掉後，K 自己做一次）

網站已經不顯示、也不給看相簿照片，但檔案還在 R2 裡佔空間。刪掉是永久的，請自己操作：

1. 打開 Cloudflare → **R2 Object Storage** → `bq-shelter-photos`。
2. 進 `photos/` → 勾選 `gallery` 資料夾 → **Delete**。
3. 進 `photos/thumbs/` → 勾選 `gallery` 資料夾 → **Delete**。
4. 回到最上層，進 `meta/` → 勾選 `gallery.json` → **Delete**。
5. `trash/` 裡以前刪的相簿照片 30 天內會由 Cron 自己清掉，不用管。

主照片在 `photos/{編號}.jpg` 和 `photos/thumbs/{編號}.jpg`，**不要**勾到。

### 要注意的地方

- 照片改由 Worker 從 R2 讀，會算進 Cloudflare Workers 免費方案的**每天 10 萬次**。照片在手機上快取 30 天，正常用不會超過；Cloudflare 的 Worker 頁面 **Metrics** 看得到每天用量。
- 機器用的管理功能（縮圖、Trash 清單和復原）要 GitHub Secret `ADMIN_KEY`。人用的管理網站是另一個 Worker，以 Cloudflare Access 驗證、不用這把金鑰（ADR 0020，見 `admin/README.md`）。

## token 到期時

- **Cloudflare token 到期**：照步驟 2 重建，更新 GitHub Secret `CLOUDFLARE_API_TOKEN`。網站不會壞，只是新的改動部署不上去。

## 給寫程式的人

- 設定：repo 根目錄的 `wrangler.jsonc`（Worker 名稱、靜態檔案、Cron）；不公開的檔案列在 `.assetsignore`。
- API 在 `/api` 底下（`/api/photos/{編號}`、`/api/notes`、`/api/gallery`、`/api/walker-code`），網站一律用同網址的 `/api`（`public/js/app.js` 的 `uploadUrlFor`）。Worker 只接受同網址的要求；要額外放行別的網站才設 `ALLOWED_ORIGINS`（預設空白）。
- 本機試跑：在 repo 根目錄 `npx wrangler dev --persist-to /tmp/wrangler-state`（`--persist-to` 放 repo 外面，不然暫存寫進網站資料夾會一直重新載入）。
- 照片快取（#127）：`public/_headers` 讓 `photos/` 在手機上快取 30 天；Worker 的 `/api/dogs` 回傳每張照片的內容雜湊（`photoVersions`），網站組照片網址加 `?v=雜湊`，換照片網址就變。
- 瀏覽統計（#128）：部署前 `scripts/analytics-beacon.mjs` 把 Cloudflare Web Analytics 的 beacon 插進要上傳的 `public/index.html`（token 來自 Secret `CF_ANALYTICS_TOKEN`，不提交）；預覽版和舊網址沒有。
- 部署：`.github/workflows/deploy-cloudflare.yml`。推到 main 且改到會放上網站的檔案時部署，也可以手動跑；「套用 D1 migration」套完會呼叫它（`workflow_call`）。
  - 部署排隊、不取消（#622）：正在跑的部署跑完才換下一個。還在排隊的會被更新的那次換掉，那次用更新的 main，一樣先確認 migration 再部署。原本會取消正在跑的部署，「套用 D1 migration」套完後呼叫的部署曾被砍掉（2026-10-25）。
  - 只准 main（#622）：「部署到 Cloudflare」「套用 D1 migration」「部署管理網站」「準備預覽資料庫」每個 job 都有 `if: github.ref == 'refs/heads/main'`，在 Actions 頁選別的分支按，整個略過（灰色），不碰正式環境。只有「部署到測試網站」可以填分支。結構檢查在 `tests/index/hosting.js`（`mainOnlyProblem`）。
  - 這只擋手誤：有推送權限的人能連 workflow 一起改。正式部署目前不等測試通過（另開票討論）。
- 照片放 R2（#130）：`wrangler.jsonc` 的 `r2_buckets`（binding `PHOTOS`，bucket `bq-shelter-photos`），程式在 `worker/src/r2.js`。
  `/photos/*` 先經過 Worker（`wrangler.jsonc` 的 `run_worker_first`；狗清單和照片版本號改由 `/api/dogs` 提供）（相簿 2026-10-09 拿掉，`photos/gallery/` 一律 404）；R2 沒有的照片退回靜態檔，刪掉的照片放 0 位元組的刪除標記（`customMetadata.deleted`）擋住退回。
  換掉、刪掉前複製到 `trash/{時間-亂數}/photo.jpg`（customMetadata 記 path、dogId、kind、file、addedAt、deletedAt）＋`thumb.jpg`，Cron 清掉超過 30 天的。
  Lifecycle 規則存在 bucket 上、不在 repo：`bq-shelter-photos`、`bq-shelter-photos-test` 都只有預設的「未完成分段上傳 7 天中止」，沒有刪除規則。K 2026-10-26 決定不加（理由見 ADR 0018 第 7 點補註）；要查就跑 `npx.cmd wrangler r2 bucket lifecycle list bq-shelter-photos`。
  管理 API（標頭 `X-Admin-Key: encodeURIComponent(金鑰)`）：`POST /api/admin/migrate`、`POST /api/admin/verify`、`GET /api/admin/thumbs`、`PUT /api/admin/thumbs/{原圖路徑}`、`GET /api/admin/trash`、`POST /api/admin/trash/{代號}/restore`。
  部署前 `scripts/r2-bucket.mjs` 只查證既有 bucket，失敗以非零狀態結束、停止部署。補縮圖（只有人工手動跑）：`.github/workflows/r2-thumbs.yml`（`scripts/make-thumbs.py --site`）。
  repo 的 `photos/` 已經不放照片（原本的 `photos/README.md` 併到這裡）。R2 找不到照片時 Worker 仍會退回讀部署的靜態檔，這是搬遷過渡期的備援，請不要再把 `.jpg` 放進 repo。

## 資料庫（D1）

K 2026-10-10：資料從 repo 裡的檔案搬到 Cloudflare 的資料庫 **D1**（結構見 `db/compact-schema.sql`；#246 當時的說明 `docs/design/history/COMPACT_D1.md` 已過時）。免費額度 5 GB，現在的資料不到 1 MB，費用 NT$0。
目前只是把資料庫建起來、把現有資料放進去；**網站還是讀原本的檔案**，所以資料庫沒接上網站也完全不受影響。

**#214 起部署不改資料庫。** `scripts/d1-database.mjs` 只驗證既有資料庫名稱／ID 並執行 `SELECT 1`，缺少、ID 不符或讀取失敗就停止部署。即使資料庫是空的也不建表或匯入。新增結構在 #215 之後走有版本的 migration，與網站部署分開執行。

| 用途 | 配置 | 資料庫 |
|---|---|---|
| 正式部署 | wrangler.jsonc → wrangler.deploy.json | bq-shelter-dogs |
| PR 預覽 | wrangler.preview-db.jsonc → wrangler.preview.json | bq-shelter-dogs-test |

測試 D1 已在 2026-10-14 建立，ID `9e23a65c-c9dd-4f83-ad9c-2e01626910f0`，與正式 `6cd6c304-0fed-4ddb-b9ec-799e60a4adb4` 不同。建立後 API 讀回、SELECT 1=1、業務表數=0、rows_written=0。這張票只建測試庫，不匯入正式資料；API 回應裡的 version=production 是 D1 的產品版本，不能用來判斷它是否為本專案正式庫，須看名稱與 ID。

預覽透過 `versions upload --preview-alias` 上傳到獨立的預覽 Worker `bq-shelter-dogs-preview`（稽核第 3 項），不部署；準備腳本把 Worker 名稱、DB、R2 換成 `wrangler.preview-db.jsonc` 的測試資源並帶 PREVIEW=1，查證預覽 Worker 除了 `WALKER_KEY` 沒有密鑰。R2 讀測試照片空間 `bq-shelter-photos-test`。測試庫一開始沒有資料表，預覽會顯示「狗的資料讀不到」。到 Actions 選「準備預覽資料庫」→「Run workflow」（`.github/workflows/seed-preview-db.yml`）：把正式 D1 匯出（只讀），清空測試庫後整份匯入（#520），最後核對兩邊狗清單一致。只寫測試庫；測試庫原有資料會被覆蓋，想讓預覽資料跟上正式庫就再跑一次。

### 結構改動與資料匯入

資料表結構：現在的完整樣子在 `db/compact-schema.sql`（`v3_*`），#246 當時的說明 `docs/design/history/COMPACT_D1.md` 已過時，只供查背景。#553 起每個變更寫成 repo 根目錄 `migrations/NNNN_*.sql`（wrangler 預設目錄，不用設 `migrations_dir`），正式庫只由 Actions「套用 D1 migration」（`.github/workflows/d1-migrations.yml`）套用，流程見 `docs/agents/data-changes.md`。舊的 `db/schema.sql`、`db/migrations/`（#252 前的舊表）已於 #275 移除，跟現在的 `migrations/` 無關。

備用庫 `bq-shelter-dogs-backup`（2026-10-24 建立，#553）：套用會刪資料或搬資料的 migration 前，套用 workflow 先把正式庫整份複製到這裡。ID `d31b8371-c94a-4a04-960f-665a0365c5af`，記在 `scripts/d1-migrations.mjs` 的 `BACKUP_DB_ID`；workflow 照名字查，ID 不同或跟正式庫一樣就停。

參考：[D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)、[D1 綁定設定](https://developers.cloudflare.com/workers/wrangler/configuration/#d1-databases)。目前沿用 repo 的版本網址預覽流程，沒有切換到另一套 Workers Previews 功能。

### 確認有沒有接上

1. 合併後等「部署到 Cloudflare」綠勾勾（或到 https://github.com/jiatsenK/bq-shelter-dogs/actions/workflows/deploy-cloudflare.yml 按 **Run workflow**）。
2. 手機打開 https://bq-shelter-dogs.jiatsen-k.workers.dev/api/ ，看到 `"database":"D1（狗 125、溜狗紀錄 732、異動紀錄 53）"` 這樣的字（數字會不一樣）就是接上了。
3. 如果看到 `"database":"未設定"`：點進剛剛那次部署，**Summary** 會寫原因。通常是 Cloudflare token 沒有 D1 權限：
   https://dash.cloudflare.com 右上角頭像 → **My Profile** → **API Tokens** → 找到部署用的那把 → **Edit** → **Permissions** 加一行
   `Account`｜`D1`｜`Edit` → **Continue to summary** → **Update token**，再部署一次（token 字串不會變，GitHub 不用改）。

### 資料弄壞了要救

- Cloudflare 後台 → **Storage & Databases** → **D1** → `bq-shelter-dogs` → **Time Travel** 可以回到 30 天內任一時間點。
- 不要刪掉資料庫期待部署自動重建。部署已移除建庫與匯入；資料損壞需用正式備份／Time Travel 與經核對的還原流程處理，測試演練先在隔離庫做。
