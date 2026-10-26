# 資料流現況

資料在哪、誰寫、誰同步，以本檔為入口。最後核對：2026-10-26，main `811a9b5`；正式庫已套 migration 0000–0009，志工站與管理站都已部署（2026-10-25）。開關與排程的即時值以自動產生的 `docs/adr/README.md` 為準；決定的理由看 ADR。

## 改版終點（K 2026-10-24）

- **D1 是唯一正本**：網站讀 D1，網站上的操作先寫 D1。
- **試算表只剩人工輸入介面**：管理者直接改表，Apps Script（GAS）把改到的列推給 Worker。網站不讀表。
- **不再有 gviz 讀表、不再用 GitHub Actions 同步資料**。
- 前端整理完（#471 系列）。

還沒到終點的項目列在改版收尾母票 #538。

## 誰寫、怎麼同步

| 資料 | 寫入來源 | 進 D1 的方式 | 程式 |
|---|---|---|---|
| 今日溜狗（網站按溜了、復原、改溜狗人） | 網站 | 先存 D1（PR #533 起；舊的直接寫回試算表路徑已刪），再由 Worker 寫回試算表兩欄 | `worker/src/walk-accept.js` |
| 今日溜狗（人工改試算表） | 管理者 | GAS 編輯觸發 → `POST /api/walk-writeback/rows`，Worker 只比那幾隻 | `apps-script/sheet-write.gs`、`worker/src/walk-reconcile.js` |
| 溜狗紀錄（每狗每天一筆；圖鑑、我溜過讀） | 網站、管理者 | 網站按溜了／改溜狗人／復原：跟今日溜狗同一批寫（稽核第 4 項，K 2026-10-26），不等保險掃描。人工改表：狗清單編輯觸發照表寫。改回較早日子時刪掉較新那天，清空日期不刪 | `worker/src/walk-accept.js`、`worker/src/dog-list.js` |
| 狗清單：主清單、已出所、常遛狗群 | 管理者 | GAS 編輯觸發 → `POST /api/walk-writeback/dog-list`，只寫有變的欄（#501）。網站讀 `/api/dogs` 時，遛狗日期以今日溜狗為準並附上今日紀錄（只在回應時換，不寫表；K 2026-10-26） | `worker/src/dog-list.js`、`worker/src/walk-accept.js` 的 `withTodayWalks` |
| 常溜狗群（網站狗群頁） | 管理者在試算表「常遛狗群」改 | GAS 編輯觸發送 D1（一欄一列 `v3_sheet_group_columns`，#559）；網站只讀（#474） | `worker/src/dog-list.js` |
| 休養、介紹、開卡、常溜、固定照顧、活動 | 網站 | 只存 D1，不碰試算表 | 見各 ADR |
| 離所 | 管理者把狗搬到試算表「已出所」 | GAS 編輯觸發送 D1，以狗 ID 記在 `v3_dog_departures`（#560）；沒編號的狗還不能記離所（`worker/src/dog-list.js` 的 `applyDeparted`） | `worker/src/dog-list.js` |
| 功能顯示、志工可編輯 | 管理網站 | 只存 D1 `v3_feature_settings`（十項開關＋revision），改動記在 `v3_feature_settings_log`（#565） | `docs/operations/feature-settings.md` |
| 狗資料（介紹、休養、固定照顧、舊編號、出入所紀錄、照片、性別） | 志工網站或管理網站 | 只存 D1；每隻狗帶 revision，衝突回 409，修改和紀錄同一次寫入（#566）。試算表送來的狗名、編號、籠位、備註、離所在管理網站只能看 | `worker/src/dog-edit.js`、`docs/operations/dog-editing.md` |
| 照片 | 志工／Access 管理網站 | 共用前端縮圖，R2 不可覆寫版本＋D1 CAS 引用及紀錄；舊固定路徑相容，Actions 只供人工補圖（#566 承接 #546 契約） | `worker/src/dog-photo.js`、`public/js/photo-images.js` |
| 志工名字建議 `/walkers` | — | 讀 D1（#519） | ADR 0019 |

