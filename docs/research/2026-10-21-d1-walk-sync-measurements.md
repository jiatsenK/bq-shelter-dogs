# #441 實測狀態與來源

日期：2026-10-21（台灣時間）。Agent：CODEX。

**已完成 Google 20 筆序列樣本、Cloudflare CPU 原型、10 個邏輯客戶端並行及真正 Cron 恢復測試。** 第 1 步仍有下述證據限制，尚未決定寬限期、Cron 頻率或 ADR 0017，也沒有開始正式功能實作。

可執行量測工具與 Google 設定步驟：[README](../../scripts/bench/d1-walk-sync/README.md)。只放 `prototype/d1-walk-sync`，不合併正式功能。

## 歷史研究來源

依 #441 第 1 步，將以下四份研究從 `C:\Users\User\repos\bq-shelter-dogs-sync\docs\research` 原樣保留到本分支：

- `2026-10-20-d1-single-source-sync.md`
- `2026-10-20-sheet-editors-in-d1-sync.md`
- `2026-10-20-sheet-db-sync-prior-art.md`
- `2026-10-20-sync-pitfalls.md`

上述文件是 10/20 的歷史研究快照，當中的用量、延遲、觸發器是否漏事件、方案可行性與部分憑記憶的數字**全部尚待本票核對**。原稿「已確認」不代表本次已驗證。以 #441 後來確認的決定與未來實測報告為準，不能直接據以實作。

PR #439 的 `2026-10-20-sheet-diff-cpu.md` 是 Node／模擬資料的本機牆鐘時間，沒有搬成 Cloudflare CPU 結果。它的 1–4 ms／10–16 ms 不屬本票實測。

## 實測表

| 指標 | 數字 | 證據／狀態 |
|---|---|---|
| doPost 成功回應耗時 | 1.851–7.576 秒；中位數 2.357 秒；P95 5.488 秒 | 20 筆，失敗 0，含客戶端網路與測試防護成本 |
| 從 POST 開始到收到首次含新值的 gviz 回應 | 2.256–8.004 秒；中位數 2.724 秒；P95 5.907 秒 | 20/20 第一次輪詢命中；不是伺服器實際可見時間或獨立快取延遲 |
| 排序、多格貼上、Ctrl+Z 事件 | K 回報三種操作都有紀錄 | 人工回報，尚未取得事件時間／changeType 原始紀錄，不能自行補造 |
| 通知 CPU | 捕獲 15 筆為 2–8 ms；其中 isolate 首次 handler 1 筆為 8 ms | 20 次 HTTP 全成功，tail 捕獲並不完整；其餘 5 筆不能視為已有逐次 CPU |
| 真正 Cron CPU | 捕獲 4 筆為 5–8 ms | 四筆皆為各自 isolate 的首次 handler，含比較與 pending 查詢／重試；無同 isolate 暖 Cron 樣本 |
| 10 客戶端並行名字保留 | D1 與 Sheet 十個名字全保留；三輪每分鐘十讀皆一致 | 一個 Node 程序的十個邏輯客戶端，不是十台實體手機；pending 歸零才通過 |
| D1／Workers 實際用量 | 已記單次 D1 metadata 與平台測試指標 | 全帳號當日用量、正式全今日清單查詢及完整同步流程仍待補，不能宣稱免費額度驗收完成 |

每組數字須附：測試時間、版本 SHA、環境識別、樣本數、失敗數、原始紀錄位置、觀測範圍與限制。直到全部完成，Issue 的第 1 步核取方塊保持未勾。

## 2026-10-21 Google 實測

