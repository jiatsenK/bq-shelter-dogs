> #501 起 GitHub Actions 不再同步試算表（`sync-sheet.yml` 已刪），狗清單改由 Apps Script 編輯觸發送 Worker，見 `SHEET_WRITE_SETUP.md` 第 8 節；#512 起本機備援腳本 `scripts/sync-compact-d1.mjs` 也已刪除。下面留作歷史。
>
> #595 起部署也不再把 GitHub Secret `SHEET_ID`、`MY_NAME` 帶到 Worker（Worker 沒在讀），兩個 Secret 都可以刪。Apps Script 指令碼屬性的 `SHEET_ID` 還在用，不要刪（見 `SHEET_WRITE_SETUP.md`）。

# 試算表 ID 設定（GitHub Secret）

每天自動同步試算表（`.github/workflows/sync-sheet.yml`）需要知道試算表的 ID。
這個 repo 是公開的，而試算表目前「知道連結的人都能編輯」，所以 ID 不寫在程式裡，改放在 GitHub 的 Secret：只有同步程式讀得到，網頁上看不到內容。

## 第一次設定（全部在網頁上完成）

1. 打開試算表，從網址複製 ID：網址裡 `/d/` 和 `/edit` 中間那一長串英數字。
2. 打開 GitHub 上的這個 repo → 上方 **Settings** → 左邊 **Secrets and variables** → **Actions**。
3. 按 **New repository secret**：
   - **Name**：`SHEET_ID`
   - **Secret**：貼上第 1 步複製的 ID（前後不要有空白）
4. 按 **Add secret**。
5. 到 **Actions** → 「同步試算表」→ **Run workflow** 手動跑一次，出現綠色勾勾就代表設定成功。

## 沒設定或設錯時

同步會失敗（Actions 頁顯示紅色叉叉，錯誤訊息會寫「沒有設定試算表 ID」或讀取失敗），網站繼續顯示上一次成功同步的資料，不會壞掉。回到上面第 2–4 步修正（Secret 可以按 **Update** 重貼）即可。

## 換試算表時

只要更新 Secret `SHEET_ID` 的內容，不用改程式。

## 「是不是我遛的」：設定 Secret `MY_NAME`（選填）

> #557 起 Worker 不再讀 `MY_NAME`、`/api/dogs` 不回 `myWalked`／`myWalkedDate`（網站早就沒在讀）；這個 Secret 可以刪掉。

同步時會比對試算表「誰遛的」欄位是不是你，公開的資料只寫「是／不是」（`myWalked`），你的名字不會出現在網站或 repo 裡。

1. 同上面第 2–3 步，按 **New repository secret**：
   - **Name**：`MY_NAME`
   - **Secret**：你在試算表「誰遛的」欄填的名字。有好幾種寫法（例：本名和暱稱）可以用頓號或逗號隔開，例如 `小明、明明`。
2. 按 **Add secret**，再到 **Actions** 手動跑一次「同步試算表」。

比對規則：名字要完全相同才算（空白不計）；格子裡寫了好幾個人（例：「小華、小明」）時，只要其中一個是你就算。

沒設定 `MY_NAME` 時同步照常，只是每隻狗都當作「不是我遛的」。設定之後才開始記，之前的遛狗紀錄沒辦法補判斷。

> V6（#94）起「我溜過」改成每個志工看自己的代號，`MY_NAME` 只剩把你以前的紀錄轉成你的代號用，之後會移除（#97）。

## 誰遛的代號：設定 Secret `WALKER_KEY`

同步時把「誰遛的」每個名字用這把密鑰換成一串代號，寫進 `data/dogs.json`（`walkers`）和 `data/walks.json`，名字本身不會出現在網站或 repo。網站上的「我溜過」靠同一把密鑰（放在 Cloudflare Worker）認出每個志工，所以**兩邊要設同一串**，Worker 那邊用的是 GitHub Secret `WALKER_KEY`，部署時自動帶上去（`docs/setup/CLOUDFLARE_SETUP.md` 步驟 4），同步也讀同一個 Secret，所以設一次就好。

- 第一次設定後的同步，會把舊紀錄補上代號：每隻狗目前的最後一次（試算表還看得到是誰），和標了 `mine` 的舊紀錄（補 `MY_NAME` 第一個寫法的代號）。其他志工以前的紀錄沒存名字，補不回來。
- 密鑰設定後**不要換**，換了舊紀錄的代號就對不上。
- 沒設定 `WALKER_KEY` 時同步照常，只是沒有代號。
