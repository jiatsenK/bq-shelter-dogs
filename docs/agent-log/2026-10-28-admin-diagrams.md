# 管理網站系統架構圖頁、圖跟程式對不上就擋

- 日期：2026-10-28。Agent：Claude Code。
- 依據：K 在對話中要求把 `docs/diagrams/` 的架構圖放到管理網站，並問能不能跟著程式更新。grill 後 K 同意的決定：
  - 正本留在 `docs/diagrams/`，管理網站建置時抽出；選單新增「系統 → 系統架構圖」，六張同一頁往下排（整體 → 資料流向 → 寫回 → 改表回 D1 → 排程 → 環境），不標號、不加白話說明，只在電腦看，管理網站維持手動部署。
  - 完全自動重畫做不到（研究：`docs/research/2026-10-28-diagram-auto-sync.md`）。改成：日期與第幾版從 git 自動算；名稱、時間、次數由測試核對，不符就 CI 失敗；相關檔案改了沒改圖，在 PR 留言提醒、不擋合併。
- 做了什麼：
  - `scripts/admin-diagrams.mjs`＋`scripts/build-admin-assets.mjs`：抽出 SVG、標題、說明，`<style>` 拆成 `shared/diagrams.css`（每張圖加範圍），id 加圖名前綴；git 歷史算版號與日期，淺層 clone 不顯示。
  - `admin/public/diagrams.html`、`js/diagrams.js`、`admin.css`；其他七頁側欄加「系統」組。拉丁字型自架 `admin/public/vendor/fonts/`（Fontsource 5.3.0，OFL）。
  - `.github/workflows/deploy-admin.yml` checkout 改 `fetch-depth: 0`。
  - `scripts/diagram-facts.test.mjs`：Worker／D1／R2 名稱、排程數量與台灣時間、GAS 補送與掃描時間、錯開分鐘、垃圾桶天數、重試間隔與上限、端點、GAS 動作、待通知名稱、preview 標籤。
  - `scripts/diagram-reminder.mjs`＋`.github/workflows/diagram-reminder.yml`：PR 碰到架構相關路徑才跑，同一則留言更新不洗版。
  - 測試：`scripts/admin-diagrams.test.mjs`、`scripts/diagram-reminder.test.mjs`、`tests/admin-diagrams.cjs`（正式 CSP 下無違規、字型載入、marker 不串圖）；`scripts/admin-table.test.mjs` 側欄改八頁三組。
- 審查（Standards／Spec 兩軸）後補修：圖名與標題收成 `scripts/admin-diagrams.mjs` 的 `DIAGRAM_TITLES` 一份，事實核對與提醒共用；HTML 轉文字共用 `plainText`。`.github/workflows/tests.yml` 原本 `paths-ignore: docs/**`，只改圖的 PR 不會跑事實核對，改成 `paths` 排除文件後再加回 `docs/diagrams/**`。`tests/admin.cjs` 側欄斷言加「系統」組。
- 限制：repo 沒有設必要檢查（tests.yml 註解：私人 repo 免費方案不能設），事實核對失敗是 PR 上的紅叉，不會真的鎖住合併；靠 K 合併前看。
- impeccable detect 在 `diagrams.html` 抓到 marquee，是 vendor Tabler 的 `.animated-dots`，比照 links.html 加窄範圍忽略。
- 例外：測試照片空間圖上寫「photos-test」（省略 `bq-shelter-` 開頭），測試照這個省略規則比對，沒改圖。
- 未完成：合併後要手動跑一次「部署管理網站」，頁面才看得到；版號從現有 git 歷史算起，architecture 目前是第 2 版、其他第 1 版。
- 相關 PR：見本分支 PR。
