# 資料流現況

資料在哪、誰寫、誰同步，以本檔為入口。最後核對：2026-10-28，main `c2da5f0`（逐項對照程式碼，見 [2026-10-28-architecture-data-flow.md](research/2026-10-28-architecture-data-flow.md)）。repo 的 migration 到 `0020`；正式庫實際套到哪一版，以 `node scripts/d1-migrations.mjs check --target production` 為準，本檔不記。開關與排程的即時值以自動產生的 `docs/adr/README.md` 為準；決定的理由看 ADR。

架構圖：[ARCHITECTURE.md](ARCHITECTURE.md)（Mermaid，跟其他專案同一套畫法）：主圖（誰連誰）、各類資料的流向、一天裡的排程、上線圖（正式／測試／預覽各綁什麼）、網站登記寫回試算表、試算表改動回到 D1、程式架構（worker/src 模組誰呼叫誰）。改了本檔的架構或排程，那份也要跟著改：名稱、時間、次數跟程式不一致時 `scripts/diagram-facts.test.mjs` 會失敗；PR 改到架構相關檔案卻沒改對應段落，「架構圖重畫提醒」（`scripts/diagram-reminder.mjs`）會在 PR 留言。管理網站「系統架構圖」頁也從那份產生（建置時把 Mermaid 畫成 SVG，顯示第幾版與更新日期，見 `admin/README.md`）。

## 改版終點（K 2026-10-24）

- **D1 是唯一正本**：網站讀 D1，網站上的操作先寫 D1。
- **試算表只剩人工輸入介面**：管理者直接改表，Apps Script（GAS）把改到的列推給 Worker。網站不讀表。
  - 例外（現況，尚未到終點）：志工網站的「加備註」「新增異動紀錄」仍由 Worker 經 GAS 直接寫表，不先存 D1、失敗不重試；程式寫表不觸發編輯觸發，D1 要等下一次狗清單保險掃描才收到（`worker/src/index.js` 的 note／log 分支）。
- **不再有 gviz 讀表、不再用 GitHub Actions 同步資料**。
- 前端整理完（#471 系列）。

還沒到終點的項目列在改版收尾母票 #538。

## 誰寫、怎麼同步

