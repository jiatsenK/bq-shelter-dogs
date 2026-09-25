# 照片上傳服務設定說明（V4，#47／#48）

網站上的「上傳照片／更換照片」要透過一個小服務（Cloudflare Worker）把照片存進這個 repo 的 `photos/{編號}.jpg`：

```
網站（GitHub Pages）→ 照片上傳服務（Cloudflare Worker）→ GitHub → photos/{編號}.jpg
```

GitHub 的寫入權限（token）只放在 Cloudflare 裡，網站程式和 repo 裡都沒有。全部步驟都在網頁上完成，不用裝軟體、不用打指令，費用 NT$0（Cloudflare Workers 免費方案每天可處理 10 萬次要求）。

> Cloudflare 和 GitHub 的網頁偶爾會改版，按鈕名稱可能跟這裡寫的略有不同，找意思相近的就可以。

還沒做完這些步驟前，網站不會出現上傳按鈕，其他功能照常。

---

## 步驟 1：在 GitHub 建立只能改這個 repo 的 token

1. 登入 GitHub，點右上角大頭貼 → **Settings**。
2. 左邊選單拉到最下面 → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**。
3. 照下面填：
   - **Token name**：`板收照片上傳`
   - **Expiration**：選最長的期限（到期後上傳會失敗，要照「token 到期時」重做）
   - **Repository access**：選 **Only select repositories**，再選 `jiatsenK/bq-shelter-dogs`（只選這一個）
   - **Permissions** → **Repository permissions** → **Contents** 改成 **Read and write**（其他都不用動；Metadata 會自動變成唯讀，這是正常的）
4. 按 **Generate token**，把出現的 token（`github_pat_` 開頭的一長串）**複製起來**。這串只會顯示一次。

⚠️ 這串 token 等於「可以改這個 repo 檔案的鑰匙」：只貼到步驟 4 的 Cloudflare 欄位，不要貼到聊天、試算表、repo 或任何其他地方。

## 步驟 2：註冊 Cloudflare（免費）

1. 打開 https://dash.cloudflare.com/sign-up ，用 email 註冊，收信點驗證連結。
2. 如果問要什麼方案或要不要加網站，選免費（Free）或直接略過；這裡用不到網域。

## 步驟 3：建立照片上傳服務（Worker）

1. 登入 Cloudflare 後，左邊選單找 **Workers & Pages**（可能在 **Compute** 底下）。
2. 按 **Create** → 選 **Start with Hello World!**（或「建立 Worker」）。
3. 名稱填 `bq-shelter-photos` → 按 **Deploy**。
4. 部署完按 **Edit code**（編輯程式碼），會開啟線上編輯器。
5. 另開一個分頁打開 https://github.com/jiatsenK/bq-shelter-dogs/blob/main/worker/src/index.js ，按程式碼右上角的 **複製（Copy raw file）** 按鈕。
6. 回到 Cloudflare 編輯器，把左邊 `worker.js`（或 `index.js`）裡原本的內容**全部刪掉**，貼上剛剛複製的程式。
7. 按右上角 **Deploy**。

## 步驟 4：把 token 設成 Secret

1. 回到這個 Worker 的頁面 → **Settings** → **Variables and Secrets** → **Add**。
2. 填：
   - **Type**：**Secret**（一定要選 Secret，這樣存進去後誰都看不到內容）
   - **Variable name**：`GITHUB_TOKEN`
   - **Value**：貼上步驟 1 複製的 token
3. 按 **Deploy**（或 Save）。

## 步驟 5：確認服務有在跑

在 Worker 頁面上可以看到它的網址，長得像：

```
https://bq-shelter-photos.你的帳號名稱.workers.dev
```

用瀏覽器打開這個網址，看到下面這樣就成功了（重點是 `"token":"已設定"`）：

```
{"ok":true,"service":"板收志工溜狗表 照片上傳服務","token":"已設定"}
```

