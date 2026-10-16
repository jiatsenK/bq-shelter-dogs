# 2026-10-16 資料包觸發器測試（#322）

- Agent：Claude Code（Opus 5.5）
- 做了什麼：`worker/test/packs.test.mjs` 新增測試，記錄 `readDogsPayload`、`readDepartures`、`readRest` 查到的 `v3_` 表，檢查每張都有 `pack_<表>_INSERT／UPDATE／DELETE`；另一個測試逐一拿掉觸發器確認抓得到。AGENTS.md 寫入規則加一條。
- 依據：#322（#315 回顧，ADR 0009）
- 例外／未完成：無
- PR：待開
