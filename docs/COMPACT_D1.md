# 精簡 D1 第一階段（#246）

依規格 #245，使用現有資料庫的新名稱 `v3_`；舊 `dogs`、`walks`、`v2_*` 等表完全不動。這張票只提供建表與狗清單匯入／比對函式，不部署、不連正式服務、不切換網站，也不匯入其他資料。

## 入口

```js
import { migrateCompactDatabase } from './scripts/migrate-compact-db.mjs';
import { importCompactDogs, readCompactDogs, compareCompactDogs } from './scripts/import-compact-dogs.mjs';

// db 由呼叫者明確提供 D1 binding；source 是解析後的 data/dogs.json。
await migrateCompactDatabase(db);
await importCompactDogs(db, source);
const report = await compareCompactDogs(db, source);
if (!report.equal) throw new Error(JSON.stringify(report.differences));
const dogs = await readCompactDogs(db);
```

建表 SQL 是 `db/compact-schema.sql`，不混入舊 `db/migrations/`；部署不會自動執行。正式套用須由 K 另行確認，後續票沿用這份表契約。私密匯出只放 `.migration-private/`，已加入忽略清單。

## 表契約

| 表 | 主鍵／用途 |
| --- | --- |
| `v3_dogs` | 隨機永久 `dog_id`；狗名、性別 |
| `v3_dog_numbers` | `number` → `dog_id`，多個編號可以對同狗 |
| `v3_sheet_main` | `row_index`；主清單複本，保存順序、編號、狗名、籠位、備註、固定照顧、上次溜、同步時間和 JSON 現有純量欄位 |
| `v3_sheet_main_walkers` | 主清單列＋順序；上次溜的代號 |
| `v3_sheet_former_numbers` | 主清單列＋順序；JSON 明載舊編號 |
| `v3_sheet_changes` | 來源列；實際來源的標籤 `label` 與完整文字 `text`，不猜拆日期或名字 |
| `v3_sheet_departed` | 來源列；編號、名字、遛狗日期、離所日期、備註 |
| `v3_sheet_groups` | 來源欄＋列；可以一起溜的狗名 |
| `v3_walks` | 狗＋日期＋順序；那天的編號 `dog_number`、狗名 `dog_name`、志工名字／代號直接存在紀錄，不另建溜狗的人表 |
| `v3_volunteers` / `v3_volunteer_codes` | 志工與代號；開卡允許只有舊代號、不必先猜志工 |
| `v3_card_opened` | 代號＋永久狗 ID；開卡日期 |
| `v3_rest` | 永久狗 ID；休養截止日、原因 |
| `v3_photos` | R2 物件路徑；永久狗 ID、縮圖路徑、主照片、上傳時間 |
| `v3_intros` | 永久狗 ID；入所介紹 |

所有集合拆成列，沒有 JSON 欄位。讀回時每隻狗都有全部欄位，比對前來源 JSON 也補成同樣形狀，所以不另存欄位是否存在。沒有編號的狗以名字延續狗 ID（改名會變成新狗）。JSON 內的 `intro` 是主清單讀取結果的複本；D1 自存介紹放 `v3_intros`，實際匯入留給後續票。其餘試算表複本、分組和 D1 自存資料本票只建表，不填資料。

## 身分、重跑與比對

- 有編號用編號找既有永久狗 ID；明載 `formerIds` 的關係可連成同狗。同名不作為不同編號的合併證據。
- 無編號狗以主清單既有的完全相同狗名延續 ID。若無編號狗改名或之後補編號，不能自動判斷是原狗，需另行確認對照，本票不猜。
- 若編號關係會把兩個既有永久狗 ID 合併，整次匯入在寫入前拒絕。
- 匯入前驗證來源鍵、型別和支援欄位；未知欄位拒絕，不靜默遺失。完整主清單複本在單一 D1 batch 交易替換，失敗保留原複本；永久狗／編號不刪除，重跑保留 ID。
- `readCompactDogs` 從主清單複本讀回原 JSON 的 `dogs` 陣列，不包含外層的 `groups`、`sheetNotes`。比對逐筆檢查所有狗欄位、陣列順序、缺欄、空值及狗清單順序。
- 一致回傳 `{ equal: true, differences: [] }`；差異列出 `key`（編號或 `名:狗名`）、`field`、`expected`、`actual`。`field: '*'` 表示缺少／多出整筆，`field: 'order'` 表示清單順序有異。