| 資料 | 寫入來源 | 進 D1 的方式 | 程式 |
|---|---|---|---|
| 今日溜狗（網站按溜了、復原、改溜狗人） | 網站 | 先存 D1（PR #533 起；舊的直接寫回試算表路徑已刪），再由 Worker 寫回試算表兩欄 | `worker/src/today-walks/`（今日溜狗紀錄 module，入口 `index.js`） |
| 今日溜狗（人工改試算表） | 管理者 | GAS 編輯觸發 → `POST /api/walk-writeback/rows`，Worker 只比那幾隻；狗清單同步發現溜狗欄變了也交同一筆觀測值（#747）；保險掃描用同一套規則收下（#746） | `apps-script/sheet-write.gs`、`worker/src/today-walks/observe.js`、`worker/src/dog-list.js` |
| 溜狗紀錄（每狗每天一筆；圖鑑、我溜過讀） | 網站、管理者 | 只由今日溜狗紀錄 module 寫（ADR 0018 補充，#747），跟今日溜狗同一批：網站按溜了／改溜狗人／復原照名單重寫今天或刪掉今天（稽核第 4 項，K 2026-10-26）；人工改表收下時，改到新的一天或同一天換人照表上名單重寫那天，改回較早的日子刪掉較新那天、那天照表寫，清空日期不刪。狗清單同步不寫，只把溜狗欄交給 module（見下方「人工改溜狗欄的先後」）；新建進主清單的狗那天還沒有才寫，寫法也由 module 給 | `worker/src/today-walks/version.js`、`worker/src/today-walks/observe.js` |
| 狗清單：主清單、已出所、常遛狗群 | 管理者 | GAS 編輯觸發 → `POST /api/walk-writeback/dog-list`，只寫有變的欄（#501）。網站讀 `/api/dogs` 時，遛狗日期以今日溜狗為準並附上今日紀錄（只在回應時換，不寫表；K 2026-10-26）。Worker 端遛狗日期、遛狗人另存溜狗日期包（`v3_pack_versions.walked`），只改這兩欄不讓在所資料包重算（#679） | `worker/src/dog-list.js`、`worker/src/today-walks/read.js` 的 `withTodayWalks` |
| 常溜狗群（網站狗群頁） | 管理者在試算表「常遛狗群」改 | GAS 編輯觸發送 D1（一欄一列 `v3_sheet_group_columns`，#559）；網站只讀（#474） | `worker/src/dog-list.js` |
| 休養、介紹、開卡、常溜、固定照顧、活動 | 網站 | 只存 D1，不碰試算表 | 見各 ADR |
| 合併重複的狗（試算表改編號多出來的，#621） | 管理網站 | 只存 D1，可在修改紀錄取消合併 | `worker/src/dog-merge.js` |
| 離所 | 管理者把狗搬到試算表「已出所」 | GAS 編輯觸發送 D1，以狗 ID 記在 `v3_dog_departures`（#560）；沒編號的狗還不能記離所（`worker/src/dog-list.js` 的 `applyDeparted`） | `worker/src/dog-list.js` |
| 功能顯示、志工可編輯 | 管理網站 | 只存 D1 `v3_feature_settings`（十項開關＋revision，清單在 `worker/src/feature-settings.js` 的 `SETTING_KEYS`；舊的 `editFormer` 已退役，讀取時拿掉；後加的 `showShare` 那列沒有時讀成關閉，ADR 0023），改動記在 `v3_feature_settings_log`（#565） | `docs/operations/feature-settings.md` |
| 狗資料（介紹、休養、固定照顧、出入所紀錄（含舊編號，ADR 0021）、照片、性別） | 志工網站或管理網站 | 只存 D1；每隻狗帶 revision，衝突回 409，修改和紀錄同一次寫入（#566）。試算表送來的狗名、編號、籠位、備註、離所在管理網站只能看 | `worker/src/dog-edit.js`、`docs/operations/dog-editing.md` |
| 照片 | 志工／Access 管理網站 | 共用前端縮圖，R2 不可覆寫版本＋D1 CAS 引用及紀錄；舊固定路徑相容，Actions 只供人工補圖（#566 承接 #546 契約） | `worker/src/dog-photo.js`、`public/js/photo-images.js` |
| 分享次數（ADR 0023） | 志工網站分享成功時 `POST /api/share` | 只存 D1 `v3_share_counts`（每天、每種方式一列，只記次數不記人）與 `v3_share_totals`（總數，一種方式一列）；管理網站志工網站設定頁讀 | `worker/src/share-counts.js` |
| 志工名字建議 `/walkers` | — | 讀 D1（#519） | ADR 0019 |

**人工改溜狗欄的先後**（#747）：GAS 同一次編輯先送改表通知（`/rows`）、再送狗清單（`/dog-list`），兩邊都把表上的值當成一筆觀測值交給今日溜狗紀錄。狗清單同步要在更新主清單複本之前交：沒有溜狗狀態的狗，基準值取自主清單複本，先更新就看不出有改。晚到的看到跟基準值一樣就不動；同時到時 version guard 只讓一個寫成，另一個不 ack，GAS 補送時就沒差異。溜狗紀錄寫一次、修改紀錄記一筆，跟哪個先到無關（`worker/test/dog-list-walks.test.mjs`）。

GAS 送不出去時把待送內容留在指令碼屬性（`WALK_EDITS_PENDING`、`DOG_LIST_PENDING`），每 10 分鐘補送；Worker 確認收到才清。

Apps Script 同一次執行會沿用第一次讀到的表內容，之後別人改的讀不到（#694 起處理）。所以有人改表、網站寫回改了格子都換一個表上變動記號（指令碼屬性 `SHEET_EDIT_MARK`）；執行讀表後記號被換掉就不送，待通知留給較新的執行或每 10 分鐘補送，舊讀值不會晚到蓋掉新的人工修改。核對記號與送出都在同一把 script lock 內（`flushWalkEdits`、`flushDogList`、`dogListScan` 每一批，#701），核對完到送出之間網站寫回插不進來。

## 排程

