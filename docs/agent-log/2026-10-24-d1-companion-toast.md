# D1 模式溜了後加回「＋一起溜的人」

- 日期：2026-10-24。Agent：Claude。分支 `claude/d1-companion-toast`。
- 問題：開關 `d1WalkAccept` 打開後（#533），按溜了不再出現提示條，「＋一起溜的人」入口跟著消失。原因是 #456（PR #461）寫的 `if (!acceptsD1) showToast(...)`，開關關著時從沒發生；#527 拆檔只是搬移。K 實測發現，要求加回。
- 改法（`public/js/walk-ui.js` 的 `walkThenRecord`）：D1 接受且全部成功、有登記名字時，提示條顯示「小白 今天溜了」＋「＋一起溜的人」。不放提示條的復原，復原照舊用狗卡名字旁的 ×。
- 測試：`tests/walk-accept.cjs` 補提示條斷言；全部網頁測試通過。
