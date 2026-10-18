# 三張介面實作票交接

日期：2026-10-17。Agent：CODEX。K 已確認定版與拆票；本輪只整理規格、保存參考、建立／補充實作票，沒有開始寫正式介面。

## 順序與相依

| 順序 | GitHub 票 | 負責 | 真正阻擋 | 本票可驗收的結果 |
|---|---|---|---|---|
| 1 | [#373 主頁四格導覽](https://github.com/jiatsenK/bq-shelter-dogs/issues/373) | Claude | 無 | 四入口可用、切換／返回正確、原主頁回歸；後兩頁先承接既有內容 |
| 2 | [#273 資訊分類與更新紀錄](https://github.com/jiatsenK/bq-shelter-dogs/issues/273) | Claude | #373；活動完整驗收另需 #270 | 五類首頁／子頁、活動與更新紀錄接通；保留既有查詢與錯誤處理 |
| 3 | [#374 常遛狗群定版](https://github.com/jiatsenK/bq-shelter-dogs/issues/374) | Claude | #373 | 全量群滑動、定版照片卡與白話日期、加狗／開群、整群／排除例外登記接通 |

依 K 的順序一票做完再開下一個實作視窗，不同時改共用介面。#374 不依賴 #273 的業務邏輯，兩者只受本次排程約束；#270 是既有前置，不是本輪另開的第四張票。

發佈後已讀回確認：三票均 OPEN、`ready-for-agent`；GitHub 原生相依為 #273 ← #373／#270，#374 ← #373。#273 原內文保留，[交接留言](https://github.com/jiatsenK/bq-shelter-dogs/issues/273#issuecomment-6232933844) 補充順序與前置。實作時仍需重新查當時狀態。

## 接手先讀

1. repo 的 AGENTS.md、現行全域規則與 `docs/agents/agent-split.md`。
2. [本批正式規格](mobile-ui-implementation-spec.md)。
3. 所接 Issue 的完整內容、留言、最新原生相依與 PR。
4. [主頁定版圖](mobile-home-approved-2026-10-17.png)；接狗群票時另讀 [狗群定版參考](common-walk-groups-approved-2026-10-17/README.md)；接資訊票時讀 [#273 規格](../273-info-page.md)。

本機另保留逐票發佈內容：[第一票](implementation-tickets/01-mobile-navigation.md)、[#273 交接補充](implementation-tickets/02-info-page-273-handoff.md)、[第三票](implementation-tickets/03-common-walk-groups.md)。後續以 GitHub 票與最新已確認規格為準，不用這些副本代替讀票。

## 新視窗可貼的開場

**第一個實作視窗：**

> 在 bq-shelter-dogs 實作 #373。先讀 AGENTS.md、docs/design/mobile-ui-implementation-spec.md 與 Issue 全部內容，核對最新遠端、既有 PR 和本機未提交工作。保持主頁定版，只完成這一票的四格導覽與可用切換。依 implement 流程執行測試與適當 code-review，一票一分支／PR；不要開始 #273／#374，不合併或部署。

**第二個實作視窗（第一票完成後）：**

> 在 bq-shelter-dogs 接續 #273，先讀同一份正式規格與本票所有留言，確認 #373 介面以及 #270 活動核心狀態。依現有資訊規格做完整內頁與驗收，不重畫主頁、不另做重複活動後端；一票一分支／PR，測試與適當 code-review 後停止，不合併或部署。

**第三個實作視窗（第二票完成後）：**

> 在 bq-shelter-dogs 實作 #374，先讀正式規格、Issue 全文與 docs/design/common-walk-groups-approved-2026-10-17/README.md。使用最後白話日期版，不回到無照片／圓泡泡／卡片日期版本；核對 #373 共用導覽。完成全量群與既有真實讀寫流程，一票一分支／PR，測試及適當 code-review 後停止，不合併或部署。

## 工作樹與發布界線

- 本輪開始時：`chore/cleanup`，HEAD `a159b371bf5cc71e425ed757c33d291aef267b93`，本機落後遠端。查核遠端 main 曾為 `3a20bfaf6d1ab3c5fb1f5cc8d73cbce118f06573`；其他工作仍在進行，開工要再核對。
- `GLOSSARY.md`、活動 ADR、資訊規格／訪談等有既有未提交工作，不可 reset／clean／覆蓋，也不能把不相關檔案混進任何票的 commit。
- 本次定版文件、圖片與片段只保存於本機 repo，尚未 commit 或推送；GitHub 票文字已可獨立說明需求，但雲端 checkout 尚取不到這些圖片。先用可讀本工作區的本機視窗；如需跨機／雲端，先依第一票既有分支流程帶入所需文件，不另開第四張實作票。
- 未建立實作視窗、未發送跨視窗任務，沒有實作、commit、push、PR、合併、部署、同步或正式資料寫入。
