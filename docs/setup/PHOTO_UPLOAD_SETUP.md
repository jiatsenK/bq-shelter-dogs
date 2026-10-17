> 2026-10-16 起網站不再用通關碼（`NOTES_PASSCODE`），任何人選好名字就能改，改了記在編輯紀錄；管理 API 改用 `ADMIN_KEY`。下面提到通關碼的段落是舊紀錄，見 `docs/adr/0004-open-editing-and-edit-log.md`。

# 照片上傳服務設定說明（V4，#47／#48）

網站上的「上傳照片／更換照片」要透過一個小服務（Cloudflare Worker）把照片存進這個 repo 的 `photos/{編號}.jpg`：

```
網站（GitHub Pages）→ 照片上傳服務（Cloudflare Worker）→ GitHub → photos/{編號}.jpg
```

GitHub 的寫入權限（token）只放在 Cloudflare 裡，網站程式和 repo 裡都沒有。全部步驟都在網頁上完成，不用裝軟體、不用打指令，費用 NT$0（Cloudflare Workers 免費方案每天可處理 10 萬次要求）。

> Cloudflare 和 GitHub 的網頁偶爾會改版，按鈕名稱可能跟這裡寫的略有不同，找意思相近的就可以。

還沒做完這些步驟前，網站不會出現上傳按鈕，其他功能照常。

> ⚠️ **這份已經過時，只留作紀錄。** V8（#125）起照片上傳服務跟網站合在同一個 Worker、自動部署，設定見 [`CLOUDFLARE_SETUP.md`](CLOUDFLARE_SETUP.md)。這份說明的單獨 Worker `bq-shelter-photos` 和 `worker/wrangler.toml` 在 2026-10 拿掉了（K 決定刪除）。下面的「誰遛的代號」密鑰說明仍然適用，只是密鑰現在設在 GitHub Secret `WALKER_KEY`、部署時自動帶上去。

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

把步驟 5 的網址貼給 Claude，Claude 會把它填進網站程式（`public/js/app.js` 最上面的 `UPLOAD_URL`）並開 PR。合併後網站的詳細資訊就會出現「上傳照片／更換照片」。

（想自己改也可以：在 GitHub 網頁打開 `public/js/app.js` → 右上角鉛筆 → 把 `let UPLOAD_URL = '';` 改成 `let UPLOAD_URL = 'https://bq-shelter-photos.你的帳號名稱.workers.dev';` → Commit changes。）

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
3. **確認**：打開服務網址（例：https://bq-shelter-photos.<子網域>.workers.dev/ ），看到 `"token":"已設定"` 和 `"notesPasscode":"已設定"` 就完成了。

想換通關碼：到同一個地方把 `NOTES_PASSCODE` 的值改掉、Deploy；舊手機下次寫備註時會被要求重新輸入。想暫停寫備註：把 `NOTES_PASSCODE` 刪掉（讀備註和上傳照片不受影響）。

### 服務的網址（給寫網站程式的人）

- 讀取：`GET /notes` → `{ "ok": true, "notes": { ...data/my-notes.json 的內容 } }`，直接讀 GitHub 上的最新版，不用等網站重新部署。
- 寫入：`PUT /notes/{編號}`，內容 `{ "text": "備註", "passcode": "通關碼" }`（`Content-Type: application/json`）。`text` 是空的就刪掉這隻的備註。通關碼錯或沒帶回 401、錯太多次回 429，兩者都帶 `"code": "passcode"`。成功回 `{ "ok": true, "id": "...", "note": { "text", "updatedAt" } 或 null, "commit": "..." }`。

## 休養中（2026-10-09）

管理者在詳細資訊最下面按「設定休養中」，填原因和到哪一天（含那天），通關碼跟我的備註同一組 `NOTES_PASSCODE`（手機記過就不用再輸入）。Worker 寫進 repo 的 `data/rest.json`（`{ "犬隻編號": { "until": "YYYY-MM-DD", "reason": "術後休養", "updatedAt": "..." } }`），不碰試算表。其他志工的手機等網站更新（一兩分鐘）就會看到。

- 設定：`PUT /rest/{編號}`，內容 `{ "passcode", "until": "YYYY-MM-DD", "reason" }`（`Content-Type: application/json`）。日期要在台灣今天到 180 天內，原因最多 40 字。
- 結束：`PUT /rest/{編號}`，內容 `{ "passcode", "end": true }`。
- 通關碼錯的回應同我的備註；成功回 `{ "ok": true, "id", "rest": { until, reason, updatedAt } 或 null, "commit" }`。

## 相簿（2026-10-09 拿掉）

K 2026-10-09：怕 Cloudflare 用量爆掉，相簿整個拿掉，只留主照片。網站不再顯示相簿、不能新增；Worker 的 `/gallery` 一律回 410，`photos/gallery/` 的照片不給看、不做縮圖，Trash 裡的相簿照片也不能復原。R2 裡原本的相簿照片要刪掉，步驟見 `docs/setup/CLOUDFLARE_SETUP.md`「刪掉相簿照片」。

## 誰遛的代號（V6，#95）

「我溜過」要認出你是誰：志工在網站上輸入自己在試算表「誰遛的」寫的名字，網站送到這個服務換成一串代號（例：`3f9a0c1b2d4e`），代號記在那支手機，名字不存。同步試算表時也用**同一把密鑰**把「誰遛的」換成代號寫進 `data/walks.json`，兩邊代號一樣，網站才找得到你的紀錄。公開的 repo 和網站只有代號，沒有名字。

