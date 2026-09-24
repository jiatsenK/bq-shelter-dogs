# Agent 操作紀錄

這份檔案記錄 AI Agent 對本 repository 做過的實際寫入，供 ChatGPT、Claude、Codex 或其他 Agent 接手時快速確認進度。

## 規則

- Agent 開始修改前，先閱讀本檔最近紀錄。
- 任何 Agent 對 repository 做實際寫入後，都必須追加一筆紀錄。
- 紀錄至少包含：日期、Agent、做了什麼、資料來源／依據、例外或未完成事項、相關 PR／commit。
- 只追加新紀錄，不覆寫舊紀錄。
- Git commit / PR 仍是程式碼變更的正式歷史；本檔負責記錄工作脈絡與交接資訊。

---

## [2026-09-25] ChatGPT | 建立主清單狗卡骨架
- 來源：Google 試算表「板收志工遛狗紀錄表」的「主清單」。
- 比對結果：主清單有 118 隻具有有效編號的狗。
- GitHub `dogs/` 原本已有野口（2024032902）；另有豆花（2026091401），豆花當時不在主清單。
- 新增 117 個 `dogs/{編號}.md` 狗卡骨架，只寫入 `name` 與 `id`。
- 未寫入會持續變動的遛狗日期、遛狗者、備註等試算表欄位。
- 跳過 3 筆無編號資料：金寶、米香、（咖啡新狗）。
- PR：#37（`add-dog-cards-20260925`）。
- Commit：`f92b06d404420f5713afb22ae84beea954e0ab51`。
- 下一步：狗卡圖片依編號分批辨識，保留原文並寫入對應狗卡；無法確認的內容不可猜測。

## [2026-09-25] Claude | #31 GitHub Action 定期同步試算表，產生 data/dogs.json
- 依據：Issue #31（V3 規格第 5.1、6 節）；排程依 K 2026-09-24 指示改為每天台灣時間 9:00、13:00、21:00。
- 新增 `.github/workflows/sync-sheet.yml`（排程＋可手動 Run workflow，資料有變才提交）與 `scripts/sync-sheet.mjs`（解析邏輯照抄前端 `js/app.js`）。
- 新增 `scripts/sync-sheet.test.mjs`（`node --test scripts/`）：模擬 gviz 測試，並與前端解析結果比對。
- 讀取失敗、欄位被改、讀到 0 隻狗時不寫檔，保留上一次的 `data/dogs.json`。
- 未完成：雲端連不到 Google，只用模擬資料測過；合併後需 K 在 Actions 手動 Run workflow 驗收真實資料。前端改讀 `dogs.json` 屬 #32。
- PR：#38（`claude/project-thread-f59fa3`）。