如果顯示 `"token":"未設定"`，回步驟 4 檢查名稱是不是 `GITHUB_TOKEN`，然後重新 Deploy。

## 步驟 6：把網址接到網站

把步驟 5 的網址貼給 Claude，Claude 會把它填進網站程式（`js/app.js` 最上面的 `UPLOAD_URL`）並開 PR。合併後網站的詳細資訊就會出現「上傳照片／更換照片」。

（想自己改也可以：在 GitHub 網頁打開 `js/app.js` → 右上角鉛筆 → 把 `let UPLOAD_URL = '';` 改成 `let UPLOAD_URL = 'https://bq-shelter-photos.你的帳號名稱.workers.dev';` → Commit changes。）

---

## 匿名上傳的風險與還原

- 規格要求不用登入，所以**任何打開網站的人都能上傳或換掉照片**，有可能被亂傳。
- 服務有基本防護：只收這個網站送來的要求、編號必須是 `data/dogs.json` 裡有的狗、只收 JPEG、單張最多 2 MB、同一個人 1 分鐘最多 5 張／1 小時最多 30 張。這些是「擋住亂來」，不是嚴格的權限管理。
- **每次上傳都是 repo 的一筆提交**，說明會寫「上傳照片」或「更換照片」和犬名，所以隨時看得到誰（哪隻狗）被改過，也都能還原：
  1. 在 GitHub 打開 `photos/{編號}.jpg` → 右上角 **History**，找到想要的那一版。
  2. 或直接跟 Claude 說「把 {犬名} 的照片還原成上一張」。
- 如果真的被大量亂傳，最快的止血方式是到 Cloudflare 這個 Worker 的 **Settings** 把 `GITHUB_TOKEN` 刪掉（網站上傳會顯示失敗，其他功能不受影響），或到 GitHub 的 Fine-grained tokens 頁把 token 刪掉。

## token 到期時

上傳會顯示「照片沒有存進去（GitHub 401）」。重做步驟 1 產生新 token，再到步驟 4 把 `GITHUB_TOKEN` 的值換成新的，按 Deploy。

## 更新服務程式

之後如果 `worker/src/index.js` 有修改（PR 會寫明），照步驟 3 的 4–7 再貼一次新程式、Deploy 就好；Secret 不用重設。

## 我的備註（V5，#61）

同一個服務也負責「我的備註」：網站把備註送到服務，服務寫進 repo 的 `data/my-notes.json`（每隻狗一筆，格式 `{ "犬隻編號": { "text": "備註內容", "updatedAt": "時間" } }`），網站再從服務讀回最新內容。

- **repo 是公開的，備註內容任何人都看得到**，網站上只是不特別標出是誰寫的。不要寫志工名字、電話等個資。
- **寫備註要通關碼**，讀不用。通關碼放在 Cloudflare 的 Secret，網站程式和 repo 裡都沒有。第一次寫備註時在手機輸入，之後記在那支手機。
- 每則備註最多 1000 字，只存純文字。每次寫入都是 repo 的一筆提交（「更新我的備註」／「刪除我的備註」加犬名），寫錯或被亂改都能從 `data/my-notes.json` 的 **History** 還原。
- 同一個人 1 小時內通關碼錯 10 次，會暫停 1 小時不給試。

### 啟用步驟（這次 PR 合併後做一次）

1. **重新貼程式**：照上面「步驟 3」的 4–7，打開 Cloudflare 的 `bq-shelter-photos` → **Edit code**，把內容全部換成 https://github.com/jiatsenK/bq-shelter-dogs/blob/main/worker/src/index.js 的最新版（右上角 **Copy raw file**），按 **Deploy**。
2. **設定通關碼**：Worker 頁面 → **Settings** → **Variables and Secrets** → **Add**：
   - **Type**：**Secret**
   - **Variable name**：`NOTES_PASSCODE`
   - **Value**：自己想一組通關碼（建議 8 個字以上，可以用中文；不要跟其他帳號密碼一樣）
   
   按 **Deploy**（或 Save）。`GITHUB_TOKEN` 不用動，現在這把 token 就能寫 `data/my-notes.json`。
