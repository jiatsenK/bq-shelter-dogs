# 新資料模型與 SQL（#215）

依 #212、規劃分支 `58c50b8aecfefe43291ccec2b8357c420c69d94a` 的 ADR 0001～0004。
K 於 2026-10-14 明確授權合併 #230／#231 並繼續第三張建立 SQL；本票只建立空結構及驗證，不代表歷史資料的待確認項目已定案。

## 結構與舊表並存

版本化 SQL：`db/migrations/0001_business_model.sql`。17 張新表統一加 `v2_` 前綴，避免新舊 dogs、changes、card_opened 名稱衝突，也讓後續遷移與同步明確選用新模型。`db/schema.sql` 與目前 Worker 的舊表均不更動。既有 `kv`、`walker_names` 繼續共用，不新增副本。

| 新表 | 儲存內容 |
|---|---|
| v2_dogs | 永久狗 ID、名字副本、性別、介紹、原文、revision |
| v2_admissions／v2_admission_numbers | 各次入所與編號、入離所事實、籠位、試算表備註 |
| v2_daily_walks／v2_walk_participants | 每次入所每日紀錄、狀態、證據、參與者 |
| v2_walkers／v2_walker_codes | 志工 ID、12 碼代號、經確認的別名 |
| v2_card_opened／v2_dog_photos | 隨狗保留的開卡與 R2 照片關聯 |
| v2_rest_settings | 隨本次入所的休養 |
| v2_sync_runs／v2_source_bindings／v2_sheet_observations | 同步、來源對應與原始格子值 |
| v2_walk_groups／v2_walk_group_members | 可以一起溜的入所組合 |
| v2_operations／v2_changes | 操作與異動的來源、前後值 |

永久狗 ID 預設以 `randomblob(16)` 產生 32 碼小寫十六進位隨機值，不使用狗名或編號。遷移工具可提供相同格式的已保存 ID，以利重跑。入所 ID 是獨立主鍵。

資料庫直接保證：同狗最多一筆在所、同次入所最多一個現行編號、編號全域唯一、入所＋溜狗日期唯一、同狗最多一張有效主照片、異動的入所屬於該狗。全部外鍵 `ON DELETE RESTRICT`；錯誤對應要修正，不能依賴連帶刪除。異動必須且只能連到操作或同步其中一項。候選／拒絕的來源對應可暫無入所，已確認的必須有入所。

日期欄位接受真實的 YYYY-MM-DD（含閏日），拒絕 2/30 等不可能日期。未來日期與未寫年份的判讀屬同步入口的台灣時間規則，沿用 #212 的測試契約，於 #220 完成；schema 不用主機的今天當 CHECK，避免阻止歷史還原。原文由 observations 保存。

## 明確執行與驗證

部署不呼叫 migration。測試庫執行：

```powershell
$env:CLOUDFLARE_ACCOUNT_ID='a0f88d34c34ad0d34f923b9f43799622'
npx wrangler@4 d1 migrations list bq-shelter-dogs-test --remote --config wrangler.preview-db.jsonc
npx wrangler@4 d1 migrations apply bq-shelter-dogs-test --remote --config wrangler.preview-db.jsonc
```

Wrangler 的 `d1_migrations` 記錄已套用版本；第二次 apply 不再套用。替身遷移入口 `scripts/migrate-business-db.mjs` 套同一個 SQL，供後續遷移演練使用；只接受傳入 D1，不會自行連正式庫。共用替身 `worker/test/fakes.mjs` 的 fakeD1 用真實 Node SQLite，外鍵開啟，batch 全部成功或回復。

本票測試從明確遷移入口及 Worker fetch 驗證結構、舊表保留、重跑、唯一、外鍵、日期與預覽禁止寫入。同步入口的新資料行為尚屬 #220，沒有假造一個同步實作來滿足測試數量。新測試已加入 CI／AGENTS.md。

本票不執行正式庫 migrations apply、不匯入試算表或歷史資料、不改前端、不決定五張狗卡／十筆歷史紀錄政策。資料遷移前仍須依 `docs/MIGRATION_INVENTORY.md` 解決待確認項目。

## 2026-10-14 實測證據

- PR #230、#231 已合併。main 部署 run `38530829279` 成功；正式啟用版本 `ddebaadc-87da-4c2f-9ce8-305d6281e5db` 的 DB 綁定讀回為正式庫 `6cd6c304-0fed-4ddb-b9ec-799e60a4adb4`。
- 測試庫 `9e23a65c-c9dd-4f83-ad9c-2e01626910f0`：Wrangler apply 執行 22 個 SQL 指令成功，`d1_migrations` 記錄 0001；再次 apply 回覆沒有 migration 待執行。
- Cloudflare 實際拒絕：同狗兩筆在所、兩個現行編號、重複每日溜狗、兩張有效主照片、跨狗入所異動、刪除被引用的狗、不可能日期、含違規寫入的批次。失敗批次前段的更新也已回復。
- 專用驗證資料清除後，新狗表 0 筆；17 張新表全部外鍵均為 RESTRICT，foreign_key_check 回 0 列。
- 正式庫唯讀回查：v2_ 表數 0，舊 dogs 仍 125 筆。沒有執行正式庫結構或資料寫入。
- Node 全套 161/161。Windows Chrome 無頭網頁 243 項通過、1 項既有 #130 縮圖 workflow 的 CRLF 檢查失敗；與本票 SQL 無關，Linux CI 另行驗證。
- Standards 審查發現共用替身的 batch SELECT 未回傳資料，已先以 Worker 開卡讀回測試重現並修正；SELECT／RETURNING 均保留結果。Spec 審查未發現偏離，後續業務同步／遷移入口的驗收仍依各票完成。