| 時間（台灣） | 做什麼 | 發起 |
|---|---|---|
| 每 10 分鐘（錯開 5 分） | 網站登記寫回試算表的重試；沒工作就結束、不讀表 | Worker cron |
| 09:23、13:23、23:23 | 今日溜狗保險掃描：按狗比指紋，只回不同的狗（#525）；排在 GAS `dogListScan` 可能跑的時段之前，避免搶鎖 | Worker cron → GAS `walkScan` |
| 09:43、13:53、23:53（Google 前後差 15 分鐘） | 狗清單保險掃描：指紋表的主清單 key 也拿來找消失的列（見下方「主清單的列消失」）；「D1 有、表沒有」每次記掃描時間，管理網站「資料檢查」顯示（#518／#567） | GAS 時間觸發 `dogListScan` |
| 每天 09:23 | 修改紀錄清理（ADR 0004 修訂），跟那次保險掃描同一個排程：`v3_edit_log` 超過 14 天的刪掉（連同 `v3_dog_edit_actors`），合併狗、取消合併的快照永久保留；只有 `editlog.js` 的 `pruneEdits` 會刪 | Worker cron |
| 每月 1 日 09:23 | 照片垃圾桶清理，跟那次保險掃描同一個排程：`trash/` 標記滿 30 天的備份刪掉；`photos/` 32 碼舊原圖與縮圖只在 D1 `v3_photos` 記得它、且 `is_primary=0` 時一起刪，並刪掉那列（D1 沒這列就不碰，防測試 D1 配正式 R2）；固定路徑 `photos/{編號}.jpg` 不刪。只剩縮圖的備份照代號開頭的時間清。一筆出錯記下來、接著清下一筆，出錯那筆的備份留到下個月；結果記在 `v3_sync_state.trash_purged`（`{at, purged, failed, errors}`），有失敗時 `cron_trash` 記成出錯（實際保留 30～約 61 天）。R2 不設 Lifecycle 刪除規則（K 2026-10-26） | Worker cron |

Cloudflare 排程上限算整個帳號，免費方案 5 個（稽核第 5 項，2026-10-26）：正式版 2 個（`5-59/10 * * * *`、`23 1,5,15 * * *`），測試網站只有寫回重試 1 個，預覽與管理 Worker 都不設。Worker 的四件排程工作每次跑完或出錯都記在 D1 `v3_sync_state` 的 `cron_retry`、`cron_scan`、`cron_trash`、`cron_editlog`（寫回重試每 10 分鐘寫這一列），管理網站「資料檢查」的「排程」顯示最後一次跑完的時間與最近失敗。

寫回重試有上限（#684，ADR 0018 補充）：試算表明確拒絕（沒設定、金鑰、試算表 ID、權限錯）失敗一次就停，其他錯誤第 10 次失敗後停。停住的工作在 `v3_walk_outbox` 照舊是 `retry`，`next_attempt_at` 設成 `9999-12-31T00:00:00.000Z`（`today-walks/dispatch.js` 的 `STOPPED_AT`），排程永遠撿不到；次數在 `v3_walk_retry.failures`。管理網站「資料檢查」的「停止重試的狗」列出來。志工網站的狗只看得到 `retry`，照舊顯示「寫回試算表失敗，會自動重試」。

重試另有每天上限（#685，ADR 0018 補充）：`v3_walk_write_budget` 每天一列，`reserved` 是全部保留量（跟 `SYNC_DAILY_BUDGET` 比），`retry` 是其中寫回重試的部分（跟 `SYNC_RETRY_DAILY_BUDGET` 比，`wrangler.jsonc` 設 10,000 列，K 2026-10-27 定）。失敗過的工作再派送才算重試；第一次派送、中斷後的恢復派送不算。上限用完時，`today-walks/dispatch.js` 的 `dispatchBatch` 把那些工作的 `next_attempt_at` 改成隔天 UTC 午夜，同一輪的第一次派送照送。

