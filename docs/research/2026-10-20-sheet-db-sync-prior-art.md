# 試算表當前台、資料庫當正本：別人怎麼做雙向同步

- 日期：2026-10-20（台灣時間）。Agent：Claude Code 背景研究代理。
- 範圍：網路一手來源（官方文件、維基百科對論文的整理、廠商產品頁）。沒有操作瀏覽器、沒有改程式、沒有寫正式資料。
- 標示：**已核對**＝實際打開來源讀到；**未核對**＝沒找到一手來源或沒打開，只是常識或推測。
- 接續 `2026-10-20-d1-single-source-sync.md`、`2026-10-20-sheet-editors-in-d1-sync.md`。

## 結論先講

| 問題 | 結論 |
|---|---|
| 有現成開源工具可直接用嗎 | **沒找到**。搜到的雙向同步多是付費 SaaS（Stacksync、Unito、Whalesync），或付費封閉授權（Odoo 模組 OPL-1、約 US$176）。都不支援 D1，也不值得換。 |
| 我們的設計跟業界做法一致嗎 | **大致一致**：「先寫 D1、標待寫回、Cron 重試」就是 outbox pattern；「Cron 全表比對當保險」對應 Odoo 模組的「快照基準＋定時跑」；「名字以集合聯集合併」接近 OR-Set／LWW-Element-Set。 |
| 主要缺漏 | ① 寫回要**冪等**（outbox 一定會重送）；② 比對要有**上次同步的基準快照**（三方合併），不然分不出「試算表刪了」還是「D1 新加還沒寫回」；③ 程式寫入不會觸發 onChange，要靠 Cron 補。 |
| 最大已知坑 | onChange 事件**不告訴你改了哪裡**；腳本／API 寫入**不會**觸發觸發器；gviz 沒有官方文件（快取行為未核對）。 |

## 1. 類似專案與官方範例

| 來源 | 做法 | 衝突處理 | 刪除 | 狀態 |
|---|---|---|---|---|
| Odoo「Google Sheets Two-Way Sync」模組 https://apps.odoo.com/apps/modules/18.0/google_sheets_two_way_sync | 每次同步成功後存一份**基準快照**，用來判斷是哪一邊改的；定時 Cron 跑，另有「立即同步」按鈕跑同一套 | 兩邊都改同一列時三選一：Odoo 永遠贏、試算表永遠贏、**最後修改者贏**（比對 Odoo 寫入時間與試算表的時間欄） | 頁面沒寫 | 已核對 |
| Stacksync https://www.stacksync.com/integrations/github-and-google-sheets | 宣稱雙向即時同步、失敗事件重播 | 頁面沒說明 | 沒寫 | 已核對（僅產品頁） |
| Unito https://unito.io/integrations/google-sheets-github/ | 宣稱雙向同步、避免重複與無限迴圈 | 頁面沒說明 | 沒寫 | 已核對（僅產品頁） |
| Whalesync https://whalesync.com/sync/postgres-google-sheets | 列出 Postgres ↔ Sheets 雙向 | — | — | 已核對：頁面寫連接器「尚未開放」 |
| Cloudflare 官方「Sheets ↔ D1」範例 | 沒找到 | — | — | 未核對 |
| 開源 Apps Script 雙向同步專案 | 搜尋沒找到維護中、有寫衝突策略的專案 | — | — | 未核對 |

重點：唯一有寫清楚機制的 Odoo 模組，核心就是「**基準快照＋定時比對＋明訂誰贏**」，跟我們的 Cron 全表比對同一路線。

## 2. 通用做法名稱與對照

| 做法 | 一手出處 | 重點 | 我們的設計 | 可改進 |
|---|---|---|---|---|
| Transactional outbox | https://microservices.io/patterns/data/transactional-outbox.html（已核對） | 業務資料和「待送訊息」寫在同一個交易；另一個程式讀 outbox 送出。送出後當掉會**重送**，所以接收端要**冪等** | 先寫 D1、失敗標「待寫回」、Cron 重試＝一致 | 「待寫回」最好跟溜狗紀錄**同一個 D1 batch** 寫入；寫回試算表要冪等（寫「這格應該是什麼」而不是「加一筆」），重送不會多一筆 |
| 基準快照／三方合併 | Odoo 模組（上表，已核對）；三方合併的學術出處未核對 | 用「上次同步結果」當共同祖先，才分得出哪一邊改了 | 有寬限期，但文件沒明講存基準 | 每格存「上次兩邊一致的值」；比對時：試算表≠基準→試算表改了；D1≠基準→網站改了；兩邊都改才算衝突 |
| Last-writer-wins | Odoo「Last Modified Wins」（已核對）；LWW-Element-Set 見下 | 用時間比新舊 | 時間由伺服器決定＝一致 | 試算表沒有可靠的每格修改時間（Apps Script onChange 可補記，但會漏），所以 LWW 只適合 D1 端；試算表端用三方合併判斷 |
| OR-Set／LWW-Element-Set（CRDT） | https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type（已核對；原論文 Shapiro 等 2011 RR-7506 未直接打開） | OR-Set：每次加入有唯一標記，刪除只刪「看過的」標記，所以**同時加與刪時加入贏**；LWW-Element-Set：加入、刪除各帶時間，比新舊 | 名字聯集合併、手動刪除尊重試算表 | 「聯集」＋「刪除尊重試算表」其實就是要**分辨刪除是否看過那個名字**——這正是 OR-Set 的重點。實作上用基準快照即可：名字在基準有、試算表沒有→試算表刪了；基準沒有、D1 有→網站新加，保留 |
| Sync token／變更紀錄 | Google Calendar API https://developers.google.com/workspace/calendar/api/guides/sync（已核對） | 先全量、之後用 token 拿增量；token 失效回 410 就清掉重做全量 | Cron 全表比對＝每次都全量 | 試算表沒有列層級的 sync token；Drive 推播（下節）只說「檔案變了」。表只有一百多隻狗，全量比對成本可接受，**不必追增量** |

