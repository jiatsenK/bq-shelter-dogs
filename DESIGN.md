# 設計入口

依目標讀取一份現行規格，不預載其他頁面或歷史資料。

| 目標 | 現行規格 | 實作來源 |
|---|---|---|
| 志工版 `public/index.html`、常溜狗群、其他志工頁 | [視覺指引](docs/DESIGN_GUIDE.md) | `public/css/app.css`；桌機 `public/js/desk.js` |
| 圖鑑 `public/cards.html` | [球員卡規格](docs/design/cards.md) | `public/css/cards.css`、`public/js/cards.js` |

功能範圍見 `docs/PROJECT_GOALS.md`；名詞見 `GLOSSARY.md`。實際 token 值由對應 CSS／JS 定義，指引記設計限制與用途。

執行 `node scripts/design-context.mjs --target public/index.html` 取得摘要與來源位置；需要某節時加 `--section 天數色籤`，全文用 `--full`。

追查舊方案才讀 [志工版快照](docs/design/history/volunteer-snapshot-2026-10-09.md) 或 [單手操作提案與研究](docs/design/history/one-hand-proposal.md)。歷史內容不覆蓋現行規格。
