# 2026-10-20 撤銷溜了的決策（grilling）

- Agent：Claude Code。
- 依據：K 回報老大溜狗人只有「佳岑」卻沒有 ×、按錯改不回來；經 /ask-matt → grilling 逐題確認。
- 查到原因：× 需要按「溜了」那個瀏覽器存的復原證據（#141、#397 設計），換裝置就沒有，與 K 原意不同。
- 決定：新增 `docs/adr/0016-undo-walk-from-server-history.md`，GLOSSARY「復原」補一句。只寫文件，未改程式、資料。
- 未完成：實作（Worker 找前一次、撤銷 API、編輯紀錄、網頁 ×、測試）另開票／PR。
- 同日 K 改第四題：撤銷只限今天（原為 3 天內），ADR 0016、GLOSSARY 已改。
