# #460 別人怎麼做「資料庫 ↔ 試算表」回寫排隊與定期對帳

- 日期：2026-10-22（台灣時間）。Agent：Claude Code 背景研究代理。
- 問題：現在每分鐘一輪 Cron 同時做「保險掃描 200 隻」和「派送最多 10 隻給 Apps Script」，CPU 超過免費方案 10 ms。別的系統怎麼排隊回寫、多久對帳一次？在 Workers 免費方案裡怎麼做？
- 範圍：只讀官方文件（下方附網址）。沒有部署、沒有改程式、沒有線上測試。延續 `docs/research/2026-10-22-460-cron-cpu-cause.md`（CPU 主要花在 D1／服務綁定的往返次數）。

## 結論

- **業界標準做法是「寄件匣（outbox）＋冪等收件」**：寫資料時同一筆交易記一筆「待送」，另一個程式慢慢送；送重複沒關係，因為收件端認得已處理過的。我們的 D1 待派送表已經是這個形狀，不用換架構。
- **最省 CPU 的改法是減少往返**：10 隻合成一次 Apps Script 呼叫（Apps Script 官方也要求一次讀寫整塊，`setValues`），D1 的讀／搶鎖／確認改成 `batch()` 一次送。預估往返從約 65 次降到個位數。
- **保險掃描不必每分鐘做**：試算表人工修改可以由 Apps Script 的 `onEdit` 觸發器主動推過來；全量掃描降到每小時或每天一次當保險。
- **Queues、Workflows、Durable Objects 免費方案都能用**，但都不是必要的；Queue 的每則訊息算 3 次操作，每天 1 萬次額度，以現在量夠用。
- 信心：中高（額度數字都來自官方頁面；往返數降低後的實際 CPU 仍要本機剖析確認）。

## 1. Cloudflare 官方能用的東西（免費方案，2026-10 查）

| 項目 | 免費方案 | 對我們的意義 | 來源 |
|---|---|---|---|
| Cron Triggers | 每次 10 ms CPU；整個帳號 5 個；每次 50 個外部子請求、1,000 個 Cloudflare 內部子請求 | 現況瓶頸 | https://developers.cloudflare.com/workers/platform/limits/ |
| Queues | 可用；每天 1 萬次操作；保留 24 小時；預設一批 10 則；**一則訊息＝寫＋讀＋刪 3 次**，重試每次再加讀 | 一天約 3,300 則上限。消費者的 CPU 上限頁面沒有另外寫，視同 Worker 的限制，不能當成「多給 CPU」 | https://developers.cloudflare.com/queues/platform/pricing/ |
| Workflows | 可用；**每個步驟 10 ms CPU**、等待時間不限；每個流程 1,024 步 | 可把「掃描」「每隻派送」切成不同步驟，各自有 10 ms；但多一層狀態，維護成本高 | https://developers.cloudflare.com/workflows/reference/limits/ |
| Durable Objects（SQLite） | 可用；每天 10 萬次請求、寫 10 萬列；`setAlarm()` 算寫一列 | 可當「有東西才叫醒」的計時器，不必每分鐘空轉；但又多一套儲存 | https://developers.cloudflare.com/durable-objects/platform/pricing/ |
| D1 `batch()` | 多句 SQL 一次送出、減少往返；整批是一個交易，一句失敗全部退回；同一個 prepared statement 可重複 `bind` | 直接對症：把每隻派送的 3 次 D1 呼叫合成 1 次，甚至 10 隻一起 | https://developers.cloudflare.com/d1/worker-api/d1-database/ |

官方沒有公布「每次 D1 呼叫花多少 CPU」，只說要用 `batch()` 減少往返；我們本機剖析的結論（往返的打包／解讀才是大宗）跟這個方向一致。

## 2. 通用的寄件匣模式

- microservices.io 的 Transactional outbox：改資料和「待送訊息」寫在同一個交易；另一個「轉送程式」輪詢寄件匣再送出。轉送可能送兩次（送完還沒記錄就當機），所以**收件端必須冪等**，例如記住處理過的編號。https://microservices.io/patterns/data/transactional-outbox.html
- 對應到我們：D1 待派送列＝寄件匣；Cron 派送＝輪詢轉送；Apps Script 回呼確認＝記錄已送。Apps Script 寫試算表時要能「同一筆重寫一次結果不變」（用溜狗紀錄編號判斷），這樣重試、批次化都安全。
- 常見搭配：一次撈一批（batching）、失敗延後重試（backoff，例如記下次可重試時間）、超過次數放到「待人工處理」。

