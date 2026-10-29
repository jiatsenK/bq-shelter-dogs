# 2026-10-29 電腦版寬版整合分支（驗收用）

- 日期：2026-10-29（台灣時間）
- Agent：Claude Code（Opus 5.5），電腦版 critique 主 session
- 依據：K 要在測試網站一次驗收五個電腦版 PR（#753 我溜過、#754 資訊、#755 常溜狗群、#756 找狗＋在哪、#757 網址），PR 先都不合。
- 做了什麼：
  - 從 `claude/volunteer-critique-p1-p2`（PR #750）依序合進 #755、#753、#756、#754、#757。
  - 解衝突：`app.css` 檔尾各段都保留；`run-browser-tests.cjs` 套件清單合併；`public/js/README.md` 各取較新的那一列；`app.js` 頁籤用 `shownTabs()`（含電腦版找狗）且是 `<a href>`；`overlays.js` 的 `replacePage` 改用 `writeHistory` 帶網址並保留 landing 標記。
  - 合在一起才出現的問題：
    - 電腦版資訊子頁清單改成 `<a href>`（跟 ADR 0024 其他入口一致），CSS `.info-nav button` 改 `:is(a, button)`、拿掉底線。
    - 直接打開 `#info/<子頁>` 後在電腦版換子頁，返回會關掉資訊：`openInfoPage` 的目前這筆補成資訊頁籤紀錄（`bqNavigation`、`tab: 'info'`）。
    - 1280 以下藏頁籤圖示的規則只寫 `button`，頁籤變連結後 1100px 頁首溢出：改 `:is(button, a)`。
    - 測試：`dog-urls` 資訊段改成電腦版清單＋返回回上一個子頁、頁籤多找狗；`desk-find`、`desk-info` 選擇器改 `[data-tab]`、`:is(a, button)`；`desk-info` 換子頁後等重畫穩定再量焦點與寬度。
- 驗證：本機全部網頁測試通過；Node 測試只剩已知的 `diagram-reminder` CRLF 一項（Windows 換行，跟這次無關）。
- 後續：五個 PR 合併時，上面的整合修正要一起帶進去（建議 K 驗收後直接合這個整合分支，或依序合五個 PR 後再合這支補修）。
