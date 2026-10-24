# 2026-10-24 修 #443 切群箭頭測試偶發失敗

- Agent：Claude Code（由主 session 交辦）
- 分支：`claude/443-flaky-arrow-test`

## 問題

`tests/group-walks.cjs` 的「狗數變化不移動切群按鈕」在 GitHub CI 偶發失敗（run 40077239618、40068838638 等），每次都是 width 320、group 1。

## 原因（測試時序，不是版面真的跳）

- 這段迴圈前一步把畫面設成 1280。1280 的底部分類列高 64px，320 是 58.59px。
- `--bottom-bar-height` 由 ResizeObserver、`--app-header-height` 由 resize 事件更新，都比 `setViewportSize` 晚一幀。
- CI 有時在變數更新前就量了第一群，`first` 用的是舊高度；第二群量到正確位置，差超過 1px 就失敗。之後換 390 時高度不變，所以只會在 320 出現。
- 驗證：暫時讓 ResizeObserver 延後 200ms 更新，原測試在本機必定失敗；加上等待後通過。延後只為診斷，已還原。

## 修正

- 換畫面尺寸後先 `waitForFunction`，等兩個 CSS 變數等於表頭、底部列實際高度再量。斷言不變，CSS 不動。
- 本機 `check-local.ps1 -Suite group-walks` 重複 5 次都通過。

## 未完成

- 尚未開 PR，CI 結果待確認。
