# 2026-10-19 #279 照片邊緣快取（B 段）

- 日期：2026-10-19（台灣時間）。Agent：CODEX。
- 依據：#279；K 本次明確同意「接著實作 B 段」，並確認沿用 Worker HTTP 照片路由作為 TDD 測試邊界。A 段已由 PR #357 合併，不重做。
- 做了什麼：`servePhoto` 對帶非空 `v` 的合法照片網址先讀 `caches.default`；只有 GET、R2 照片版本相符時才用 `ctx.waitUntil` 存完整圖片。命中後不讀 R2，回應 `CF-Cache-Status: HIT`；可快取但未命中回 `MISS`。主照片與縮圖各自依完整網址區分，沿用 30 天快取期限。
- 保護：HEAD／304 不存空圖片，命中時保留原本 HEAD／ETag 行為；無版本、找不到、刪除標記、舊靜態備援不寫邊緣快取；Cache API 失敗仍讀 R2。換照片仍由新版本網址取得新圖，舊版本依原本 immutable 契約保留。
- TDD：先確認命中測試失敗，再實作；HEAD、快取失敗、版本不符各自先紅再綠。新增共 7 個回歸案例；原有縮圖產製 API 仍在使用，保留。
- 驗證：Node 全套 313 項通過；網頁 260 項及獨立互動測試通過；修改的 JS 語法檢查、`git diff --check` 通過。repo 沒有 TypeScript／typecheck 指令。
- 部署前基準：10/19 10:35 唯讀正式 HTTP 量測，`/api/dogs` 1,583 ms；25 張縮圖共 445,207 bytes，兩輪並行完整下載 1,255／728 ms，單張中位數 860／411 ms，全部 200、無 `CF-Cache-Status`。不使用瀏覽器快取，不是整頁載入時間。原始網址與結果只留本機 `.scratch/issue-279-baseline.json`，不提交。
- 參考：[Cloudflare Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)；快取限同一資料中心，未命中仍會讀 R2。
- 例外／未完成：未合併、未部署、未修改正式資料。正式部署需 K 確認；部署後用相同 25 個版本網址重測，確認實際 HIT 與耗時，再判斷 B 段驗收，不以模擬測試當成正式成效。
- 相關 PR：待建立；審查結果另補。
