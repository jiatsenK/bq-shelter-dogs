# #474 常溜狗群只讀與整張讀取例外核對

- 日期：2026-10-24。Agent：CODEX。依使用者 `/implement #474` 在目前分支 `claude/test-site` 實作、檢查、審查及提交；沒有交辦推送或建立 PR。
- 依據：#474 2026-10-24 已確認決定；#552 只更新名詞表，沒有完成本票程式。#538 現有待辦已指向 #474，保留未完成狀態直到部署驗收。
- 網站：主頁狗群與舊獨立頁移除加狗、移出、建立群的入口及事件；提示到試算表「常遛狗群」分頁修改。保留整群溜狗登記、復原、同行人與舊 kind=group 編輯紀錄。
- Worker／GAS：刪除狗群寫入路由、writeGroup、mainNameMatcher、replaceGroup、saveGroup、group 動作與計畫寫入函式。舊 `/groups` 回 404：功能與路由已刪；另擋預設照片上傳處理。保留 GAS groupLayout、編輯觸發、掃描與 Worker applyGroup。
- FULL_SCAN_OK：逐筆核對呼叫點，記載版本快取重建、首次身分銜接、GAS 異動補送、排程掃描、固定大小交易檢查表、離線測試對照等原因；移除已刪 matcher 的例外。沒有 schema 或正式資料變更。
- 驗證：先紅後綠確認舊 POST /groups 被退役；相關 Node／頁面套件通過。Standards／Spec 獨立審查及增量複審皆 0 待修項（固定基準 `a217e5d` 至工作樹）；首次身分銜接例外依 #474 明文分類，另測既有 code 在新增 100 位無關志工後讀取量固定，不宣稱首次銜接固定。最終 `check-local.ps1 -Full` 通過：414 項 Node、全部網頁套件（index 263 項），紀錄 `.scratch/checks/1792851960912-9925d3df-1042-4278-8c48-5977ef9d2f90.json`。JS 語法及 diff 檢查通過，repo 無型別檢查入口。全套另抓到 `scripts/api.test.mjs` 使用已刪函式，已改用仍存在的活動寫入端點保留相對路徑驗證。
- 例外／未完成：本機 headless Chromium 需在沙箱外啟動（沙箱內 spawn EPERM）。impeccable detect 回報既有頁面樣式警告，本次不變動既有視覺規格。
- 相關 PR：本次未建立。後續 PR 說明需附下面 Apps Script 部署步驟。#550 整欄插入／刪除驗收不在本票。

## 合併後由 K 重新部署 Apps Script

1. 開啟正式試算表綁定的 Apps Script 專案，將 `apps-script/sheet-write.gs` 完整內容貼回對應指令碼並儲存。
2. 選「部署 → 管理部署作業」，編輯目前 Web App 部署，版本選「新版本」，部署；沿用原有 URL、執行身分與存取權限，Worker 不需更改密鑰。
3. 保留原本編輯與排程觸發器；本次沒有新增觸發器，不用重裝。確認網站沒有狗群編輯入口，直接在試算表「常遛狗群」修改名單後，重新整理網站確認同步。
4. 確認歷史狗群編輯紀錄仍可檢視；整欄插入／刪除另外依 #550 驗收。
