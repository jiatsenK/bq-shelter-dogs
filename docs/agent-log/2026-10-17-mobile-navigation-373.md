# 2026-10-17 主頁四格導覽（#373）

- Agent：CODEX；依據：#373 與 K 指定 implement 373。
- 隔離工作樹：`.scratch/issue-373`，分支 `codex/373-mobile-navigation`，基準 main `3a20bfaf6d1ab3c5fb1f5cc8d73cbce118f06573`。原 `chore/cleanup` 的未提交文件保持。
- 底部改為「遛狗表／常遛狗群／我溜過／資訊」；資訊承接現有分析，狗群以同來源 iframe 承接既有正式 groups.html 與 API，保留獨立頁舊入口。沒有提前實作 #273／#374。
- 主導覽切換接 history，手機返回／前進恢復分類與焦點；保留籠位定位、#find 舊連結及教學。狗群內事件不冒泡至外層主分類。320／390px、安全區沿用原站規則；桌機頁首可換行，內頁導覽仍可操作；嵌入群內控制項補足 44px。
- 未改 Worker、同步、資料契約或資料寫入流程；測試使用 API fixture，無正式資料操作、合併或部署。

## 驗證與審查

- 修改前確認舊三格名稱斷言失敗；修改後新增正式 DOM 流程測試 `tests/navigation.cjs`，由既有網頁 runner 執行。
- Node：287／287；網頁：259／259，另含導覽（實際狗群、資訊、返回／前進／焦點、搜尋、鍵盤、320／390／1100／1280px）、既有詳細狗卡編輯流程。
- JavaScript 語法及 git diff --check 通過；專案沒有獨立型別檢查指令。
- code-review Standards／Spec 分別審查：修正桌機內頁導覽被舊 CSS 隱藏、嵌入群內點擊區不足，新增對應回歸。
- impeccable context／detect 已執行；偵測包含既有色籤、陰影、字級、圓角等警告。依定版範圍保留既有設計，未重畫；未更新過期的 design.json。
- 限制：headless 自動化不等於實機 Safari／Android 系統返回手勢與安全區驗收；iframe 為 #374 取代既有狗群內容前的過渡承接。
- 相關 PR：本分支的 #373 PR（內文 Closes #373）；待擁有者驗收，禁止自動合併／部署。