GAS 送不出去時把待送內容留在指令碼屬性（`WALK_EDITS_PENDING`、`DOG_LIST_PENDING`），每 10 分鐘補送；Worker 確認收到才清。

## 排程

| 時間（台灣） | 做什麼 | 發起 |
|---|---|---|
| 每 10 分鐘（錯開 5 分） | 網站登記寫回試算表的重試；沒工作就結束、不讀表 | Worker cron |
| 09:23、13:23、23:23 | 今日溜狗保險掃描：按狗比指紋，只回不同的狗（#525）；排在 GAS `dogListScan` 可能跑的時段之前，避免搶鎖 | Worker cron → GAS `walkScan` |
| 09:43、13:53、23:53（Google 前後差 15 分鐘） | 狗清單保險掃描：「D1 有、表沒有」只記錄不刪，每次記掃描時間；管理網站「資料檢查」顯示（#518／#567） | GAS 時間觸發 `dogListScan` |
| 每月 1 日 09:23 | 照片垃圾桶清理，跟那次保險掃描同一個排程：`trash/` 標記滿 30 天的備份刪掉；`photos/` 32 碼舊原圖與縮圖只在 D1 `v3_photos` 記得它、且 `is_primary=0` 時一起刪，並刪掉那列（D1 沒這列就不碰，防測試 D1 配正式 R2）；固定路徑 `photos/{編號}.jpg` 不刪。只剩縮圖的備份照代號開頭的時間清。一筆出錯記下來、接著清下一筆，出錯那筆的備份留到下個月；結果記在 `v3_sync_state.trash_purged`（`{at, purged, failed, errors}`），有失敗時 `cron_trash` 記成出錯（實際保留 30～約 61 天）。R2 不設 Lifecycle 刪除規則（K 2026-10-26） | Worker cron |

Cloudflare 排程上限算整個帳號，免費方案 5 個（稽核第 5 項，2026-10-26）：正式版 2 個（`5-59/10 * * * *`、`53 1,5,15 * * *`），測試網站只有寫回重試 1 個，預覽與管理 Worker 都不設。Worker 的三件排程工作每次跑完或出錯都記在 D1 `v3_sync_state` 的 `cron_retry`、`cron_scan`、`cron_trash`（寫回重試每 10 分鐘寫這一列），管理網站「資料檢查」的「排程」顯示最後一次跑完的時間與最近失敗。

**注意：試算表主清單刪掉的列，D1 不會跟著刪。** 例如暫時籠位的「(狗名)」列刪掉後，網站還會照舊顯示暫時籠位。K 2026-10-26 決定再發生時才處理。

## 管理網站（ADR 0020）

- 獨立的管理 Worker `bq-shelter-dogs-admin`（`wrangler.admin.jsonc`、`worker/src/admin/`、`admin/public/`），網址 `https://bq-shelter-dogs-admin.<子網域>.workers.dev`，整個 host 由 Cloudflare Access 擋住、程式再驗 Access 簽章。直接讀寫正式 D1 和 R2（設定、狗資料、照片、活動），沒有自己的排程、沒有密鑰；三個 vars 都在 `wrangler.admin.jsonc`，repo 就是線上設定。
- **沒有自動部署**：main 合併不會更新管理站，要在 Actions 頁手動跑「部署管理網站」（`deploy-admin.yml`，部署紀錄記分支與 commit；說明在 `admin/README.md`）。改到兩站共用的程式時，兩個 Worker 都要部署。
- 進度：第 1–5 階段都已上線（#564–#568）；#568 刪了電腦版「補資料」。

## D1 結構怎麼改（#553）

- 每個變更是 `migrations/NNNN_*.sql` 一個檔，正式庫的 `d1_migrations` 表記著套過哪些；`db/compact-schema.sql` 是現在的完整樣子，測試檢查兩邊一致。
- 正式庫只由手動的「套用 D1 migration」workflow 套用（必要時先複製到備用庫 `bq-shelter-dogs-backup`、記 Time Travel 書籤、套用、接著部署）。部署發現有還沒套的就紅叉。
- 預覽、測速、測試網站部署自動套到測試庫 `bq-shelter-dogs-test`。

