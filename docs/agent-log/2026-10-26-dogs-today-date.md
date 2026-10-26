# 2026-10-26 狗清單帶今日溜狗的日期與紀錄

- Agent：Claude（Opus 5.5），前端結構整理工作階段接續；分支 `claude/dogs-today-date`。
- 依據：R1（#607）時發現開頁讀不到 `/today` 溜狗表會停在載入畫面；研究 `docs/research/2026-10-26-today-walks-unreadable.md`。K 2026-10-26 選「狗清單上的日期也改成今天」（A），接受重新整理後復原要等「取消中」一兩秒。

## 做了什麼

- `worker/src/index.js`：`getDogs` 多讀一列今日溜狗資料包（`readAcceptedWalks`），`withTodayWalks`（`walk-accept.js`）把主清單上有今日溜狗的狗換成 D1 日期，回應附 `today`（只放主清單上的狗）。複製物件，不改資料包快取；讀不到今日溜狗照複本給、不帶 `today`。不寫表、不加 migration。
- `public/js/dog-data.js`：`parseDogsData` 保留 `today`。
- `public/js/app.js`：`applyDogsData` 收到當天的 `today` 就交給 `walkRegistration.receiveToday`、`todayState` 直接 ready，開頁不再另外打 `/today`；之後每分鐘讀 `/today` 照舊。
- 文件：ADR 0018 補充一節；`docs/ARCHITECTURE_NOW.md` 狗清單一列。

## 測試

- `worker/test/d1-read.test.mjs` 加 2 項：今日溜狗日期蓋過複本、復原回較早日期、主清單外的狗不放、快取沒被改；今日溜狗讀不到照複本給。
- `tests/startup-stability.cjs` 加：狗清單帶 `today`、`/today` 回 503 時直接出現狗卡且排序相同。先把前端改回 `withToday = false` 確認這步逾時失敗，再改回通過。
- `worker/test/packs.test.mjs`：直接讀表的對照也合併今日溜狗；「沒變時只讀版本號」的 /dogs 從 2 列改 3 列（多今日溜狗資料包 1 列）。
- 本機 `check-local.ps1`：Node 全套 453／454，唯一失敗 `admin-stage4` 為既有偶發、單獨重跑通過；本機沒有 pwsh 7，`local-check.test.mjs` 以 `BQ_CHECK_PWSH=powershell.exe` 跑通過。網頁 25 套全過（index 253 項）。
- 未在手機上實際看過。
