# 2026-10-27 溜狗日期從在所資料包拆出來（#679）

- Agent：Claude Code（Opus 5.5），由 #687 分派 session 開的子 session
- 分支：`claude/679-split-walk-dates-8c3a03`

## 依據

#679；D1 讀寫效率稽核第 1 項與 K 2026-10-27 定案（`docs/research/2026-10-27-d1-efficiency-audit.md`「定案」表、`docs/research/2026-10-27-small-pack-invalidation.md`）：拆溜狗日期包、同一台機器共用重算、不做 Durable Object、Workers Logs 先不開。

## 做了什麼

- `migrations/0013_walked_pack.sql`：`v3_pack_versions` 加 `walked`；`packs_v3_sheet_main_UPDATE` 重建（監看欄位拿掉 `walked_date`、`walker_codes`，離所年份那段不變）；新增 `walked_v3_sheet_main_INSERT／UPDATE／DELETE`（UPDATE 監看 `row_index,number,name,walked_date,walker_codes`）。`db/compact-schema.sql` 同步。只加東西、沒有搬資料。
- `worker/src/packs.js`：新增溜狗日期包（part=`walked`，主清單順序 `[編號, 狗名, 溜狗日期, 溜狗人代號]`，重算只讀 `v3_sheet_main` 1 張表）；`readSmall('dogs')` 把它蓋回在所資料包（照位置，對不上才照編號＋狗名），兩個版本號都沒變就用記憶體裡合好的那份。`once()`：同一版本號正在重算時，同一台機器後進來的請求等同一次；等的那次失敗就自己再算。版本號查詢改讀 `small,walked`（同一列，讀取列數不變）。
- ADR 0009、0014 補決策段落（不寫量測數字，#670）；`docs/ARCHITECTURE_NOW.md` 狗清單那列補一句。

## 測試

- `worker/test/packs.test.mjs`：改觸發器收窄測試（溜狗日期／溜狗人只動 walked）；新增 4 個測試：只改溜狗日期時 small 不變、只重算溜狗日期包且輸出跟直接讀表相同；加刪狗、改名、換順序；兩包不同步時照編號＋狗名對回去；同時進來的請求共用重算、失敗自己再算。

## 未完成（要 K）

- 合併後按「套用 D1 migration」（接著部署）。套 migration 到部署完成之間，舊程式只看 `small`，溜狗日期可能短暫舊一點（今天的日期有今日溜狗蓋過，不受影響）。
- 上線後檢查正式庫 `v3_packs` part=`main` 的 `ver` 是否仍落後 `v3_pack_versions.small` 很多；仍落後再跟 K 討論開 Workers Logs。
- 研究未定問題 1（`withTodayWalks` 只蓋 `walkedDate` 不蓋 `walkers`）不在這張票範圍，沒動。

## 2026-10-27 rebase

- rebase 到 origin/main e29f63c（含 #688、#690、#689 的 0011、#693 的 0012），沒有衝突；migration 改名為 `0013_walked_pack.sql`。
