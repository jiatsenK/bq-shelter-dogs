# 2026-10-19 #360 移除群名表缺表相容判斷

- 日期：2026-10-19（台灣時間）
- Agent：CODEX。
- 依據：Issue #360、ADR 0008；使用者確認沿用 readSeed(query) 測試邊界。
- 做了什麼：移除 OPTIONAL_TABLES 與群名表缺表視為空資料的判斷和註解；保留同步日期表原有相容處理。
- 驗證：原同步測試 36 項通過；調整缺表測試後先紅（Missing expected rejection），修改後 36 項全綠；Node 全套 287 項與網頁 258 項及附加互動測試通過；node --check 與 diff --check 通過。
- 審查：以 6d41d6836719b1769bb998f12c4cacbcaa34aec3 為基準，Standards／Spec 各自獨立審查，均無需修正項目。
- 例外或未完成：未寫正式 D1、未部署；正式資料預演待 PR CI。只提交本票三個檔案，保留既存未提交工作。
- 後續：K 同意後，從 origin/main（fb00d9f）建立 codex/issue-360-remove-optional-tables，僅移入本票提交；最新基準 Node 全套 313 項通過，正式資料預演由 PR CI 留言。
- 相關 PR：以 Closes #360 連結；未合併、未部署。
