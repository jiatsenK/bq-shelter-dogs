# #565 三項顯示與七項志工編輯開關

- 日期：2026-10-25。Agent：Codex；分支 `codex/565-feature-settings`，獨立 `.scratch/565-worktree`。
- 依據：#562／#565；K 明確授權第二階段由 Codex 實作，取代票內僅規劃／Claude 分工舊敘述。基準 origin/main `856aa6c`（含 #573）。保留共享目錄及其他 worktree 原狀。
- 變更：十項 boolean＋revision，Access 管理表單、同來源 PUT、條件更新與同交易 audit、七項志工伺服器 gate、志工正常載入／更新與入口顯示。公開設定不含管理身分；核心、GAS、機器作業不經 gate。
- Schema：核對主線 0000–0002 與進行中 #574（未新增 migration），新增 0003，compact-schema 同步。正式套用與安全回復、成本邊界見 docs/operations/feature-settings.md。
- 測試：check-local.ps1 新契約先紅後綠；版本競爭、無差異、audit 失敗回復、Access／跨來源、七項真實路由、顯示重讀與舊連結。完整測試與兩軸審查結果收尾補記。
- 未執行：合併、正式 migration、部署、Access 變更、正式資料寫入；不做 #566–568。
- 相關 PR：待草稿建立後補記。
- 審查：固定基準 `856aa6c`；Standards 初審 1 項（固定成本量測）、Spec 初審 1 項（活動既有草稿重讀後仍能操作），均已補修並由原獨立代理複審通過。成本測試比較 10／100 筆 audit，SELECT 走主鍵；成功改動 2 列、無差異 0 寫。
- 整合補修：schema 可重跑且不重設設定；照片測試 stub 與新增一列讀取成本更新；原生模組／舊單元 API fixture 明確提供全開設定，新功能套件另外驗證真實 HTTP 設定失敗與關閉。新套件含管理表單、409 草稿、設定失敗、活動既有草稿關閉／恢復、舊連結；index 264 項通過。
- 設計 detect：只有 Tabler vendor 內未使用 animated-dots 動畫提示，非本次實作；未更動 vendor 或既有設計 sidecar。新管理表單沿用原生 Tabler，390／1440px 無整頁溢出。
