# 2026-10-17 電腦版排版規則

- Agent：Claude（Opus 5.5）。
- 依據：K 反映電腦版排版不一致、按鈕位置會跑、新功能沒做電腦版；先跑 `/impeccable audit 電腦版`（1440×900 無頭截圖，結果 9/20），再用 grill-with-docs 訪談定規則，K 全部確認。
- 完成：`docs/DESIGN_GUIDE.md` 新增「電腦版」段落（對象、範圍、1440px 骨架＋右側欄 300px、統一頁首、按鈕位置、新功能要求、1100px 分界）。
- 未做：沒改程式、AGENTS.md、測試；沒開票、commit、PR。下一步用 `/to-spec`、`/to-tickets` 拆成：共用骨架與頁首＋統一顏色、自動檢查與 AGENTS.md 規則、找狗／我溜過／常溜狗群／編輯紀錄各一張（先 `/prototype`）。
- 相關 PR：無。
