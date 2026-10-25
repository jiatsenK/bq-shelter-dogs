# 精簡 D1 第一階段（#246）

> 志工身分調整：K 已確認 [ADR 0005](adr/0005-volunteer-identity.md)。下列志工、開卡與 #267 常溜的代號表契約描述既有實作；新規格改用固定 `volunteer_id` 持有資料，名字／代號只作對照，尚待實作，不能沿用舊契約判定已完成。

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

建表 SQL 是 `db/compact-schema.sql`（現在的完整樣子）；#553 起正式庫改用 `migrations/` 由「套用 D1 migration」workflow 套用，流程見 `docs/agents/data-changes.md`。私密匯出只放 `.migration-private/`，已加入忽略清單。

## 表契約

| 表 | 主鍵／用途 |
| --- | --- |
| `v3_dogs` | 隨機永久 `dog_id`；狗名、性別；網站共用設定 `fixed_care` 預設 0，試算表同步不得寫入（ADR 0015） |
| `v3_dog_numbers` | `number` → `dog_id`，多個編號可以對同狗 |
| `v3_sheet_main` | `row_index`；主清單複本，保存順序、編號、狗名、籠位、備註、上次溜、「誰遛的」原文與代號（`walker_codes`，JSON 陣列照名單順序，#559）。`covered`、`my_walked`、`my_walked_date`、`synced_at`、`version`、`sex`、`intro` 7 欄 #557 刪欄（migration 0004） |
| `v3_sheet_changes` | 來源列；實際來源的標籤 `label` 與完整文字 `text`，不猜拆日期或名字 |
| `v3_sheet_group_columns` | 常遛狗群一欄一列（#559）：`column_index`、群名 `label`、狗名 `names`（JSON 陣列，照試算表由上往下）；群名和狗都空就刪掉那列 |
| `v3_walks` | 狗＋日期＋順序；那天的編號 `dog_number`、狗名 `dog_name`、志工名字／代號直接存在紀錄，不另建溜狗的人表 |
| `v3_volunteers` | 志工；代號對照在 `v3_identity_names`（`v3_volunteer_codes` 跟它完全重複，#557 刪表） |
| `v3_card_opened` | 代號＋永久狗 ID；開卡日期 |
| `v3_rest` | 永久狗 ID；休養截止日、原因 |
| `v3_photos` | #566／0007 新的不可覆寫版本引用，與狗編輯紀錄同交易提交；0004 已刪的舊清單不恢復，舊固定路徑仍由 R2 備援 |
| `v3_dog_edit_state` / `v3_dog_edit_guard` | 狗 CAS 版本／GAS 交易檢查；無差異不寫 |
| `v3_dog_edit_actors` | 受保護操作者來源；公開 API 不回登入識別 |
| `v3_intros` | 永久狗 ID；入所介紹 |
| `v3_edit_log` | 編輯紀錄：時間、編輯者代號與名字、種類、狗、改前／改後（JSON），見 `docs/adr/0004-open-editing-and-edit-log.md` |
| `v3_activities` / `v3_activity_dogs` | 活動紀錄（#270，ADR 0002）：一場一列（日期、類型、revision）；出席的狗一列一隻，`dog_id` 是 NULL 表示只有名字、還沒對上狗。網站寫，同步不碰；舊名單用 `scripts/import-activities.mjs` 手動匯入 |
| `v3_departed_cards` | **#560 停用，下一張 PR 刪表**；只有名字的已出所狗卡改記在 `v3_dog_departures`（編號留空）。K 用 `scripts/departed-card.mjs` 手動建，同時接上活動紀錄同名、沒對上的出席 |

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

本機演練用的 `scripts/check-compact-profiles.mjs` 已在 #275 移除（匯入已完成，需要時見 Git 歷史）。

`migrateCompactDatabase` 會幫 #246 時已經建好的 `v3_walks` 補上 `dog_number`、`dog_name` 兩欄。

## 同步寫進 D1（#251 第一步）

> 已退役（#501）：`sync-sheet.yml` 已刪，狗清單改由 Apps Script 編輯觸發送 Worker（`worker/src/dog-list.js`）。以下只供查背景，現況見 `docs/ARCHITECTURE_NOW.md`。

當時 `.github/workflows/sync-sheet.yml` 同步完會跑 `scripts/sync-compact-d1.mjs`：用 wrangler 讀正式 D1 現有的永久狗 ID，在記憶體 D1 匯入 dogs.json、walks.json 和常遛狗群（照試算表的欄存），比對一致才產生 SQL 寫回正式 D1。休養、介紹、開卡、志工、照片表不動。需要 repo Secrets `CLOUDFLARE_API_TOKEN`（要有 D1 編輯權限）和 `CLOUDFLARE_ACCOUNT_ID`。

（#251 起已拿掉 GitHub 提交，見下面「同步只寫 D1」。）

## 網站寫入改存 D1（#250）

