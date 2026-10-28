# #677 ADR 0018 補上排程心跳決策，修正過時註解

- 日期：2026-10-27。Agent：Claude（#687 分派 session 開的子 session）。分支 `claude/677-adr-heartbeat-19f0f3`（從 main `ff8501a` 開）。
- 依據：Issue #677；`docs/research/2026-10-27-cron-heartbeat.md` 的建議與 K 2026-10-27 定案（維持每次都寫心跳，ADR 只補決策）；#670 原則（ADR 不放量測數字）。
- 做法：
  - `docs/adr/0018-today-walks-d1-event-sync.md` 第 2 點補修訂：「直接結束」指不派送、不讀試算表；沒工作仍記跑完時間的原因、考慮過的替代做法、K 接受的代價。沒寫列數或百分比。
  - `worker/src/index.js` 兩處註解：排程「沒工作就只查一次 D1」改成實際做的事；`/walkers` 註解改成手機只輪詢 `/today`，`/walkers` 在開頁、按更新、恢復連線時才抓。
  - `docs/ARCHITECTURE_NOW.md` 排程說明的保險掃描 cron 從 `53 1,5,15` 改成跟 `wrangler.jsonc` 一致的 `23 1,5,15`（研究文件建議一起修）。
- 不改程式行為，只動註解與文件。沒有部署、沒有動正式或測試資料。
