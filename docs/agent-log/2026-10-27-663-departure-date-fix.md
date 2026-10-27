# 2026-10-27 管理網站可以修正離所日（#663）

- Agent：Claude Code（Opus 5.5）
- 分支：`claude/departure-date-fix`

## 起因

#639 驗收時唯讀查正式 D1：納卡西（2026042101）的離所紀錄 `departed_date` 是 2026-10-08、`date_source='note'`，是同步從「已出所」分頁備註「被認養」前面的 10/8 讀來的。牠 10-10～10-15 還有溜狗紀錄，主清單最後溜狗日 10-18，K 判斷實際是 2026-10-18。出入所表有離所紀錄那列的離所日照離所紀錄，沒有地方能改；直接改 D1 的話，出所 60 天內同步碰到那列會從試算表重算蓋回去（`worker/src/dog-list.js`）。K 決定直接做修正功能。

## 做了什麼

- `worker/src/stays.js`：`cleanStayTable` 加 `{ admin }`；管理者送來的、有離所紀錄那列的離所日照送來的（不能清空、未來、早於入所日），志工的照舊不看。
- `worker/src/dog-edit.js`：管理者存出入所表時，離所日有變就在同一筆交易 `UPDATE v3_dog_departures SET departed_date=?, date_source='manual'`；編輯紀錄照常記改前／改後的出入所表。
- `worker/src/dog-list.js`：已記過的離所，`date_source='manual'` 時同步不改日期，原因、旗標照樣跟試算表。
- `admin/public/js/dog-editor.js`：有離所紀錄那列的離所日可以編輯，提示改成「離所日讀錯可以直接改，存檔後同步不會再改回去」。
- ADR 0021 補一句這個決定。
- 沒有 migration：`date_source` 本來就是自由文字；離所資料包靠既有 `packs_v3_dog_departures_UPDATE` 觸發器（換年份兩年都加 1）。

## 測試

`worker/test/stays.test.mjs`、`dog-edit.test.mjs`、`dog-list.test.mjs` 各加一組（先紅後綠）；`tests/admin-dog-edit.cjs` 原本檢查離所日唯讀，改成可編輯。

本機 `scripts/check-local.ps1`：node 全套 491 過、4 個失敗都在 `scripts/local-check.test.mjs`（測試入口自己的測試），乾淨的 main 上同樣失敗，跟本票無關；網頁測試全套通過。

## 未完成（要 K）

- 合併、部署管理網站後，在管理網站把納卡西的離所日改成 2026-10-18。
- 改完再唯讀查一次 D1 確認 `date_source='manual'`。
