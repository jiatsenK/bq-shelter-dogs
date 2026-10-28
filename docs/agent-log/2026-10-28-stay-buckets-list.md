# 在所統計：入所多久 0～9 每年一格＋10+，點長條列名單（#739）

- 日期：2026-10-28。Agent：Claude Code。
- 依據：#739；K 2026-10-28 選 `3h`（0～9 每年一格＋10+，固定 11 根）、`3e`（白底短名單）與在所統計「只統一樣式」版（`docs/design/unify-other-pages/README.md` 第 3 節）。
- 做了什麼：
  - `public/js/analysis.js`：`STAY_BUCKETS` 改成 11 格（每格帶念給螢幕閱讀器的 `label`、長條下的 `short`、名單標題 `head`）；`stayDistribution` 每格多帶那格的狗（久的排前面）；拿掉 `STAY_SHADES`、`STAY_SHORT`。`columnChart` 整欄改成按鈕（`aria-pressed`、完整句名稱、0 隻停用），新增 `stayPickHtml` 名單；選擇記在 `analysisState.stayPick`，換子頁時清掉。說明改成「點長條看是哪些狗」。在所統計各段標題與「板收在所的狗」拿掉圖示。
  - `public/css/app.css`：分布長條同一個檔案綠、選中深綠、其他中間綠；名單、箭頭、「看全部／收起」；拿掉舊的 7 種綠深淺覆寫；「板收在所的狗」20px 粗；「回資訊」拿掉外框（所有資訊子頁共用同一顆）。
  - 測試：`tests/index/analysis.js` 分組改 11 格；`tests/info-page.cjs` 換一份照今天往回推入所日的狗，檢查 11 根、加總、點長條列名單／看全部／收起、鍵盤、0 隻停用、320px 每欄 ≥ 24px、沒有標題圖示、回資訊沒外框。
  - `docs/DESIGN_GUIDE.md` 新增「資訊 › 在所統計」一節。
- 例外／未完成：0 隻的長條選「不能選」（停用），寫進規格。「10+」變多時自動往後拉不做（issue 明訂）。
- 相關 PR：（開好後補）。
