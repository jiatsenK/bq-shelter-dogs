# #643 登記失敗時狗卡留下「沒登記到」，錯誤提示條不自動消失

- 日期：2026-10-26。Agent：Claude（Opus 5.5）；分支 `claude/643-walk-failed-state`，基準 origin/main `c506c79`。
- 依據：#643（K 2026-10-26 確認要修）。K 同一天交辦：先部署到測試網站給 K 確認，確認後再開 PR 進正式網站。
- 變更：
  - `public/js/walk-registration.js`：按溜了（action `walk`）沒成功的狗記失敗狀態（只記當天），成功或再按一次就清掉；新增 `failure(dog)`，`unsure` 表示送出了但沒收到確認。每列結果帶 `error`；送出後沒回應的原因寫「連線中斷」。手機沒網路時不送出，算 `notSent`。
  - `public/js/walk-flow.js`：`send` 先看 `deps.offline`；`registrationText` 改寫：「X 沒登記到（原因），有訊號再按一次／再按一次」「X 還不知道有沒有登記到（原因），按「再試一次」確認」，衝突照舊加「沒登記到：」。拿掉「未全部登記成功」。
  - `public/js/app.js`：登記流程帶 `offline`（只看 `navigator.onLine`）。
  - `public/js/walk-ui.js`：狗卡按鈕失敗狀態「沒登記到／未確認＋再按一次」，按了走原本的 `walkThenRecord`；`showToast` 加 `{ sticky }`：不設計時器、顯示 ×、`role="alert"`。溜了、復原、一起溜的人、修改溜狗人的失敗提示條都用。
  - `public/css/app.css`：`.walk-btn.failed` 淡紅底紅框；`.toast.error` 左邊紅條、`.toast-close`。
  - `docs/DESIGN_GUIDE.md` 補失敗狀態與提示條規則。
- 測試：新增 `tests/walk-failed-state.cjs`（加進 `run-browser-tests.cjs`）；`scripts/walk-flow.test.mjs` 加沒網路、未確認、整群只標失敗兩個；四個網頁測試的「未全部登記成功」斷言改新文案。
- 注意：失敗狀態只存在記憶體，重新整理頁面就不見（未確認的那筆要求仍存在手機，再按會沿用原識別查明）。常遛狗群頁的整群回饋是頁內文字，不是提示條，沒改。
- 相關 PR：待 K 在測試網站確認後開。
