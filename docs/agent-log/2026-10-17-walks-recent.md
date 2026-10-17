# 2026-10-17 /api/walks 預設只回近期溜狗紀錄（#347）

- Agent：Claude Code（Opus 5.5）
- 依據：#347（父票 #343）、ADR 0013、ADR 0009

## 做了什麼

- `worker/src/packs.js`：`readWalksPacked` 只補、只回上個月 1 號（台灣時間）以後的月份，新機器只讀版本號、近期那一年的資料包和今天的列，不讀更早的年份。回應多 `recentStart`。新增 `recentStart(today)`。
- `worker/test/packs.test.mjs`：`/api/walks` 跟直接讀表比對時只比近期；另外檢查各年 `?year=` 接起來等於全部紀錄。新機器讀取列數的斷言改成只算今年的段。
- 狀態頁的溜狗紀錄筆數照舊數全部（`packStatus`），狀態頁很少開。

## 重量

- 用 `prototype/capacity-20y` 原型重量，結果補在那個分支的 `docs/research/2026-10-17-capacity-20y.md`（commit 5332736）：20 年 `/api/walks` 從 30 MB／699 ms 降到 193 KB／17 ms，不再隨年數變大。

## 未完成／注意

- 一天讀取量還是隨年數變多（small 重算、同步整張讀出所／入所表），不在這張票範圍。
- `?year=` 和新機器 `/api/walks` 本機量的 CPU 都超過 10 ms，要在 Cloudflare 主控台實測。