**主清單的列消失**（#771，ADR 0025；取代 K 2026-10-26「刪列再發生才處理」）：GAS 每次送狗清單（`/dog-list` 的 `mainKeys`）、保險掃描送指紋，都附上讀表那一刻主清單的全部單位 key；改到主清單卻算不出單位（例：清空最後一隻狗那列）也送一次。Worker 套用完這批列後，主清單複本有、表上沒有的列標成候選（`v3_sheet_main.missing_at` 記第一次不見的時間），網站照常顯示；候選又出現就清掉，不記紀錄。第一次不見後隔 `MISSING_CONFIRM_MS`（10 分鐘，GAS 一次執行最多 6 分鐘）以上再收到清單還是不見，才確認：整列移出主清單複本，狗的資料（溜狗紀錄、照片、介紹）不刪，管理網站顯示待核對，可以合併。Worker 回 `candidates: true` 時 GAS 記在指令碼屬性 `DOG_LIST_CANDIDATES`，下一次 10 分鐘補送沒有待送也再送一次清單，所以實際約 10～20 分鐘確認。一次請求最多處理 `MISSING_MAX`（10）個，其餘留給下一次；表上一個主清單 key 都沒有，或一次少了一半以上的狗，當成讀錯表，不處理。保險掃描送指紋前也在 script lock 內核對表上變動記號（讀表後有人改過就整次不送）。Google 刪整列不跑編輯觸發，要等下一次有人改表、補送或保險掃描才送到清單。程式在 `worker/src/dog-list.js` 的 `reconcileMissing`。同籠自動合併（#773）：要新建狗時，同一個籠位剛好只有一個不在表上、非暫住的列，就建新狗後由 `dog-merge.js` 的 `autoMergeDogs` 把那一列移出主清單、併到新狗（修改紀錄「系統自動合併」，可取消合併）；沒編號的括號暫用名不再用溜狗紀錄的名字找回舊狗。

**暫住列**（#772，ADR 0025）：主清單上「(皮蛋）」這種列（沒編號、犬名用括號包起來、括號裡去掉空白是主清單上一隻有編號的狗）不建狗，存成暫住紀錄 `v3_sheet_stays`（哪一隻、暫住哪一籠），修改紀錄記「暫住開始」。在所資料包照舊把這一列當成沒編號的一列、接在狗清單後面送出，志工網站照舊合到那隻狗（`public/js/app.js` 的 `mergeTempCages`）。暫住列消失照上面的候選規則確認，確認後刪掉暫住紀錄、記「暫住結束」。有編號的括號列、括號裡不是在所狗名的列（「(乳白)」暫用名）照舊當新狗。上線時 migration `0021` 把主清單複本上的暫住列轉成暫住紀錄，沒有其他資料的假狗刪掉。程式在 `worker/src/dog-list.js` 的 `applyStay`。

**可能是同一隻**（#774，ADR 0025）：確認消失的同一個 batch 記下那隻狗的籠位（`v3_sheet_gone`），同籠還在表上的狗如果同名、或是新出現的（`v3_sheet_main.added_at` 不早於第一次不見前一小時；#774 之前就在表上的列是 NULL），就記一組配對（`v3_dog_pairs`，狀態 pending／merged／not_same）。確認後 7 天內同籠新建狗，也跟這隻配對（同一批寫入）。管理網站資料頁待核對的狗名下顯示「可能跟 ○○（籠位）是同一隻」：「合併」開抽屜照現有合併狗（`mergeDogs` 同一批把這組記成 merged）；「不是同一隻」記成 not_same，修改紀錄記一筆（kind `not_same`，保留 14 天），按過的那組 `INSERT OR IGNORE` 不再建立。待補清單只顯示組數、連到資料頁待核對。程式在 `worker/src/dog-pairs.js`。

**系統自動判斷紀錄**（#775，ADR 0025）：自動合併、暫住開始與結束、可能是同一隻（建配對同一批記 kind `pair`）、不是同一隻都在 `v3_edit_log`，沒有另外的表。管理網站資料頁「系統自動判斷」與編輯抽屜讀 `/api/manage/edits?kind=judge`（抽屜加 `dog`；部分索引 `v3_edit_log_judge`，migration 0023），按鈕數字讀等確認的配對數。

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

測試網站長得跟正式版不一樣（K 2026-10-26）：設定帶 `SITE_ENV=test`，網頁也先經過 Worker（`run_worker_first` 列了每一頁），`worker/src/test-site.js` 在送出前給 `<html>` 加 `data-site="test"`、標題加「測試｜」、換網址列顏色、主畫面圖示（`public/icons/*-test.*`）與 `manifest-test.webmanifest`；各頁 CSS 依這個屬性把頁首換成測試紫並加「測試版」標籤。正式版不設 `SITE_ENV`、網頁不經過 Worker，不受影響。`public/` 新增網頁要加進 `run_worker_first`（`worker/test/test-site.test.mjs` 會抓）。

測試網站和 PR 預覽共用同一個測試 D1：手動跑「準備預覽資料庫」（`seed-preview-db.yml`）會用正式 D1 整份覆蓋測試 D1，測試網站上實測的資料也會一起不見；測試照片空間不動。
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
