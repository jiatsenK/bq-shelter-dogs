# 2026-10-17 拿掉分析頁月統計，單隻狗歷史只用近期溜狗紀錄（#345）

- Agent：Claude Code
- 依據：#345、#343、ADR 0013

## 做了什麼

- `public/js/analysis.js`：拿掉「本月溜狗」區塊（`monthWalks`、`monthWalksSection`），分析頁不再讀 `api/walks`。
- 詳細資訊的溜狗紀錄：30 天格子不變；平均、最久隔幾天只用上個月 1 號到今天的紀錄算（`recentStart`）。範圍開始前就有紀錄、範圍內一次都沒溜時顯示「最久超過 62 天沒溜」。
- `public/css/app.css`：拿掉 `.a-month`、`.a-days` 等月統計樣式；`tests/index.html` 拿掉月統計測試，補近期範圍的測試。

## 未完成／注意

- `/api/walks` 本身沒改，回傳範圍由 #344 處理。
