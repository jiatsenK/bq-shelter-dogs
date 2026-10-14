# 開卡、介紹、休養與照片關聯（#218）

入口 `migrateProfiles(db, input)` 只操作傳入的隔離 D1；不連網路、不改試算表、不寫 R2、不切換 Worker。版本化 `0003_profile_sources.sql` 保存每筆來源與 imported／pending／archived 去處，外鍵均 RESTRICT。開卡、照片等 ID 用既有身分對應，不依狗名新建狗。

## 各類資料

- 開卡：舊代號＋編號轉成 walker_id＋永久狗 ID，跨入所與多筆合併取最早 opened_on；未知身分或非法代號／日期保留待確認。
- 志工別名：`walkerAliases` 要有 primaryCode、aliasCodes、confirmedAt、K 的 evidence。既有兩個志工 ID 經確認才將參與者、操作、開卡及代號重綁到同人；開卡取最早、同筆參與者去重。舊永久 ID 留著，不刪歷史身分。真實資料此次沒有提供新別名決策，沒有自行合併。
- 介紹：跟著狗，可靠再入所關係共用；保留來源的每個舊版本與改寫前原文。預設用最新編號的可靠狗卡；明確選擇可提供 `introChoices`（cardId、originalId、evidence）。`docs/migration-213/profile-review.json` 是既有五卡待確認清單的機器可讀入口；未確認且未有有證據選擇時不覆寫介紹。
- 休養：按來源編號所屬入所保存，不自動套到下一次入所。未有入所對應或日期無效者保留待確認。
- 照片：沿用 photos／photos/thumbs 路徑；以永久狗 ID 關聯。優先目前入所編號的現有原圖，沒有才沿用同狗的舊圖；每狗只有一張 active 主照片。其他原圖與有可靠 dogId metadata 的 trash 主照片保存 replaced；trash 縮圖使用原同目錄路徑。未知身分／孤立物件保留來源，不猜狗、不搬檔。`photoChoices` 指定同狗既有原圖並附 evidence。
- 名字推薦與 kv：使用既有表、保留內容；時間以實際時間比較，舊來源不蓋掉較新值。名字推薦不連到志工身分。kv 中分組仍保留，分組同步改用新模型留後續票。
- 舊備註：只在來源表保存 Git 封存檔位置與指紋，文字不搬進 D1 備註功能；原文留現有檔案，正式封存交 #228，不恢復 API。

來源鍵使用資料內容雜湊＋重複序號，重排重跑不增筆；不同版本原文均保留。來源表不是備註 API，不用它恢復功能。

## 唯讀查證與本機演練

2026-10-14 直接讀正式 D1：0 開卡、20 名字推薦、3 kv；R2 完整分頁取得 310 個物件／21,228,359 bytes，與 #213 清單一致；另讀 trash metadata 20 個物件。只有 SELECT／物件 metadata，未下載、搬移或寫入照片。來源存系統暫存，個人代號／姓名不加入 repo、PR 或報告。

```powershell
node scripts/check-profiles.mjs <已出所暫存JSON> <唯讀舊D1暫存JSON> <R2清單暫存JSON>
node --test scripts/migrate-profiles.test.mjs
```

本機先套全部 migrations、#216 身分與 #217 歷史，再演練附屬資料兩次。594 筆來源都有去處，重跑一致、外鍵檢核 0 列：2 筆休養、133 筆原圖關聯（含 replaced）、0 筆開卡；20 名字推薦與 3 kv 逐筆讀回一致。開卡真實來源為 0，非漏搬；非空、跨入所、別名合併由固定資料測試驗證。

未決來源包含介紹來源未確認、無身分對應與 44 個 R2 物件；全部保存，不宣稱所有來源已搬完。正式資料尚未搬遷；Cloudflare 的資料複本／還原演練留 #219。
