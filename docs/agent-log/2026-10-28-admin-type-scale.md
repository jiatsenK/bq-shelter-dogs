# 2026-10-28 管理網站字級收成四級
- Agent：Claude Code（Opus 5.5）。
- 依據：K 執行 `/impeccable critique 管理網站`（23/40），覺得字級很奇怪。中間試過整套改版「戶政謄本」（淡藍灰底、思源宋體標題、全格線表格），K 看了成品覺得死板、表格線太多、不喜歡字型，決定「先維持原本的風格，調整字級」。改版的程式、自架宋體、mock 都已退回或刪除，沒有進 repo。
- 做了什麼：`admin/public/admin.css` 把散落的九種字級（11／12／13／14／16／18／20／24／28px）收成四個變數 28／20／15／13px，Tabler 寫死的輸入框、按鈕、`small` 字級接回這四級；內文 14→15px、行高 1.5；`pre` 改用內文字型。字級變大後兩處列高會在抽屜開關時跳動（沒照片的列、維護狀態標籤換行），補了無照片列撐到照片高度、維護狀態欄至少 240px。規格寫進 `docs/design/admin.md` Typography。
- 驗證：check-local 管理網站七組（admin、admin-dog-edit、admin-dog-merge、feature-settings、admin-stage4、admin-hide-edits、admin-diagrams）通過；本機假資料 headless 截圖八頁 1440／390px 看過。
- 未完成：顏色、側欄等「個性」調整沒有做，等 K 看過字級再說。critique 快照留在本機 `.impeccable/critique/`（未追蹤）。
- PR：見本分支 PR。