3. **確認**：打開服務網址（例：https://bq-shelter-photos.jiatsen-k.workers.dev/ ），看到 `"token":"已設定"` 和 `"notesPasscode":"已設定"` 就完成了。

想換通關碼：到同一個地方把 `NOTES_PASSCODE` 的值改掉、Deploy；舊手機下次寫備註時會被要求重新輸入。想暫停寫備註：把 `NOTES_PASSCODE` 刪掉（讀備註和上傳照片不受影響）。

### 服務的網址（給寫網站程式的人）

- 讀取：`GET /notes` → `{ "ok": true, "notes": { ...data/my-notes.json 的內容 } }`，直接讀 GitHub 上的最新版，不用等網站重新部署。
- 寫入：`PUT /notes/{編號}`，內容 `{ "text": "備註", "passcode": "通關碼" }`（`Content-Type: application/json`）。`text` 是空的就刪掉這隻的備註。通關碼錯或沒帶回 401、錯太多次回 429，兩者都帶 `"code": "passcode"`。成功回 `{ "ok": true, "id": "...", "note": { "text", "updatedAt" } 或 null, "commit": "..." }`。

## 相簿

每隻狗的詳細資訊最下面（狗卡資訊下方）有「相簿」：主照片之外可以再放幾張，點照片用燈箱看大圖、左右滑換張。

- 照片存在 `photos/gallery/{犬隻編號}/`，檔名是上傳時間（台灣時間）加 4 碼亂數，例：`20260925-153012-ab12.jpg`；清單在 `data/gallery.json`（`{ "犬隻編號": [{ "file": "檔名", "addedAt": "時間" }] }`，舊到新）。
- **新增不用登入**（跟換主照片一樣），和換主照片共用頻率限制；每隻狗最多 30 張。每張是兩筆提交：先存照片檔，再更新清單。
- **刪除要通關碼**，跟「我的備註」同一組 `NOTES_PASSCODE`（手機記過就不用再輸入）。刪除會先從清單拿掉、再刪照片檔；刪錯可以從 `data/gallery.json` 和照片檔的 **History** 還原。
- 主照片（`photos/{編號}.jpg`）不能從相簿刪，要換主照片照舊按詳細資訊照片角落的相機。

### 啟用步驟（這次 PR 合併後做一次）

只要**重新貼程式**：照上面「步驟 3」的 4–7，打開 Cloudflare 的 `bq-shelter-photos` → **Edit code**，把內容全部換成 https://github.com/jiatsenK/bq-shelter-dogs/blob/main/worker/src/index.js 的最新版（右上角 **Copy raw file**），按 **Deploy**。token 和通關碼都不用動。沒重新貼之前，網站的相簿只會顯示主照片，按「新增」會失敗。

### 服務的網址（給寫網站程式的人）

- 讀取：`GET /gallery` → `{ "ok": true, "gallery": { ...data/gallery.json 的內容 } }`。
- 新增：`POST /gallery/{編號}`，內容是 JPEG（`Content-Type: image/jpeg`）。成功回 `{ "ok": true, "id": "...", "photo": { "file", "addedAt" } }`；滿 30 張回 409。
- 刪除：`DELETE /gallery/{編號}/{檔名}`，內容 `{ "passcode": "通關碼" }`（`Content-Type: application/json`）。通關碼錯的回應同我的備註。成功回 `{ "ok": true, "removed": true/false, "fileDeleted": true/false }`。

## 給用命令列的人

`worker/wrangler.toml` 已經設定好，在 `worker/` 資料夾執行：

```
npx wrangler deploy
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put NOTES_PASSCODE
```

自動測試（模擬 GitHub，不會真的上傳）：`node --test worker/test/worker.test.mjs`
