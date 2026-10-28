# 管理網站「網站更新」改讀 GitHub Releases

- 日期：2026-10-28。Agent：Claude Code。
- 問題：管理網站「網站更新」頁停在 10/17。它讀建置時複製的 `public/website-updates.json`，這份要人工補，10/17 後沒人補；管理網站又只能手動部署，就算補了也要等有人按部署。
- 依據：K 2026-10-28 選 A——管理網站改讀 GitHub Releases；志工網站那份維持人工寫白話版（`docs/website-updates.md` 的「不自動匯出 Git 歷史」只管志工版）。
- 做了什麼：
  - `admin/public/js/release-notes.js`（純規則）＋ `releases.js`：瀏覽器直接讀公開 repo 的 Releases API，不帶登入。草稿／預先發布不列，日期換台灣日期，拿掉每條結尾的 PR／commit 連結，版本號連到 Release 頁；403／429 顯示 GitHub 限制次數。
  - 管理網站 CSP `connect-src` 多放 `https://api.github.com`。
  - `build-admin-assets.mjs` 不再複製 `website-updates.json`。
  - `release-please.yml` 加 `push` 觸發，只看 `.release-please-manifest.json`（只有 Release PR 會改）：合併就馬上打 tag、建 Release，不用等下週一。核對時發現 9.4.0 的 Release PR（#614）10/28 已合併但還沒打 tag，GitHub Releases 最新仍是 v9.3.0。
- 未完成／待 K：
  - 這張 PR 不改 manifest，合併後不會自動補 9.4.0；要馬上補就在 Actions 手動跑一次「版本號」，不然下週一（11/2）排程會補。
  - 管理網站仍要手動部署一次，新頁面才會上線；之後發版就不用再部署。
  - 志工網站的 `website-updates.json` 10/17 之後的白話紀錄沒有補，本次範圍外。
- 相關 PR：見本分支 PR。
