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
