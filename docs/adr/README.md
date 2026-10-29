# ADR 索引與開關現況

> 由 `node scripts/adr-index.mjs --write` 產生，不要手動改。新增 ADR、在開頭加「已由 [ADR NNNN] 修訂」、或改開關後重新產生；`scripts/adr-index.test.mjs` 會擋過期的索引。

## ADR

| 編號 | 決定 | 狀態 |
|---|---|---|
| [0001](0001-volunteer-data-follows-code.md) | 志工自己的資料跟著代號存 D1 | 部分或全部被 [0005](0005-volunteer-identity.md) 修訂，一起讀、以新的為準 |
| [0002](0002-activity-records.md) | 活動紀錄與已出所狗卡存 D1 | 現行 |
| [0003](0003-252-old-data-cleanup.md) | 舊資料與舊 D1 表清除（#252） | 現行 |
| [0004](0004-open-editing-and-edit-log.md) | 開放編輯與編輯紀錄 | 部分或全部被 [0020](0020-independent-admin-site.md) 修訂，一起讀、以新的為準 |
| [0005](0005-intake-date-from-oldest-number.md) | 入所日照最舊編號算，舊編號誰都能補 | 部分或全部被 [0021](0021-stays-carry-number.md) 修訂，一起讀、以新的為準 |
| [0005](0005-volunteer-identity.md) | 志工身分固定，登記名字可以更改與合併 | 現行 |
| [0006](0006-sheet-write-scope.md) | 網站寫入試算表的範圍 | 現行 |
| [0007](0007-today-walks-live.md) | 今日溜狗紀錄：其他手機很快看到今天溜過 | 部分或全部被 [0018](0018-today-walks-d1-event-sync.md) 修訂，一起讀、以新的為準 |
| [0008](0008-diff-sync-and-write-budget.md) | 同步只寫差異，D1 每天有寫入預算 | 部分或全部被 [0018](0018-today-walks-d1-event-sync.md) 修訂，一起讀、以新的為準 |
| [0009](0009-d1-read-versioned-packs.md) | 減少 D1 讀取：版本號＋資料包＋只讀今天 | 部分或全部被 [0010](0010-sync-recent-walks-only.md) 修訂，一起讀、以新的為準 |
| [0010](0010-sync-recent-walks-only.md) | 同步只比對最近一段溜狗紀錄，舊紀錄定下來 | 部分或全部被 [0018](0018-today-walks-d1-event-sync.md) 修訂，一起讀、以新的為準 |
| [0011](0011-intake-date-manual-backfill.md) | 每次出入所都可以補登，入所日取最早那次 | 部分或全部被 [0021](0021-stays-carry-number.md) 修訂，一起讀、以新的為準 |
| [0012](0012-sync-on-change.md) | 同步改成「有改才同步＋每天保險一次」 | 部分或全部被 [0010](0010-sync-recent-walks-only.md)、[0018](0018-today-walks-d1-event-sync.md) 修訂，一起讀、以新的為準 |
| [0013](0013-walks-recent-and-yearly.md) | 網站只拿近期溜狗紀錄，舊的按年拿，「我溜過的狗」由 Worker 彙總 | 現行 |
| [0014](0014-small-pack-split-and-settled-departures.md) | small 資料包拆成在所／離所，離所按年存，同步只讀最近 60 天的離所 | 現行 |
| [0015](0015-website-fixed-care.md) | 有人固定照顧完全由網站設定 | 現行 |
| [0016](0016-undo-walk-from-server-history.md) | 撤銷溜了改由伺服器找回上一次，不再限登記的那支手機 | 現行 |
| [0017](0017-frontend-es-modules.md) | 前端分段整理，最後改成 ES module | 現行 |
| [0018](0018-today-walks-d1-event-sync.md) | 今日溜狗以 D1 為準，有人編輯才同步、只送改動 | 現行 |
| [0019](0019-walker-names-in-d1.md) | 「誰遛的」原文存進 D1，公開檔案仍只放代號 | 現行 |
| [0020](0020-independent-admin-site.md) | 獨立管理網站與可控制的志工編輯 | 現行 |
| [0021](0021-stays-carry-number.md) | 一個編號就是一筆出入所紀錄 | 部分或全部被 [0022](0022-intro-is-the-dog-stays-hold-history.md) 修訂，一起讀、以新的為準 |
| [0022](0022-intro-is-the-dog-stays-hold-history.md) | 介紹只寫狗自己，出入所經過記在出入所紀錄 | 現行 |
| [0023](0023-share-site-and-share-count.md) | 分享網站：正式網址不進 repo，分享次數只記每天總數 | 現行 |
| [0024](0024-volunteer-site-urls.md) | 志工網站的網址：每個分頁、資訊子頁、每隻狗都有自己的 hash | 現行 |

## 網站開關

目前 `public/js/site-config.js` 沒有布林開關（`SITE.d1WalkAccept` 已隨舊寫回試算表路徑刪除）。

## Worker 讀的設定

| 名稱 | repo 裡的值 | 位置 |
|---|---|---|
| `ADMIN_KEY` | GitHub Secret，部署時帶上（值不在 repo） | deploy-cloudflare.yml |
| `D1_WALK_NOTIFY` | `1` | wrangler.jsonc 的 vars |
| `PREVIEW` | 只有預覽版設定 | preview-cloudflare.yml |
| `SHARE_URL` | repo 沒設定：正式環境只可能是手動加的 Cloudflare 密鑰（後台加的一般變數部署時會被 keep_vars: false 清掉） | — |
| `SHEET_WRITE_KEY` | GitHub Secret，部署時帶上（值不在 repo） | deploy-cloudflare.yml |
| `SHEET_WRITE_URL` | GitHub Secret，部署時帶上（值不在 repo） | deploy-cloudflare.yml |
| `SITE_ENV` | repo 沒設定：正式環境只可能是手動加的 Cloudflare 密鑰（後台加的一般變數部署時會被 keep_vars: false 清掉） | — |
| `SYNC_DAILY_BUDGET` | `40000` | wrangler.jsonc 的 vars |
| `SYNC_MAX_ROWS` | repo 沒設定：正式環境只可能是手動加的 Cloudflare 密鑰（後台加的一般變數部署時會被 keep_vars: false 清掉） | — |
| `SYNC_RETRY_DAILY_BUDGET` | `10000` | wrangler.jsonc 的 vars |
| `WALKER_KEY` | GitHub Secret，部署時帶上（值不在 repo） | deploy-cloudflare.yml |
| `WALK_RETRY_ENABLED` | `true` | wrangler.jsonc 的 vars |

## 排程（wrangler.jsonc）

- `5-59/10 * * * *`
- `23 1,5,15 * * *`
