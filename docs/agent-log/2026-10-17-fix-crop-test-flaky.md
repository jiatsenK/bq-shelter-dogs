# 2026-10-17 修正裁切網頁測試偶發失敗

- Agent：Claude Code
- 依據：PR #328 的 CI（run 38941064078）網頁測試「裁切：可換比例；Esc 取消不改照片」第一次失敗、重跑才過，錯誤 `Cannot read properties of null (reading 'url')`。

## 原因

`openCropper` 要先 `await img.decode()` 才顯示裁切畫面。測試按「裁切」後只等固定 50ms，CI 慢時裁切畫面還沒出現，這時送出的 Esc 被詳細資訊接走 → `closeDetail` → `hideDetail` → `clearPhotoUpload()`，`photoUpload` 變成 null。正式程式行為正確（裁切畫面出現前按 Esc 本來就是關詳細資訊），只改測試。

## 做了什麼

- `tests/index.html` 裁切兩項測試：改成等裁切畫面真的出現（`cropOpen()` 且框已算好），完成後等預覽網址真的換掉，不再用固定 setTimeout(50)／(30)。等不到 2 秒就報錯，訊息會寫在等什麼。
- 本機 `node scripts/run-browser-tests.cjs` 連跑 3 次，258 項全過。

## 未完成

- feat/333-stays 之前的網頁測試失敗沒有查（沒有失敗紀錄可對照）。
