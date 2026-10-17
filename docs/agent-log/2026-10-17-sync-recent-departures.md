# 2026-10-17 同步只讀最近 60 天的離所（#364）

- Agent：Claude Code（Opus 5.5）
- 依據：#364、ADR 0014「同步只讀最近 60 天的離所」

## 做了什麼

- `scripts/sync-compact-d1.mjs`：`readSeed` 平常的同步改用 `narrowSeedSql`：
  - `v3_departures`、`v3_departure_items`：只讀出所日在 60 天內（`departureCutoff`，含剛好 60 天前那天）或日期空白的。
  - `v3_dogs`、`v3_dog_numbers`、`v3_intros`：照 `dog_id` 讀上一次主清單、這些近期離所、試算表這次的編號（找回來的狗）、這次要讀的溜狗紀錄的狗。
  - 記憶體 D1 裡沒有舊離所，寫回時比不出差異，不會被刪或改。`full`（全量核對）照樣整張讀。
  - `main` 把試算表編號和台灣時間的今天傳進 `readSeed`。
- 測試（`scripts/sync-compact-d1.test.mjs`）：讀取量不隨舊離所數變大、全量核對照樣讀到、舊離所不被刪改且新出所照樣寫入、出所很久的狗用同一編號回到主清單時沿用原本的永久狗。

## 備註
- 出所很久的狗回到主清單，舊離所紀錄不會像以前那樣被拿掉（ADR 0014 刻意的，要修走全量核對）。
- 預演：PR 轉正式後 `測試` CI 的同步預演會留言列數。
