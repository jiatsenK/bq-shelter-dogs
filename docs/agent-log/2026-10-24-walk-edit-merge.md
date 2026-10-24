# 人工連改兩格：「上一次」記改之前的值

- 日期：2026-10-24。Agent：Claude。分支 `claude/walk-edit-merge`。
- 依據：K 2026-10-24 開 `D1_WALK_NOTIFY` 後實測，GAS 一格一送，D1 每格開一版；研究 `docs/research/2026-10-24-walk-edit-per-cell-impact.md` 結論：D1 額度無影響，問題在復原會回到改一半的狀態。K 要求解決。
- 問題：先改人名、再改日期時，第二版的 `previous_date／previous_walker` 取第一版（改一半：舊日期＋新人名），網站按復原會回到不存在的紀錄。先改日期再改人名不受影響（同日期改人名沿用原本的上一次）。
- 改動：`worker/src/walk-accept.js` 的 `compareTrustedWalk` 改日期時呼叫 `beforeManualEdits`：往回找 2 分鐘內連續的人工版本（synced、`dispatch_id` 空白、`next_attempt_at` 為建立時間），用這串之前那一版的值當上一次。改回連改前的日期時照一般規則。不新增欄位、不改 schema、版本照常遞增。
- 測試：`worker/test/walk-edit-rows.test.mjs` 新增兩項（連改記改之前、超過合併時間照一般規則）。
- 未做：網站仍可能短暫顯示改一半的值（要 GAS 延遲送出才能避免）；第一版是種子（沒有 outbox）時找不到改之前的值，照舊規則；outbox 保留期另議。
