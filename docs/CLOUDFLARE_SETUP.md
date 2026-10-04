# 網站搬到 Cloudflare 設定說明（V8，#125）

網站和照片上傳服務合在一起，放在 Cloudflare 的同一個 Worker（名稱 `bq-shelter-dogs`）：

```
GitHub repo（程式、狗卡、資料、照片）──main 有變動──▶ GitHub Action「部署到 Cloudflare」──▶ Cloudflare Worker
                                                                                         ├─ 網頁、data/、photos/
                                                                                         └─ /api（上傳、備註、相簿、代號、更新）
```

- 程式和資料一樣放 GitHub，Cloudflare 只負責「放網站、跑後端」。
- 以後改了 Worker 程式**不用再手動貼**，合併後 Action 會自動部署。
- 密碼（token、通關碼、代號密鑰）**全部設在 GitHub 的 Secrets**，部署時自動帶到 Cloudflare。
- 費用 NT$0（Cloudflare Workers 免費方案）。
- 舊網址 https://jiatsenk.github.io/bq-shelter-dogs/ 從 #129 起一打開就轉到新網址同一頁（舊的書籤、主畫面捷徑都還能用）。舊的照片上傳服務（`bq-shelter-photos`）先留著，什麼時候可以刪見下面「刪掉舊的照片上傳服務」。

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

## 步驟 3：建立 Worker 要用的 GitHub token

新 Worker 要一把可以改 repo、叫同步的 GitHub token。舊 Worker 那把的字串看不到了，所以另外建一把（舊的不要刪，舊網址還在用）。

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
| `WORKER_GITHUB_TOKEN` | 步驟 3 複製的 GitHub token |
| `NOTES_PASSCODE` | 「我的備註」的通關碼（跟現在用的一樣，iPhone 鑰匙圈裡有） |

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

新 Worker 已經會每 30 分鐘叫一次同步，舊的也叫的話會一次叫兩次（不會壞，只是浪費）。

Cloudflare → **Workers & Pages** → `bq-shelter-photos` → **Settings** → **Trigger Events**（舊版畫面叫 **Triggers**）→ 找到 `0,30 23,0-14 * * *` 那一筆 → 刪除。

舊 Worker 本身不要刪，舊網址還在用它上傳照片和存備註。

## 步驟 7：用手機驗收新網址

用手機打開步驟 5 的新網址，確認：

1. 狗卡、照片都有出現。
2. 打開 `新網址/api/`，看到 `"token":"已設定"`、`"notesPasscode":"已設定"`、`"walkerKey":"已設定"`。
3. 選一隻狗換一張照片，等一兩分鐘重新整理看得到。
4. 存一則「我的備註」成功。
5. 按頁首「更新」圓箭頭，沒有出現錯誤。
6. 「我溜過」重新輸入自己的名字（新網址是新網站，手機上記的東西要重設一次），看得到自己溜過的狗。
   存備註時通關碼也要自己打一次，之後 iPhone 鑰匙圈會記住新網址。

都沒問題就跟 Claude 說，接著做其他項目；舊網址要等你說「切換」才會導過來（#129）。

---

## PR 預覽網址（#126）

之後每開一個 PR，GitHub 會自動部署一份預覽版，並在 PR 頁面留一則「📱 預覽網址」留言，網址固定是：

```
https://pr-<PR 編號>-bq-shelter-dogs.<子網域>.workers.dev
```

- 用手機點開就能看到這個 PR 改完的樣子，不用等合併。同一個 PR 再改，網址不變，重新整理就是最新的。
- 預覽版可以看、可以讀，但**上傳照片、存備註、按「更新」都不會存**，會顯示「這是預覽版，不能存」，正式資料不受影響。
- 「我溜過」等手機上記的東西，預覽網址也要重新輸入一次（每個預覽網址都算不同網站）。
- 不用另外設定，用的是步驟 4 已經設好的 Cloudflare Secret。

## 瀏覽統計（#128）

看每天有幾個人用、用什麼手機。Cloudflare 免費，不放 cookie、不記個人資料。只要設一次：

1. 打開 https://dash.cloudflare.com ，左邊選單找 **Web Analytics**（可能在 **Analytics & Logs** 底下）。
2. 按 **Add a site**。
3. **Hostname** 填 `bq-shelter-dogs.<子網域>.workers.dev` → 按 **Done**。
4. 畫面會出現一段程式碼，裡面有 `"token": "一串 32 個英數字"`。**只複製引號裡那串英數字**（如果畫面跳掉了，在 Web Analytics 清單點這個網址 → **Manage site** 就看得到）。
5. 打開 https://github.com/jiatsenK/bq-shelter-dogs/settings/secrets/actions → **New repository secret**，**Name** 填 `CF_ANALYTICS_TOKEN`，**Secret** 貼上那串 → **Add secret**。
6. 照步驟 5 手動部署一次（或等下一次同步，會自動部署）。

