# #565 三項顯示與七項志工編輯開關

- 日期：2026-10-25。Agent：Codex；分支 `codex/565-feature-settings`，獨立 `.scratch/565-worktree`。
- 依據：#562／#565；K 明確授權第二階段由 Codex 實作，取代票內僅規劃／Claude 分工舊敘述。基準 origin/main `856aa6c`（含 #573）。保留共享目錄及其他 worktree 原狀。
- 變更：十項 boolean＋revision，Access 管理表單、同來源 PUT、條件更新與同交易 audit、七項志工伺服器 gate、志工正常載入／更新與入口顯示。公開設定不含管理身分；核心、GAS、機器作業不經 gate。
- Schema：核對主線 0000–0002 與進行中 #574（未新增 migration），新增 0003，compact-schema 同步。正式套用與安全回復、成本邊界見 docs/operations/feature-settings.md。
- 測試：check-local.ps1 新契約先紅後綠；版本競爭、無差異、audit 失敗回復、Access／跨來源、七項真實路由、顯示重讀與舊連結。完整測試與兩軸審查結果收尾補記。
- 未執行：合併、正式 migration、部署、Access 變更、正式資料寫入；不做 #566–568。
- 相關 PR：待草稿建立後補記。
