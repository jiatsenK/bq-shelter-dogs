# 打開今日溜狗 D1 開關

- 日期：2026-10-24。Agent：Claude。分支 `claude/d1-walk-accept-on`。K 2026-10-24 對話明確要求現在打開 `SITE.d1WalkAccept`（ADR 0018「啟用另行授權」）。
- 改動：`public/js/site-config.js` 的 `d1WalkAccept` 改成 `true`；`docs/adr/README.md` 重新產生。
- 網頁測試：開關打開前寫的套件分兩類處理。
  - 不按「溜了」的（read-policy、navigation、large-text、activities、intake-presentation）：今日溜狗假回應補 `source: 'd1'`，在開關打開下跑。
  - 測試寫試算表舊流程的（fixed-care、group-cache、group-walks、walker-editing、startup-stability、index 單元測試）：用 `tests/fixtures/legacy-walk-mode.cjs` 固定開關關著跑。D1 登記由 walk-accept、walk-d1-entries、walk-feedback 覆蓋。
- 未做：上面固定在舊流程的套件，開關打開後的同等情境（固定照顧、整群溜、改溜狗人、啟動穩定）沒有 D1 版本的測試，要另開票補。
- 本機：19 套中 18 套通過；`index` 在本機 120 秒逾時，開關關著也一樣（main 的 CI 有通過），交給 CI 判斷。Node 測試只剩 `local-check.test.mjs` 的 4 項老問題。
- CI 失敗（兩次相同）：index 的兩項裁切測試。原因：測試頁沒載 `css/app.css`，`.cropper` 不是 fixed，裁切區高度只看照片當下撐開多少；index 加了 `page.route` 後載入時序改變，量尺寸時照片還沒撐開，裁切區只剩約 24px 高，座標變小數，`DOMMatrix` 的 float32 誤差讓「不露空白」判定失敗，第二項是連帶出錯。對照：main 只加同一個 route 就重現。修法：裁切測試期間只套 `app.css` 的 `.crop*` 規則，邊界比較留 0.01px 容差。本機 index 266 項全過。
- 工作目錄另有 `tests/index.html` 被改成 48 行（03:13:59，不是本工作），已收進 `git stash` 未提交。
