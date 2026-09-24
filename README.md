# 板收志工溜狗表（bq-shelter-dogs）

板橋收容所志工用的唯讀遛狗清單網頁：一眼看出誰最久沒遛、牠的備註、以及可以跟誰一起遛。

**正式網址：https://jiatsenk.github.io/bq-shelter-dogs/**

手機打開後可以加到主畫面，之後一鍵開啟：
- iPhone（Safari）：下方「分享」按鈕 →「加入主畫面」
- Android（Chrome）：右上角「⋮」→「加到主畫面」

- 規格（V3 定版）：[`docs/PROJECT_GOALS.md`](docs/PROJECT_GOALS.md)
- 前端設計需求（細節）：[`docs/FRONTEND_REQUIREMENTS.md`](docs/FRONTEND_REQUIREMENTS.md)
- 視覺風格指引：[`docs/DESIGN_GUIDE.md`](docs/DESIGN_GUIDE.md)
- 工作分票：見 GitHub Issues（標籤 `v3`；舊版 `v1`）

## 結構

```
index.html        ← 頁面基本結構
css/app.css       ← 樣式
js/app.js         ← 程式（資料讀取、分頁、搜尋、畫面）
dogs/{編號}.md     ← 狗狗介紹（YAML frontmatter + 內文），選填
photos/{編號}.jpg  ← 狗狗照片，選填
docs/             ← 規格、設計指引、參考圖
icons/            ← 網站圖示（瀏覽器分頁、手機主畫面）
manifest.webmanifest ← 加到主畫面時的名稱、顏色、圖示
.nojekyll         ← 讓 GitHub Pages 原樣提供 dogs/*.md，不要轉成網頁（請勿刪除）
tests/index.html  ← 資料讀取測試（用假資料，不連試算表）
```

## 部署

網站用 GitHub Pages 從 `main` 分支的根目錄部署：PR 合併進 `main` 後，約一、兩分鐘網站就會更新，不用另外操作。
設定位置：repo 的 Settings → Pages →「Deploy from a branch」、分支 `main`、資料夾 `/ (root)`。

## 本機預覽

```
python3 -m http.server 8000
```

然後開 http://localhost:8000 。資料即時從 Google 試算表讀取。

## 測試

打開 `tests/index.html` 就會自動跑資料讀取的測試，全部通過會顯示綠色「全部 N 項通過」。
部署後網址是 https://jiatsenk.github.io/bq-shelter-dogs/tests/ ；本機請先執行上面的 `python3 -m http.server 8000`，再開 http://localhost:8000/tests/ （直接雙擊檔案打不開）。
