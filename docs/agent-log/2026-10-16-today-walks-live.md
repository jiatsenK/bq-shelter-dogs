# 2026-10-16 今日溜狗紀錄實作（ADR 0007）

- Agent：Claude Code（Opus 5.5）
- 依據：`docs/adr/0007-today-walks-live.md`（K 2026-10-16 決定）；#305 追問時發現按復原後 D1 還是上次同步的內容，狗又出現在「我溜過」。

## 做了什麼

- 新表 `v3_today_walks`（`db/compact-schema.sql`）：每隻狗今天一筆，記按溜了／復原後試算表那隻狗的「遛狗日期」「誰遛的」；`walked=0` 表示復原了。
- Worker（`worker/src/today.js`、`index.js`）：`POST /api/walk` 寫試算表成功後同步寫 D1（溜了、修改、復原、試算表已被改過都記現況）；寫失敗只 `console.error`。每次寫入順便清掉今天以前的。`GET /api/today` 回今天清單，記憶體快取 15 秒、寫入時清掉。
- 網站（`public/js/app.js`）：打開時、每 1 分鐘（顯示在螢幕上才抓）、切回超過 30 秒時抓 `/api/today`；只採用比上次同步（`syncedAt`）新、也比這頁自己寫入新的紀錄；安靜改狗卡、誰遛的、這支手機今天已溜和「我溜過」。抓不到不提示。

## 例外

- ADR 寫「復原時連這筆一起刪」，實作改成留一筆 `walked=0`：同步已經把誤按帶進 D1 時，刪掉就沒有東西能蓋過舊同步資料，K 的狗會又出現在「我溜過」。效果等同「這筆今日紀錄不算溜過」，仍只保留今天。
- 舊資料清理放在 Worker 寫入時（ADR 寫同步後），沒有舊資料時不算 D1 寫入。

## 相關

- 分支 `claude/today-walks-live`，PR 見 commit 紀錄。
