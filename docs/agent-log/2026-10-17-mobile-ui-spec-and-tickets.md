# 2026-10-17 手機介面定版與三票交接

- Agent：CODEX。
- 依據：K 確認最後白話日期狗群示意「好，這樣訂版」，並同意三票、一票一個實作視窗，依主頁導覽 → 資訊 → 常遛狗群順序做。

## 實際整理

- 更新 `docs/design/mobile-home-and-groups-decisions.md` 的接手入口與狗群定版；保留舊探索為已失效歷史，不再要求下一視窗做無照片構圖。
- 新增 `docs/design/mobile-ui-implementation-spec.md`，寫明鎖定外觀、既有資料契約、外部行為驗收及範圍。
- 保存最後 `plain-walk-history.html` 片段與兩群 320px 參考圖到 `docs/design/common-walk-groups-approved-2026-10-17/`，明示兩群／固定日期／假登記只是原型，主頁仍有自己定版圖。
- 新增 #373 主頁四格導覽、#374 常遛狗群；資訊沿用 #273，不另開票。逐票內容與接手文字存於 `docs/design/implementation-tickets/` 和 `mobile-ui-tickets-handoff.md`。
- 讀回 GitHub #273／#270，兩者仍 OPEN；#270 活動核心尚為 #273 完整驗收前置。技術相依與 K 指定排程分開，不誤將 #273 當 #374 的技術阻擋。

## 驗證與未完成事項

- 基準：本機 `chore/cleanup`、`a159b371bf5cc71e425ed757c33d291aef267b93`，遠端查核 main `3a20bfaf6d1ab3c5fb1f5cc8d73cbce118f06573`。沒有 fetch／reset／改寫其他既有變更。
- 本輪只改文件與保存設計證據；未更動網站／Worker、執行完整程式測試、建立實作視窗、commit／push／PR、合併、部署、同步或正式資料寫入。
- 圖與片段尚未推上 GitHub，跨機／雲端接手須先帶入；本機視窗可直接讀。
- GitHub 最後讀回：#373、#273、#374 均 OPEN、`ready-for-agent`；#273 原內文未覆蓋，交接留言已保存（issuecomment-6232933844），移除原 `needs-triage`。
- 原生相依讀回：#273 blocked by `[373,270]`；#374 blocked by `[373]`。沒有建立 #273 → #374 的假技術依賴，仍按 K 的 1 → 2 → 3 排程逐票執行。
- 定版 HTML 與最後原型 SHA-256 相同：`EA1DA0C80194BE317A70FDBBE0100B1239A47FF87A8077B6A126A596F3492A43`。本次設計文件的 22 個本機參考連結皆存在；`git diff --check` 通過。
- 相關 PR：無。
