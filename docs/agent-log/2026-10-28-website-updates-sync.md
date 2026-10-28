# 管理網站「網站更新」改讀 GitHub Releases

- 日期：2026-10-28。Agent：Claude Code。
- 問題：管理網站「網站更新」頁停在 10/17。它讀建置時複製的 `public/website-updates.json`，這份要人工補，10/17 後沒人補；管理網站又只能手動部署，就算補了也要等有人按部署。
- 依據：K 2026-10-28 選 A——管理網站改讀 GitHub Releases。同一天 K 再決定「不用人工寫，把這拿掉」：志工網站的網站更新整個拿掉。
- 做了什麼：
  - `admin/public/js/release-notes.js`（純規則）＋ `releases.js`：瀏覽器直接讀公開 repo 的 Releases API，不帶登入。草稿／預先發布不列，日期換台灣日期，拿掉每條結尾的 PR／commit 連結，版本號連到 Release 頁；403／429 顯示 GitHub 限制次數。
  - 管理網站 CSP `connect-src` 多放 `https://api.github.com`。
  - `build-admin-assets.mjs` 不再複製 `website-updates.json`。
  - `release-please.yml` 加 `push` 觸發，只看 `.release-please-manifest.json`（只有 Release PR 會改）：合併就馬上打 tag、建 Release，不用等下週一。核對時發現 9.4.0 的 Release PR（#614）10/28 已合併但還沒打 tag，GitHub Releases 最新仍是 v9.3.0。
- 第二次推送（拿掉志工網站的網站更新）：
  - 資訊 → 更新紀錄直接顯示資料編輯，不再分「網站更新／資料編輯」兩個分頁；首頁卡片說明改成「誰、什麼時候改了哪些資料」。
  - 刪 `public/website-updates.json`、`docs/website-updates.md`；拿掉 `analysis.js` 的讀取與手機快取、`store.js` 的 `bq-website-updates` 鍵、相關 CSS。已在手機上的舊快取（幾百位元組）不主動清。
  - 管理網站網站更新頁拿掉志工開關標記（志工網站不再顯示這塊）；志工網站設定的開關說明改成「更新紀錄（資料編輯）」。側欄仍放在「志工網站」組，沒搬。
  - GLOSSARY、feature-settings、admin-records、admin-site-plan、admin.md、`public/js/README.md` 跟著改。
- 未完成／待 K：
  - 這張 PR 不改 manifest，合併後不會自動補 9.4.0；要馬上補就在 Actions 手動跑一次「版本號」，不然下週一（11/2）排程會補。
  - 管理網站仍要手動部署一次，新頁面才會上線；之後發版就不用再部署。
- 相關 PR：#731。
