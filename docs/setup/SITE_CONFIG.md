# 換一間收容所要改哪些地方

K 2026-10-10：「我希望網站當主人（未來），讓這個網站以後若其他收容所要用可以整個搬去用，所以有些東西要分離出來，但目前主人還是試算表。」

這份列出「板橋收容所專屬」的東西放在哪裡。目標是全部收進 `public/js/site-config.js`；還沒收進去的列在下面，之後一步一步搬。

## 已經收進 `public/js/site-config.js`

| 設定 | 用在哪裡 |
|---|---|
| `name`、`shelter`、`shelterShort` | 第一次打開的歡迎畫面、分析頁標題 |
| `days.amber`、`days.red` | 天數紅黃綠的門檻（溜狗表、列表、電腦版、找狗、分析） |
| `warnKeywords` | 備註警示關鍵字 |
| `zones`（key、name、match、team、color） | 電腦版簡報和分區分頁、圖鑑的隊伍和隊色 |
| `freeTeam` | 圖鑑裡不屬於任何一區的狗 |

`public/index.html`、`public/cards.html` 都在其他程式前面載入這個檔；測試（`tests/index.html`、`scripts/sync-sheet.test.mjs`）也是。

## 還沒收進去，換收容所時要另外改

- **靜態檔裡的站名**：`public/index.html` 的 `<title>`、頁首 `<h1>`、`apple-mobile-web-app-title`；`public/manifest.webmanifest` 的 name／short_name／description；`public/cards.html` 的標題、說明、卡包上的字（「板收圖鑑」「BQ ALL-STARS」）。
- **找狗的平面圖**：`public/js/find.js` 的 `FIND_ZONES`（各區在平面圖上的位置）、`FIND_FACILITIES`、`FIND_OUTLINE`、`findCageLayout()`（每一籠排在哪）。這是最大的一塊，每間收容所都不一樣。
- **試算表的長相**：`scripts/sync-sheet.mjs` 的分頁名稱（「主清單」「已出所」）、欄位標題的認法、離所原因關鍵字（`DEPARTURE_KEYWORDS`）；`apps-script/sheet-write.gs` 寫回的兩欄。主人換成網站（資料庫）之後這一塊就不需要了。
- **編號規則**：編號前 8 碼是入所日期（`public/js/app.js` 的 `idDate`、`public/js/cards.js` 的 `bqIntake`）。
- **部署**：`wrangler.jsonc`（Worker 名稱、`GITHUB_REPO`、R2 bucket）、`worker/src/index.js` 的預設 repo、`.github/workflows/` 的 Secret；`public/index.html` 開頭的舊網址轉址（只有板收需要）。
- **圖示、顏色**：`public/icons/`、`public/css/app.css` 的 `:root` 色票（病歷夾綠）。

## 接下來（K 2026-10-10 同意的順序）

1. 這份設定檔（本次）。
2. 資料搬進 Cloudflare 資料庫（D1），改成「現況＋異動紀錄」，舊的每日快照轉進去；試算表照舊是主人、照舊同步進來。動工前先給 K 看資料表設計。
3. 異動紀錄畫面和還原（像 Notion、Google 試算表的版本紀錄；K：不做管控，只要有紀錄可以恢復）。已完成：編輯紀錄頁 `edits.html`，通關碼已拿掉（ADR 0004）。
4. 管理頁面（直接編輯、報表）；K 再決定哪一天把主人從試算表切到網站。
