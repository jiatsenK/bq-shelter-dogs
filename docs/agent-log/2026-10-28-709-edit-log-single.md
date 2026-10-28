# 2026-10-28 修改紀錄寫入收成一個函式（#709）

- 日期：2026-10-28（台灣時間）
- Agent：Claude Code
- 分支：`claude/709-edit-log-single`
- 依據：#709（#671／#672 系列 retro）

## 做了什麼

- `worker/src/editlog.js` 新增 `editLogWrites`：全 repo 唯一一處 `INSERT INTO v3_edit_log`，回傳句子給呼叫端放進自己的 batch；`when` 條件、`actor`（管理網站 Access 身分／志工網站請求代號）照各處原本的寫法。
- 來源必填、只收 `EDIT_SOURCES`（access／volunteer／sheet），沒傳或不對丟錯。`logEdit` 的預設 `'volunteer'` 拿掉，`index.js` 兩個呼叫端明寫 `'volunteer'`；來源錯誤不會被 `logEdit` 的 try 吞掉。
- 改用它的 7 個檔：`walk-accept.js`、`editlog.js`（logEdit）、`dog-list.js`、`identity.js`、`dog-edit.js`、`dog-merge.js`、`admin/activities.js`。`admin/edits.js` 的 `SOURCES` 改由 `EDIT_SOURCES` 加上 `legacy`。
- 新測試 `worker/test/edit-log-single.test.mjs`：掃 `worker/src`（含子資料夾）只要 editlog.js 以外出現 `INSERT INTO v3_edit_log` 就失敗（暫時加一個檔驗證過會擋）；來源驗證；帶 actor 時的欄位內容。

## 行為不變的保守做法

- 原本寫 `v3_dog_edit_actors` 的三處（狗資料編輯、合併狗、管理網站活動），來源照舊記在 actors 那列，`v3_edit_log.source` 照舊留 NULL，不趁這次補值。
- 沒給條件時用 `VALUES(...)`、有條件時用 `SELECT ... WHERE 條件`，SQL 跟各處原本一樣（`SELECT ... WHERE 1` 會讓 `dog-merge.test.mjs` 的查詢計畫檢查看到 SCAN CONSTANT ROW）。網站按溜了那筆原本是 `SELECT ... WHERE 1`，現在是 `VALUES`，寫入的列一樣。
- 寫入預算（ADR 0008 `writeBudget`）沒動：`EDIT_LOG_COST` 與各 batch 的句數不變。

## 相關 PR

- （開好後補）
