# 志工溜狗表（bq-shelter-dogs）

收容所志工用的唯讀遛狗清單網頁：一眼看出誰最久沒遛、牠的備註、以及可以跟誰一起遛。

手機打開後可以加到主畫面，之後一鍵開啟：
- iPhone（Safari）：下方「分享」按鈕 →「加入主畫面」
- Android（Chrome）：右上角「⋮」→「加到主畫面」

- 規格（V3 定版）：[`docs/PROJECT_GOALS.md`](docs/PROJECT_GOALS.md)
- 前端設計需求（細節）：[`docs/FRONTEND_REQUIREMENTS.md`](docs/FRONTEND_REQUIREMENTS.md)
- 視覺風格指引：[`docs/DESIGN_GUIDE.md`](docs/DESIGN_GUIDE.md)
- 工作分票：見 GitHub Issues（標籤 `v4`、`v3`；舊版 `v1`）
- 網站、照片上傳、R2 設定：[`docs/CLOUDFLARE_SETUP.md`](docs/CLOUDFLARE_SETUP.md)

## 結構

```
index.html        ← 頁面基本結構
css/app.css       ← 樣式
js/app.js         ← 程式（資料讀取、分頁、搜尋、畫面）
scripts/          ← 同步、部署用的程式與測試
db/compact-schema.sql ← D1 資料表結構（資料存在 Cloudflare D1，照片存在 R2，都不放 repo）
docs/             ← 規格、設計指引、參考圖
icons/            ← 網站圖示（瀏覽器分頁、手機主畫面）
manifest.webmanifest ← 加到主畫面時的名稱、顏色、圖示
tests/index.html  ← 資料讀取測試（用假資料，不連試算表）
worker/           ← 後端 API（上傳照片、備註、代號、更新；跟網站一起部署成同一個 Cloudflare Worker，不含任何 token）
```

## 部署

網站和後端 API 部署成同一個 Cloudflare Worker：https://bq-shelter-dogs.jiatsen-k.workers.dev 。`main` 有變動（合併 PR、同步試算表、網站上傳照片）時 GitHub Action「部署到 Cloudflare」會自動部署，一、兩分鐘網站就會更新，不用另外操作。設定和第一次怎麼開見 `docs/CLOUDFLARE_SETUP.md`。

每個 PR 會自動部署一份預覽版，網址貼在 PR 留言（`https://pr-<PR 編號>-bq-shelter-dogs.jiatsen-k.workers.dev`）。

舊網址 https://jiatsenk.github.io/bq-shelter-dogs/ 的 GitHub Pages 已經關閉（2026-10-15 查證回 404），`.nojekyll` 因此在 #275 移除。

## 本機預覽

```
python3 -m http.server 8000
```

然後開 http://localhost:8000 。資料即時從 Google 試算表讀取。

## 測試

打開 `tests/index.html` 就會自動跑資料讀取的測試，全部通過會顯示綠色「全部 N 項通過」。
部署後網址是 https://bq-shelter-dogs.jiatsen-k.workers.dev/tests/ ；本機請先執行上面的 `python3 -m http.server 8000`，再開 http://localhost:8000/tests/ （直接雙擊檔案打不開）。
