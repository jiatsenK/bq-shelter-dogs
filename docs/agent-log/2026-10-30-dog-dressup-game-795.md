# 2026-10-30 資訊頁加小遊戲：狗狗變裝秀（#795）

- Agent：Claude Code（Opus 5.5），分支 `claude/issue-795-a20237`
- 依據：#795。原型是 K 在 claude.ai 的私人頁面（第 16 版），原型程式與臉部位置腳本在 #769 那個 worktree 的暫存資料夾，這次照它搬進網站。

## 做了什麼

- 新頁 `public/games.html`＋`css/games.css`＋`js/games-entry.js`、`js/games.js`、`js/dress-up.js`：小遊戲選單（狗狗變裝秀、更多遊戲・準備中、模型來源與授權）、遊戲中、結算在同一頁切換。網址 `games.html` 是選單、`#dressup` 是遊戲；返回鍵與左上角返回走 overlays.js（遊戲中、結算回選單，選單回資訊頁）。分享截圖也註冊成覆蓋層，返回鍵先關它。
- `overlays.js`：`BACK_ORDER` 多 `gameShot`；新增 `leaveTo`，從資訊頁點進來的就走上一頁，直接打開的照網址換頁。
- 資訊頁入口：手機分類清單在「分享網站連結」前多「小遊戲」（按鈕，跟其他列一樣，ADR 0024 手機不用連結），電腦版左邊清單在「使用說明」前多「小遊戲」（連結 `games.html`）。不是資訊子頁。
- `scripts/dog-faces.py`：讀正式站 `/api/dogs` 與照片原圖，模型執行時下載到 `.scratch/dog-faces/model/`，照票上的門檻篩選，輸出 `public/data/dog-faces.json`（一隻狗一行），印出可以出題與不收的數量、原因，並畫對照表 `.scratch/dog-faces/sheet-*.png`。`/api` 只收同網站要求，腳本帶 `Origin`。正式網址不寫進 repo（#493），用 `--site` 傳。
- `public/data/dog-faces.json`：10/30 用正式站實跑，117 隻有編號、有照片，97 隻可以出題；不收的：側臉 12、模型結果不穩 6、照片太小 2。跟原型結果一樣。
- 測試：`tests/games.cjs`（加進 `run-browser-tests.cjs`），`scripts/dog-faces.test.mjs` 檢查臉部位置檔格式。
- 文件：`public/js/README.md`、`docs/ARCHITECTURE_NOW.md`（資料放哪）、`docs/ARCHITECTURE.md`（「沒畫」那行加上腳本）。研究筆記 `2026-10-30-dog-face-decoration-research.md`、`2026-10-30-huggingface-ideas-research.md` 從 #769 worktree 一起帶進來。

## 例外與要注意的

- 網站沒有深色版，小遊戲頁固定淺色（`color-scheme: light`），跟其他頁一致；測試驗手機開深色模式時背景、文字還是淺色配色。
- 配色、字型照志工網站（病歷夾綠頁首、系統中文字型），不用原型的鐵絲網色帶、狗牌黃與 Google Fonts。
- 截圖對話框只有「長按存圖」和手機支援時的「分享」；原型的「存到手機」是 claude.ai 專用功能，沒搬。
- 對照表畫的是裝飾會戴的位置（頭頂、兩眼、鼻子、人中、脖子），不是畫好的裝飾；要看實際戴起來的樣子，開小遊戲頁玩。
- 10 秒倒數時間到的路徑沒有自動測試（要等 10 秒）。
- 新狗或換照片後要 K 本機重跑：`python scripts/dog-faces.py --site <正式網址>`，再開 PR。

## 審查與測試

- code-review 兩軸（基準 origin/main）：
  - Standards：games.css 的色票改用 app.css 的變數名稱，測試網站改覆蓋 `--shell`（分享截圖頁首也會變紫），截圖底色改讀變數；畫面和截圖共用同一段裝飾 SVG；`leaveTo` 改成比對傳進來的網址，不寫死 index.html；新網址與返回規則補進 ADR 0024。
  - Spec：長相（4×4 色塊）全部算完才開放開始，第一題就有長得像的選項；倒數改從照片出現（或確定讀不到）才開始；腳本把點限制在 0～1。
  - 沒改：脖子 92% 比的是正方形畫面座標，跟原型一樣；裝飾是 19 種洗牌後依區挑，跟原型一樣；每題照片隨機轉 ±4° 是原型行為。
- games、info-page、share-site、desk-info、es-modules、index 套件與相關 Node 測試通過，最後跑 `-Full`。

## 相關 PR

- （開 PR 後補）
