# 隔離區顯示名稱改為住院區

- 日期：2026-10-29。Agent：Claude Code。
- 依據：K 2026-10-29 在對話中要求，所有使用者看得到的「隔離區」改叫「住院區」，只改顯示名稱，不動資料庫值、欄位、API、識別碼與邏輯。沒有對應 Issue。
- 盤點：全 repo 搜尋「隔離」，跟區名有關的只有兩處設定。其餘都是「測試資料隔離」的意思（預覽 D1、隔離 SQLite 等），不動。
  - `public/js/site-config.js` 的 `SITE.zones` ward：`name` 給電腦版分區、`team` 給圖鑑隊名。
  - `public/js/find.js` 的 `FIND_ZONES` iso：`name` 給平面圖標籤、aria-label、分區標題與找路文字，`short` 給篩選小標籤。
- 確認不受影響：篩選、排序、隊伍歸屬都用 `key`（`ward`／`iso`）與籠位比對 `^住院`，沒有任何程式拿顯示名稱做比對。籠位值本來就是「住院區」。管理站與 Worker 沒有顯示分區名。
- 做了什麼：上面兩處的 `name`／`team`／`short` 改成住院區、住院區隊、住院；同步改 `tests/index/find.js` 三處預期文字、`GLOSSARY.md`「區」、`docs/design/cards.md` 隊色清單與程式註解。舊紀錄（AGENT_LOG、agent-log、PROJECT_GOALS 歷史段落、critique 報告）保留原文。
- 本機測試：`check-local.ps1 -Suite index,desk-find,desk-layout,departed-cards` 全部 255 項通過。沒有跑 `-Full`，交給 CI。
- 相關 PR：見本分支 PR。
