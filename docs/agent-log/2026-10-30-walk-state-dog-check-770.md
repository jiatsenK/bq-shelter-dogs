# 2026-10-30 網站按溜了核對溜狗狀態的狗 ID（#770）

- Agent：Claude Code（Opus 5.5），分支 `claude/issue-770-5ac5cf`
- 依據：#770（母票 #768 的子票，同批 #769 由另一個 session 平行處理）

## 做了什麼

- `worker/src/today-walks/accept.js`：讀溜狗狀態時同一次 batch 讀主清單這隻（`MAIN_DOG`），主清單不是剛好一隻、或狗 ID 跟溜狗狀態記的不同，就回 409「找不到唯一的主清單狗」，跟 `observe.js` 收觀測值的檢查一樣。檢查在寫入之前，所以 D1 不寫、不派送寫回。溜了、改溜狗人、復原都走這裡。
- `worker/test/walk-accept.test.mjs`：新增「#770 溜狗狀態的狗 ID 跟主清單這隻不同時，網站登記回衝突」，從 `/api/walk` 打。先溜沒編號的暖暖建立名字那一份狀態，再模擬表上補編號，殘留的沒編號暖暖分兩種（主清單另一隻、已不在主清單）。斷言三種操作都 409、溜狗狀態／溜狗紀錄／寫回工作／修改紀錄都沒變、沒叫 Apps Script，有編號的暖暖照常成功。

## 例外與要注意的

- 讀溜狗狀態原本是一次查詢，改成兩個查詢併成一次 batch，往返次數不變。
- 同一個請求識別重送（replay）在檢查之前回原結果，跟原本一樣。
- 不動 Apps Script、不動 schema，不用重新部署 Apps Script 或套 migration，只要部署志工 Worker。

## 審查與測試

- Standards／Spec 兩軸審查（固定基準 main）沒有要補修的。留給之後判斷：主清單核對沒放進 `writeVersion` 的交易條件，讀到寫之間剛好有狗清單同步改主清單時理論上仍會通過，跟 `observe.js` 同樣的設計。
- 本機完整測試：node 627 項只有 `scripts/diagram-reminder.test.mjs` 失敗（新 worktree 的 `docs/ARCHITECTURE.md` 是 CRLF，#746 紀錄寫過的已知狀況，跟這次無關），網頁測試 255 項全過。

## 相關 PR

- （開 PR 後補）
