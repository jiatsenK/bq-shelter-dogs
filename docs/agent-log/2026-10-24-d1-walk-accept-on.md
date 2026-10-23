# 打開今日溜狗 D1 開關

- 日期：2026-10-24。Agent：Claude。分支 `claude/d1-walk-accept-on`。K 2026-10-24 對話明確要求現在打開 `SITE.d1WalkAccept`（ADR 0018「啟用另行授權」）。
- 改動：`public/js/site-config.js` 的 `d1WalkAccept` 改成 `true`；`docs/adr/README.md` 重新產生。
- 網頁測試：開關打開前寫的套件分兩類處理。
  - 不按「溜了」的（read-policy、navigation、large-text、activities、intake-presentation）：今日溜狗假回應補 `source: 'd1'`，在開關打開下跑。
  - 測試寫試算表舊流程的（fixed-care、group-cache、group-walks、walker-editing、startup-stability、index 單元測試）：用 `tests/fixtures/legacy-walk-mode.cjs` 固定開關關著跑。D1 登記由 walk-accept、walk-d1-entries、walk-feedback 覆蓋。
- 未做：上面固定在舊流程的套件，開關打開後的同等情境（固定照顧、整群溜、改溜狗人、啟動穩定）沒有 D1 版本的測試，要另開票補。
- 本機：19 套中 18 套通過；`index` 在本機 120 秒逾時，開關關著也一樣（main 的 CI 有通過），交給 CI 判斷。Node 測試只剩 `local-check.test.mjs` 的 4 項老問題。
- 工作目錄另有 `tests/index.html` 被改成 48 行（03:13:59，不是本工作），已收進 `git stash` 未提交。
