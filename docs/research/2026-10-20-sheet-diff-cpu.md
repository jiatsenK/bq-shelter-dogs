# 主清單比對差異的 CPU 時間實測（ADR 0017）

日期：2026-10-20。腳本：`scripts/bench/sheet-diff-cpu.mjs`。

## 方法

- 用跟 Worker 一樣的函式（`gvizTable`、`walkersHeaderRow`、`parseWalkers`，從 `worker/src/index.js` 匯入），餵模擬的主清單 gviz 回應（跟現在一樣讀兩次：headers=0 找表頭、再指定表頭重讀），再和模擬的 D1 今日紀錄比差異。
- Node v24（同樣是 V8）。網路等待（fetch Google、D1 查詢）不算 Worker CPU，所以只量 JS 處理。
- 「冷」：新程序第一次執行（含 JIT 編譯，近似新 isolate 第一次收到通知）；「熱」：連跑 200 次的平均。每組跑 3 次。
- Windows 的 `process.cpuUsage` 精度約 15.6 ms，不能用；改用 `performance.now`（同步程式碼，牆鐘時間約等於 CPU 時間）。

## 結果（ms）

| 列數 | 欄數 | 回應大小 | 冷 | 熱 |
|---|---|---|---|---|
| 300 | 5 | 50 KB | 9.8–10.9 | 1.0–1.2 |
| 300 | 25 | 263 KB | 12.1–15.2 | 2.4–2.6 |
| 300 | 40 | 410 KB | 13.5–16.0 | 3.6–3.6 |
| 500 | 25 | 439 KB | 14.0–16.1 | 4.1–4.3 |

## 結論

- 熱的情況（isolate 還在）1–4 ms，穩定在 10 ms 內。比 ADR 0012 整份同步的 64–152 ms 輕很多。
- 冷的第一次 10–16 ms，貼著或超過上限；主因是讀進整張表和 JIT。只讀 5 欄能壓到約 10 ms。
- 所以實作要：只讀需要的欄、表頭位置不必每次讀兩次。上線前在預覽版看 Cloudflare 儀表板的實際 CPU time 確認（本機量測不等於 Cloudflare 計費）。

## 限制

- 資料是模擬的（每列備註約 40 字），真實主清單欄數、備註長度可能不同。
- 沒用 wrangler／workerd 量：本機 `wrangler dev` 不回報每次 CPU time。