- 時間：台灣時間 09:52:19–09:54:22；最後一筆 POST 在 09:54:19 開始，約 2.287 秒後收到含標記回應。
- 工具版本：`194aa88c83ebde386ff9ec90cf88e4a302d48e31`；Node v24.16.0、Windows。Google 部署使用者貼入此版本產生的程式，GET 回應的 `prototype` 與複本 ID 皆相符；未取得 Google 內部版本編號或原碼雜湊，不能宣稱已比對遠端原碼。
- 測試複本：`1E2my7vuseiOwCK7EODr9AdJf8StW2fpit4CFkaY1d-4`，檔名 `BENCH441 今日溜狗測試`；主清單配置 165 列、33 欄，表頭第 7 列。配置列數不等於有效狗隻數。
- Apps Script 部署：`AKfycbxz87ymqFClpggSXrvY8wY-BWx2ocaRKPYXSDqymbZnt2lggxyd6RuP1dfQ4IxrSjfW-Q`。每筆送到 `/exec`，先核對部署識別，再經既有 writer 登記同一個測試狗編號 `2024010501`；只有測試複本的日期／誰遛的欄位被改動，沒有清除既有正式資料。
- gviz：固定 URL、`headers=0`、`select B,C,D,E`，即編號／犬名／日期／誰遛的。不附 cache-busting 參數；依編號核對唯一列。每筆獨立 Node 程序，序列執行，非同時競爭。
- 原始紀錄：[20 筆 NDJSON](2026-10-21-d1-walk-sync-samples.ndjson)，包含唯一測試 marker，不含金鑰或原有志工姓名。SHA-256（LF 換行）：`aa3ead3e12e06b99723753fdafd9c0cbd87979cbd2e442ce15131c1400faad8b`。
- 統計：中位數取排序後第 10、11 筆平均；P95 用 nearest rank（第 19 筆）。最後另讀 gviz 核對 20 個唯一 marker 全部仍存在，缺失 0；**這只能證明序列寫入結果，不是 10 客戶端競爭驗證**。
- 限制：20 筆短時段樣本不能代表所有時段或延遲保證。20 筆皆在第一次輪詢命中，`lastAbsentResponseMs` 均為 null，因此沒有觀測到從舊值變新值的切換區間，不能估出獨立 gviz 快取延遲。測試防護多一次試算表名稱讀取，`postMs` 不等同正式路徑、純 Google CPU 或 Worker CPU。尚未測試人工修改後的 gviz 延遲，也尚未據此選定寬限期。
- 測試留下的 20 個 BENCH441 名字暫不自動清除，以便核對證據；下一組測試前由 K 在複本確認並清理。本機金鑰以 Windows DPAPI 加密存於忽略檔，只在執行程序內解密，未提交或輸出。

## 2026-10-21 Cloudflare 實測

證據：[Cloudflare 原始選取事件與客戶端紀錄](2026-10-21-d1-walk-sync-cloudflare-evidence.json)。只保留 CPU、事件類型、版本、假名字與 D1 metadata；排除 request headers、IP、完整 request.cf 等資訊。

- 時間：台灣時間 10:07–10:13。Wrangler 4.151.3，帳號 `a0f88d34c34ad0d34f923b9f43799622`。新 Worker `bq-d1-walk-sync-441`，測試版本 `131bddfe-57d0-43aa-ac59-9c62e8c8d05d`；原型原始碼 LF SHA-256 在證據檔 `summary.codeSha256LF`。
- 只綁已核對的測試 D1 `9e23a65c-c9dd-4f83-ad9c-2e01626910f0`，新增 `bench441_walkers`／`bench441_sheet_hashes` 專用表。其餘 39 張既有表不變，沒有寫正式 D1、正式試算表或正式 Worker。原型 schema 依本票的丟棄式分支要求留在工具目錄，不納入正式 compact-schema。
- CPU 來自真正 Cloudflare `wrangler tail --format json` 的 `cpuTime`（ms），不是 `performance.now`。另以 GraphQL schema introspection 確認 `cpuTimeP50/P99` 為微秒；捕獲的最後一次 GraphQL 匯出含 33 組、76 次請求，最大組 P99 為 8,258 微秒（8.258 ms）。它是分組分位數，不是逐次最大值，且查詢可能有資料延遲，不替代 tail。
- `/notify` 讀測試表四欄、正規化名字、對每隻狗計 SHA-256，再和 D1 快照比對，只寫有變的雜湊。第一筆 116 隻初始化回報讀 1、寫 232 列（含主鍵索引成本）；其後 19 次相同快照各讀 116、寫 0。HTTP 回應 20/20 成功，tail 捕獲 15 筆 CPU 2–8 ms；首次 handler 為 8 ms，其餘捕獲 14 筆亦在 2–8 ms。
- Cron 每分鐘執行**同一個比較函式**，並獨立重試最多 3 筆 pending，避免讀取失敗阻斷寫回。捕獲 4 次真實 scheduled 事件，CPU 為 6、8、6、5 ms。每次都有新的 isolateId 且 invocation=1。這是首次 handler 證據，不能保證測到了所有平台啟動成本；也沒有同 isolate 暖 Cron 樣本。不用換網址冒充冷啟動。
- 實測負載只有 116 隻、四欄，尚未加入正式同步的三方合併／手動刪除／復原等工作。因此目前只能說這個探測原型的捕獲 CPU 未超過免費方案 10 ms，不能保證完整正式版本也通過。

