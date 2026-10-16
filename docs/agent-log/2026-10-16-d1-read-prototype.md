# 2026-10-16 D1 讀取量原型實測

- Agent：Claude Code（Opus 5.5，由 adr/讀取量討論的 session 交辦）
- 分支：`prototype/d1-read-reduction`（從 main 開，丟棄式，不開 PR）
- 做了什麼：寫原型 Worker `worker/prototype/d1-read/entry.js`（`wrangler.d1read.jsonc`，只 `wrangler dev --remote`、不部署），在原型 D1 量現在 API 和「歷史資料包＋今天紀錄＋記憶體快取」的 `meta.rows_read`，模擬一天 1,400 次請求。結果見 `docs/research/2026-10-16-d1-read-prototype.md`。
- 原型 D1 的變更：溜狗紀錄複製一份（2,442 列）、加 `proto_walks_date` 索引、`proto_pack`、`proto_versions` 兩張表、2026-10-17 的 30 筆假紀錄。正式 D1 沒動。
- 未完成：Cloudflare 上記憶體快取的實際存活時間與機器數沒量；請求種類比例是假設。

## 第二輪（同日）：快取失效與同步

- 加 `worker/prototype/d1-read/inval.js`：用觸發器自動加版本號、資料包拆成 small／walks、溜狗紀錄觸發器依日期分歷史／今天；在原型 D1 實測各種改動（同步時間、介紹、休養、過去紀錄、今天紀錄、同步 30 列、跨日）的讀寫列數，每種改動之後 4 支 API 輸出都和現在相同。
- 另外量了同步程式每次讀整表（3,068 列）和 `/api/today` 每次讀的列數，結果和修正後的一天估算寫在研究筆記第二輪。
- 原型 D1 新增：`proto_ver`、`proto_pack2` 兩張表、38 個 `proto_` 觸發器、`v3_today_walks` 100 筆假資料、v3_walks 今天幾筆假紀錄。正式 D1 沒動。
- 沒做到：查 Cloudflare 正式環境各查詢的讀取量（要用本機登入憑證，被權限擋下），步驟寫在研究筆記給 K。
