# 今日溜狗保險掃描改成按狗比指紋

- 日期：2026-10-24。Agent：Claude。分支 `claude/walk-scan-per-dog`。
- 依據：ADR 0018 第 5 點「不一樣才找出哪幾隻不同」；K 2026-10-24 對話要求照狗清單 `dog-list-scan` 的做法改。
- 問題：原本 `walkScan` 整張表只有一個 SHA-256（`v3_sync_state.walk_scan_sig`），而且只在掃描時更新。兩次掃描之間只要有人溜狗，即使早已同步好，下次掃描也會整份傳回、Worker 逐隻比對。
- Worker（`worker/src/walk-reconcile.js`）：`scanWalks` 對每隻 D1 有狀態的狗，用 `base_date`／`base_walker`（D1 記的表上值）算指紋 `walkFingerprint` 送給 GAS；GAS 回空就結束。指紋不另外存，`walk_scan_sig` 不再讀寫（舊列留著無害）。未決派送、一輪 10 隻上限沒收完的狗 base 不變，下次掃描自然再回來。
- GAS（`apps-script/sheet-write.gs`）：`walkScan` 收到 `fingerprints` 時用 `walkScanRows` 只回 D1 有記、指紋不同的狗；同一隻在表上出現兩次都不回（Worker 本來就跳過）。沒帶 `fingerprints`（舊 Worker）回整份，兩邊不必同時部署。
- 指紋算法：`SHA-256(JSON.stringify([日期, 名單]))` 取前 16 碼 hex；`worker/test/walk-writeback.test.mjs` 用 Worker 的函式核對 GAS 結果。
- 未做／待 K：GAS 要貼新版並重新部署才會生效（舊 GAS 收到新 Worker 會照舊回整份，功能正確只是沒省到）。
