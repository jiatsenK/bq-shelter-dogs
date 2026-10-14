# 測試 D1 遷移與還原演練（#219）

2026-10-14 已將固定來源複本匯入 Cloudflare `bq-shelter-dogs-test`，重跑相同 SQL 後核對，再從完整封存還原至新庫 `bq-shelter-dogs-restore-219`。三次 Cloudflare 完整匯出皆與封存逐表、逐欄、逐列一致：21 張業務表（19 張 v2 表、walker_names、kv），9,260 列。D1 自己的內部表與 migrations 記錄不納入業務指紋。

主要結果：166 隻狗、167 次入所、166 個編號、878 筆溜狗紀錄、971 筆參與者關聯、133 筆照片關聯、2 筆休養。0 開卡是實際來源數，不是漏搬。73 個身分來源仍待確認；歷史與介紹／照片的待確認來源保留原文及理由。這次演練不替 K 決定五張介紹、十筆溜狗差異或不明離所日期。

## 封存與驗證

私有封存放本機 `.migration-private/219/`，已排除 Git 與網站靜態檔。內容包括來源複本、全部輸入與來源指紋、身分對照／待確認決策、固定永久 ID、業務表結構及全部資料、可重跑 SQL、正式庫前後完整匯出、測試庫原狀／第一次／重跑匯出、還原庫匯出及各檔 SHA-256 清單。封存含個人代號、推薦名字與來源備註，不加入 repo 或 PR。`bundle.zip` 為同目錄檔案的攜帶封存，檔案清單見 `manifest.json`。

可審閱的數量、逐表指紋與檢核證據在 `docs/migration-219/rehearsal.json`。業務指紋：`b1b3607f504a0648f1bb9f4e4fd8b57013a663089e6baf9a1747df4da434d34b`。

`rehearse-d1.mjs` 沒有正式連線或部署入口。先本機呼叫 #216～#218 工具兩次，完整內容一致才產生固定 SQL；同份 SQL 在 Cloudflare 重跑，保留既有永久 ID。SQL 使用外鍵依賴順序與 INSERT OR IGNORE，匯入完成必須再逐筆核對，不能把匯入成功當作驗證通過。原文以 UTF-8 hex literal 保存，分號、引號與換行不會變成 SQL。

```powershell
node scripts/rehearse-d1.mjs build <已出所JSON> <唯讀舊D1JSON> <R2清單JSON> <私有封存JSON>
node scripts/rehearse-d1.mjs verify-export <私有封存JSON> <Cloudflare完整匯出SQL>
```

重做 Cloudflare 演練前先用 `d1 list` 查名稱與 UUID；設定必須明確指向隔離測試庫，不能使用 `wrangler.jsonc` 的正式綁定。範例使用既有隔離設定；還原庫另以封存內的 `bq-219-restore-config.json` 指定。

```powershell
npx wrangler d1 execute bq-shelter-dogs-test --remote --config wrangler.preview-db.jsonc --file <私有封存JSON.sql> --yes
npx wrangler d1 export bq-shelter-dogs-test --remote --config wrangler.preview-db.jsonc --output <私有匯出SQL>
node scripts/rehearse-d1.mjs verify-export <私有封存JSON> <私有匯出SQL>
```

外鍵檢核為零列、SQLite integrity_check 為 ok；七項業務檢核皆零列：重複在所、已有編號入所缺唯一現行編號、重複有效主照片、重複主代號、已知名單卻無參與者、已確認來源無入所、已匯入歷史無去處。沒有編號的狗允許入所未分配編號。來源覆蓋核對：2,660 個身分來源鍵、3,442 個歷史來源、594 個附屬來源。

D1 匯出 SQL 可交錯建表與插入；本機驗證先載入整份匯出，再開啟外鍵並逐表檢核。不能以暫時關閉本機外鍵略過最後檢核。封存遭修改、目標原文不同或有孤立外鍵均拒絕核對。

## 正式庫與下一步

正式 D1 僅匯出，不寫入；前後完整內容指紋相同（見證據 JSON）。R2 僅使用清單關聯，不搬照片；不寫試算表。Cloudflare 的兩個演練庫保留供後續驗證，沒有切換正式 Worker。網站目前仍使用原有 API／資料來源；前端讀取新模型由後續工作票處理。
