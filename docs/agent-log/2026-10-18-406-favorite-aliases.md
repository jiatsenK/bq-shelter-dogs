# 2026-10-18 #406 讀常溜不再附全部狗的對照表

- Agent：Claude Code（由 #403 用量追蹤的對話交辦）。
- 做了什麼：`favoriteAliases` 改成只查「常溜的狗」和「手機帶來的舊格式鍵（編號／`名:狗名`）對到的狗」的全部編號與唯一名字；`GET /api/favorites` 多收重複的 `key` 參數（最多 200 個）。前端只在手機還有舊格式常溜時才帶 `key`，並保留還沒送出操作要用的對照。`v3_dogs(name)` 加索引，名字查詢不整張掃。
- 同名規則不變：名字只在唯一時才轉。
- 為什麼動到 `worker/src/index.js`：讀 `key` 參數只能在 `favorites()` 裡做，只改 `readFavorites` 那一行附近；沒碰 #407 的 `rememberWalkerNames`。
- 驗證：TDD 先紅再綠；新增「多 300 隻狗讀取列數不變」測試、舊編號換現在編號測試、網頁「沒有舊格式不帶 key」測試。Node 297 項、網頁 260 項全過。只用本機 fixture，沒有部署、沒有寫正式 D1。
- 待辦：正式 D1 要等同步把新索引補上（`scripts/sync-compact-d1.mjs` 會整份送 schema）。