用手機開新網址逛一下，過幾分鐘回 Cloudflare **Web Analytics** 點這個網址，就看得到今天的瀏覽數。這串 token 本來就會出現在網頁裡，不是密碼，放 Secret 只是方便跟其他設定放一起。

## 刪掉舊的照片上傳服務（#129 之後）

舊網址轉到新網址以後，舊的 `bq-shelter-photos` Worker 應該就沒人用了。切換後過一週再看：

1. Cloudflare → **Workers & Pages** → 點 `bq-shelter-photos`。
2. 看 **Metrics**（或 **Observability**）最近 7 天的 **Requests**。
3. 是 0（或只有零星幾筆）就可以刪：**Settings** 拉到最下面 → **Delete** → 輸入名稱確認。

還有很多流量的話先不要刪，跟 Claude 說，查是哪裡還在用舊的。

## 照片放 R2（#130）

照片（主照片、相簿、縮圖）從 GitHub 搬到 Cloudflare 的檔案空間 **R2**。搬好以後：

- 換照片、加相簿、設為主照片、刪相簿照片**馬上生效**，不再產生 GitHub 提交、不用等部署。
- 換掉、刪掉的照片會先放進 **Trash（回收區）30 天**，誤刪可以復原（跟 Claude 說哪隻狗、大概什麼時候刪的）；30 天後自動清掉。
- 網址不變，志工不用做任何事。費用 NT$0（R2 免費 10 GB，照片目前約 27 MB）。
- repo 裡的舊照片**先不刪**：R2 讀不到的照片網站會自動改讀舊檔，等你驗收沒問題再另外處理。

### 步驟 1：開通 R2、建立照片空間

1. 登入 https://dash.cloudflare.com ，左邊選單找 **R2 Object Storage**（可能在 **Storage & Databases** 底下）。
2. 第一次用會請你開通（**Purchase R2** 或 **Add R2 subscription to my account**）。Cloudflare 規定要填信用卡或 PayPal，但 **10 GB 以內免費、不會扣款**。
3. 開通後按 **Create bucket**：
   - **Bucket name**：`bq-shelter-photos`（一字不差）
   - **Location**：`Automatic`
   - 其他不用動，按 **Create bucket**。

> 如果忘了建 bucket，部署時會自動試著建；建不起來網站也不會壞，照片照舊存 GitHub。

### 步驟 2：部署一次，確認接上了

1. 打開 https://github.com/jiatsenK/bq-shelter-dogs/actions/workflows/deploy-cloudflare.yml → **Run workflow** → 綠色 **Run workflow**，等綠勾勾。
2. 手機打開 https://bq-shelter-dogs.<子網域>.workers.dev/api/ ，看到 `"photos":"R2"` 就是接上了。
3. 如果看到 `"photos":"GitHub"`：點進剛剛那次部署，**Summary** 會寫原因。通常是 Cloudflare token 沒有 R2 權限：
   右上角頭像 → **My Profile** → **API Tokens** → 找到部署用的那把 → **Edit** → **Permissions** 加一行
   `Account`｜`Workers R2 Storage`｜`Edit` → **Continue to summary** → **Update token**，再回到第 1 步部署一次（token 字串不會變，GitHub 不用改）。

### 步驟 3：把舊照片搬進 R2

1. 打開 https://github.com/jiatsenK/bq-shelter-dogs/actions/workflows/migrate-photos-r2.yml → **Run workflow** → 綠色 **Run workflow**。
2. 等綠勾勾（幾分鐘），點進去看 **Summary**：會列出 repo 裡共幾張、這次複製幾張、核對正確幾張，最下面是
   「✅ 每一張都核對過，數量一致。」就完成了。
3. 紅叉叉的話 Summary 會列出哪幾張不對，截圖給 Claude。可以重跑，搬過的會自動跳過。

### 步驟 4：用手機驗收

1. 溜狗表、詳細資訊、相簿、放大照片、找狗、分析頁的照片都正常。
2. 選一隻狗換主照片：換完重新整理還是新照片；另一支手機（或無痕視窗）也馬上看得到。
3. 過一兩分鐘清單上的小圖也換成新的（縮圖由「產生照片縮圖（R2）」Action 做，做好前先顯示原圖）。
4. 相簿加一張、設為主照片、刪一張（要通關碼），重新整理都跟剛剛一樣。
5. GitHub 的提交紀錄（https://github.com/jiatsenK/bq-shelter-dogs/commits/main ）**沒有**多出照片的提交。

