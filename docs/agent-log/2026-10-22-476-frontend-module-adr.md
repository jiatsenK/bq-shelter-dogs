# 2026-10-22 #476 前端模組過渡 ADR

- 日期：2026-10-22
- Agent：CODEX
- 依據：#476、母票 #471 已確認的檔案連接方式與行為邊界。
- 變更：新增 ADR 0017，記錄一般 script、每支新檔一個全域名稱到 ES module 的分段方向；AGENTS.md 增加依任務載入的指向。
- 驗證：固定基準 `14771bcd2a5b9038cf0908dec38c3facb6d31ba8` 至工作樹的 Standards／Spec 兩軸審查各 0 項問題；經 `check-local.ps1 -Full` 執行，Node 427 項、網頁 index 262 項與其他網頁套件全過。純文件變更，沒有適用的新增 TDD 測試或型別檢查。
- 例外／未完成：本票不實作後續拆檔、ES module 切換或資料改名；未部署、未修改正式資料。
- 相關 PR：`codex/476-frontend-module-adr` 對應 #476 的 PR；先開草稿，本機完整測試完成後轉正式。
