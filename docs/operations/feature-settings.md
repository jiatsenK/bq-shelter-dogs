# 功能管理（#565）

2026-10-25。以主線 `856aa6c`／已合併 #564、#573 為基準。依 #562、#565 與 K 的第二階段實作授權；第三至五階段不在本次。

> 2026-10-26 現況：PR #576 已合併，migration 0003 已套用，志工站與管理站已部署（#565 留言）。K 登入後的操作驗收還沒做（記在 #562）。

## 契約

`v3_feature_settings` 只保存一份十項 boolean＋revision。三項顯示是活動紀錄、資料檢查、更新紀錄；七項編輯是介紹、照片、休養、活動、固定照顧、出入所紀錄、舊編號。初始化全部 true，沿用現況。核心登記／復原、個人資料、GAS、機器管理、同步與重試開關維持原路徑。

管理頁 `settings.html` 經既有管理 Worker Access 驗證；GET／PUT `/api/manage/settings`。PUT 要同 Origin、JSON、最多 4096 bytes（串流讀取時限制），只收完整白名單 values 與正整數 revision。操作者只來自既有 Access 驗證結果，body email 或 email 標頭不具授權效果。

先讀版本，無差異直接回傳、不送 UPDATE；實際修改以 revision 條件 UPDATE。AFTER UPDATE trigger 在同交易追加 `v3_feature_settings_log`，包含前後 JSON、版本、Access subject／email、時間及請求識別。版本競爭回 409；紀錄失敗整筆回復。管理者身分表不接公開 edit log，公開設定只 SELECT revision／values_json。

志工 Worker 七類修改在接受請求時讀一列設定，不快取授權；關閉回 403，設定不存在／損壞／D1 故障回 503。管理 Worker 不經這個志工 gate；狗資料與活動管理編輯仍由 #566／#567 增加，這張不提前建立它們的路由。已接受的工作不再檢查後來設定，機器後續作業照常。

志工設定 GET `/api/feature-settings` 有 ETag 與 private/no-cache，正常初始化及手動更新各讀一次；無新增計時器。失敗不使用過期設定猜授權，選用功能不開放，核心資料照常載入。三項顯示只隱藏 UI 入口及直接頁面，讀取 API 保留；更新紀錄涵蓋網站更新與 edits.html。讀取到新版後重畫，不要求所有已開手機立即切換。

## Migration 與正式步驟（待 K 授權）

1. 主線現有 0000–0002；2026-10-25 核對進行中的 #574 沒有 migration，採 `0003_feature_settings.sql`。提交／合併前再核對編號；不可改已套用檔名。
2. 本機隔離 SQLite 執行完整 migrations，與 compact-schema.sql 比對；設定、衝突、audit 失敗回復都用記憶體 D1，不連正式／共用測試資料庫。
3. K 核准合併後，先以既有「套用 D1 migration」Actions workflow 套 schema，再部署。workflow 會記 Time Travel 書籤並接著部署志工 Worker；管理 Worker 使用既有管理部署流程更新，兩邊都要更新。新增表／預設列不碰既有狗資料；新增預設列 INSERT OR IGNORE 不被工具判為搬資料；auto 不會整庫複製，仍記 Time Travel 書籤。如需整庫備份，由 K 選 always。
4. 正式操作前確認最新 migration 清單、備份與書籤。驗收預設十項 true，管理設定 GET，先挑一項顯示開關來回測試；志工關閉修改與管理可用以隔離資料驗證，不能任意修改正式狗資料。
5. 本次未執行合併、正式 migration、部署、Access 設定或正式寫入。

## 回復

優先回復 Worker 程式至套用前版本，保留新增設定／audit 表。舊程式不讀新表；不需 DROP，不會遺失核心新寫入。若只想恢復開放，可由管理者讀取最新 revision、十項設回 true，仍留下可靠紀錄。若新設定服務無法使用，先修復／回復部署，不能讓新程式以全開備援繞過失敗。

Time Travel 僅是整庫災難回復：會覆蓋書籤之後所有登記及其他寫入，不是這張新增表的例行 rollback；只由 K 評估並執行 workflow 摘要提供的特定書籤指令。不刪 audit、不倒退已套用 migration ledger。

## 成本與量測邊界

- 一次設定載入：1 SQL／主鍵命中 1 列／0 寫。ETag 304 仍須查 1 列確認最新版本；瀏覽器免下載內容。
- 每個新志工選用編輯：額外 1 SQL／1 列讀／0 設定寫；不在每隻狗或每列渲染迴圈查設定。核心登記、GAS、同步、重試：額外 0 SQL。
- 管理搜尋狗表：設定不增加逐列請求；切換 checkbox 不請求。
- 設定儲存：先讀 1 列；無差異 0 寫；改動 UPDATE 1 列＋audit INSERT 1 列，audit 主鍵與 request_id UNIQUE 索引的維護另計 D1 寫入列成本。一天 N 次修改為 2N 筆邏輯列寫入，非每次造訪寫入。
- SQLite 測試以 total_changes() 驗證：無差異 0，成功變更 2，拒絕與交易失敗 0 已提交變更。memoryD1.stats 只量回傳列，不能宣稱等於正式 D1 計費。正式 D1 實際 rows_read／rows_written（含索引）須授權驗收時讀 meta 量測；這次不連正式庫。
- 無新增 Cron、輪詢、第三方旗標服務或第二套正式資料庫。
