# 手機點擊目標 44px、間距 8px 網頁測試

- 日期：2026-10-26。Agent：Claude（Opus 5.5）；分支 `claude/mobile-touch-targets`，基準 origin/main `70ff450`。
- 依據：志工版手機版評審（K 本機的 `.impeccable/critique/2026-10-26T09-27-01Z__public-index-html.md`，未進 repo；量測發現多處小於 44px、間距不足）後，K 交辦：「390 和 360 寬時檢查志工版主要畫面所有可點元素至少 44px、相鄰間距至少 8px，進 CI」。
- 變更：
  - 新增 `tests/touch-targets.cjs`，加進 `scripts/run-browser-tests.cjs` 的套件清單，CI 會跑。
    - 畫面：開頭畫面、溜狗表照片與列表、兩種模式按溜了後的提示條、一起溜的人、詳細資訊、「在哪」、常遛狗群、我溜過、資訊。用觸控手機模式（`isMobile`、`hasTouch`），並減少動態效果，不用等動畫。
    - 有效範圍含 `::before`／`::after` 用 inset 擴大的點擊範圍，從宿主的 padding box 算。
    - 不同捲動層（固定在畫面上的、黏住的列、面板內捲動區）之間不比間距，因為距離會隨捲動改變。同一種整列項目（狗卡、資訊頁選單）上下相連不算違規。
    - 既有違規列在 `KNOWN`，附現在量到的值 `at`。比 `at` 更差算新違規；`KNOWN` 裡已經修好的項目也會失敗，提醒拿掉。
  - `docs/DESIGN_GUIDE.md`「單手操作」：寫明 8px 間距與這個測試。
- 審查：Standards／Spec 由獨立審查代理執行。已修：KNOWN 改記數值、補提示條與一起溜的人、容差從 0.5 收到 0.05、偽元素範圍改從 padding box 算、整列豁免限定上下排、改用減少動態效果取代固定等待、變數改名。沒修：CI 是 Linux 字型，`#whoSave`、`#whoInput` 這類靠行高撐到 44px 的元素可能差幾 px，要看 CI 結果。
- 驗證：
  - 本機 `touch-targets` 通過。暫時把「溜了」改成 30px 高、把「在哪」關閉改成 20px，測試都會失敗並列出元素。
  - 全部網頁套件通過。
  - Node 全套 466 項有 4 項失敗，都在 `scripts/local-check.test.mjs`，本機沒有 pwsh，跟這次改動無關。
- 例外與未完成：`KNOWN` 共 15 項。籠位相關 2 項掛 #644，其餘 13 項開總票 #647（K 2026-10-26 決定）。
- 相關 PR：[#648](https://github.com/jiatsenK/bq-shelter-dogs/pull/648)，草稿。