都沒問題跟 Claude 說，再決定什麼時候把 repo 裡的舊照片刪掉。

### 要注意的地方

- 照片改由 Worker 從 R2 讀，會算進 Cloudflare Workers 免費方案的**每天 10 萬次**。照片在手機上快取 30 天，正常用不會超過；Cloudflare 的 Worker 頁面 **Metrics** 看得到每天用量。
- 管理用的功能（搬遷、縮圖、Trash 清單和復原）都要「我的備註」那組通關碼（GitHub Secret `NOTES_PASSCODE`），之後的管理後台也會用到。

## token 到期時

- **Cloudflare token 到期**：照步驟 2 重建，更新 GitHub Secret `CLOUDFLARE_API_TOKEN`。網站不會壞，只是新的改動部署不上去。
- **GitHub token 到期**：照步驟 3 重建，更新 GitHub Secret `WORKER_GITHUB_TOKEN`，再照步驟 5 手動部署一次。

## 給寫程式的人

- 設定：repo 根目錄的 `wrangler.jsonc`（Worker 名稱、靜態檔案、Cron）；不公開的檔案列在 `.assetsignore`。
- API 在 `/api` 底下（`/api/photos/{編號}`、`/api/notes`、`/api/gallery`、`/api/walker-code`、`/api/sync`），網站在 `*.workers.dev` 上會自動改用同網址的 `/api`（`js/app.js` 的 `uploadUrlFor`）。同一份 `worker/src/index.js` 也還能照舊部署成沒有 `/api` 前綴的單獨 Worker（`worker/wrangler.toml`）。
- 本機試跑：在 repo 根目錄 `npx wrangler dev --persist-to /tmp/wrangler-state`（`--persist-to` 放 repo 外面，不然暫存寫進網站資料夾會一直重新載入）。
- 照片快取（#127）：`_headers` 讓 `photos/` 在手機上快取 30 天；部署前 `scripts/photo-versions.mjs` 把每張照片的內容雜湊寫進要上傳的 `data/dogs.json`（`photoVersions`，不提交），網站組照片網址加 `?v=雜湊`，換照片網址就變。
- 瀏覽統計（#128）：部署前 `scripts/analytics-beacon.mjs` 把 Cloudflare Web Analytics 的 beacon 插進要上傳的 `index.html`（token 來自 Secret `CF_ANALYTICS_TOKEN`，不提交）；預覽版和舊網址沒有。
- 部署：`.github/workflows/deploy-cloudflare.yml`。同步試算表、產生縮圖這兩個 Action 用 GitHub 內建 token 提交，不會觸發推送事件，所以用 `workflow_run` 接著部署。
- 照片放 R2（#130）：`wrangler.jsonc` 的 `r2_buckets`（binding `PHOTOS`，bucket `bq-shelter-photos`），程式在 `worker/src/r2.js`。
  `/photos/*`、`/data/dogs.json`（蓋上 R2 照片的版本號）、`/data/gallery.json`（R2 的 `meta/gallery.json`）先經過 Worker；R2 沒有的照片退回靜態檔，刪掉的照片放 0 位元組的刪除標記（`customMetadata.deleted`）擋住退回。
  換掉、刪掉前複製到 `trash/{時間-亂數}/photo.jpg`（customMetadata 記 path、dogId、kind、file、addedAt、deletedAt）＋`thumb.jpg`，Cron 清掉超過 30 天的。
  管理 API（標頭 `X-Admin-Passcode: encodeURIComponent(通關碼)`）：`POST /api/admin/migrate`、`POST /api/admin/verify`、`GET /api/admin/thumbs`、`PUT /api/admin/thumbs/{原圖路徑}`、`GET /api/admin/trash`、`POST /api/admin/trash/{代號}/restore`。
  部署前 `scripts/r2-bucket.mjs` 確認 bucket，沒有就用拿掉 R2 的 `wrangler.no-r2.json` 部署（照片照舊寫 GitHub）。縮圖：`.github/workflows/r2-thumbs.yml`（`scripts/make-thumbs.py --site`）；搬遷：`.github/workflows/migrate-photos-r2.yml`（`scripts/migrate-photos-r2.mjs`）。
  本機試跑 `npx wrangler dev --local --persist-to /tmp/wrangler-state --var NOTES_PASSCODE:測試`，再 `SITE_URL=http://localhost:8787 ADMIN_PASSCODE=測試 node scripts/migrate-photos-r2.mjs` 就能模擬搬遷。
