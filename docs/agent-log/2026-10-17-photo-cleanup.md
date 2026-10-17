# 2026-10-17 刪掉沒在用的照片版本號腳本（#279 A 段）

- Agent：Claude Code（Opus 5.5）
- 依據：#279（只做 A 段；B 段會改正式環境，沒做）

## 做了什麼

- 刪除 `scripts/photo-versions.mjs`、`scripts/photo-versions.test.mjs`：照片版本號現在由 Worker 的 `/api/dogs` 帶上（`worker/src/index.js` 約 200 行），部署流程已不跑這支腳本。
- 更正註解與文件：`public/js/app.js`、`public/_headers`、`docs/setup/CLOUDFLARE_SETUP.md` 改寫成「版本號來自 `/api/dogs`」。
- `AGENTS.md`、`.github/workflows/tests.yml` 原本就沒有引用（node 測試改成自動找檔），不用改。

## 保留

- `worker/src/r2.js` 的 `pendingThumbs` 與 `/admin/thumbs`：還在用。`.github/workflows/r2-thumbs.yml` 跑 `scripts/make-thumbs.py --site`，會 GET `/api/admin/thumbs` 問哪些照片缺縮圖、再 PUT 回去，所以不刪。

## 測試

- node 測試 274 項全過；網頁測試全過。
