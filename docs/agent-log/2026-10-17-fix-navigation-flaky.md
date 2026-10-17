# 2026-10-17 修主頁導覽測試偶發逾時

- Agent：Claude Code（Opus 5.5）
- 做了什麼：`tests/navigation.cjs` 最後的鍵盤步驟原本是 `focus()` 後直接按 Enter。分頁列每次 render 都用 innerHTML 換掉按鈕，焦點跟按鍵之間如果剛好重畫，Enter 就沒切到「我溜過」，`selected('mine')` 等到逾時。改成確認焦點真的在按鈕上才按，沒切到就重按，直到切換成功或 10 秒逾時（逾時會寫出當下焦點在哪個元素）。只改測試，網站程式碼沒動。
- 依據：PR #380 只改 `public/website-updates.json` 卻在 CI 失敗（run 39029532798 第一次，第 77 行 TimeoutError），重跑就過；做法參考 #338（等實際狀態，不靠固定等待時間）。
- 驗證：本機 `node scripts/run-browser-tests.cjs` 連跑 6 次全過。本機一直沒重現失敗，所以「重畫搶走焦點」是推斷的原因，不是親眼看到的。
- 未完成：如果之後還偶發，逾時訊息會寫出當下焦點，可以用來查真正原因。