## 3. Google Sheets／Apps Script

| 項目 | 一般 Gmail 帳號額度 | 來源 |
|---|---|---|
| 每次執行 | 最長 6 分鐘 | https://developers.google.com/apps-script/guides/services/quotas |
| 觸發器總執行時間 | 每天 90 分鐘 | 同上 |
| UrlFetch | 每天 2 萬次 | 同上 |
| 同時執行 | 每人 30 個 | 同上 |
| 觸發器數量 | 每個腳本每人 20 個 | 同上 |

- **一次讀寫整塊**：官方最佳做法是一次讀進陣列、在記憶體裡處理、一次寫回；逐格寫 100×100 約 70 秒，整塊寫約 1 秒。所以「10 隻合一次呼叫、用 `setValues` 一次寫」在 Apps Script 那端也更快。https://developers.google.com/apps-script/guides/support/best-practices
- **人工修改主動推送**：可安裝的 `onEdit`／`onChange` 觸發器在「有人改值／改結構」時執行，以建立者身分跑；**腳本或 API 寫入不會觸發**，所以我們自己回寫不會造成迴圈。失敗只寄信給建立者。https://developers.google.com/apps-script/guides/triggers/installable
- 注意：每次人工修改都會用到「觸發器總時間 90 分鐘／天」與 UrlFetch 額度；志工表的修改量遠低於這些上限，但最好在觸發器裡只送「哪隻狗被改」，讓 Worker 再讀那一隻。

## 4. 對帳掃描怎麼排

- 一般做法是「平常靠變更通知或變更標記做增量，偶爾全量對帳當保險」。
- Google Drive 的 Changes 只告訴你「哪個檔案變了」，**不給儲存格層級的差異**，要自己存上次狀態比對；對單一試算表來說等於只能知道「整份有改」，用處不大。https://developers.google.com/workspace/drive/api/guides/about-changes
- 所以對我們最實用的增量訊號是上面的 `onEdit`：它知道改到哪一列。全量掃描保留，但頻率可從每分鐘降到每小時或每天，並且跟派送分開跑。

## 對應到本專案的選項

| 選項 | 做法 | 好處 | 代價 | 免費？ |
|---|---|---|---|---|
| A. 派送批次化（建議先做） | 一輪把待派的狗合成一次 `walkWake`，Apps Script 用 `setValues` 一次寫，回呼一次確認多隻 | 往返從約 30 次降到約 3 次；Apps Script 也更快 | 要改 Apps Script 與回呼格式；一批失敗要能逐隻重試 | 是 |
| B. D1 改 `batch()` | 讀、搶鎖、確認各合成一次 | 直接砍 D1 往返；交易保證 | 一句失敗整批退回，要設計好 | 是 |
| C. 掃描與派送拆開、掃描降頻 | 派送仍每分鐘；全量掃描改成另一個 Cron（每小時／每天），或輪流每次只掃 1/N | 每輪 CPU 減半以上 | 人工修改最慢要等到下一次掃描（搭配 D 解決） | 是（Cron 帳號上限 5 個要算） |
| D. `onEdit` 主動推人工修改 | Apps Script 觸發器把被改的狗編號 POST 給 Worker | 不用每分鐘掃全表也能很快看到 | 多一個觸發器要維護；吃 Apps Script 每日額度；失敗只寄信 | 是 |
| E. 改用 Queue 消費者派送 | 收到溜狗紀錄就送進 Queue，消費者一批 10 則處理 | 有內建重試、死信佇列 | CPU 上限沒有比較多；每則 3 次操作；和 D1 待派送表重複 | 是，每天 1 萬次操作 |
| F. Workflows／Durable Object 鬧鐘 | 每步驟各自 10 ms；或有待送才設鬧鐘 | 可把工作切細、沒事不空轉 | 架構變複雜，K 較難自己維護 | 是 |

建議順序：A＋B（最小改動、對症）→ C＋D（掃描降頻）→ 真的還不夠才考慮 E／F。

## 未確認

- Queue 消費者的 CPU 上限官方限制頁沒寫明，需要時再查或實測。
- A＋B 之後的實際 CPU 要本機 workerd 剖析確認。
- 各額度官方註明可能隨時調整。