- 已知限制：知道某人名字的人，也能在網站輸入他的名字，看到他遛過哪些狗。K 2026-09-26 同意先不加通關碼。
- 密鑰一旦開始用就**不要換**：換了以後，舊紀錄的代號就對不上，大家的「我溜過」會變空。

### 啟用步驟（這次 PR 合併後做一次）

1. **想一把密鑰**：一串 20 個字以上、別人猜不到的英數亂碼。可以用 iPhone「密碼」App 新增密碼時產生的強密碼。先存在自己的密碼 App，第 2、3 步要貼同一串。
2. **設定 GitHub**：repo 的 **Settings** → **Secrets and variables** → **Actions** → **New repository secret**：**Name** 填 `WALKER_KEY`，**Secret** 貼上密鑰，按 **Add secret**。
3. **設定 Cloudflare**：Worker 頁面 → **Settings** → **Variables and Secrets** → **Add**：**Type** 選 **Secret**，**Variable name** 填 `WALKER_KEY`，**Value** 貼上**同一串**密鑰，按 **Deploy**（或 Save）。
4. **重新貼程式**：照上面「步驟 3」的 4–7，把 Worker 程式換成最新的 `worker/src/index.js`，按 **Deploy**。
5. **確認**：打開服務網址，看到 `"walkerKey":"已設定"`。再到 GitHub 的 **Actions** 手動跑一次「同步試算表」，之後打開網站的「我溜過」輸入你的名字（要包含 `MY_NAME` 裡的第一個寫法，你以前的紀錄才會出現）。

### 服務的網址（給寫網站程式的人）

- `POST /sync`（不用內容）：叫 GitHub 跑「同步試算表」。成功回 `{ "ok": true }`；同一個人 2 分鐘內第二次回 429；GitHub 拒絕（多半是 token 沒開 Actions 權限）回 502。
- `POST /walker-code`，內容 `{ "names": ["小明、明明"] }`（`Content-Type: application/json`）。每個字串再照試算表的規則拆開（頓號、逗號、斜線、空白等），最多 8 個名字、每個 20 字。成功回 `{ "ok": true, "codes": ["...", "..."] }`（12 碼十六進位，不重複）。同一個人 1 分鐘最多 20 次。沒設定 `WALKER_KEY` 回 500。
- 算法：名字全形半形統一（NFKC）、去掉空白、英文轉小寫，`HMAC-SHA256(WALKER_KEY, 名字)` 取前 12 碼。跟 `scripts/sync-sheet.mjs` 的 `walkerCode` 一樣，兩邊的測試用同一組測試向量確認。

## 準時同步試算表（Cloudflare 定時叫 GitHub）

> 2026-10-16 起（#305、ADR 0012）改成「有改才同步＋每天 6:30 保險一次」，GitHub 自己的排程拿掉了；設定見 [SHEET_WRITE_SETUP.md](SHEET_WRITE_SETUP.md) 第 6 節。下面是舊 Worker 當時的步驟，留著當紀錄。

GitHub 自己的定時同步常被跳過（2026-09-27 從早上到下午只跑了一次），網站就一直是舊的。所以改由這個 Worker 當鬧鐘：台灣時間 7:00–22:30 每 30 分鐘叫 GitHub 跑一次「同步試算表」。GitHub 原本的排程（每小時 17、47 分）留著當備援。網站頁首的「更新」圓箭頭也是叫這個 Worker 馬上同步一次（同一支手機 2 分鐘 1 次），一樣要做完下面第 1、2 步才會動。

### 啟用步驟（這次 PR 合併後做一次）

1. **讓 token 可以叫同步**：GitHub 右上角頭像 → **Settings** → 左邊最下面 **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → 點 `板收照片上傳` → **Edit**。
   在 **Repository permissions** 找到 **Actions**，改成 **Read and write**，拉到最下面按 **Update**。token 那串字不會變，Cloudflare 的 `GITHUB_TOKEN` 不用動。
2. **重新貼程式**：照上面「步驟 3」的 4–7，把 Worker 程式換成最新的 `worker/src/index.js`，按 **Deploy**。
3. **設定鬧鐘**：Cloudflare 的 `bq-shelter-photos` → **Settings** → **Trigger Events**（舊版畫面叫 **Triggers**）→ **Add** → **Cron Triggers**。
   選自訂寫法（Cron expression），貼上下面這串，按 **Add**（或 Deploy）：
   ```
   0,30 23,0-14 * * *
   ```
   這串是 UTC 時間，換成台灣時間就是每天 7:00–22:30、每個整點和半點。
4. **確認**：等到下一個整點或半點過後幾分鐘，打開 GitHub repo 的 **Actions** → **同步試算表**，最上面應該有一筆新的綠勾勾，觸發方式寫 `workflow_dispatch`。
   如果是紅叉叉或沒有出現：Cloudflare 的 Worker 頁面 → **Logs**／**Cron Events** 會看到「叫同步失敗（GitHub 403）」之類的訊息，多半是第 1 步的 Actions 權限沒存到，回去再檢查一次。

## 給用命令列的人

`worker/wrangler.toml` 已經設定好，在 `worker/` 資料夾執行：

```
npx wrangler deploy
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put NOTES_PASSCODE
npx wrangler secret put WALKER_KEY
```

自動測試（模擬 GitHub，不會真的上傳）：`node --test worker/test/worker.test.mjs`
