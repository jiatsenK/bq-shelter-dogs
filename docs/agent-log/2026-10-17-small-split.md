# 2026-10-17 small 拆成在所＋離所按年（#362）

- Agent：Claude Code（Opus 5.5）
- 依據：ADR 0014（PR #359 分支 `claude/small-pack-352-32caf4`）、ADR 0009

## 做了什麼

- `worker/src/packs.js`：在所資料包（`v3_packs` part=`main`）只有狗清單和主清單上的狗的休養；離所按出所年份一年一份（part=`departures:年`，日期不明是 `departures:none`），版本號在新表 `v3_departure_versions.years`（JSON）。`/api/departures`、`/api/rest` 回應格式不變，由各年資料包接起來。
- `worker/src/compact.js`：入所事件、出入所紀錄只讀主清單上的狗；`readDepartures(db, 年)`、`readRest(db, 'main'|年)` 只讀那部分，走 `departed_date`、`dog_id` 索引。休養改成依編號排（直接讀表和資料包同一個順序）。
- `db/compact-schema.sql`：新表、兩個索引、第一次補建時從現有離所紀錄補每年的鍵；觸發器換內容並改名 `packs_<表>_<動作>`（同步只跑 IF NOT EXISTS，同名換不掉），舊的 `pack_` 和舊的 small 資料包刪掉。
- 測試：`worker/test/packs.test.mjs` 觸發器檢查改 `packs_`，新增跨年份輸出相同、觸發器只動那一年、10 隻和 100 隻離所讀取列數一樣、查詢計畫不整張讀、補建版本表；同步測試的 schema 行規則跟著改。

## 例外／未完成

- 不在主清單、也沒有離所紀錄的狗，休養不再出現在 `/api/rest`（實際不會發生，測試有寫明）。
- Worker 先部署、同步還沒補建 `v3_departure_versions` 前，`/api/departures`、`/api/rest` 會回「等同步補建」錯誤（跟 ADR 0009 一樣不退回整表讀取）。
- `synced_at` 搬家是 #361（另一個視窗），兩邊都改 `db/compact-schema.sql`，後合併的處理衝突。
- 名冊索引、按年詳細 API 是 #363。
