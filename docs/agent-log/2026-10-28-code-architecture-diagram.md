# 架構圖重新核對、加程式架構圖

- 日期：2026-10-28。Agent：Claude Code（agent-hub 主代理交辦的子代理）。
- 依據：K 在 agent-hub 要求各專案架構圖重新核對，並加一張「程式架構」圖（模組誰呼叫誰，每條線附 `路徑:行號`）。規則照本 repo 自己的 `docs/diagrams/*.html`、事實核對與 PR 提醒。無對應 Issue。
- 做了什麼：
  - 六張圖對照 main `e8031ed` 重新核對：
    - `architecture.html`：補上管理網站「網站更新」頁在瀏覽器直接讀 GitHub Releases（#731 新增，`admin/public/js/api.js:21-22`），圖例「Google 服務」改成「外部服務」；排程註解補標點；說明連到新圖。
    - `data-flows.html`：最後一道加「分享次數」（#736，只存 D1）。
    - `environments.html`：「未畫」補 diagram-reminder。
    - 其餘三張內容沒變；六張的「依程式碼核對」都改成 main `e8031ed`（原本寫的 `c2da5f0` 不在 main 歷史上）。
  - 新增 `docs/diagrams/code-architecture.html`（標題「志工溜狗表 程式架構」）：志工網站 Worker、管理網站 Worker 兩個框，加一個「兩個 Worker 都匯入」的共用框；十個模組、26 條線，每條線的依據寫在圖下說明。直接讀寫 D1、匯入 editlog.js 用方塊上的小標記表示，不另外拉線。
  - 接上：`scripts/admin-diagrams.mjs` 的 `DIAGRAM_TITLES`（排在最後）、`scripts/diagram-reminder.mjs`（`worker/src/` 任何檔案改了提醒這張）、`scripts/diagram-facts.test.mjs`（Worker 每支 .js 都要出現在圖上、圖上檔名都還在、依據行號不超過檔案長度）、`tests/admin-diagrams.cjs` 張數改用 `DIAGRAMS.length`、`.impeccable/config.json` 忽略範圍、`docs/ARCHITECTURE_NOW.md` 連結（順手把 migration 編號改成 0017）。
- 例外與判斷：共用框定義成「兩個 Worker 都匯入」，不是「被兩個以上模組呼叫」；後者會讓志工網站幾乎每個模組都進共用框，看不出部署邊界。管理查詢只匯入常數（STOPPED_AT、EXTRA_KEY）的兩處沒畫線，寫在說明。
- 未完成：合併後要手動跑「部署管理網站」，管理網站的架構圖頁才會出現第七張。
- 相關 PR：見本分支 PR。
