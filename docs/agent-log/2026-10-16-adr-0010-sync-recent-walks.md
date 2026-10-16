# 2026-10-16 ADR 0010：同步只比對最近一段溜狗紀錄

- Agent：Claude Code（Opus 5.5）
- 做了什麼：和 K 討論（grill）後新增 `docs/adr/0010-sync-recent-walks-only.md`，在 ADR 0009 那段註明已被取代。只寫文件，沒改程式。
- 依據：PR #327 的報告（建議 1）；K 在對話中的決定。
- 未完成：實作要另外開票（同步腳本只讀、只寫最近一段；6:30 用主鍵核對；workflow 加全量核對選項；記下上一次成功同步）。GitHub Actions 分鐘數的問題另見 #329。
