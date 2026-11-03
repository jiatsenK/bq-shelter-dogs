# 2026-11-03 拿掉管理網站的系統架構圖頁

- Agent：Claude Code（Opus 5.5），分支 `claude/remove-admin-architecture-page`
- 依據：K 2026-11-03「管理網站的那個我想拿掉，我只想留放在 claude.ai 上的」，取代 K 2026-10-28 加這一頁的決定。

## 做了什麼

- 拿掉 `diagrams.html`、`js/diagrams.js`、側欄「系統」這組、建置時畫 SVG 的步驟，以及只有這頁在用的 Mermaid 與 Geist 字型。部署管理網站不再裝無頭瀏覽器、不再抓完整 git 歷史。
- `scripts/admin-diagrams.mjs` 只留讀文件的部分，改名 `scripts/architecture-doc.mjs`。

## 例外與要注意的

- `docs/ARCHITECTURE.md`、事實核對、PR 重畫提醒都留著，claude.ai 的總覽頁從這份產生。
- 少了「每張 Mermaid 都畫得出來」的測試，語法寫壞要到 GitHub 或產生總覽頁時才看得到。
- 管理網站只能手動部署，合併後要按「部署管理網站」才會生效。舊網址 `/diagrams.html` 之後會找不到。

## 相關 PR

拿掉系統架構圖頁的那張 PR。
