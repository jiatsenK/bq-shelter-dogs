# 2026-10-17 離所名冊索引＋按年詳細資料（#363）

- Agent：Claude Code（Opus 5.5）
- 依據：#363、ADR 0014（`docs/adr/0014-small-pack-split-and-settled-departures.md`），接在 #367（離所按年資料包）之後。
- 做了什麼：
  - Worker 新增 `GET /api/departures/index`：每隻離所狗只給編號、狗名、舊編號、出所日、原因（另帶名冊那一行要的「推估」日期來源、再入所編號），加每年版本號 `years`。從各年資料包組，不讀離所表；沒變只讀 1 列版本號。
  - `GET /api/departures?year=YYYY|none&v=版本號`：那一年的詳細離所紀錄，版本號對得上回 `immutable` 快取。原本不帶參數的 `/api/departures` 保留。
  - `public/js/analysis.js`：長條圖、名冊搜尋（全部年份）改用索引；點名冊上的狗才拿那一年，拿不到就用索引那筆開，下次再拿。畫面不變。
  - 測試：`worker/test/packs.test.mjs` 加索引／按年內容與直接讀表相同、讀取量 10 隻和 100 隻一樣；`tests/index.html` 加搜尋舊編號、點舊年份的狗。
- 沒動：`scripts/sync-*`（#364 另一個視窗在改）。
- PR：見本分支的草稿 PR。
