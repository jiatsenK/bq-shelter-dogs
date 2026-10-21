# #441 實測狀態與來源

日期：2026-10-21（台灣時間）。Agent：CODEX。

**目前沒有 Google 或 Cloudflare 線上實測數字。** K 確認尚無獨立測試試算表及 Apps Script 部署；正在準備複本。不得將本文件視為第 1 步已完成，也尚未決定寬限期、Cron 頻率或 ADR 0017。

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
| doPost 成功回應耗時 | 未測 | 缺測試部署 |
| gviz 首次讀到新值耗時 | 未測 | 缺測試複本與可讀權限 |
| 排序、多格貼上、Ctrl+Z 事件 | 未測 | 需 K 實際操作測試表與配對觸發器紀錄 |
| 通知／Cron CPU（含冷啟動） | 未測 | 隔離 Worker 尚未建立，不能用本機時間取代 |
| 10 客戶端並行名字保留 | 未測 | D1 候選同步原型尚未建立 |
| D1／Workers 實際用量 | 未測 | 須同時記索引、觸發器、重試與帳號共用量 |

每組數字須附：測試時間、版本 SHA、環境識別、樣本數、失敗數、原始紀錄位置、觀測範圍與限制。直到全部完成，Issue 的第 1 步核取方塊保持未勾。