## 本機驗證

```powershell
node --test scripts/compact-schema.test.mjs scripts/import-compact-dogs.test.mjs
```

測試使用既有 `fakeD1` 的真實 SQLite 約束與交易。包含 repo 現有 `data/dogs.json` 的完整讀回比對，不接觸正式 D1 或試算表。

## 第二階段：溜狗紀錄、介紹、休養、照片清單（#248）

```js
import { importCompactProfiles, compareCompactProfiles } from './scripts/import-compact-profiles.mjs';

// 先跑完 importCompactDogs；walks 是 data/walks.json，rest 是 data/rest.json，
// intros／names 是 dogs/*.md 轉好的 { 編號: 介紹純文字 }／{ 編號: 狗名 }，photos 是 R2 清單的 objects。
await importCompactProfiles(db, { walks, intros, names, rest, photos });
const report = await compareCompactProfiles(db, { walks, intros, names, rest, photos });
```

- 溜狗紀錄照網站的規則合併：同一隻狗同一天以最後一筆有 `walkers` 的為準；只有 `mine`、沒記人的舊紀錄仍算那天有溜。`mine` 網站已經不看，不搬。一天一個代號一列，沒記人的存一列 `walker_code` 是 NULL。
- 同一天多隻狗的先後順序不保存，讀回依日期、編號、狗名排序。
- 介紹來源是 `dogs/*.md`（同步寫進 dogs.json `intro` 的同一份）；`data/intro-original.json` 是改寫前的原文封存，網站不讀，不搬。演練另外確認 D1 讀回的介紹跟 dogs.json 的 `intro` 一樣。
- 介紹、休養、照片跟著永久狗 ID；讀回時換成主清單上現在的編號，已出所的狗用最大的編號。空白介紹不存。
- 不在主清單上的狗（已出所）用編號新建永久狗，名字取狗卡或溜狗紀錄；沒編號的用名字認。
- 照片只收 `photos/{編號}.jpg` 和同編號的縮圖；刪除標記不算。同一隻狗有多張時，主清單上現在編號的那張是主照片。相簿縮圖、trash、沒有主照片的縮圖不搬，列在回傳的 `skipped`。
- 四張表在同一個 batch 整份替換；永久狗和編號只新增不刪，重跑不換 ID。
- 差異列出 `kind`（walks／intros／rest／photos）、`key`（溜狗是「編號或狗名|日期」，其他是編號或 R2 路徑）、`field`、`expected`、`actual`。

本機演練（R2 清單放 `.migration-private/`，不提交）：

```powershell
node scripts/check-compact-profiles.mjs .migration-private/219/bq-218-r2-source.json
```

`migrateCompactDatabase` 會幫 #246 時已經建好的 `v3_walks` 補上 `dog_number`、`dog_name` 兩欄。

## 同步寫進 D1（#251 第一步）

`.github/workflows/sync-sheet.yml` 同步完會跑 `scripts/sync-compact-d1.mjs`：用 wrangler 讀正式 D1 現有的永久狗 ID，在記憶體 D1 匯入 dogs.json、walks.json、rest.json、狗卡介紹和常遛狗群（照試算表的欄存），比對一致才產生 SQL 寫回正式 D1。開卡、志工、照片表不動。需要 repo Secrets `CLOUDFLARE_API_TOKEN`（要有 D1 編輯權限）和 `CLOUDFLARE_ACCOUNT_ID`。

GitHub 的 JSON 提交暫時照舊：新的溜狗紀錄和離所還是從舊檔算。等 #250 寫入改寫 D1 之後，再把 GitHub 提交拿掉。
