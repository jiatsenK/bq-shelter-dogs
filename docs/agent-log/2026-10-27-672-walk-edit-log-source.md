# 2026-10-27 修改紀錄新增「溜了」與來源（#672）

- Agent：Claude Code（Opus 5.5）
- 分支：`claude/672-walk-edit-log-source-a77d2d`

## 依據

K 2026-10-27 決定（#672 內文）：管理網站修改紀錄新增類型「溜了」，每筆標來源志工網站或試算表；舊紀錄不補；來源只分管理網站／志工網站／試算表；志工統計取消。背景研究比較過 `editor_code` 做記號、重建 `v3_dog_edit_actors` 改 CHECK、讀取時推算，結論是加 `source` 欄（研究檔在 K 本機 chore/cleanup 分支，要點已寫進 issue）。

## 做了什麼

- `migrations/0010_edit_log_source.sql`：`v3_edit_log` 加 `source`（沒有 CHECK）；「試算表（自動認回所）」的 `former` 舊紀錄改 `sheet`。`db/compact-schema.sql` 同步。含 UPDATE，套用 workflow 會先備份。
- `worker/src/walk-accept.js`：`walkLog`／`sheetWalkLog`。`acceptWalk` 按溜了（名單有變才記）記 `walk／volunteer`，撤銷、改溜狗人照舊 kind 但填 `volunteer`；收下人工改表（`compareTrustedWalk`）記 `walk／sheet`，清空日期不記。寫入預算每筆 +8（`32 + 8 × 筆數`，原本 `editor ? 40 : 32` 的算法不變）。
- `worker/src/walk-reconcile.js`：保險掃描收下人工改表同樣記 `walk／sheet`。
- 沒動 `dog-list.js` 的 `applyMain`（網站寫回的值在那裡跟人工改表分不出來）；只把自動認回所的寫入補 `source='sheet'`。
- `worker/src/editlog.js`：KIND_LABELS 加 `walk: '溜了'`；`logEdit` 預設 `source='volunteer'`（活動、備註、異動紀錄）；`readEdits` 排除 `walk`，不加索引。`worker/src/identity.js` 更名、合併填 `volunteer`。
- `worker/src/admin/edits.js`：來源白名單加 `sheet`，讀取 `COALESCE(a.source,l.source,'legacy')`。
- 管理網站：`updates.html` 來源選單加「試算表」、`edit-log.js` `sourceLabel` 加試算表、`public/js/edit-values.js` 溜了顯示「日期（溜狗人）」。為了跟同時進行的 #671 少衝突，這三個檔只動這幾行。
- 文件：ADR 0004 加修訂段、GLOSSARY「編輯紀錄」「資料編輯」「修改紀錄」。

## 測試

- 新增 `worker/test/walk-log.test.mjs`（驗收條件逐條）、`scripts/d1-migrations.test.mjs` 的 0010 測試、`scripts/admin-stage4.test.mjs` 顯示文字。
- 寫入量預演：CI 的「同步預演會寫 N 列」留言已隨 #501 拿掉，改用本機 `worker/test/walk-cost-preview.mjs`、`walk-reconcile-cost-preview.mjs` 比對改前改後（數字見 PR）。

## 未完成（要 K）

- 合併後按「套用 D1 migration」（會先備份，接著部署）。
- 上線後驗收：志工網站按一次溜了、試算表填一隻狗今天的溜狗人、同一隻狗網站登記寫回後不多出試算表紀錄。
