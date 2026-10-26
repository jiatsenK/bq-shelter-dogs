# 管理網站「資料流」頁

- 日期：2026-10-26。Agent：Claude（Opus 5.5）；分支 `claude/admin-data-flow`，基準 origin/main `aa71c3c`。
- 依據：K 2026-10-26 看完資料傳輸稽核後，要把「資料流向」「網站登記的完整傳輸鏈」做成像 Cloudflare 那種節點圖放進管理網站。K 選定：節點上顯示即時狀態、點節點右側顯示詳細。
- 變更：
  - `worker/src/admin/flow.js`＋`GET /api/manage/flow-status`：一次 batch 只讀、0 寫入。讀目前版本還沒寫回的狗（最多列 20 隻）、`v3_walk_conflicts`、`v3_walk_delivery` 筆數、今天的 `v3_walk_write_budget`、最近一次網站登記、`synced_at`、`dog_list_extra`、三件排程紀錄。每日預算上限寫成常數 40000，測試核對跟 `wrangler.jsonc` 的 `SYNC_DAILY_BUDGET` 一樣（管理網站 Worker 沒有這個變數）。
  - `admin/public/flow.html`、`js/flow.js`（DOM、SVG 連線、右側詳細、網址 `view`／`node`）、`js/flow-model.js`（兩張圖的位置、連線、說明與燈號規則，純函式）。內容照 `docs/ARCHITECTURE_NOW.md` 與稽核結果。
  - 八頁側欄「資料」組加「資料流」；`admin.css` 加 `.flow-*`。
  - 文件：`docs/design/admin.md` 新增「資料流」一節、`admin/README.md` 入口表、`docs/ARCHITECTURE_NOW.md` 管理網站一段；順手改正排程那段過時的 `53 1,5,15`（實際是 `23 1,5,15`）。
- 測試：`worker/test/admin-flow.test.mjs`（API 讀值、空庫、預算常數、未登入 401、只准讀）、`scripts/admin-flow-model.test.mjs`（圖自洽、燈號門檻、格式錯丟錯）、`tests/admin-flow.cjs`（兩張圖、燈號、詳細、網址、讀取失敗、1440／1100／390px、CSP）；`scripts/admin-table.test.mjs` 側欄改成八頁。截圖在 `.impeccable/review/flow-*.png`。
- detect：只剩 vendor Tabler 的 `animated-dots`（既有誤判）；節點原本的單邊色條被抓 side-tab，已改成整張淡色底框。
- 未做：沒開 PR、沒部署。管理網站要合併後手動跑「部署管理網站」才會出現這頁。
- 相關 PR：尚未建立。待決定的做法記在 [#658](https://github.com/jiatsenK/bq-shelter-dogs/issues/658)，分支先放著。
- 2026-10-26 追加：背景研究員核對圖與程式，結果在 `docs/research/2026-10-26-flow-diagram-maintenance.md`（6 處不符、8 處不精確；燈號「一直失敗的狗永遠是綠的」、紅燈分類太寬）。K 之後說主要想要像 Cloudflare 那樣的視覺化、而且是真實資料，做法（資源圖自動產生／加流量／維持手畫；部署時讀、開頁即時讀、只讀 repo）還沒決定，圖與燈號都先不改。
