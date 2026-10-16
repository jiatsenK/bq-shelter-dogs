# 2026-10-16 ADR 0011 補登舊入所日

- Agent：Claude Code
- 做了什麼：新增 `docs/adr/0011-intake-date-manual-backfill.md`；在 ADR 0005 開頭註明「部分被 0011 取代」；GLOSSARY 新增「舊入所日」，並改寫「入所日」的定義；開 #333（ready-for-agent）。
- 依據：K 2026-10-16 決定重開 ADR 0005，採做法 A（研究見 `docs/research/2026-10-16-intake-date-without-former-number.md`）。
- 未完成：程式還沒改，照 #333 做。本 PR 只有文件。
- 編號用 0011，因為 #331 已經用掉 0010。
- 同日更新：K 改成每次出入所都可以補登一筆（入所日、出所日、原因），入所多久從最早那次入所算到今天，中間出所的時間不扣。ADR 0011、GLOSSARY（「舊入所日」改為「出入所紀錄」）、#333 跟著改。
