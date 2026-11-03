# 2026-11-03 回所判斷的 name 索引（#807）

- Agent：Codex（gpt-6.1-sol，K 指定、K 手動交辦）寫 migration 與 schema，Claude Code（Opus 5.5）寫規格、驗收測試、收尾、審查，分支 `claude/807-departure-name-index`
- 依據：#807，#803 搬動 `returnedDog` 時發現。

## 做了什麼

- `migrations/0024_departure_name_index.sql` 與 `db/compact-schema.sql` 加 `v3_dog_departures_name`，回所判斷不再掃整張離所表。查詢本身沒改。
- `main-row.test.mjs` 從實際呼叫抓 SQL 看查詢計畫。本機計數只算回傳的列，看不出掃了多少。

## 例外與要注意的

- 合併後 K 要按「套用 D1 migration」。按之前部署那關會亮紅叉，這是正常的。
- 這次 Sol 在主資料夾工作，主資料夾暫時切到 detached HEAD。改動複製到分支後已還原並切回 `main`，兩個原有的未追蹤檔沒動。

## 相關 PR

關閉 #807 的那張 PR。
