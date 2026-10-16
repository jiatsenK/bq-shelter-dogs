# 2026-10-16 首頁暫時公告：D1 額度用完

- Agent：Claude Code（Opus 5.5）
- 做了什麼：首頁頁首下方加可關閉的提示橫幅（`public/index.html` 的 `#notice`、`public/css/app.css` 的 `.notice`、`public/js/app.js` 的 `initNotice`）。關掉記在這支手機的 localStorage（key 帶日期）。
- 依據：K 2026-10-16 指示公告文字；起因是 D1 免費寫入額度（每天 10 萬列）被同步刪光重寫用完（#301）。
- 未完成：同步恢復後要整段拿掉（三處都有「暫時公告」註解）。止血與差異同步還在追問中。本機沒有 Playwright Chromium，網頁測試交給 CI。
