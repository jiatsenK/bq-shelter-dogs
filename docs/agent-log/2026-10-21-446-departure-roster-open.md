# 2026-10-21 #446 離所紀錄頁預設展開名冊

- Agent：Claude Code（雲端）；依據：Issue #446（K 2026-10-21 確認）。
- 分支：claude/446-departure-roster-open。
- 修改：`depRoster.open` 預設 true；`openInfoPage('departures')` 每次從分類進來都重設為展開。收起只維持到離開該頁；點狗看詳細再返回不經過 openInfoPage，保留收起狀態。按年長條仍會展開並篩年份。
- 文件：`docs/273-info-page.md` 離所紀錄一行補上預設展開。
- TDD：`tests/info-page.cjs` 新增一隻離所狗的情境：進頁即見名冊、aria-expanded=true、可收起、返回再進又展開；先紅後綠。
- 未改樣式，未跑 impeccable detect。