## 3. 已知的坑

| 坑 | 出處 | 影響 | 狀態 |
|---|---|---|---|
| 腳本與 API 寫入**不會**觸發觸發器 | https://developers.google.com/apps-script/guides/triggers ：「Script executions and API requests don't cause triggers to run」 | Worker 寫回試算表不會引發 onChange（好事，不會迴圈）；但其他腳本或外掛改的值，Worker 只能靠 Cron 發現 | 已核對（該頁講 simple trigger；installable onChange 是否同樣不觸發，頁面未明講，推測相同） |
| onChange 的 `changeType` 只有 EDIT、INSERT_ROW、REMOVE_ROW、INSERT_GRID、FORMAT、OTHER 等，**不給範圍** | https://developers.google.com/apps-script/guides/triggers/events | 排序、貼上等大概落在 EDIT／OTHER，無法知道改了哪幾格→通知 Worker 後仍要全表比對（我們已是這樣） | 已核對（排序、貼上分別歸哪一類未核對） |
| onEdit 的 `oldValue`／`value` 只在單格編輯時才有 | 同上 | 不能用 onEdit 精準記錄多格貼上 | 已核對 |
| 大量貼上漏抓 | 社群討論（非 Apps Script 官方，第三方連接器）https://community.glideapps.com/t/onchange-trigger/16970 | 佐證「觸發器不能當唯一來源」 | 已核對（社群文章，非一手） |
| 找不到 Issue Tracker 上「排序／貼上不觸發 onChange」的正式回報 | — | — | 未核對 |
| Apps Script 配額（一般 Gmail 帳號） | https://developers.google.com/apps-script/guides/services/quotas | 觸發器合計 **90 分鐘／天**、單次 6 分鐘、UrlFetch **2 萬次／天**、同時執行 30 個；官方註明可能隨時變動 | 已核對。onChange 每次只送一個通知給 Worker（約 1 秒內），一天幾百次遠低於上限 |
| Drive 推播可當 onChange 的替代 | https://developers.google.com/workspace/drive/api/guides/push | 可 `files.watch` 試算表檔案；通知**不含內容**、頻道最長 1 天要自己續、無延遲保證 | 已核對。比 onChange 麻煩，不建議換 |
| gviz `/gviz/tq` 快取與延遲 | 沒有官方文件 | 寬限期長度只能靠實測 | 未核對 |
| Cloudflare Cron 時間不保證精準 | https://developers.cloudflare.com/workers/configuration/cron-triggers/ | 排程在閒置機器上跑；最細每分鐘；改排程最多 15 分鐘才生效；頁面**沒寫送達保證** | 已核對 → Cron 漏一次要能被下一次補上（全表比對本來就成立） |

## 4. 結論：有沒有缺漏

1. **方向對**：outbox（待寫回＋重試）、觸發器通知＋定時全量比對當保險、伺服器時間，都是常見做法，Odoo 模組也是同一套。
2. **建議補上**：
   - **基準快照**（每格「上次兩邊一致的值」）。有了它，寬限期、名字聯集、手動刪除三件事可以用同一個規則判斷，不用各自寫特例。
   - **寫回冪等**：寫回時寫「這格的完整名單」，不要「附加一個名字」；重送不會重複。
   - **待寫回與溜狗紀錄同一個 D1 batch** 寫入，避免寫了紀錄卻沒排待寫回。
   - **明訂兩邊同格都改時誰贏**（例如名字取聯集、其他欄試算表贏），寫進 ADR。
3. **現成工具**：沒有能接 D1 的免費開源方案；SaaS 要付費且不懂我們的名字合併規則。**不值得換**，維持自己寫。