- `PUT /api/rest/{編號}` 存 `v3_rest`，`GET /api/rest` 讀回 `{ ok, rest: { 編號: { until, reason } } }`，網站改讀這裡。
- `PUT /api/intro/{編號}` 存 `v3_intros`；`/api/dogs` 的 `intro` 改從 `v3_intros` 讀，存完重新整理就看得到。
- 用舊編號設定也存在同一隻狗，讀回時換成主清單上現在的編號。
- 這兩個寫入不再呼叫 GitHub。`dogs/*.md` 和 `data/rest.json` 不再更新，同步也不再拿它們蓋 D1。
- 「已溜」照舊寫試算表兩欄；取消時用 Worker 回傳的原值還原，那格被別人改過時回 `changed`，網站提示不蓋掉（原本就有，見 `apps-script/sheet-write.gs`）。
- 照片在 R2 上本來就不提交 GitHub。
- 我的備註（`data/my-notes.json`）依規格不搬，仍寫 GitHub。

## 離所紀錄（#259）

- #560 起記在 `v3_dog_departures`：用永久狗 ID 記，一隻狗一次離所一列（主鍵是狗 ID＋離所時的編號；編號留空是只有名字的已出所狗卡）。欄位有離所日期與來源、第一次不在主清單那天、原因、命中的字、回到主清單用的新編號、離開前最後一次的樣子；判讀旗標、最後的舊編號、最後的常遛狗群是 JSON 陣列欄（`flags_json`、`former_json`、`groups_json`）。
- 舊的 `v3_departures`、`v3_departure_items`（以編號為主鍵、附屬清單拆成列）資料已由 `migrations/0006_dog_departures.sql` 搬過去，程式不再讀寫，下一張 PR 刪表。以下兩點是 #259 當時的做法。
- 同步（`sync-compact-d1.mjs`）每次把 `data/departures.json` 整份換進這兩張表，正式 D1 還沒有這兩張表時 SQL 開頭會先建，不用另外遷移。第一次同步就等於匯入既有紀錄，比對不一致就不寫。
- 讀回用 `worker/src/compact.js` 的 `readDepartures`，形狀跟 `data/departures.json` 的 `departures` 一樣（#260 網站改讀時用）。
- #251 起離所以 D1 上一次的內容為基準計算。

## 網站改讀 API（#260）

- `GET /api/walks`：形狀跟 `data/walks.json` 一樣（一隻狗一天一筆，沒記人的舊紀錄沒有 `walkers`），另外帶 `historyStart`（溜狗歷史開始累積的日子，原本是 `data/history/index.json` 的第一個日期，固定 2026-09-25）。
- `GET /api/departures`：形狀跟 `data/departures.json` 一樣。
- 「我溜過」、圖鑑、電腦版最近 30 天、狗的遛狗歷史、離所名冊都改讀這兩個；不再讀 `data/walks.json`、`data/departures.json`、`data/history/`。
- 照片上傳、備註確認編號改讀 `v3_sheet_main`（有 D1 時），不讀部署上去的 `data/dogs.json`。

## 同步只寫 D1（#251）

- 同步的入口改成 `scripts/sync-compact-d1.mjs`：讀試算表（主清單、異動紀錄、常遛狗群、已出所），用 wrangler 讀正式 D1 的現況（主清單複本、溜狗紀錄、離所、永久狗），在記憶體 D1 算出新的溜狗紀錄和離所、匯入並比對，一致才寫回。
- 上一次的主清單從 `v3_sheet_main` 讀，溜狗紀錄從 `v3_walks` 讀；D1 一隻狗一天只存最後一筆，`mine` 用代號推回來。
- 不再寫 `data/dogs.json`、`data/walks.json`、`data/departures.json`、`data/history/`，workflow 沒有 git 提交，權限 `contents: read`。repo 裡這些檔停在 #251 那天，網站已不讀（#260）。
- 每日快照停止；溜狗歷史的開始記錄日固定 2026-09-25（`HISTORY_START`）。
- `syncedAt` 每次同步都更新（原本資料沒變就不動）。

## 開卡與名字推薦的一次性匯入（#249，已完成）

舊 D1 的 `cardOpened`、`walkerNames` 曾用 `scripts/import-compact-legacy.mjs`、`scripts/check-compact-legacy.mjs` 合併進 `v3_card_opened`、`v3_volunteers`：開卡以編號換永久狗 ID，同代號同狗取最早日期；名字完全相同才合併、取較新時間；不清表、不刪既有資料。匯入完成、舊表已在 #252 清除，兩支腳本和原本的 `docs/COMPACT_LEGACY_IMPORT.md` 已在 #275 移除，細節見 Git 歷史。

## #267 固定志工身分（PR 尚待驗證／上線）

常溜與開卡由 volunteer_id＋永久 dog_id 持有，名字與代號是對照。更名、明確確認後合併、舊手機相容及正式升級順序見 [267-identity-rollout.md](267-identity-rollout.md) 與 ADR 0005。

原本的 v3_favorites／v3_card_opened 保留來源資料，新的 v3_volunteer_favorites／v3_volunteer_cards 才是新寫入位置；不以重建空庫代替升級。正式資料尚未搬移，PR 不可視為已上線。
