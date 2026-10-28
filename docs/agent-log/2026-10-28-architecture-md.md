# 架構圖改成 docs/ARCHITECTURE.md（Mermaid）唯一正本

- 日期：2026-10-28。Agent：Claude Code（agent-hub 主代理交辦的子代理）。
- 依據：K 2026-10-28 決定（選項 A）：架構圖跟其他專案用同一套，只留一份 `docs/ARCHITECTURE.md`，照 agent-hub `docs/rules/architecture-diagrams.md` 用 Mermaid 畫；手工的 `docs/diagrams/*.html` 刪除，不留兩份。這推翻 `docs/research/2026-10-28-diagram-auto-sync.md` 第 5 點「手工圖保留」，已在該文件開頭註明決定與原因（所有專案同一套畫法，總覽頁才能直接對照）。無對應 Issue。
- 做了什麼：
  - 新增 `docs/ARCHITECTURE.md`，對照 main `6406afa` 重新核對（168 筆 `路徑:行號` 依據全部對得上）。原 7 張圖的去處：
    - architecture → 主圖（容器）；daily-schedule → 「一天裡的排程」說明段（排程時間、錯開分鐘、日界線）＋主圖的排程虛線；data-flows → 「各類資料的流向」說明段；environments → 上線圖（各 workflow 自動／手動、各環境綁哪個 D1／R2／試算表）；writeback-sequence、sheet-sync-sequence → 兩個流程圖；code-architecture → 元件圖（模組分法與每條線照舊，共用框仍定義為兩個 Worker 都匯入）。
  - 刪除 `docs/diagrams/*.html` 7 張，以及只給手工圖用的字型（Geist Mono、Instrument Serif、Geist 500／600）；`.impeccable/config.json` 拿掉針對那些圖的忽略規則。
  - `scripts/diagram-facts.test.mjs` 改讀 `docs/ARCHITECTURE.md` 各段：同一批事實（名稱、排程、重試、端點、GAS 動作、待通知、preview 標籤、Worker 每支 .js）照舊；測試 R2 名稱改比全名；依據行號檢查從只有元件圖擴大到所有段落。
  - `scripts/diagram-reminder.mjs`：改用 PR 的 patch 判斷 `docs/ARCHITECTURE.md` 改到哪幾段，沒改到的段落才提醒；workflow 的 paths 跟著改。
  - 管理網站「系統架構圖」頁：建置時用 Playwright 的無頭 Chromium＋`scripts/vendor/mermaid/mermaid.min.js`（11.4.1）把 Mermaid 畫成 SVG，`<style>` 拆成外部 CSS、style 屬性換成 class，CSP 不用放寬；沒有無頭瀏覽器時不擋建置，該張圖顯示 GitHub 連結。`deploy-admin.yml` 部署前先裝 Playwright（失敗不擋部署），job 時限 10 → 15 分鐘。
- 例外與判斷：flowchart 的版面由 Mermaid 自動排，比手工圖亂一些（有幾條線會穿過框的標題），但字與字沒有重疊；網頁測試會檢查每個方塊的字都在框裡。
- 未完成：合併後要手動跑「部署管理網站」，線上的架構圖頁才會換成新版。
- 相關 PR：見本分支 PR。