## PR 預覽

`bq-shelter-dogs-preview`（稽核第 3 項，2026-10-26）：PR 加 `preview` 標籤時上傳成這個獨立 Worker 的版本，網址 `pr-<編號>-bq-shelter-dogs-preview`。只綁測試 D1（跟測試網站共用）、測試照片空間 `bq-shelter-photos-test`，Worker 上只有 `WALKER_KEY`（算代號，不能寫）、不跑排程；另帶 PREVIEW 擋寫入。正式 Worker 關預覽網址，因為它的版本會帶正式密鑰。設定在 `wrangler.preview-db.jsonc`，上傳前由 `scripts/d1-database.mjs --preview` 查證。

## 測試網站

`bq-shelter-dogs-test`（`wrangler.test-site.jsonc`，#498）：程式跟正式版同一份，只接測試 D1、測試照片空間 `bq-shelter-photos-test`、測試試算表；不擋寫入，可以按溜了。main 有推送時「部署到測試網站」（`.github/workflows/deploy-test-site.yml`）先對測試庫套 migration 再部署；合併前要實測某個分支，到 Actions 手動指定分支跑，之後 main 再推送會換回 main。金鑰跟正式版不同，設在測試 Worker 上，workflow 不帶。
- 流程細節與「先加後刪」見 `docs/agents/data-changes.md`。

## Worker 開關

`wrangler.jsonc` 的 vars，現值見 `docs/adr/README.md`。2026-10-24 補開並驗收（#498）；原本是 Cloudflare 密鑰、repo 看不到，PR #540 改成 vars。

| 開關 | 值 | 管什麼 |
|---|---|---|
| `D1_WALK_NOTIFY` | `1` | 人工改表的今日溜狗是否寫進 D1；沒設時 GAS 會一直補送失敗 |
| `WALK_RETRY_ENABLED` | `true` | 保險掃描與寫回重試；沒設時兩者都不跑 |

開關不要再放 Cloudflare 密鑰：密鑰只放金鑰類的值，同名密鑰與 vars 不能並存。

## 已退役，不要照著做

- gviz 讀試算表（`docs.google.com/.../gviz`）、舊同步程式 `scripts/sync-*.mjs`：#512 已刪；`worker/src/sheet-read.js` 只剩拆名字（`splitNames`）。
- GitHub Actions `sync-sheet.yml`、Worker `syncTick`／`triggerSync`、每 10 分鐘同步：#501 已刪。
- `/sync`、`/sheet-changed`、GAS `notifyWorker`、Secret `SHEET_NOTIFY_KEY`：#512 已刪。頁首「更新」只重讀 D1；舊版網頁還 POST `/sync` 會收到 410 請它重新整理。
- 舊版網頁直寫試算表（GAS `walk`／`edit`／`undo`）與 Worker `/api/walk-writeback/legacy-check`：#597 已刪。小程式收到這三個動作只回「已使用新登記流程，請重新整理網頁」，不改表；試算表只剩 `walkWake`／`walkWakeBatch` 寫回、`note`／`log` 只追加兩條程式寫入路徑。
- `data/*.json` 當資料來源、「試算表為正本」（ADR 0007）：已由 ADR 0018 取代。
- 同步設計稿 456–460：已移到 `docs/design/history/`，只供查背景。
- 2026-10-26 也移到 `docs/design/history/` 的舊文件（內容描述已退役的架構，只供查背景）：`COMPACT_D1.md`（#246 精簡 D1 第一階段）、`SHEET_SYNC_SETUP.md`（Actions 同步試算表）、`PHOTO_UPLOAD_SETUP.md`（照片存 GitHub）、`FRONTEND_REQUIREMENTS.md`（V3 需求）、`267-identity-rollout.md`／`267-identity-dry-run.json`、`273-info-page.md`、`285-intake-events.md`、`390-intake-presentation.md`、`INTRO_REWRITE.md`、`mobile-ui-implementation-spec.md`、`mobile-ui-tickets-handoff.md`、`implementation-tickets/`。