### 十個邏輯客戶端及 pending

- run `r91f328c0fb0e96e6`：十個不同 BENCH441 名字對同一隻狗同時 POST；每筆先在 D1 以 `(run,dog,walker)` 主鍵原子 INSERT，`pending=1` 在同一列，因此不會出現名字成功但待寫回漏記。HTTP 回應後 `waitUntil` 呼叫測試 GAS，成功再把該名字的 pending 改 0。
- 第 0／1／2 分鐘各十次讀回，30/30 名單皆含十個名字；第 0 輪可看到十筆 pending，第 1、2 輪均為 0。最後再核對 D1 與 gviz 試算表十個名字都存在，才宣告測試完成。D1 同狗新增 handler 捕獲 1–7 ms CPU。
- 這次寫回仍使用測試 GAS 的既有「加名字＋鎖」路徑，**不是未來整格替換／三方合併的完成實作**；並行 CPU 不能外推到尚未建立的最終流程。
- run `re09e042e69b65d34`：刻意只留下 pending，不派送背景工作（模擬背景派送遺失；未模擬 Google 真實網路故障）。同一名字再送一次回報 D1 寫 0 列。真正 Cron 於台灣 10:11:14 執行時讀到一筆工作，成功補寫，約 10:11:22 的客戶端輪詢觀測到 pending=0；從初次確認 pending 到觀測恢復為 62.076 秒。沒有用 `/retry` HTTP 冒充 Cron。
- 重試 Cron 的比較階段讀 116／寫 0，retry 階段讀 12／寫 1；後者包含 pending 掃描與更新。下一次比對才會看到此次重試造成的 Sheet 雜湊改變，這是比較與 retry 並行的預期結果。

### 用量與免費額度的界線

| 原型動作 | 實際 D1 metadata |
|---|---|
| 初次建立 116 隻雜湊快照 | 讀 1、寫 232 |
| 已一致的比較 | 讀 116、寫 0 |
| 同狗新增一人 | INSERT 讀 0、寫 2；背景 pending 更新另外讀 1、寫 1 |
| 同一人重送（defer 場景） | INSERT 寫 0 |
| 一次讀取該 run 十人 | 讀 10、寫 0 |
| 無 pending 的 Cron | 比較讀 116；pending 掃描讀 10（十人測試資料時）；寫 0 |

此表含捕獲的索引／更新成本，但沒有將不完整 tail 加總冒充全帳號用量。新建表的 schema 寫入、測試查詢、其他網站的用量也不能從帳號預算扣除不算。

以下是**依實測單價的條件推估，不是日用量實測**：固定 116 隻快照每分鐘比較一天，僅快照掃描是 `116 × 1,440 = 167,040` 列／日；還要加 pending 掃描、變動及其他功能。若 30 人開著 15 小時，每分鐘抓一次，為 `30 × 900 = 27,000` 請求／日，另加 Cron 1,440 次與登記／通知等。若正式手機全今日清單每次掃 200 列，單手機輪詢部分就有 `27,000 × 200 = 5,400,000` 列，會高於 D1 免費 500 萬列／日；因此不能把本次只讀十人測試 run 的讀取成本當正式全清單成本。後續須驗證版本號／快取路徑及帳號整體用量，才能敲定頻率與免費額度結論。

官方依據：[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)、[D1 計價](https://developers.cloudflare.com/d1/platform/pricing/)、[GraphQL Workers 指標](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/)。Observability REST 查詢曾被既有 OAuth 拒絕 403，但 tail 與 GraphQL 可讀，不需請 K 另給金鑰。

### 測試收尾與下一步

- 測試 Worker 已移除 Cron，API 讀回 `schedules: []`；另部署到期版本 `56157f35-c4f7-4f3f-9dba-f7f1a29a681f`（EXPIRES_AT=0），已用正確測試金鑰確認 `/notify` 回 HTTP 410。沒有留下可持續寫入的測試服務，也沒有刪資料。
- 測試 D1 專用表與 BENCH441 名字保留供核對。即時 tail 程序已停止。金鑰不包含在證據檔。
- 後續仍需：取得人工觸發器原始紀錄、直接人工改表後的 gviz 延遲觀測，以及正式全今日清單／版本快取／帳號預算驗證。正式整格寫回、三方合併、刪除與復原語意留給 ADR／後續規格，不在原型中偷定案。#441 第 1 步保持未勾，不能關票或進行正式部署。
