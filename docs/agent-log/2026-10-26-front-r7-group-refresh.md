# 前端結構整理 R7：狗群頁重讀狗清單時少抓我溜過與常溜

- 日期：2026-10-26。Agent：Claude（Opus 5.5），由前端架構稽核工作階段交辦；分支 `claude/front-r7-group-refresh`，疊在 R2＋R3（#608）上。
- 依據：2026-10-26 前端稽核 A9；K 在對話中選「2 做」。
- 問題：狗群頁「整群溜了」登記前、背景檢查、重新讀取都會重讀狗清單，經 `applyDogsData` 連帶重抓我溜過（`/walks`）、常溜（`/identity`＋`/favorites`，有代號時）、休養（`/rest`）、今日登記（`/today`）。
- 做了什麼：`applyDogsData(data, { groupCheck: true })` 跳過 `loadMyWalks` 與 `favorites.syncFavs`；休養與今日登記照樣補（`groupBlocked` 要靠休養擋住休養中的狗，所以比當初說的「只更新狗清單與今日登記」多留休養）。開頁、按「更新」、溜狗表照原本全部讀。
- 測試：`tests/group-cache.cjs` 加端點計數，狗群重讀後 `/walks` 次數不變、`/rest` 有增加；先改回舊呼叫確認斷言失敗再改回。網頁 25 套全過；`-Full` 的 Node 只剩既有 `local-check.test.mjs` 5.1 亂碼。
- 草稿 PR #609（目標分支 claude/front-r2r3-ui-kit-status）。
