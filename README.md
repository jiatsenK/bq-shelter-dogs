# 板收遛狗（bq-shelter-dogs）

板橋收容所志工用的唯讀遛狗清單網頁：一眼看出誰最久沒遛、牠的備註、以及可以跟誰一起遛。

- 規格與 v1 目標：[`docs/PROJECT_GOALS.md`](docs/PROJECT_GOALS.md)
- 前端設計需求（細節）：[`docs/FRONTEND_REQUIREMENTS.md`](docs/FRONTEND_REQUIREMENTS.md)
- 視覺風格指引：[`docs/DESIGN_GUIDE.md`](docs/DESIGN_GUIDE.md)
- 工作分票：見 GitHub Issues（標籤 `v1`）

## 結構

```
index.html        ← 整個網站（純前端、單檔）
dogs/{編號}.md     ← 狗狗介紹（YAML frontmatter + 內文），選填
photos/{編號}.jpg  ← 狗狗照片，選填
docs/             ← 規格、設計指引、參考圖
tests/index.html  ← 資料讀取測試（用假資料，不連試算表）
```

## 本機預覽

```
python3 -m http.server 8000
```

然後開 http://localhost:8000 。資料即時從 Google 試算表讀取。

## 測試

打開 `tests/index.html` 就會自動跑資料讀取的測試，全部通過會顯示綠色「全部 N 項通過」。
部署後網址是 https://jiatsenk.github.io/bq-shelter-dogs/tests/ ；本機請先執行上面的 `python3 -m http.server 8000`，再開 http://localhost:8000/tests/ （直接雙擊檔案打不開）。
