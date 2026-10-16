# 2026-10-17 出入所紀錄補登（#333，ADR 0011）

- Agent：Claude Code（Opus 5.5）
- 依據：`docs/adr/0011-intake-date-manual-backfill.md`；#333 票內容與 K 2026-10-17 留言（版本號觸發器、同時修改回 409）。

## 做了什麼

- 新表 `v3_stays(dog_id PK, stays_json)`（`db/compact-schema.sql`）：一隻狗一列，加 `pack_v3_stays_*` 觸發器讓 small 版本號加 1。
- Worker：`worker/src/stays.js` 檢查格式（日期、不能是未來、出所不早於入所、原因 40 字、最多 30 筆）；`compact.js` 的狗清單和離所紀錄都帶 `stays`，新增 `saveStays`（條件式 SQL，跟送來的 `before` 不同就 409）；`index.js` 新增 `PUT /stays/{編號}`（要選名字、限流、記編輯紀錄「出入所紀錄」）。
- 網站：`firstIntake`（app.js）、`bqIntake`（cards.js）改成編號、舊編號、出入所紀錄三者取最早；詳細資訊新增「出入所紀錄」區塊，可新增、修改、刪除，409 時提示「別人剛改過，請重新整理再改」；離所的狗只看不改；分析頁說明文字跟著改。
- 測試：`d1-write`、`d1-read`、`compact-schema`、網頁測試（三來源取最早且 app 和 cards 一樣、詳細資訊編輯流程）。

## 例外

- 本機網頁測試沒跑完（Playwright 的 Chromium 正被別的程式安裝中），交給 PR 的 CI。
