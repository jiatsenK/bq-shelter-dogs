# 2026-10-21 常溜狗群拿掉讀取時間

- Agent：Claude Code。
- 依據：#444（K 確認：只留主頁右上角的資料時間）。
- 改動：`public/js/group-stage.js` 的 `#gwSource` 不再顯示「網站狗群・讀取 時間」，只在背景檢查時顯示「檢查中…」、失敗時顯示「檢查失敗，保留先前內容」與「重新讀取」；平常是空的。`checkedAt` 仍用於 30 秒後背景重讀。`docs/DESIGN_GUIDE.md` 頁首段補一句。
- 測試（先紅後綠）：`tests/group-cache.cjs` 加斷言：狗群頁平常 `#gwSource` 為空、沒有「讀取 時間」，頁首 `#updatedLabel` 仍有「資料更新」。
- 衝突注意：#443（箭頭位置）另一個 session 同時改常溜狗群，若衝突就 merge main。
