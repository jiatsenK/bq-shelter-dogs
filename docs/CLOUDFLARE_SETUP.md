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
- 舊網址 https://jiatsenk.github.io/bq-shelter-dogs/ 照常可以用，舊的照片上傳服務（`bq-shelter-photos`）也先留著；等新網址驗收沒問題、說「切換」後，#129 再把舊網址導過來。

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
https://pr-<PR 編號>-bq-shelter-dogs.jiatsen-k.workers.dev
```

- 用手機點開就能看到這個 PR 改完的樣子，不用等合併。同一個 PR 再改，網址不變，重新整理就是最新的。
- 預覽版可以看、可以讀，但**上傳照片、存備註、按「更新」都不會存**，會顯示「這是預覽版，不能存」，正式資料不受影響。
- 「我溜過」等手機上記的東西，預覽網址也要重新輸入一次（每個預覽網址都算不同網站）。
- 不用另外設定，用的是步驟 4 已經設好的 Cloudflare Secret。

## token 到期時

- **Cloudflare token 到期**：照步驟 2 重建，更新 GitHub Secret `CLOUDFLARE_API_TOKEN`。網站不會壞，只是新的改動部署不上去。
- **GitHub token 到期**：照步驟 3 重建，更新 GitHub Secret `WORKER_GITHUB_TOKEN`，再照步驟 5 手動部署一次。

## 給寫程式的人

- 設定：repo 根目錄的 `wrangler.jsonc`（Worker 名稱、靜態檔案、Cron）；不公開的檔案列在 `.assetsignore`。
- API 在 `/api` 底下（`/api/photos/{編號}`、`/api/notes`、`/api/gallery`、`/api/walker-code`、`/api/sync`），網站在 `*.workers.dev` 上會自動改用同網址的 `/api`（`js/app.js` 的 `uploadUrlFor`）。同一份 `worker/src/index.js` 也還能照舊部署成沒有 `/api` 前綴的單獨 Worker（`worker/wrangler.toml`）。
- 本機試跑：在 repo 根目錄 `npx wrangler dev --persist-to /tmp/wrangler-state`（`--persist-to` 放 repo 外面，不然暫存寫進網站資料夾會一直重新載入）。
- 部署：`.github/workflows/deploy-cloudflare.yml`。同步試算表、產生縮圖這兩個 Action 用 GitHub 內建 token 提交，不會觸發推送事件，所以用 `workflow_run` 接著部署。
