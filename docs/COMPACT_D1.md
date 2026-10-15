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
| `v3_walks` | 狗＋日期＋順序；當時狗名、志工名字／代號直接存在紀錄，不另建溜狗的人表 |
| `v3_volunteers` / `v3_volunteer_codes` | 志工與代號；開卡允許只有舊代號、不必先猜志工 |
| `v3_card_opened` | 代號＋永久狗 ID；開卡日期 |
| `v3_rest` | 永久狗 ID；休養截止日、原因 |
| `v3_photos` | R2 物件路徑；永久狗 ID、縮圖路徑、主照片、上傳時間 |
| `v3_intros` | 永久狗 ID；入所介紹 |

所有集合拆成列，沒有 JSON 欄位。`v3_sheet_main.fields` 是固定欄位存在與否的位元遮罩（順序見程式 `columns`），只用於忠實重建 JSON 缺欄與空值。JSON 內的 `intro` 是主清單讀取結果的複本；D1 自存介紹放 `v3_intros`，實際匯入留給後續票。其餘試算表複本、分組和 D1 自存資料本票只建表，不填資料。

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
